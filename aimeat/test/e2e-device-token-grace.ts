/**
 * @file e2e-device-token-grace.ts
 * @description E2E for the device-token retrieval grace window + the MCP onboarding funnel marker
 *   (UX-remake v3, blocks 1.5/1.6). The device-token response is flat OAuth-style JSON, unlike
 *   every other endpoint's envelope, and a client that parses it wrong used to lose the
 *   credentials forever: the first poll cleared them and the whole authorize + owner-approval
 *   round had to be redone. The grace window lets the same device_code re-poll for a short
 *   window; this suite runs the WHOLE flow (authorize → owner approve → poll → re-poll) and
 *   asserts the second poll returns the same credentials.
 *
 *   Also covers the funnel marker: the owner's first authenticated MCP session initialize writes
 *   `onboarding.first_mcp_call` into the owner's namespace, readable from an owner session with
 *   the same soft lookup the profile uses.
 *
 *   Failure modes: unknown device_code is invalid_grant, and a re-poll inside the poll interval
 *   is slow_down (the RFC 8628 rate limit still applies inside the grace window).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-device-token-grace
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `dtg${Date.now() % 100000}`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const pollToken = (deviceCode: string) => json('/v1/agents/device-token', {
    method: 'POST',
    body: JSON.stringify({ device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
});

// ── State ──
let ownerToken = '';
let deviceCode = '';
let userCode = '';
let pollInterval = 5;
let firstCreds: any = null;

console.log('\n=== Device-Token Grace + MCP Funnel E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register the owner', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await signMsg(reg.body.data.private_key, owner + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    ownerToken = tok.body.data.token;
});

// ── Phase 1: the full RFC 8628 flow ──
console.log('\nPhase 1: authorize → approve → poll');

await test('device-authorize returns device_code + user_code', async () => {
    const r = await json('/v1/agents/device-authorize', {
        method: 'POST',
        body: JSON.stringify({ agent_name: 'grace-agent', owner }),
    });
    assert(r.status === 200 && r.body.ok === true, `authorize ${r.status}: ${JSON.stringify(r.body.error)}`);
    deviceCode = r.body.data.device_code;
    userCode = r.body.data.user_code;
    pollInterval = r.body.data.interval ?? 5;
    assert(!!deviceCode && !!userCode, 'device_code and user_code must be present');
});

await test('Owner approves via /v1/agents/verify', async () => {
    const r = await json('/v1/agents/verify', {
        method: 'POST',
        body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['memory:*'], owner_token: ownerToken }),
    });
    assert(r.status === 200 && r.body.ok === true, `verify ${r.status}: ${JSON.stringify(r.body.error)}`);
});

await test('First poll returns flat OAuth-style credentials', async () => {
    const r = await pollToken(deviceCode);
    assert(r.status === 200, `first poll ${r.status}: ${JSON.stringify(r.body)}`);
    // The contract the grace exists for: flat top-level fields, NOT the {ok,data} envelope.
    assert(typeof r.body.access_token === 'string' && typeof r.body.gaii === 'string'
        && typeof r.body.privateKey === 'string', `flat fields missing: ${Object.keys(r.body).join(',')}`);
    assert(!('ok' in r.body) && !('data' in r.body), 'device-token must stay flat OAuth-style, not enveloped');
    firstCreds = r.body;
});

// ── Phase 2: the grace window ──
console.log('\nPhase 2: retrieval grace');

await test('Immediate re-poll is slow_down (RFC 8628 rate limit still applies)', async () => {
    const r = await pollToken(deviceCode);
    assert(r.status === 400 && r.body.error === 'slow_down', `expected slow_down, got ${r.status} ${JSON.stringify(r.body)}`);
    // slow_down bumps the interval by 5 s; respect the new one below.
    pollInterval += 5;
});

await test('Re-poll after the interval returns the SAME credentials (grace window)', async () => {
    await sleep((pollInterval + 1) * 1000);
    const r = await pollToken(deviceCode);
    assert(r.status === 200, `grace re-poll ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.gaii === firstCreds.gaii, `gaii changed: ${r.body.gaii} !== ${firstCreds.gaii}`);
    assert(r.body.privateKey === firstCreds.privateKey, 'privateKey must be identical on a grace re-poll');
});

await test('Unknown device_code is invalid_grant', async () => {
    const r = await pollToken('no-such-device-code');
    assert(r.status === 400 && r.body.error === 'invalid_grant', `expected invalid_grant, got ${r.status} ${JSON.stringify(r.body)}`);
});

// ── Phase 3: the funnel marker from an MCP session ──
console.log('\nPhase 3: first_mcp_call marker');

await test('MCP initialize with the agent token writes onboarding.first_mcp_call', async () => {
    const init = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'Authorization': `Bearer ${firstCreds.access_token}`,
        },
        body: JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grace-e2e', version: '1.0' } },
        }),
    });
    assert(init.status === 200, `mcp initialize ${init.status}: ${(await init.text()).slice(0, 200)}`);

    // The marker write is fire-and-forget off the initialize path — poll briefly for it.
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
        const r = await json('/v1/memory/onboarding.first_mcp_call?soft=1', auth(ownerToken));
        if (r.status === 200 && r.body.data?.exists !== false && r.body.data?.value) found = true;
        else await sleep(300);
    }
    assert(found, 'onboarding.first_mcp_call must appear in the owner scope after the first MCP session');
});

console.log(`\n=== Device-Token Grace: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
