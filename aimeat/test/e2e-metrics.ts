/**
 * @file e2e-metrics.ts
 * @description E2E for the Prometheus exposition endpoint (/v1/metrics) and the per-request
 *   HTTP metrics middleware. Asserts the operator gets the text exposition, that
 *   aimeat_http_requests_total actually GROWS between two reads (the middleware existed
 *   unmounted from 2026-07-13 to 2026-08-17, so the counter sat at zero samples on every
 *   node — this is the assertion that would have caught it), and that non-operator and
 *   unauthenticated callers are refused.
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: exposition + counter-growth + auth gates.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-metrics

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function registerAndToken(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

/** Sum every sample of a counter across its label sets in a Prometheus exposition. */
function counterTotal(text: string, name: string): number | null {
    let total = 0, seen = false;
    for (const line of text.split('\n')) {
        if (!line.startsWith(name)) continue;
        const after = line.slice(name.length);
        if (after[0] !== '{' && after[0] !== ' ') continue;   // e.g. name_sum / name_count
        const sp = line.lastIndexOf(' ');
        const v = Number(line.slice(sp + 1));
        if (Number.isFinite(v)) { total += v; seen = true; }
    }
    return seen ? total : null;
}

console.log('\n=== AIMEAT Metrics E2E ===\n');

const opName = `metricsop${Date.now()}`;
const nonOpName = `metricsnon${Date.now()}`;
let opToken = '';
let nonOpToken = '';

await test('Setup: first owner is auto-operator; a second is not', async () => {
    opToken = await registerAndToken(opName);
    nonOpToken = await registerAndToken(nonOpName);
});

let firstTotal: number | null = null;

await test('GET /v1/metrics as operator returns the Prometheus exposition', async () => {
    const res = await fetch(`${BASE}/v1/metrics`, { headers: { Authorization: `Bearer ${opToken}` } });
    assert(res.status === 200, `status ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/plain'), `content-type ${ct}`);
    const text = await res.text();
    assert(text.includes('process_resident_memory_bytes'), 'has process metrics');
    firstTotal = counterTotal(text, 'aimeat_http_requests_total');
    assert(firstTotal !== null, 'aimeat_http_requests_total has at least one sample (middleware mounted)');
});

await test('aimeat_http_requests_total grows when requests are made', async () => {
    for (let i = 0; i < 3; i++) await json('/v1/build');
    const res = await fetch(`${BASE}/v1/metrics`, { headers: { Authorization: `Bearer ${opToken}` } });
    const text = await res.text();
    const second = counterTotal(text, 'aimeat_http_requests_total');
    assert(second !== null, 'counter still present');
    assert(second! > (firstTotal ?? 0), `counter grew: ${firstTotal} -> ${second}`);
});

await test('HTTP duration histogram records observations', async () => {
    const res = await fetch(`${BASE}/v1/metrics`, { headers: { Authorization: `Bearer ${opToken}` } });
    const text = await res.text();
    const count = counterTotal(text, 'aimeat_http_request_duration_ms_count');
    assert(count !== null && count > 0, `duration count > 0, got ${count}`);
});

await test('Non-operator is refused (403)', async () => {
    const res = await fetch(`${BASE}/v1/metrics`, { headers: { Authorization: `Bearer ${nonOpToken}` } });
    assert(res.status === 403, `expected 403, got ${res.status}`);
});

await test('Unauthenticated is refused', async () => {
    const res = await fetch(`${BASE}/v1/metrics`);
    assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
