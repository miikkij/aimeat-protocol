/**
 * @file e2e-feature-flag-off.ts
 * @description E2E for a router behind a feature flag on a node where the operator switched the
 *   feature off (src/server-bootstrap/flagged-mount.ts).
 *
 *   Until 2026-11-21 such a router was mounted only when its flag was on, so with the flag off the
 *   caller got 404 NOT_FOUND, the same answer as a route that does not exist. Now the router's
 *   paths answer 503 FEATURE_DISABLED with the setting's name in `error.details.setting`.
 *
 *   The suite boots a node of its own in process (port 0, a database of its own through
 *   test/helpers/own-node-db.ts) with the prompt calibrator, cortex extensions and personal nodes
 *   switched off, and checks against the suite's own node that a switched-on feature is unchanged.
 *   Seen red first: before flagged-mount.ts the first case got 404 on every path.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=feature-flag-off

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerOwner } from './helpers/owner-login.js';
import { ownNodeDb } from './helpers/own-node-db.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const short = (b: any) => (b === undefined ? '' : String(JSON.stringify(b)).slice(0, 300));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function call(base: string, path: string, opts: RequestInit = {}) {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

console.log('\n=== AIMEAT Feature Flag Off E2E ===\n');

const stamp = Date.now();
const SWITCHED = {
    AIMEAT_CALIBRATOR_ENABLED: 'false',
    AIMEAT_CORTEX_ENABLED: 'false',
    AIMEAT_PERSONAL_NODES_ENABLED: 'false',
};

await test('On the suite\'s own node, with the calibrator on, its route answers as before (no 503)', async () => {
    const token = (await registerOwner(BASE, `ffon${stamp}`)).token;
    const r = await call(BASE, '/v1/calibrator', { headers: auth(token) });
    assert(r.status === 200, `calibrator on: expected 200, got ${r.status} ${short(r.body)}`);
    const gone = await call(BASE, `/v1/owners/ffon${stamp}`, { method: 'DELETE', headers: auth(token) });
    assert(gone.status === 200, `cleanup: ${gone.status} ${short(gone.body)}`);
});

await test('On a node with three features off, their routes answer 503 FEATURE_DISABLED with the setting', async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(SWITCHED)) { saved[k] = process.env[k]; process.env[k] = v; }
    process.env.AIMEAT_DEV_MODE = 'true';
    process.env.AIMEAT_TEST_MODE = 'true';

    const { loadConfig } = await import('../src/config.js');
    const { createServer } = await import('../src/server.js');
    const { config } = loadConfig({});
    Object.assign(config, (await ownNodeDb('flags-off', { memory: true })).config);
    assert(!config.calibratorEnabled && !config.cortexEnabled && !config.personalNodesEnabled,
        'the second node should have the three features off');

    const { app } = await createServer(config);
    const server: Server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    const offBase = `http://localhost:${(server.address() as AddressInfo).port}`;

    try {
        const token = (await registerOwner(offBase, `ffoff${stamp}`)).token;
        const cases: Array<[string, string, string]> = [
            ['GET', '/v1/calibrator', 'AIMEAT_CALIBRATOR_ENABLED'],
            ['POST', '/v1/calibrator', 'AIMEAT_CALIBRATOR_ENABLED'],
            ['GET', '/v1/cortex', 'AIMEAT_CORTEX_ENABLED'],
            ['GET', '/v1/personal/status', 'AIMEAT_PERSONAL_NODES_ENABLED'],
        ];
        for (const [method, path, setting] of cases) {
            const r = await call(offBase, path, { method, headers: auth(token), ...(method === 'POST' ? { body: '{}' } : {}) });
            assert(r.status === 503, `${method} ${path}: expected 503, got ${r.status} ${short(r.body)}`);
            assert(r.body.error?.code === 'FEATURE_DISABLED', `${method} ${path}: code ${r.body.error?.code}`);
            assert(r.body.error?.details?.setting === setting, `${method} ${path}: setting ${short(r.body.error?.details)}`);
        }

        // A path no router serves is still 404: the 503 covers only the switched-off router's paths.
        const nothing = await call(offBase, '/v1/calibratorx', { headers: auth(token) });
        assert(nothing.status === 404, `a path next to the prefix: expected 404, got ${nothing.status}`);

        // A feature left on answers as it does on any node.
        const on = await call(offBase, '/v1/extensions', { headers: auth(token) });
        assert(on.status === 200, `extensions on: expected 200, got ${on.status} ${short(on.body)}`);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
// The in-process node keeps timers running; an explicit exit keeps a green run from hanging.
process.exit(failed > 0 ? 1 : 0);
