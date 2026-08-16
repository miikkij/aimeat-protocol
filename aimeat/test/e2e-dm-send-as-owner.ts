// E2E: delegated "reply as me" — aimeat_dm_send_as_owner (messages:send-as-owner).
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dm-send-as-owner
//
// Verifies the consent-gated delegation behind Inbox "Reply with AI":
//  - the tool is only on the surface for an agent holding messages:send-as-owner (and for a '*' agent);
//  - calling it sends the DM AS THE AGENT'S OWNER (server-derived), landing in the OWNER's thread, so the
//    recipient sees it from the human — NOT from the agent;
//  - an agent may only ever send as its OWN owner (no cross-owner impersonation — there is no owner param);
//  - an agent WITHOUT the scope cannot use it.

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
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'sao-e2e' }) });
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

    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sao-e2e', version: '1.0.0' } }, 1);
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
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'SaoTest12345' }) });
    assert(ghii.status === 201, `ghii ${name} ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const key = ghii.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(key, name + NODE_ID + ts);
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    return { ghii: `${name}@${NODE_ID}`, token: tk.body.data.token as string, key };
}

async function createAgent(ownerName: string, ownerToken: string, name: string, scopes: string[]): Promise<{ gaii: string; key: string }> {
    const r = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], model: 'gpt-4o', scopes }),
    });
    assert(r.status === 201, `register ${name} ${r.status}: ${JSON.stringify(r.body)}`);
    return { gaii: r.body.data.agent.gaii as string, key: r.body.data.private_key as string };
}

function toolResult(body: any): any {
    try { return JSON.parse(body.result?.content?.[0]?.text ?? '{}'); } catch { return {}; }
}

console.log('\n=== AIMEAT Delegated "reply as me" E2E (aimeat_dm_send_as_owner) ===\n');

const stamp = Date.now();
const aliceName = `saoalice${stamp}`;   // owner of the agents
const bobName = `saobob${stamp}`;       // recipient human
let alice = { ghii: '', token: '', key: '' };
let bob = { ghii: '', token: '', key: '' };
let sendbot = { gaii: '', key: '' };    // agent WITH messages:send-as-owner
let plainbot = { gaii: '', key: '' };   // agent WITHOUT it (only messages:send)
let broadbot = { gaii: '', key: '' };   // agent with '*'

await test('Setup: owners Alice + Bob; agents (with / without / *) the delegation scope', async () => {
    alice = await registerOwner(aliceName);
    bob = await registerOwner(bobName);
    sendbot = await createAgent(aliceName, alice.token, 'sendbot', ['messages:send', 'messages:send-as-owner']);
    plainbot = await createAgent(aliceName, alice.token, 'plainbot', ['messages:send']);
    broadbot = await createAgent(aliceName, alice.token, 'broadbot', ['*']);
    assert(sendbot.gaii.startsWith('sendbot#'), `sendbot gaii ${sendbot.gaii}`);
});

await test('1. Tool is on the surface ONLY with messages:send-as-owner (and for a * agent)', async () => {
    const withScope = await (await connectMcp(sendbot.gaii, sendbot.key)).list();
    const without = await (await connectMcp(plainbot.gaii, plainbot.key)).list();
    const broad = await (await connectMcp(broadbot.gaii, broadbot.key)).list();
    assert(withScope.includes('aimeat_dm_send_as_owner'), 'sendbot (scope) SEES the tool');
    assert(without.includes('aimeat_dm_send'), 'plainbot still has plain aimeat_dm_send');
    assert(!without.includes('aimeat_dm_send_as_owner'), 'plainbot (no scope) does NOT see the delegated tool');
    assert(broad.includes('aimeat_dm_send_as_owner'), 'broad (*) agent has the tool');
});

await test('2. sendbot sends AS ALICE (owner), NOT as the agent — tool reports sent_as = owner', async () => {
    const client = await connectMcp(sendbot.gaii, sendbot.key);
    const { ok, body } = await client.call('aimeat_dm_send_as_owner', { to: bob.ghii, body: 'Moi Bob — tämä on minulta (AI:n avustama vastaus).' });
    assert(ok, `call should succeed: ${JSON.stringify(body.result ?? body.error)}`);
    const res = toolResult(body);
    assert(res.sent_as === alice.ghii, `sent_as should be Alice the owner, got ${res.sent_as}`);
    assert(res.recipient === bob.ghii, `recipient should be Bob, got ${res.recipient}`);
});

await test('3. The DM lands in ALICE\'s thread with Bob (owner-to-owner), not an agent thread', async () => {
    const convs = await json('/v1/messages/conversations', { headers: { Authorization: `Bearer ${alice.token}` } });
    const withBob = convs.body.data.conversations.find((c: any) => c.peerGhii === bob.ghii);
    assert(withBob !== undefined, 'Alice sees a conversation with Bob (her own thread)');
});

await test('4. Bob receives it FROM ALICE (the human), not from the agent', async () => {
    // First contact: Alice lands in Bob\'s requests; accept, then the message is in his inbox from alice.
    const reqs = await json('/v1/messages/requests', { headers: { Authorization: `Bearer ${bob.token}` } });
    const fromAlice = reqs.body.data.requests.find((r: any) => r.contactId === alice.ghii);
    if (fromAlice) {
        const acc = await json(`/v1/messages/requests/${encodeURIComponent(alice.ghii)}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${bob.token}` } });
        assert(acc.status === 200, `accept ${acc.status}: ${JSON.stringify(acc.body)}`);
    }
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const m = inbox.body.data.messages.find((x: any) => /AI:n avustama/.test(x.body));
    assert(m !== undefined, 'Bob inbox has the message');
    assert(m.senderGhii === alice.ghii, `sender is Alice (the human), got ${m.senderGhii}`);
    assert(!m.senderGhii.includes('#'), `sender must NOT be an agent GAII, got ${m.senderGhii}`);
});

// Tests 2-4 prove the DISPLAY side hard: the message reads as Alice, and the sender is not an agent
// GAII. The provenance side — which the tool's own comment calls the sharpest case on this surface —
// was asserted by nothing. Delegation moves the SIGNATURE, not the authorship: the message displays
// as Alice because she delegated, and the provenance record must still say an agent produced the
// bytes. A record naming Alice would be the false attribution the whole design exists to prevent.
await test('4b. the provenance names the AGENT while the message displays as Alice', async () => {
    const PROV_BODY = `Provenance ${stamp}: tämä teksti on agentin tuottamaa.`;
    const client = await connectMcp(sendbot.gaii, sendbot.key);
    // No ai_provenance declaration in the call — silence is exactly the case the rule is about.
    const { ok, body } = await client.call('aimeat_dm_send_as_owner', { to: bob.ghii, body: PROV_BODY });
    assert(ok, `call should succeed: ${JSON.stringify(body.result ?? body.error)}`);
    const res = toolResult(body);

    // The display half, restated so this test carries the whole rule rather than half of it.
    assert(res.sent_as === alice.ghii, `sent_as should still be Alice, got ${res.sent_as}`);

    const rec = res.ai_provenance?.record;
    assert(!!rec, `the write must be stamped: ${JSON.stringify(res).slice(0, 240)}`);
    assert(rec.generator?.principal === sendbot.gaii,
        `the record must name the AGENT that produced the bytes, got ${rec.generator?.principal}`);
    assert(rec.generator?.principal !== alice.ghii,
        'the record must NOT name the human whose name the message carries');
    assert(rec.attestation?.stampedBy === 'node', `stampedBy: ${rec.attestation?.stampedBy}`);
    assert(rec.attestation?.observed === false, `observed must be false for a node stamp: ${rec.attestation?.observed}`);
    const expected = `sha256:${createHash('sha256').update(PROV_BODY).digest('hex')}`;
    assert(rec.attestation?.contentHash === expected,
        `the record must be about THESE bytes: ${rec.attestation?.contentHash} != ${expected}`);

    // The delivered copy carries the same record — the recipient can check it, not just the sender.
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    const delivered = (inbox.body.data.messages as any[]).find(x => x.body === PROV_BODY);
    assert(!!delivered, `Bob must have the message: ${JSON.stringify((inbox.body.data.messages as any[]).map(x => x.body))}`);
    assert(delivered.aiProvenanceId === res.ai_provenance.id,
        `the delivered copy must carry the same provenance id: ${delivered.aiProvenanceId} != ${res.ai_provenance.id}`);
});

await test('5. plainbot (no scope) cannot use the delegated tool', async () => {
    const client = await connectMcp(plainbot.gaii, plainbot.key);
    const { ok, body } = await client.call('aimeat_dm_send_as_owner', { to: bob.ghii, body: 'should not go out as Alice' });
    assert(!ok, 'a filtered (unregistered) tool call must not succeed');
    // Name the SHAPE of the refusal, not just that something went wrong. Without the scope the tool
    // is never registered on the session, so the JSON-RPC layer answers with an error rather than a
    // tool result — an isError body would mean the tool ran and declined, which is a different story.
    assert(body.error !== undefined || body.result?.isError === true,
        `the refusal must be an MCP error or an isError result, got ${JSON.stringify(body).slice(0, 200)}`);
    // …and nothing went out under Alice's name.
    const inbox = await json('/v1/messages/inbox', { headers: { Authorization: `Bearer ${bob.token}` } });
    assert(!(inbox.body.data.messages as any[]).some(m => m.body === 'should not go out as Alice'),
        'the refused delegation must not have delivered anything');
});

await test('6. Cannot address the owner itself (own-owner-only sender; no self-send)', async () => {
    const client = await connectMcp(sendbot.gaii, sendbot.key);
    const { ok } = await client.call('aimeat_dm_send_as_owner', { to: alice.ghii, body: 'to myself' });
    assert(!ok, 'sending to your own owner identity must be rejected');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
