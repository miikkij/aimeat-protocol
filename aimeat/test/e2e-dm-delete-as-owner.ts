// E2E: removing a message from the owner's mailbox — the door and the word (messages:delete-as-owner).
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dm-delete-as-owner
//
// DELETE /v1/messages/:id had existed since the Messages page was built, behind requireRole('owner'),
// and no view ever called it — so the only way to remove a message was curl, and no agent could do it
// at all. This covers the door as it is now:
//
//  - an owner session still deletes its own message, exactly as before;
//  - an agent needs the EXACT word: no scope is a 403, and `*` is a 403 too, because this one is in
//    the own-tick family that no wildcard carries (utils/scope-coverage.ts);
//  - the tool appears on the MCP surface only for an agent holding it, and NOT for a `*` agent —
//    which is the difference from messages:send-as-owner, and the whole point of the family;
//  - the mailbox is the acting agent's OWN owner, derived server-side. A 1:1 message is TWO rows,
//    keyed by (message id, mailbox owner), so the id is shared and the copies are not: another
//    owner's agent holding the word removes ITS owner's copy and never this one's, and an id its
//    owner was never party to is a 404.

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
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

interface McpClient {
    list(): Promise<string[]>;
    call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; body: any }>;
}

/** OAuth PATH A (agent signature) + MCP session init for one agent. Returns a tool client. */
async function connectMcp(gaii: string, privKey: string): Promise<McpClient> {
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'dao-e2e' }) });
    const clientId = reg.body.client_id as string;
    const clientSecret = reg.body.client_secret as string;

    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + NODE_ID + timestamp);
    const authQs = new URLSearchParams({ response_type: 'code', client_id: clientId, gaii, signature, timestamp });
    const auth = await json(`/v1/mcp/authorize?${authQs}`);
    const code = auth.body.code as string;
    assert(typeof code === 'string', `authorize returned code (${JSON.stringify(auth.body)})`);

    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret }),
    });
    const token = tok.body.access_token as string;
    assert(typeof token === 'string', `token exchange (${JSON.stringify(tok.body)})`);

    let sessionId = '';
    async function rpc(method: string, params: Record<string, unknown>, id: number) {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
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

    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dao-e2e', version: '1.0.0' } }, 1);
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    return {
        async list() { const { body } = await rpc('tools/list', {}, 2); return (body.result?.tools ?? []).map((t: any) => t.name); },
        async call(name, args) { const { body } = await rpc('tools/call', { name, arguments: args }, 3); return { ok: body.error === undefined && body.result?.isError !== true, body }; },
    };
}

async function registerOwner(name: string): Promise<{ ghii: string; token: string; key: string }> {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'DaoTest12345' }) });
    assert(ghii.status === 201, `ghii ${name} ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const key = ghii.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(key, name + NODE_ID + ts);
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    return { ghii: `${name}@${NODE_ID}`, token: tk.body.data.token as string, key };
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
    const sig = await signMsg(key, gaii + ts);
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tk.body?.ok === true, `agent token ${name}: ${JSON.stringify(tk.body)}`);
    return { gaii, key, token: tk.body.data.token as string };
}

function toolResult(body: any): any {
    try { return JSON.parse(body.result?.content?.[0]?.text ?? '{}'); } catch { return {}; }
}

/** One message from `fromToken` to `toGhii`. Returns its id as the SENDER's copy. */
async function sendDm(fromToken: string, toGhii: string, body: string): Promise<string> {
    const r = await json('/v1/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${fromToken}` },
        body: JSON.stringify({ to: toGhii, body }),
    });
    assert(r.status === 201 || r.status === 200, `send ${r.status}: ${JSON.stringify(r.body)}`);
    const id = r.body?.data?.message?.id ?? r.body?.data?.id;
    assert(typeof id === 'string', `sent message id (${JSON.stringify(r.body)})`);
    return id;
}

/** Every message id this owner can still see in their own inbox listing. */
async function inboxIds(ownerToken: string): Promise<Set<string>> {
    const r = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(r.status === 200, `inbox ${r.status}: ${JSON.stringify(r.body)}`);
    const rows = r.body?.data?.messages ?? r.body?.data?.items ?? [];
    return new Set(rows.map((m: any) => m.id));
}

console.log('\n=== AIMEAT Delete a message as the owner E2E (messages:delete-as-owner) ===\n');

const stamp = Date.now();
const aliceName = `daoalice${stamp}`;   // the mailbox under test
const bobName = `daobob${stamp}`;       // the other party, and a second owner
let alice = { ghii: '', token: '', key: '' };
let bob = { ghii: '', token: '', key: '' };
let delbot = { gaii: '', key: '', token: '' };    // Alice's agent WITH the word
let plainbot = { gaii: '', key: '', token: '' };  // Alice's agent without it
let broadbot = { gaii: '', key: '', token: '' };  // Alice's agent with '*'
let bobbot = { gaii: '', key: '', token: '' };    // BOB's agent, with the word

await test('Setup: two owners, and agents with / without / * / another owner\'s', async () => {
    alice = await registerOwner(aliceName);
    bob = await registerOwner(bobName);
    delbot = await createAgent(aliceName, alice.token, 'delbot', ['messages:read', 'messages:send', 'messages:delete-as-owner']);
    plainbot = await createAgent(aliceName, alice.token, 'plainbot', ['messages:read', 'messages:send']);
    broadbot = await createAgent(aliceName, alice.token, 'broadbot', ['*']);
    bobbot = await createAgent(bobName, bob.token, 'bobbot', ['messages:read', 'messages:send', 'messages:delete-as-owner']);
    assert(delbot.gaii.startsWith('delbot#'), `delbot gaii ${delbot.gaii}`);
});

await test('1. The tool is on the surface ONLY with the exact word — and NOT for a * agent', async () => {
    // The difference from messages:send-as-owner, and the reason the word exists: "Full access" is one
    // click, and nobody clicking it is deciding that an agent may destroy their correspondence.
    const withWord = await (await connectMcp(delbot.gaii, delbot.key)).list();
    const without = await (await connectMcp(plainbot.gaii, plainbot.key)).list();
    const broad = await (await connectMcp(broadbot.gaii, broadbot.key)).list();
    assert(withWord.includes('aimeat_dm_delete_as_owner'), 'agent holding the word does not see the tool');
    assert(!without.includes('aimeat_dm_delete_as_owner'), 'agent WITHOUT the word can see the tool');
    assert(!broad.includes('aimeat_dm_delete_as_owner'), 'a * agent can see the tool — the wildcard must not carry it');
    // The neighbouring delegation IS in the wildcard, so this is a real difference and not a broken surface.
    assert(broad.includes('aimeat_dm_send_as_owner'), 'a * agent lost send-as-owner — the wildcard should still carry that one');
});

await test('2. The owner deletes their own message, exactly as before', async () => {
    const id = await sendDm(bob.token, alice.ghii, 'one for alice to remove herself');
    const before = await inboxIds(alice.token);
    assert(before.size >= 0, 'inbox readable');
    const del = await json(`/v1/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert(del.status === 200, `owner delete ${del.status}: ${JSON.stringify(del.body)}`);
    assert(del.body?.data?.deleted === true, `deleted flag: ${JSON.stringify(del.body)}`);
    const after = await inboxIds(alice.token);
    assert(!after.has(id), 'the message is still in the owner inbox after a successful delete');
});

await test('3. An agent WITHOUT the word is refused — 403 SCOPE_DENIED, not an empty answer', async () => {
    const id = await sendDm(bob.token, alice.ghii, 'plainbot may not remove this');
    const del = await json(`/v1/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${plainbot.token}` },
    });
    assert(del.status === 403, `expected 403, got ${del.status}: ${JSON.stringify(del.body)}`);
    assert(del.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED: ${JSON.stringify(del.body?.error)}`);
    assert((await inboxIds(alice.token)).has(id), 'a refused delete removed the message anyway');
});

await test('4. A * agent is refused too — the wildcard does not carry an own-tick word', async () => {
    const id = await sendDm(bob.token, alice.ghii, 'broadbot may not remove this either');
    const del = await json(`/v1/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${broadbot.token}` },
    });
    assert(del.status === 403, `expected 403 for '*', got ${del.status}: ${JSON.stringify(del.body)}`);
    assert(del.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED: ${JSON.stringify(del.body?.error)}`);
    assert((await inboxIds(alice.token)).has(id), 'the * agent removed the message anyway');
});

await test('5. The agent holding the word removes it from its OWN OWNER\'s mailbox', async () => {
    const id = await sendDm(bob.token, alice.ghii, 'delbot clears this one out');
    assert((await inboxIds(alice.token)).has(id), 'setup: the message should be in the owner inbox');
    const del = await json(`/v1/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${delbot.token}` },
    });
    assert(del.status === 200, `scoped agent delete ${del.status}: ${JSON.stringify(del.body)}`);
    assert(!(await inboxIds(alice.token)).has(id), 'the message is still in the OWNER inbox after the agent deleted it');
});

await test('6. The MCP tool does the same thing, and says so', async () => {
    const id = await sendDm(bob.token, alice.ghii, 'removed through the tool');
    const mcp = await connectMcp(delbot.gaii, delbot.key);
    const r = await mcp.call('aimeat_dm_delete_as_owner', { message_id: id });
    assert(r.ok, `tool call failed: ${JSON.stringify(r.body)}`);
    assert(toolResult(r.body).deleted === true, `tool result: ${JSON.stringify(toolResult(r.body))}`);
    assert(!(await inboxIds(alice.token)).has(id), 'the tool answered ok and the message is still there');
});

await test('7. A message that is not in the mailbox is a flagged NOT_FOUND, never a quiet ok', async () => {
    const mcp = await connectMcp(delbot.gaii, delbot.key);
    const r = await mcp.call('aimeat_dm_delete_as_owner', { message_id: 'msg-does-not-exist' });
    assert(!r.ok, 'deleting a message that does not exist answered ok');
    assert(r.body?.result?.isError === true, `expected isError on the tool result: ${JSON.stringify(r.body?.result)}`);
    assert(toolResult(r.body).code === 'NOT_FOUND', `expected NOT_FOUND: ${JSON.stringify(toolResult(r.body))}`);
});

await test('8. CROSS-OWNER: another owner\'s agent removes its OWN owner\'s copy, never this one\'s', async () => {
    // A 1:1 message is TWO rows, one per mailbox, keyed by (message id, mailbox owner) — so the id is
    // shared and the copies are not. bobbot holds the word for BOB, so this call is a real delete: it
    // removes BOB's copy, which is Bob's to remove. What it must not do is touch Alice's, and that is
    // the boundary worth asserting — the word grants a capability over your OWN account, not over the
    // message id space. Asserting a 404 here would have tested the wrong thing and passed for a
    // reason nobody checked.
    const id = await sendDm(bob.token, alice.ghii, 'bobbot must not reach into alice');
    assert((await inboxIds(alice.token)).has(id), 'setup: alice should hold her copy');
    const del = await json(`/v1/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${bobbot.token}` },
    });
    assert(del.status === 200, `bob's own copy should be removable by bob's agent: ${del.status} ${JSON.stringify(del.body)}`);
    assert((await inboxIds(alice.token)).has(id), 'another owner\'s agent deleted THIS owner\'s copy');
});

await test('9. CROSS-OWNER: an id that is not in the agent\'s own mailbox at all is a 404', async () => {
    // The other half, and the one that shows the lookup is scoped rather than filtered afterwards: a
    // conversation bobbot's owner was never part of. Nothing of Bob's carries this id, so there is
    // nothing to delete and nothing to leak.
    const carolName = `daocarol${stamp}`;
    const carol = await registerOwner(carolName);
    const id = await sendDm(carol.token, alice.ghii, 'a thread bob was never in');
    const del = await json(`/v1/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${bobbot.token}` },
    });
    assert(del.status === 404, `expected 404, got ${del.status}: ${JSON.stringify(del.body)}`);
    assert((await inboxIds(alice.token)).has(id), 'a cross-owner delete removed the message anyway');
});

await test('10. Unauthenticated is 401, and the message stays', async () => {
    const id = await sendDm(bob.token, alice.ghii, 'nobody may remove this');
    const del = await json(`/v1/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    assert(del.status === 401, `expected 401, got ${del.status}: ${JSON.stringify(del.body)}`);
    assert((await inboxIds(alice.token)).has(id), 'an unauthenticated delete removed the message');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
