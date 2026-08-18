/**
 * @file e2e-mcp-session-expiry.ts
 * @description E2E for MCP session idle expiry (memory trace 2026-08-19): a session with no
 *   requests for mcp.session_idle_minutes is closed by the sweep and its next call answers the
 *   spec's 404, an ACTIVE session survives the same window, and re-initializing after a reap
 *   works. The idle knob is runtime config; the suite drops it to 6 seconds, proves both sides,
 *   and restores it. Also: the knob itself is operator-only.
 * @version-history
 *   v1.0.0 -- 2026-08-19 -- Initial: reap + survive + re-init + operator gate.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-session-expiry

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try {
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT after 60s')), 60_000));
        await Promise.race([fn(), timeout]);
        passed++; console.log(`  ✅ ${name}`);
    } catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

interface Session { token: string; sessionId: string; nextId: number }

function parseSSE(text: string, id: number): any {
    for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { const p = JSON.parse(line.slice(5)); if (p.id === id) return p; } catch { /* keep scanning */ }
    }
    return null;
}

/** Raw RPC that also reports the HTTP status, because a reaped session answers 404 at that layer. */
async function rpcRaw(s: Session, method: string, params: Record<string, unknown> = {}) {
    const id = s.nextId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${s.token}`,
            ...(s.sessionId ? { 'mcp-session-id': s.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) s.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('text/event-stream') ? parseSSE(await res.text(), id) : await res.json().catch(() => null);
    return { status: res.status, body };
}

async function initSession(s: Session) {
    const r = await rpcRaw(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'expiry e2e', version: '1.0.0' } });
    assert(r.status === 200, `initialize: ${r.status}`);
    assert(s.sessionId.length > 0, 'session id assigned');
}

console.log('\n=== AIMEAT MCP Session-Expiry E2E ===\n');

let ownerToken = '';
let mcpAccessToken = '';
let nonOpToken = '';

const setIdle = (token: string, minutes: number) =>
    json('/v1/admin/config', { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ changes: [{ path: 'mcp.session_idle_minutes', value: minutes }] }) });

await test('Setup: operator owner + agent + MCP access token', async () => {
    const owner = `mexp${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp: ts, signature: await sign(reg.body.data.private_key, owner + NODE_ID + ts) }) });
    ownerToken = tok.body.data.token;

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'expag', owner, capabilities: ['memory'], mode: 'interactive', scopes: ['*'] }),
    });
    assert(ag.status === 201, `agent: ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const agentGaii = ag.body.data.agent.gaii as string;
    const agentKey = ag.body.data.private_key as string;

    const client = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'expiry e2e', redirect_uris: [] }) });
    const ats = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agentGaii,
        signature: await sign(agentKey, agentGaii + NODE_ID + ats), timestamp: ats,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const token = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.body.code, client_id: client.body.client_id, client_secret: client.body.client_secret }),
    });
    assert(token.status === 200, `mcp token: ${token.status}`);
    mcpAccessToken = token.body.access_token;

    const reg2 = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: `${owner}b`, public_key: 'placeholder' }) });
    const ts2 = new Date().toISOString();
    const tok2 = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: `${owner}b`, timestamp: ts2, signature: await sign(reg2.body.data.private_key, `${owner}b` + NODE_ID + ts2) }) });
    nonOpToken = tok2.body.data.token;
});

await test('The idle knob is operator-only (non-operator 403, anonymous 401)', async () => {
    const nonOp = await setIdle(nonOpToken, 0.1);
    assert(nonOp.status === 403, `non-operator expected 403, got ${nonOp.status}`);
    const anon = await json('/v1/admin/config', { method: 'PUT', body: JSON.stringify({ changes: [{ path: 'mcp.session_idle_minutes', value: 0.1 }] }) });
    assert(anon.status === 401, `anonymous expected 401, got ${anon.status}`);
});

await test('An idle session is reaped (6 s idle, 10 s sweep) and answers the spec 404', async () => {
    const r = await setIdle(ownerToken, 0.1);   // 6 seconds
    assert(r.status === 200, `set idle: ${r.status}: ${JSON.stringify(r.body.error)}`);

    const s: Session = { token: mcpAccessToken, sessionId: '', nextId: 1 };
    await initSession(s);
    // Idle past the 6 s floor plus one full sweep interval.
    await sleep(18_000);
    const after = await rpcRaw(s, 'tools/list');
    assert(after.status === 404, `reaped session must answer 404, got ${after.status}`);
});

await test('An ACTIVE session survives the same window', async () => {
    const s: Session = { token: mcpAccessToken, sessionId: '', nextId: 1 };
    await initSession(s);
    // Keep touching it every 3 s for 18 s — activity resets the idle clock each time.
    for (let i = 0; i < 6; i++) {
        await sleep(3_000);
        const ping = await rpcRaw(s, 'tools/list');
        assert(ping.status === 200, `active session ping ${i}: ${ping.status}`);
    }
});

await test('A reaped client re-initializes and works again; knob restored', async () => {
    const s: Session = { token: mcpAccessToken, sessionId: '', nextId: 1 };
    await initSession(s);
    const list = await rpcRaw(s, 'tools/list');
    assert(list.status === 200 && Array.isArray(list.body?.result?.tools), 'fresh session lists tools');
    const r = await setIdle(ownerToken, 60);
    assert(r.status === 200, `restore idle: ${r.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
