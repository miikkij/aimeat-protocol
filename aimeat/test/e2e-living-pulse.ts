/**
 * @file e2e-living-pulse.ts
 * @description E2E for the unattended living-document pulse's DUE-SCAN (2026-08-17 meta-projection
 *   rewrite): a due living-config is found by the scheduler's cross-owner meta scan and pulsed
 *   (status.last_pulse/pulses written), and the owner's manual pulse-due door honours the cadence
 *   guard right after a pulse. Deriving sections needs an AI key and is out of scope here — a config
 *   with an empty template pulses to completion without one, which is exactly what makes the scan
 *   path testable.
 * @version-history
 *   v1.0.0 -- 2026-08-17 -- Initial: scheduler scan finds + pulses a due config; cadence guard holds.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=living-pulse

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Living-Pulse Due-Scan E2E ===\n');

const ownerName = `lpown${Date.now()}`;
let token = '';
let orgId = '';
const WS = 'ws-lp1';
const DOC = 'lpdoc1';
const configKey = () => `organism.${orgId}.w.${WS}.living.${DOC}.latest`;

await test('Setup: first owner (auto-operator) + organism + a DUE living-config', async () => {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    token = tok.body.data.token;

    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Pulse Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `organism: ${o.status}`);
    orgId = o.body.data.organism.id;

    // No status.last_pulse yet + hourly cadence ⇒ due on the very next scan. Empty template ⇒ the
    // pulse completes without an AI key (nothing to derive; the status write still happens).
    const cfg = { type: 'living-config', title: 'Pulse probe', charter: { cadence: 'hourly' }, template: [], status: {} };
    const w = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: configKey(), value: cfg, visibility: 'private' }) });
    assert(w.status === 201, `config write: ${w.status}: ${JSON.stringify(w.body.error)}`);
});

await test('The scheduler scan (core:living-pulse) finds the due config and pulses it', async () => {
    const trig = await json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST', headers: auth(token) });
    assert(trig.status === 200, `trigger: ${trig.status}: ${JSON.stringify(trig.body.error)}`);

    const r = await json(`/v1/memory/${encodeURIComponent(configKey())}`, { headers: auth(token) });
    assert(r.status === 200, `config read: ${r.status}`);
    const status = r.body.data?.value?.status ?? {};
    assert(status.pulses === 1, `pulses should be 1 after one scan, got ${status.pulses}`);
    assert(typeof status.last_pulse === 'string' && status.last_pulse.length > 0, 'last_pulse stamped');
    assert(status.health === 'green', `health should stay green, got ${status.health}`);
});

await test('Right after a pulse, the owner pulse-due door honours the cadence (pulses nothing)', async () => {
    const r = await json('/v1/living/pulse-due', { method: 'POST', headers: auth(token) });
    assert(r.status === 200, `pulse-due: ${r.status}`);
    assert(r.body.data?.pulsed === 0, `hourly cadence just satisfied — expected pulsed 0, got ${r.body.data?.pulsed}`);
});

await test('A non-operator owner cannot trigger the scheduler job (403), and anonymous cannot (401)', async () => {
    const name2 = `lpnop${Date.now()}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: name2, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register second owner: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name2, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name2 + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `second token: ${JSON.stringify(tok.body.error)}`);

    const nonOp = await json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST', headers: auth(tok.body.data.token) });
    assert(nonOp.status === 403, `non-operator trigger expected 403, got ${nonOp.status}`);
    const anon = await json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST' });
    assert(anon.status === 401, `anonymous trigger expected 401, got ${anon.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
