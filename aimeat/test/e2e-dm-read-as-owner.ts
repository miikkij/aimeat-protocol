/**
 * @file e2e-dm-read-as-owner.ts
 * @description E2E: reading the OWNER's mailbox, by the three readers the four read doors serve.
 *   GET /v1/messages/inbox, /conversations, /conversations/:id and /overview were requireRole('owner'),
 *   which an app grant can never pass: its role is always `app`, so an app holding messages:read got
 *   403 while its consent screen promised "Read direct messages addressed to you". And an agent asked
 *   to "reply as me" could send in the owner's thread but not read it. This covers the doors as they
 *   are now:
 *
 *   - the owner in person sees everything as before, their agents' threads with other people included;
 *   - an app holding messages:read reads the owner's OWN mailbox: no agent threads, no agent list;
 *   - an app WITHOUT the word is refused with SCOPE_DENIED naming messages:read;
 *   - an agent holding messages:read-as-owner reads the owner's own mailbox, over REST and over MCP,
 *     and reading marks nothing as read;
 *   - an agent holding only messages:read is REFUSED. That is the line a requireRoleOrScope('owner',
 *     'messages:read') gate would have crossed: the handlers read by the owner's name, so every agent
 *     with the commonest messaging word would have listed its siblings' conversations;
 *   - a `*` agent is refused, and cannot see the tools: the word is outside every wildcard;
 *   - another owner's app and another owner's agent reach THEIR owner's mailbox and never this one.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dm-read-as-owner
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with messages:read-as-owner and the app read door.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const FILENAME = 'home-mailbox.html';
const REDIRECT = 'http://localhost:9922/callback';

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
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'rao-e2e' }) });
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
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'rao-e2e', version: '1.0.0' } }, 1);
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
function toolResult(body: any): any {
    try { return JSON.parse(body.result?.content?.[0]?.text ?? '{}'); } catch { return {}; }
}

async function registerOwner(name: string): Promise<{ name: string; ghii: string; token: string }> {
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'RaoTest12345' }) });
    assert(ghii.status === 201, `ghii ${name} ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const key = ghii.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(key, name + NODE_ID + ts);
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
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
    const sig = await signMsg(key, gaii + ts);
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tk.body?.ok === true, `agent token ${name}: ${JSON.stringify(tk.body)}`);
    return { gaii, key, token: tk.body.data.token as string };
}

// PKCE, reused: each authorize → consent mints its own single-use code.
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

/** The full app-grant flow for `scopes`, consented by `consenterToken`. Returns the app access token. */
async function grantApp(appRef: string, consenterToken: string, scopes: string[]): Promise<string> {
    const q = new URLSearchParams({
        app: appRef, response_type: 'code', scope: scopes.join(' '),
        redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256',
    });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(auth.status === 302, `authorize: ${auth.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', {
        method: 'POST', headers: { Authorization: `Bearer ${consenterToken}` },
        body: JSON.stringify({ request_id: rid }),
    });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }),
    });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body)}`);
    const granted: string[] = tok.body.data.scope?.split(' ') ?? tok.body.data.scopes ?? scopes;
    assert(scopes.every(s => granted.includes(s)), `grant carries ${scopes.join(' ')}: ${JSON.stringify(tok.body.data)}`);
    return tok.body.data.access_token;
}

/** One message; returns the sender's copy id and the conversation id. */
async function sendDm(fromToken: string, to: string, body: string): Promise<{ id: string; conversationId: string }> {
    const r = await json('/v1/messages', { method: 'POST', headers: { Authorization: `Bearer ${fromToken}` }, body: JSON.stringify({ to, body }) });
    assert(r.status === 201, `send ${r.status}: ${JSON.stringify(r.body)}`);
    return { id: r.body.data.message.id, conversationId: r.body.data.message.conversationId };
}

const FOUR_DOORS = (conversationId: string) => [
    '/v1/messages/inbox',
    '/v1/messages/conversations',
    '/v1/messages/overview',
    `/v1/messages/conversations/${encodeURIComponent(conversationId)}`,
];

console.log('\n=== AIMEAT Reading the owner\'s mailbox E2E (messages:read on apps, messages:read-as-owner on agents) ===\n');

const stamp = Date.now();
let alice = { name: '', ghii: '', token: '' };   // the mailbox under test
let bob = { name: '', ghii: '', token: '' };     // writes to alice; a second owner with his own mailbox
let carol = { name: '', ghii: '', token: '' };   // the party alice's agent talks to on its own
let readbot = { gaii: '', key: '', token: '' };  // alice's agent WITH messages:read-as-owner
let plainbot = { gaii: '', key: '', token: '' }; // alice's agent with messages:read + messages:send only
let broadbot = { gaii: '', key: '', token: '' }; // alice's agent with '*'
let bobbot = { gaii: '', key: '', token: '' };   // bob's agent WITH messages:read-as-owner
let appRead = '';     // alice's grant to the app: messages:read
let appMemory = '';   // alice's grant to the app: memory:read only
let bobApp = '';      // bob's grant to the same app: messages:read
let bobToAlice = { id: '', conversationId: '' };
let agentToCarol = { id: '', conversationId: '' };
const BOB_SAYS = `bob writes to alice ${stamp}`;
const AGENT_SAYS = `plainbot writes to carol ${stamp}`;

await test('Setup: three owners, four agents, one app with three grants, and the messages', async () => {
    alice = await registerOwner(`raoalice${stamp}`);
    bob = await registerOwner(`raobob${stamp}`);
    carol = await registerOwner(`raocarol${stamp}`);
    readbot = await createAgent(alice.name, alice.token, 'readbot', ['messages:read', 'messages:read-as-owner']);
    plainbot = await createAgent(alice.name, alice.token, 'plainbot', ['messages:read', 'messages:send']);
    broadbot = await createAgent(alice.name, alice.token, 'broadbot', ['*']);
    bobbot = await createAgent(bob.name, bob.token, 'bobbot', ['messages:read', 'messages:read-as-owner']);

    const pub = await json('/v1/apps', {
        method: 'POST', headers: { Authorization: `Bearer ${alice.token}` },
        body: JSON.stringify({ filename: FILENAME, content: Buffer.from('<!DOCTYPE html><html><body>home</body></html>').toString('base64'), name: 'Home Mailbox', description: 'a home page that shows the mailbox', category: 'utility' }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    appRead = await grantApp(`${alice.name}/${FILENAME}`, alice.token, ['messages:read']);
    appMemory = await grantApp(`${alice.name}/${FILENAME}`, alice.token, ['memory:read']);
    bobApp = await grantApp(`${alice.name}/${FILENAME}`, bob.token, ['messages:read']);

    bobToAlice = await sendDm(bob.token, alice.ghii, BOB_SAYS);
    agentToCarol = await sendDm(plainbot.token, carol.ghii, AGENT_SAYS);
    await sendDm(carol.token, alice.ghii, `carol writes to alice ${stamp}`);
});

await test('1. The owner in person reads as before, their agent\'s thread with carol included', async () => {
    const inbox = await json('/v1/messages/inbox', bearer(alice.token));
    assert(inbox.status === 200, `inbox ${inbox.status}: ${JSON.stringify(inbox.body)}`);
    assert(inbox.body.data.messages.some((m: any) => m.body === BOB_SAYS), 'bob\'s message is not in the owner\'s inbox');
    const convs = await json('/v1/messages/conversations', bearer(alice.token));
    assert(convs.status === 200, `conversations ${convs.status}`);
    assert(convs.body.data.conversations.some((c: any) => c.viaAgent === plainbot.gaii), 'the owner lost the "via agent" row for plainbot\'s thread');
    const over = await json('/v1/messages/overview', bearer(alice.token));
    assert(over.status === 200, `overview ${over.status}`);
    assert(over.body.data.agents.length === 3, `the owner's overview should list their three agents: ${over.body.data.agents.length}`);
});

await test('2. An app holding messages:read reads the owner\'s mailbox on all four doors', async () => {
    const inbox = await json('/v1/messages/inbox', bearer(appRead));
    assert(inbox.status === 200, `app inbox ${inbox.status}: ${JSON.stringify(inbox.body)}`);
    assert(inbox.body.data.messages.some((m: any) => m.body === BOB_SAYS), 'bob\'s message is not in the app\'s view of the inbox');
    const convs = await json('/v1/messages/conversations', bearer(appRead));
    assert(convs.status === 200, `app conversations ${convs.status}: ${JSON.stringify(convs.body)}`);
    assert(convs.body.data.conversations.some((c: any) => c.conversationId === bobToAlice.conversationId), 'the bob thread is missing from the app\'s list');
    const thread = await json(`/v1/messages/conversations/${encodeURIComponent(bobToAlice.conversationId)}`, bearer(appRead));
    assert(thread.status === 200, `app thread ${thread.status}: ${JSON.stringify(thread.body)}`);
    assert(thread.body.data.messages.some((m: any) => m.body === BOB_SAYS), 'the app read the thread and bob\'s message was not in it');
    const over = await json('/v1/messages/overview', bearer(appRead));
    assert(over.status === 200, `app overview ${over.status}: ${JSON.stringify(over.body)}`);
    assert(over.body.data.conversations.some((c: any) => c.conversationId === bobToAlice.conversationId), 'the bob thread is missing from the app\'s overview');
});

await test('3. ...and only the owner\'s OWN mailbox: no agent\'s thread, no agent list, no groups, no ?agent=', async () => {
    const convs = await json('/v1/messages/conversations', bearer(appRead));
    assert(!convs.body.data.conversations.some((c: any) => c.viaAgent), `the app was shown an agent's own thread: ${JSON.stringify(convs.body.data.conversations.filter((c: any) => c.viaAgent))}`);
    assert(!JSON.stringify(convs.body.data).includes(AGENT_SAYS), 'plainbot\'s words to carol reached the app');
    const over = await json('/v1/messages/overview', bearer(appRead));
    assert(Array.isArray(over.body.data.agents) && over.body.data.agents.length === 0, `the app was shown the agent list: ${over.body.data.agents?.length}`);
    assert(Array.isArray(over.body.data.groups) && over.body.data.groups.length === 0, 'the app was shown the sharing groups');
    assert(Array.isArray(over.body.data.tracked) && over.body.data.tracked.length === 0, 'the app was shown the tracked-response rules');
    const viaAgent = await json(`/v1/messages/conversations/${encodeURIComponent(agentToCarol.conversationId)}?agent=${encodeURIComponent(plainbot.gaii)}`, bearer(appRead));
    assert(viaAgent.status === 403, `?agent= should be the owner's alone, got ${viaAgent.status}: ${JSON.stringify(viaAgent.body)}`);
});

await test('4. An app WITHOUT messages:read is refused on all four, and told the one word it lacks', async () => {
    for (const path of FOUR_DOORS(bobToAlice.conversationId)) {
        const r = await json(path, bearer(appMemory));
        assert(r.status === 403, `${path}: expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
        assert(r.body?.error?.code === 'SCOPE_DENIED', `${path}: expected SCOPE_DENIED: ${JSON.stringify(r.body?.error)}`);
        assert(String(r.body?.error?.message).includes('messages:read'), `${path}: the refusal should name messages:read: ${r.body?.error?.message}`);
    }
});

await test('5. An agent holding ONLY messages:read is refused on all four: that word is its own mail', async () => {
    // The line requireRoleOrScope('owner', 'messages:read') would have crossed. plainbot HAS a thread
    // of its own and a sibling (readbot); the handlers read by the owner's name, so letting it through
    // would have listed the owner's whole mailbox for it.
    for (const path of FOUR_DOORS(bobToAlice.conversationId)) {
        const r = await json(path, bearer(plainbot.token));
        assert(r.status === 403, `${path}: expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
        assert(r.body?.error?.code === 'SCOPE_DENIED', `${path}: expected SCOPE_DENIED: ${JSON.stringify(r.body?.error)}`);
        assert(String(r.body?.error?.message).includes('messages:read-as-owner'), `${path}: the refusal should name messages:read-as-owner`);
    }
    // Its own door is untouched.
    const own = await json('/v1/messages/agent-inbox', bearer(plainbot.token));
    assert(own.status === 200, `plainbot's own agent-inbox should still answer: ${own.status}`);
});

await test('6. A * agent is refused too, and cannot see the tools: the word is outside every wildcard', async () => {
    const r = await json('/v1/messages/overview', bearer(broadbot.token));
    assert(r.status === 403, `expected 403 for '*', got ${r.status}: ${JSON.stringify(r.body)}`);
    const withWord = await (await connectMcp(readbot.gaii, readbot.key)).list();
    const without = await (await connectMcp(plainbot.gaii, plainbot.key)).list();
    const broad = await (await connectMcp(broadbot.gaii, broadbot.key)).list();
    for (const tool of ['aimeat_dm_inbox_as_owner', 'aimeat_dm_thread_as_owner']) {
        assert(withWord.includes(tool), `the agent holding the word does not see ${tool}`);
        assert(!without.includes(tool), `an agent WITHOUT the word can see ${tool}`);
        assert(!broad.includes(tool), `a * agent can see ${tool}: the wildcard must not carry it`);
    }
});

await test('7. The agent holding messages:read-as-owner reads the owner\'s own mailbox over REST', async () => {
    const inbox = await json('/v1/messages/inbox', bearer(readbot.token));
    assert(inbox.status === 200, `delegate inbox ${inbox.status}: ${JSON.stringify(inbox.body)}`);
    assert(inbox.body.data.messages.some((m: any) => m.body === BOB_SAYS), 'bob\'s message is not in the delegate\'s view');
    const convs = await json('/v1/messages/conversations', bearer(readbot.token));
    assert(convs.status === 200, `delegate conversations ${convs.status}`);
    assert(!convs.body.data.conversations.some((c: any) => c.viaAgent), 'the delegate was shown a sibling agent\'s own thread');
    const over = await json('/v1/messages/overview', bearer(readbot.token));
    assert(over.status === 200 && over.body.data.agents.length === 0, `the delegate's overview should carry no agent list: ${over.status} ${over.body.data?.agents?.length}`);
});

await test('8. The MCP tools read the same mailbox, and reading marks nothing as read', async () => {
    const mcp = await connectMcp(readbot.gaii, readbot.key);
    const inbox = await mcp.call('aimeat_dm_inbox_as_owner', {});
    assert(inbox.ok, `inbox tool failed: ${JSON.stringify(inbox.body)}`);
    const listed = toolResult(inbox.body);
    const row = (listed.conversations ?? []).find((c: any) => c.conversation_id === bobToAlice.conversationId);
    assert(!!row, `the bob thread is missing from aimeat_dm_inbox_as_owner: ${JSON.stringify(listed)}`);
    assert(row.with === bob.ghii, `the row should name bob: ${JSON.stringify(row)}`);
    assert(row.unread >= 1, `setup: the bob thread should be unread: ${JSON.stringify(row)}`);

    const thread = await mcp.call('aimeat_dm_thread_as_owner', { conversation_id: bobToAlice.conversationId });
    assert(thread.ok, `thread tool failed: ${JSON.stringify(thread.body)}`);
    assert((toolResult(thread.body).messages ?? []).some((m: any) => m.body === BOB_SAYS), `bob's message is not in aimeat_dm_thread_as_owner: ${JSON.stringify(toolResult(thread.body))}`);

    const after = await json('/v1/messages/conversations', bearer(alice.token));
    const ownerRow = after.body.data.conversations.find((c: any) => c.conversationId === bobToAlice.conversationId);
    assert(ownerRow?.unread >= 1, `an agent reading the thread marked it read for the owner: ${JSON.stringify(ownerRow)}`);
});

await test('9. limit and unread narrow the list for a chat; without them it is whole', async () => {
    const whole = await json('/v1/messages/overview', bearer(readbot.token));
    const one = await json('/v1/messages/overview?limit=1', bearer(readbot.token));
    assert(one.status === 200, `limit ${one.status}`);
    assert(one.body.data.conversations.length === 1, `limit=1 returned ${one.body.data.conversations.length}`);
    assert(one.body.data.conversationsTotal === whole.body.data.conversations.length, `conversationsTotal ${one.body.data.conversationsTotal} vs whole ${whole.body.data.conversations.length}`);
    assert(whole.body.data.conversations.length >= 2, `setup: alice should hold two threads, holds ${whole.body.data.conversations.length}`);
});

await test('10. CROSS-OWNER: bob\'s agent and bob\'s app read BOB\'s mailbox, never alice\'s', async () => {
    const carolThreadWithAlice = (await json('/v1/messages/conversations', bearer(alice.token))).body.data.conversations
        .find((c: any) => c.peerGhii === carol.ghii && !c.viaAgent);
    assert(!!carolThreadWithAlice, 'setup: alice should hold a thread with carol');
    for (const [who, token] of [['bobbot', bobbot.token], ['bob\'s app', bobApp]] as const) {
        const convs = await json('/v1/messages/conversations', bearer(token));
        assert(convs.status === 200, `${who} conversations ${convs.status}: ${JSON.stringify(convs.body)}`);
        assert(!convs.body.data.conversations.some((c: any) => c.conversationId === carolThreadWithAlice.conversationId), `${who} listed alice's thread with carol`);
        assert(!JSON.stringify(convs.body.data).includes(`carol writes to alice ${stamp}`), `${who} was shown carol's words to alice`);
        const thread = await json(`/v1/messages/conversations/${encodeURIComponent(carolThreadWithAlice.conversationId)}`, bearer(token));
        assert(thread.status === 200 && thread.body.data.messages.length === 0, `${who} read alice's thread with carol: ${thread.status} ${JSON.stringify(thread.body.data)}`);
        // Bob's own copy of his message to alice IS his to read.
        const own = await json(`/v1/messages/conversations/${encodeURIComponent(bobToAlice.conversationId)}`, bearer(token));
        assert(own.body.data.messages.some((m: any) => m.body === BOB_SAYS), `${who} could not read bob's own copy`);
    }
});

await test('11. Unauthenticated is 401 on all four', async () => {
    for (const path of FOUR_DOORS(bobToAlice.conversationId)) {
        const r = await json(path);
        assert(r.status === 401, `${path}: expected 401, got ${r.status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
