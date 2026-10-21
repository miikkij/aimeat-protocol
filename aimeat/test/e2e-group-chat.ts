// E2E: group chat on the Messages page (wish-ryhm-keskustelu-viestit-puolelle).
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=group-chat
//
// The four rulings, each with its failure mode (Jouni, 2026-10-21):
//  - members live on this node: another node's identity, and a name with no account, are refused per
//    person and the group opens without them (1);
//  - a person joins directly only when their contacts accept the one adding them; anybody else is
//    invited, reads nothing and cannot write until they accept, and can decline (1, 3, 4, 8);
//  - a member who joins later sees what is written from then on, and the list shows the group at once
//    with no message in it yet (4);
//  - the one who opened it manages the members; another member is refused, a removed member is out,
//    and when the manager leaves the next person manages it (5, 6, 7).
// And the doors: the aimeat_dm_group_* MCP tools call the same services (9), `as_owner` needs
// messages:send-as-owner (9), and a support thread's members are not chosen by hand (10).

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: as(token), body: JSON.stringify(body) });
const get = (path: string, token: string) => json(path, { headers: as(token) });

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';
import { ownerSignIn } from './helpers/owner-login.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ } }
    return out;
}

/** OAuth PATH A (agent signature) + MCP session init for one agent. Returns a tool caller. */
async function connectMcp(gaii: string, privKey: string) {
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'group-chat-e2e' }) });
    const clientId = reg.body.client_id as string;
    const clientSecret = reg.body.client_secret as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + NODE_ID + timestamp);
    const pkce = mcpPkce(BASE);
    const auth = await json(`/v1/mcp/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, gaii, signature, timestamp, ...authorizeParams(pkce) })}`);
    const code = auth.body.code as string;
    assert(typeof code === 'string', `authorize returned code (${JSON.stringify(auth.body)})`);
    const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, ...tokenParams(pkce) }) });
    const token = tok.body.access_token as string;
    assert(typeof token === 'string', `token exchange (${JSON.stringify(tok.body)})`);
    let sessionId = '';
    let nextId = 1;
    async function rpc(method: string, params: Record<string, unknown>) {
        const id = nextId++;
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json();
    }
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'group-chat-e2e', version: '1.0.0' } });
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const text = body.result?.content?.[0]?.text ?? '';
        let data: any = {};
        try { data = JSON.parse(text); } catch { /* an error text */ }
        return { ok: body.error === undefined && body.result?.isError !== true, text, data };
    };
}

async function registerOwner(name: string): Promise<{ ghii: string; token: string }> {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'GroupChat12345' }) });
    assert(ghii.status === 201, `ghii ${name} ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const tk = await ownerSignIn(BASE, name, 'GroupChat12345');
    return { ghii: `${name}@${NODE_ID}`, token: tk.body.data.token as string };
}

async function createAgent(ownerName: string, ownerToken: string, name: string, scopes: string[]): Promise<{ gaii: string; key: string }> {
    const r = await post('/v1/agents', ownerToken, { name, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes });
    assert(r.status === 201, `register ${name} ${r.status}: ${JSON.stringify(r.body)}`);
    return { gaii: r.body.data.agent.gaii as string, key: r.body.data.private_key as string };
}

console.log('\n=== AIMEAT Group chat E2E ===\n');

const stamp = Date.now();
const aliceName = `gcalice${stamp}`;
const bobName = `gcbob${stamp}`;
const carolName = `gccarol${stamp}`;
let alice = { ghii: '', token: '' };
let bob = { ghii: '', token: '' };
let carol = { ghii: '', token: '' };
let groupId = '';

await test('Setup: Alice, Bob and Carol; Bob accepts Alice as a contact, Carol accepts nobody', async () => {
    // The first account on a node is its operator, and every new account accepts the operator through
    // the welcome message the node sends it. So the operator joins anybody to a group directly, as an
    // operator's 1:1 message lands in anybody's inbox. That account is somebody else here, so Alice's
    // rights are an ordinary person's.
    await registerOwner(`gcop${stamp}`);
    alice = await registerOwner(aliceName);
    bob = await registerOwner(bobName);
    carol = await registerOwner(carolName);
    const dm = await post('/v1/messages', alice.token, { to: bob.ghii, body: 'Hi Bob' });
    assert(dm.status === 201, `first DM ${dm.status}`);
    const acc = await json(`/v1/messages/requests/${encodeURIComponent(alice.ghii)}/accept`, { method: 'POST', headers: as(bob.token) });
    assert(acc.status === 200, `Bob accepts Alice ${acc.status}: ${JSON.stringify(acc.body)}`);
});

await test('1. Alice opens a group: Bob is added, Carol invited, a missing name and another node refused', async () => {
    const r = await post('/v1/messages/groups', alice.token, {
        members: [bobName, carol.ghii, `nobody${stamp}`, 'zed@other-node'], subject: 'Weekend plans', body: 'Who is in for Saturday?',
    });
    assert(r.status === 201, `create ${r.status}: ${JSON.stringify(r.body)}`);
    const d = r.body.data;
    groupId = d.conversation_id;
    const outcome = (id: string) => (d.members as any[]).find(m => m.identity === id);
    assert(outcome(bob.ghii)?.result === 'added', `Bob ${JSON.stringify(outcome(bob.ghii))}`);
    assert(outcome(carol.ghii)?.result === 'invited', `Carol ${JSON.stringify(outcome(carol.ghii))}`);
    assert(outcome(`nobody${stamp}@${NODE_ID}`)?.code === 'NOT_FOUND', `missing ${JSON.stringify(d.members)}`);
    assert(outcome('zed@other-node')?.code === 'CROSS_NODE_UNSUPPORTED', `foreign ${JSON.stringify(d.members)}`);
    assert(d.manager === alice.ghii && d.you_manage === true, `manager ${d.manager}`);
    assert(d.participants.includes(bob.ghii) && !d.participants.includes(carol.ghii) && d.invited.includes(carol.ghii), `membership ${JSON.stringify(d)}`);
});

await test('1b. A group with nobody who can join is refused NO_MEMBERS, and nothing is written', async () => {
    const r = await post('/v1/messages/groups', alice.token, { members: ['zed@other-node'], subject: 'Nobody', body: 'Anyone?' });
    assert(r.status === 400 && r.body.error?.code === 'NO_MEMBERS', `${r.status} ${JSON.stringify(r.body.error)}`);
    const convs = await get('/v1/messages/conversations', alice.token);
    assert(!(convs.body.data.conversations as any[]).some(c => c.subject === 'Nobody'), 'a refused group left a row');
});

await test('2. Bob has the group in his list and its first message, and writes in it', async () => {
    const convs = await get('/v1/messages/conversations', bob.token);
    const row = (convs.body.data.conversations as any[]).find(c => c.conversationId === groupId);
    assert(row?.groupAlias === `group:${groupId}`, `Bob's row ${JSON.stringify(row)}`);
    assert(row.participants.includes(alice.ghii), 'the row names the members');
    const thread = await get(`/v1/messages/conversations/${groupId}`, bob.token);
    assert((thread.body.data.messages as any[]).some(m => m.body === 'Who is in for Saturday?'), 'Bob reads the first message');
    const send = await post('/v1/messages', bob.token, { conversation_id: groupId, body: 'I am in' });
    assert(send.status === 201, `Bob writes ${send.status}`);
});

await test('3. Carol, invited, sees the invitation but not the group: no read, no write, no members', async () => {
    const inv = await get('/v1/messages/groups/invitations', carol.token);
    const mine = (inv.body.data.invitations as any[]).find(i => i.conversation_id === groupId);
    assert(mine?.subject === 'Weekend plans' && mine.invited_by === alice.ghii, `invitation ${JSON.stringify(inv.body.data)}`);
    const thread = await get(`/v1/messages/conversations/${groupId}`, carol.token);
    assert((thread.body.data.messages ?? []).length === 0, 'Carol read messages before accepting');
    const send = await post('/v1/messages', carol.token, { conversation_id: groupId, body: 'early' });
    assert(send.status === 403 && send.body.error?.code === 'NOT_A_PARTICIPANT', `Carol writes ${send.status}`);
    const members = await get(`/v1/messages/groups/${groupId}`, carol.token);
    assert(members.status === 404, `Carol reads the members ${members.status}`);
    const convs = await get('/v1/messages/conversations', carol.token);
    assert(!(convs.body.data.conversations as any[]).some(c => c.conversationId === groupId), 'the group is in Carol\'s list');
});

await test('4. Carol accepts: the group is in her list at once, and she gets what is written from then on only', async () => {
    const r = await post(`/v1/messages/groups/${groupId}/invitation`, carol.token, { accept: true });
    assert(r.status === 200 && r.body.data.accepted === true, `accept ${r.status}: ${JSON.stringify(r.body)}`);
    const convs = await get('/v1/messages/conversations', carol.token);
    const row = (convs.body.data.conversations as any[]).find(c => c.conversationId === groupId);
    assert(row?.messageCount === 0 && row?.subject === 'Weekend plans', `empty row ${JSON.stringify(row)}`);
    await post('/v1/messages', alice.token, { conversation_id: groupId, body: 'Welcome Carol' });
    const thread = await get(`/v1/messages/conversations/${groupId}`, carol.token);
    const bodies = (thread.body.data.messages as any[]).map(m => m.body);
    assert(bodies.includes('Welcome Carol'), `Carol gets the new message ${JSON.stringify(bodies)}`);
    assert(!bodies.includes('Who is in for Saturday?') && !bodies.includes('I am in'), `Carol got the history ${JSON.stringify(bodies)}`);
    const again = await post(`/v1/messages/groups/${groupId}/invitation`, carol.token, { accept: true });
    assert(again.status === 404 && again.body.error?.code === 'NOT_INVITED', `second accept ${again.status}`);
});

await test('5. Bob is a member, not the manager: adding somebody is refused NOT_THE_MANAGER', async () => {
    const r = await post(`/v1/messages/groups/${groupId}/members`, bob.token, { add: [carol.ghii] });
    assert(r.status === 403 && r.body.error?.code === 'NOT_THE_MANAGER', `${r.status} ${JSON.stringify(r.body.error)}`);
    const view = await get(`/v1/messages/groups/${groupId}`, bob.token);
    assert(view.status === 200 && view.body.data.you_manage === false, `Bob's view ${JSON.stringify(view.body.data)}`);
});

await test('6. Alice removes Bob: he can no longer write or read the members, and the manager cannot be removed', async () => {
    const r = await post(`/v1/messages/groups/${groupId}/members`, alice.token, { remove: [bob.ghii, alice.ghii] });
    assert(r.status === 200, `remove ${r.status}: ${JSON.stringify(r.body)}`);
    const out = r.body.data.members as any[];
    assert(out.some(m => m.identity === bob.ghii && m.result === 'removed'), `Bob ${JSON.stringify(out)}`);
    assert(out.some(m => m.identity === alice.ghii && m.code === 'IS_MANAGER'), `Alice ${JSON.stringify(out)}`);
    const send = await post('/v1/messages', bob.token, { conversation_id: groupId, body: 'still here?' });
    assert(send.status === 403, `Bob writes after removal ${send.status}`);
    const view = await get(`/v1/messages/groups/${groupId}`, bob.token);
    assert(view.status === 404, `Bob reads members after removal ${view.status}`);
});

await test('7. Alice leaves: Carol, the next person, manages the group', async () => {
    const r = await post(`/v1/messages/groups/${groupId}/leave`, alice.token, {});
    assert(r.status === 200 && r.body.data.manager === carol.ghii, `leave ${r.status}: ${JSON.stringify(r.body)}`);
    const view = await get(`/v1/messages/groups/${groupId}`, carol.token);
    assert(view.body.data.you_manage === true && !view.body.data.participants.includes(alice.ghii), `Carol's view ${JSON.stringify(view.body.data)}`);
    const send = await post('/v1/messages', alice.token, { conversation_id: groupId, body: 'gone' });
    assert(send.status === 403, `Alice writes after leaving ${send.status}`);
});

await test('8. Declining an invitation leaves Carol out and clears it', async () => {
    const r = await post('/v1/messages/groups', bob.token, { members: [carol.ghii], subject: 'Bob asks', body: 'Join?' });
    assert(r.status === 201 && r.body.data.invited.includes(carol.ghii), `create ${r.status}: ${JSON.stringify(r.body)}`);
    const id = r.body.data.conversation_id;
    const no = await post(`/v1/messages/groups/${id}/invitation`, carol.token, { accept: false });
    assert(no.status === 200 && no.body.data.accepted === false, `decline ${no.status}`);
    const inv = await get('/v1/messages/groups/invitations', carol.token);
    assert(!(inv.body.data.invitations as any[]).some(i => i.conversation_id === id), 'the invitation is still open');
    const send = await post('/v1/messages', carol.token, { conversation_id: id, body: 'after declining' });
    assert(send.status === 403, `Carol writes after declining ${send.status}`);
});

await test('9. MCP: an agent opens a group as itself, and in its owner\'s name only with messages:send-as-owner', async () => {
    const plain = await createAgent(aliceName, alice.token, 'gcplain', ['messages:send', 'messages:read']);
    const deleg = await createAgent(aliceName, alice.token, 'gcdeleg', ['messages:send', 'messages:read', 'messages:send-as-owner']);
    const plainCall = await connectMcp(plain.gaii, plain.key);
    const own = await plainCall('aimeat_dm_group_create', { members: [bob.ghii], subject: 'Agent group', body: 'From the agent' });
    assert(own.ok && own.data.manager === plain.gaii, `as itself ${own.text}`);
    const got = await plainCall('aimeat_dm_group_get', { conversation_id: own.data.conversation_id });
    assert(got.ok && got.data.you_manage === true, `get ${got.text}`);
    const refused = await plainCall('aimeat_dm_group_create', { members: [bob.ghii], subject: 'In Alice\'s name', body: 'x', as_owner: true });
    assert(!refused.ok && /SCOPE_DENIED/.test(refused.text), `as_owner without the word ${refused.text}`);
    const delegCall = await connectMcp(deleg.gaii, deleg.key);
    const named = await delegCall('aimeat_dm_group_create', { members: [bob.ghii], subject: 'In Alice\'s name', body: 'Written by my agent', as_owner: true });
    assert(named.ok && named.data.manager === alice.ghii, `as owner ${named.text}`);
    const thread = await get(`/v1/messages/conversations/${named.data.conversation_id}`, bob.token);
    const m = (thread.body.data.messages as any[]).find(x => x.body === 'Written by my agent');
    assert(m?.senderGhii === alice.ghii && m?.sentByAgent === deleg.gaii, `Bob's copy ${JSON.stringify(m && { s: m.senderGhii, a: m.sentByAgent })}`);

    // The other tools: the manager adds, nobody else does, an answer needs an invitation, and leaving works.
    const added = await plainCall('aimeat_dm_group_members', { conversation_id: own.data.conversation_id, add: [carol.ghii] });
    assert(added.ok && added.data.invited.includes(carol.ghii), `members ${added.text}`);
    // Bob is a member through his own account, so his agent is in the group too, and is not its manager.
    const bobbot = await createAgent(bobName, bob.token, 'gcbobbot', ['messages:send', 'messages:read']);
    const notManager = await (await connectMcp(bobbot.gaii, bobbot.key))('aimeat_dm_group_members', { conversation_id: own.data.conversation_id, add: [carol.ghii] });
    assert(!notManager.ok && /NOT_THE_MANAGER/.test(notManager.text), `a member who does not manage changed members ${notManager.text}`);
    const invitations = await plainCall('aimeat_dm_group_invitations', {});
    assert(invitations.ok && Array.isArray(invitations.data.invitations), `invitations ${invitations.text}`);
    const noInvite = await plainCall('aimeat_dm_group_answer', { conversation_id: named.data.conversation_id, accept: true });
    assert(!noInvite.ok && /NOT_INVITED/.test(noInvite.text), `an answer with no invitation ${noInvite.text}`);
    const left = await plainCall('aimeat_dm_group_leave', { conversation_id: own.data.conversation_id });
    assert(left.ok && left.data.left === true, `leave ${left.text}`);
});

await test('9b. A stranger and an anonymous caller are refused on every group route', async () => {
    const dave = await registerOwner(`gcdave${stamp}`);
    const asDave = { 'Content-Type': 'application/json', Authorization: `Bearer ${dave.token}` };
    const members = await json(`/v1/messages/groups/${groupId}/members`, { method: 'POST', headers: asDave, body: JSON.stringify({ add: [dave.ghii] }) });
    assert(members.status === 403, `a stranger adds himself ${members.status}`);
    const leave = await json(`/v1/messages/groups/${groupId}/leave`, { method: 'POST', headers: asDave, body: '{}' });
    assert(leave.status === 403, `a stranger leaves ${leave.status}`);
    const create = await json('/v1/messages/groups', { method: 'POST', body: JSON.stringify({ members: [bob.ghii], subject: 'x', body: 'x' }) });
    // With anonymous mode on the caller is the anonymous identity rather than nobody, and is refused 403.
    assert(create.status === 401 || create.status === 403, `anonymous create ${create.status}`);
    const answer = await json(`/v1/messages/groups/${groupId}/invitation`, { method: 'POST', body: JSON.stringify({ accept: true }) });
    assert(answer.status === 401 || answer.status === 403, `anonymous answer ${answer.status}`);
});

await test('10. A support thread\'s members are not chosen by hand (NOT_A_GROUP)', async () => {
    const s = await post('/v1/messages', bob.token, { to: 'support@operators', subject: 'Help', body: 'A question' });
    assert(s.status === 201 && s.body.data.conversation_id, `support ${s.status}: ${JSON.stringify(s.body)}`);
    const r = await post(`/v1/messages/groups/${s.body.data.conversation_id}/members`, bob.token, { add: [carol.ghii] });
    assert(r.status === 400 && r.body.error?.code === 'NOT_A_GROUP', `${r.status} ${JSON.stringify(r.body.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
