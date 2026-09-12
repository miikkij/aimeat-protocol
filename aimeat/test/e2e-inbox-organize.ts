/**
 * @file e2e-inbox-organize.ts
 * @description E2E: the Messages list in sections, the archive, and the rules, through the real doors
 *   and the real storage (the conversation summary's new fields are SQL on each backend, and a fold or
 *   a return from the archive is only as right as those fields).
 *
 *   - rows land in sections: another person's thread with the people, the owner's own agents' threads
 *     in their own section;
 *   - copies one agent sent in a loop with one subject fold into one row, and stay folded when another
 *     of the owner's agents answers (the ACK the owner asked to hide);
 *   - an archived thread stays archived when an own agent writes, and comes back when a person or the
 *     owner does; restoring keeps it out of the archive;
 *   - a group rule moves threads under its heading, a rule over everything with nothing to match is
 *     refused, the settings persist and switching folding off unfolds;
 *   - an agent holding messages:organize-as-owner archives and changes rules over MCP, and the list the
 *     owner reads changes with it; a `*` agent is refused on REST and cannot see the tools;
 *   - CROSS-OWNER: another owner's agent with the word archives into ITS owner's record and never this one;
 *   - the record is reserved: an agent writing into the owner's namespace cannot forge it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=inbox-organize
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial, with the Messages list's sections, rules and archive.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

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
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const put = (path: string, token: string, body: unknown) => json(path, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const line of text.split('\n')) if (line.startsWith('data:')) { try { out.push(JSON.parse(line.slice(5).trim())); } catch { /* not a JSON event line */ } }
    return out;
}

interface McpClient {
    list(): Promise<string[]>;
    call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: any }>;
}

/** OAuth PATH A (agent signature) + MCP session init for one agent. Returns a tool client. */
async function connectMcp(gaii: string, privKey: string): Promise<McpClient> {
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'org-e2e' }) });
    const clientId = reg.body.client_id as string;
    const clientSecret = reg.body.client_secret as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + NODE_ID + timestamp);
    const auth = await json(`/v1/mcp/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, gaii, signature, timestamp })}`);
    const code = auth.body.code as string;
    assert(typeof code === 'string', `authorize returned code (${JSON.stringify(auth.body)})`);
    const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret }) });
    const token = tok.body.access_token as string;
    assert(typeof token === 'string', `token exchange (${JSON.stringify(tok.body)})`);
    let sessionId = '';
    async function rpc(method: string, params: Record<string, unknown>, id: number) {
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
        const body = ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json();
        return { status: res.status, body };
    }
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'org-e2e', version: '1.0.0' } }, 1);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return {
        async list() { const { body } = await rpc('tools/list', {}, 2); return (body.result?.tools ?? []).map((t: any) => t.name); },
        async call(name, args) { const { body } = await rpc('tools/call', { name, arguments: args }, 3); return { ok: body.error === undefined && body.result?.isError !== true, body }; },
    };
}
const toolResult = (body: any): any => { try { return JSON.parse(body.result?.content?.[0]?.text ?? '{}'); } catch { return {}; } };

async function registerOwner(name: string): Promise<{ name: string; ghii: string; token: string }> {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'OrgTest12345' }) });
    assert(ghii.status === 201, `ghii ${name} ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const key = ghii.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(key, name + NODE_ID + ts) }) });
    return { name, ghii: `${name}@${NODE_ID}`, token: tk.body.data.token as string };
}

async function createAgent(ownerName: string, ownerToken: string, name: string, scopes: string[]): Promise<{ gaii: string; key: string; token: string }> {
    const r = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes }),
    });
    assert(r.status === 201, `register ${name} ${r.status}: ${JSON.stringify(r.body)}`);
    const gaii = r.body.data.agent.gaii as string;
    const key = r.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(key, gaii + ts) }) });
    assert(tk.body?.ok === true, `agent token ${name}: ${JSON.stringify(tk.body)}`);
    return { gaii, key, token: tk.body.data.token as string };
}

async function sendDm(fromToken: string, body: Record<string, unknown>): Promise<{ id: string; conversationId: string }> {
    const r = await post('/v1/messages', fromToken, body);
    assert(r.status === 201, `send ${r.status}: ${JSON.stringify(r.body)}`);
    return { id: r.body.data.message.id, conversationId: r.body.data.message.conversationId };
}

/** Alice's list, flattened: every row, folded copies included, by conversation id. */
async function listOf(token: string): Promise<{ rows: any[]; byId: Map<string, any> }> {
    const r = await json('/v1/messages/conversations', bearer(token));
    assert(r.status === 200, `conversations ${r.status}: ${JSON.stringify(r.body)}`);
    const rows = r.body.data.conversations as any[];
    const byId = new Map<string, any>();
    for (const c of rows) { byId.set(c.conversationId, c); for (const f of c.folded ?? []) byId.set(f.conversationId, { ...f, _foldedUnder: c.conversationId }); }
    return { rows, byId };
}

console.log('\n=== AIMEAT Messages list: sections, archive and rules E2E ===\n');

const stamp = Date.now();
const SUBJECT = `Lifecycle update ${stamp}`;
let alice = { name: '', ghii: '', token: '' };
let bob = { name: '', ghii: '', token: '' };
let announcer = { gaii: '', key: '', token: '' };
let worker1 = { gaii: '', key: '', token: '' };
let worker2 = { gaii: '', key: '', token: '' };
let orgbot = { gaii: '', key: '', token: '' };
let broadbot = { gaii: '', key: '', token: '' };
let ownerwriter = { gaii: '', key: '', token: '' };
let bobbot = { gaii: '', key: '', token: '' };
let toW1 = { id: '', conversationId: '' };
let toW2 = { id: '', conversationId: '' };
let bobThread = { id: '', conversationId: '' };

await test('Setup: two owners, their agents, a loop-sent announcement and a person writing', async () => {
    alice = await registerOwner(`orgalice${stamp}`);
    bob = await registerOwner(`orgbob${stamp}`);
    announcer = await createAgent(alice.name, alice.token, 'announcer', ['messages:send', 'messages:read']);
    worker1 = await createAgent(alice.name, alice.token, 'worker1', ['messages:send', 'messages:read']);
    worker2 = await createAgent(alice.name, alice.token, 'worker2', ['messages:send', 'messages:read']);
    orgbot = await createAgent(alice.name, alice.token, 'orgbot', ['messages:read-as-owner', 'messages:organize-as-owner']);
    broadbot = await createAgent(alice.name, alice.token, 'broadbot', ['*']);
    ownerwriter = await createAgent(alice.name, alice.token, 'ownerwriter', ['memory:write', 'memory:write-as-owner']);
    bobbot = await createAgent(bob.name, bob.token, 'bobbot', ['messages:organize-as-owner']);

    // The loop the fold is for: one subject, one sender, two recipients, no broadcast id.
    toW1 = await sendDm(announcer.token, { to: worker1.gaii, subject: SUBJECT, body: 'Please acknowledge.' });
    toW2 = await sendDm(announcer.token, { to: worker2.gaii, subject: SUBJECT, body: 'Please acknowledge.' });
    bobThread = await sendDm(bob.token, { to: alice.ghii, body: `bob writes ${stamp}` });
    // First contact from bob lands in alice's requests; accepting puts it in the list.
    const acc = await post(`/v1/messages/requests/${encodeURIComponent(bob.ghii)}/accept`, alice.token, {});
    assert(acc.status === 200, `accept bob ${acc.status}: ${JSON.stringify(acc.body)}`);
});

await test('1. A person lands with the people, the owner\'s agents in their own section, and the loop folds', async () => {
    const { byId } = await listOf(alice.token);
    assert(byId.get(bobThread.conversationId)?.section === 'people', `bob's thread: ${JSON.stringify(byId.get(bobThread.conversationId))}`);
    const w1 = byId.get(toW1.conversationId);
    const w2 = byId.get(toW2.conversationId);
    assert(w1?.section === 'agents' && w2?.section === 'agents', `agent threads: ${JSON.stringify([w1, w2])}`);
    assert(w1.openedBy === announcer.gaii && w1.openedTo === worker1.gaii && !!w1.openedAt, `the opener fields: ${JSON.stringify(w1)}`);
    assert(!w1.lastForeignAt, `only alice's agents wrote there, so nothing foreign: ${JSON.stringify(w1)}`);
    // Alice's mailbox counts her agents' copies as unread, and none of it is addressed to her.
    assert(w1.unread >= 1 && w1.unreadToOwner === 0, `unread for alice herself: ${JSON.stringify(w1)}`);
    const toAlice = await sendDm(worker2.token, { to: alice.ghii, body: 'A question for you.' });
    const again = await listOf(alice.token);
    assert(again.byId.get(toAlice.conversationId)?.unreadToOwner === 1, `a message to alice is unread for her: ${JSON.stringify(again.byId.get(toAlice.conversationId))}`);
    const head = byId.get(toW1.conversationId)?._foldedUnder ? byId.get(byId.get(toW1.conversationId)._foldedUnder) : w1;
    assert(head?.fold?.kind === 'subject' && head.fold.count === 2, `the two copies should be one row: ${JSON.stringify(head)}`);
});

await test('2. Another of the owner\'s agents answering does not lift the row out of the fold', async () => {
    await sendDm(worker1.token, { to: announcer.gaii, conversation_id: toW1.conversationId, body: 'ACK' });
    const { rows, byId } = await listOf(alice.token);
    const w1 = byId.get(toW1.conversationId);
    assert(!w1?.lastForeignAt, `an own agent's ACK is not foreign: ${JSON.stringify(w1)}`);
    const heads = rows.filter(r => r.fold?.kind === 'subject');
    assert(heads.length === 1 && heads[0].fold.count === 2, `still one folded row: ${JSON.stringify(heads)}`);
});

await test('3. Archiving: an own agent writing keeps it archived; a person writing brings it back', async () => {
    const arch = await post('/v1/messages/organize/archive', alice.token, { conversation_ids: [toW2.conversationId, bobThread.conversationId] });
    assert(arch.status === 200 && arch.body.data.archived === 2, `archive ${arch.status}: ${JSON.stringify(arch.body)}`);
    let { byId } = await listOf(alice.token);
    assert(byId.get(toW2.conversationId)?.archived?.reason === 'manual', `worker2's thread archived: ${JSON.stringify(byId.get(toW2.conversationId))}`);
    assert(byId.get(bobThread.conversationId)?.section === 'archive', 'bob\'s thread archived');

    await sendDm(worker2.token, { to: announcer.gaii, conversation_id: toW2.conversationId, body: 'ACK' });
    await sendDm(bob.token, { to: alice.ghii, conversation_id: bobThread.conversationId, body: `bob again ${stamp}` });
    ({ byId } = await listOf(alice.token));
    assert(byId.get(toW2.conversationId)?.section === 'archive', `an own agent's ACK must not bring it back: ${JSON.stringify(byId.get(toW2.conversationId))}`);
    assert(byId.get(bobThread.conversationId)?.section === 'people', `bob writing must bring it back: ${JSON.stringify(byId.get(bobThread.conversationId))}`);
});

await test('4. The owner writing into an archived agent thread brings it back; restore keeps a thread out', async () => {
    await post('/v1/messages/organize/archive', alice.token, { conversation_ids: [toW1.conversationId] });
    await sendDm(alice.token, { to: worker1.gaii, conversation_id: toW1.conversationId, body: 'Thanks, noted.' });
    let { byId } = await listOf(alice.token);
    assert(byId.get(toW1.conversationId)?.section === 'agents', `the owner writing is not own-agent traffic: ${JSON.stringify(byId.get(toW1.conversationId))}`);

    const back = await post('/v1/messages/organize/archive', alice.token, { conversation_ids: [toW2.conversationId], restore: true });
    assert(back.status === 200 && back.body.data.restored === 1, `restore ${back.status}: ${JSON.stringify(back.body)}`);
    ({ byId } = await listOf(alice.token));
    assert(byId.get(toW2.conversationId)?.section === 'agents', `restored: ${JSON.stringify(byId.get(toW2.conversationId))}`);
    const settings = await json('/v1/messages/organize', bearer(alice.token));
    assert(settings.body.data.kept_count === 1, `restore marks it kept: ${JSON.stringify(settings.body.data)}`);
});

await test('5. Rules: a group rule moves threads under its heading; a rule over everything with nothing to match is refused', async () => {
    const bad = await put('/v1/messages/organize', alice.token, { add_rule: { name: 'Everything', action: 'archive', match: { scope: 'all' } } });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_INPUT', `expected 400, got ${bad.status}: ${JSON.stringify(bad.body)}`);
    const unknown = await put('/v1/messages/organize', alice.token, { remove_rule: 'nosuchrule' });
    assert(unknown.status === 404, `removing a rule that is not there: ${unknown.status}`);
    const add = await put('/v1/messages/organize', alice.token, { add_rule: { name: 'Coordination', action: 'group', match: { subject: 'lifecycle update', scope: 'agents' } } });
    assert(add.status === 200 && add.body.data.rules.length === 1, `add rule ${add.status}: ${JSON.stringify(add.body)}`);
    const { byId } = await listOf(alice.token);
    const w2 = byId.get(toW2.conversationId);
    assert(w2?.section === 'group' && w2.group === 'Coordination', `under the rule's heading: ${JSON.stringify(w2)}`);
    assert(byId.get(bobThread.conversationId)?.section === 'people', 'a people thread is not touched by an agents rule');
});

await test('6. Settings persist, and switching folding off unfolds the copies', async () => {
    const r = await put('/v1/messages/organize', alice.token, { auto_archive: { days: 30 }, fold_same_subject: false });
    assert(r.status === 200, `settings ${r.status}: ${JSON.stringify(r.body)}`);
    const g = await json('/v1/messages/organize', bearer(alice.token));
    assert(g.body.data.auto_archive.enabled === true && g.body.data.auto_archive.days === 30 && g.body.data.fold_same_subject === false, `persisted: ${JSON.stringify(g.body.data)}`);
    const { rows } = await listOf(alice.token);
    assert(!rows.some(x => x.fold), `no subject fold with folding off: ${JSON.stringify(rows.filter(x => x.fold))}`);
    await put('/v1/messages/organize', alice.token, { fold_same_subject: true, remove_rule: add0(g.body.data.rules) });
});
function add0(rules: any[]): string { return rules[0]?.id; }

await test('7. An agent with messages:organize-as-owner archives and writes rules over MCP; the owner\'s list follows', async () => {
    const mcp = await connectMcp(orgbot.gaii, orgbot.key);
    const tools = await mcp.list();
    assert(tools.includes('aimeat_dm_archive_as_owner') && tools.includes('aimeat_dm_organize_as_owner'), `orgbot should see both tools: ${tools.filter(t => t.startsWith('aimeat_dm_')).join(',')}`);
    const read = await mcp.call('aimeat_dm_organize_as_owner', {});
    assert(read.ok && toolResult(read.body).auto_archive?.days === 30, `organize read: ${JSON.stringify(read.body)}`);
    const arch = await mcp.call('aimeat_dm_archive_as_owner', { conversation_ids: [bobThread.conversationId] });
    assert(arch.ok && toolResult(arch.body).archived === 1, `archive tool: ${JSON.stringify(arch.body)}`);
    const { byId } = await listOf(alice.token);
    assert(byId.get(bobThread.conversationId)?.section === 'archive', `alice's list follows the tool: ${JSON.stringify(byId.get(bobThread.conversationId))}`);
    const rule = await mcp.call('aimeat_dm_organize_as_owner', { add_rule: { name: 'Acks', action: 'fold', match: { body: 'ack' } } });
    assert(rule.ok && toolResult(rule.body).rules?.some((r: any) => r.name === 'Acks'), `rule tool: ${JSON.stringify(rule.body)}`);
    const inbox = await mcp.call('aimeat_dm_inbox_as_owner', { limit: 200 });
    const row = (toolResult(inbox.body).conversations ?? []).find((c: any) => c.conversation_id === bobThread.conversationId);
    assert(row?.section === 'archive' && row.archived?.reason === 'manual', `the inbox tool says where the row is: ${JSON.stringify(row)}`);
});

await test('8. A * agent is refused on REST and cannot see the tools: the word is outside every wildcard', async () => {
    for (const [path, body] of [['/v1/messages/organize/archive', { conversation_ids: [toW1.conversationId] }], ['/v1/messages/organize', { fold_same_subject: false }]] as const) {
        const r = path.endsWith('archive') ? await post(path, broadbot.token, body) : await put(path, broadbot.token, body);
        assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `${path}: expected SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(String(r.body.error?.message).includes('messages:organize-as-owner'), `${path}: the refusal names the word`);
    }
    const g = await json('/v1/messages/organize', bearer(broadbot.token));
    assert(g.status === 403, `GET for a * agent: ${g.status}`);
    const tools = await (await connectMcp(broadbot.gaii, broadbot.key)).list();
    assert(!tools.includes('aimeat_dm_archive_as_owner') && !tools.includes('aimeat_dm_organize_as_owner'), 'a * agent can see the organise tools');
});

await test('9. CROSS-OWNER: bob\'s agent archives into bob\'s record, never alice\'s', async () => {
    const r = await post('/v1/messages/organize/archive', bobbot.token, { conversation_ids: [toW1.conversationId] });
    assert(r.status === 200, `bobbot archive ${r.status}: ${JSON.stringify(r.body)}`);
    const { byId } = await listOf(alice.token);
    assert(byId.get(toW1.conversationId)?.section !== 'archive', `bob's agent archived alice's thread: ${JSON.stringify(byId.get(toW1.conversationId))}`);
    const bobs = await json('/v1/messages/organize', bearer(bob.token));
    assert(bobs.body.data.archived_count === 1, `the mark landed in bob's record: ${JSON.stringify(bobs.body.data)}`);
});

await test('10. The record is reserved: an agent writing into the owner\'s namespace cannot forge it', async () => {
    const r = await post('/v1/memory', ownerwriter.token, {
        key: 'messages.organize.settings', owner_scope: true, visibility: 'private',
        value: { archived: { [bobThread.conversationId]: new Date().toISOString() }, rules: [] },
    });
    assert(r.status === 403 && r.body.error?.code === 'RESERVED_KEY', `expected RESERVED_KEY, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('11. Validation and authentication', async () => {
    const empty = await post('/v1/messages/organize/archive', alice.token, { conversation_ids: [] });
    assert(empty.status === 400, `no ids: ${empty.status}`);
    const stray = await put('/v1/messages/organize', alice.token, { something: true });
    assert(stray.status === 400, `an unknown field: ${stray.status}`);
    for (const path of ['/v1/messages/organize']) {
        const r = await json(path);
        assert(r.status === 401, `${path}: expected 401, got ${r.status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
