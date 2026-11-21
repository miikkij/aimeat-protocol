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
 *   v1.1.0 — 2026-11-21 — The shared harness (test/helpers/harness.ts), and a second owner's refused
 *     account delete on the switched-off node: the stubs leave the other routers' refusals as they were.
 *   v1.0.0 — 2026-11-21 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=feature-flag-off

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BASE, test, assert, json, expectRefusal, finish } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { ownNodeDb } from './helpers/own-node-db.js';

const short = (b: any) => (b === undefined ? '' : String(JSON.stringify(b)).slice(0, 300));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A request to `base`, the suite's own node or the in-process one, through the shared harness. */
const call = (base: string, path: string, opts: RequestInit = {}) => json(`${base}${path}`, opts);

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

        // The stubs come after every other router, so the refusals of the routers around them stay:
        // a second owner on the same node still cannot delete the first owner's account.
        const second = await registerOwner(offBase, `ffoffb${stamp}`);
        const other = await call(offBase, `/v1/owners/ffoff${stamp}`, { method: 'DELETE', headers: auth(second.token) });
        expectRefusal(other, 403, 'ACCESS_DENIED');
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
});

// The in-process node keeps timers running; finish() exits, which keeps a green run from hanging.
finish();
