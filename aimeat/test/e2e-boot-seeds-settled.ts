/**
 * @file e2e-boot-seeds-settled.ts
 * @description The boot seeding's settled signal, end to end. `GET /v1/build` answers `seeds`, and the
 *   runner waits for `settled` before the first test (test/run-e2e-server.ts), so a suite that reads a
 *   seeded record never races the seeder. Before this, the bundled cortexes, the example packages and
 *   the core scheduled jobs were seeded without the boot waiting for them, and a suite reading one at
 *   once passed on SQLite and failed on PostgreSQL, where the migrations run first.
 * @structure
 *   - the first request already sees `seeds: settled`, uncached
 *   - every shipped cortex is listed for an account that is not the operator (the unawaited seeder
 *     landed, and the node's own private cortexes are visible to every account)
 *   - the core scheduled jobs, seeded outside the service start, are all there at the first read; an
 *     account that is not the operator is refused the list
 *   - the profile schemas are locked by the node's seeder; a key no seeder owns has none
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial (the seeding bullet of docs/pitfalls.md §19, now deleted).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-boot-seeds-settled

import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { bundledCortexNames } from '../src/services/cortex/seeder.js';

const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

console.log('\n=== AIMEAT Boot Seeds Settled E2E ===\n');

await test('the first request sees the boot seeding settled, uncached', async () => {
    const r = await json('/v1/build');
    assert(r.status === 200, `GET /v1/build: ${r.status}`);
    assert(r.body.seeds === 'settled', `seeds: expected "settled", got ${JSON.stringify(r.body.seeds)}`);
    assert((r.headers.get('cache-control') ?? '').includes('no-store'), `Cache-Control: ${r.headers.get('cache-control')}`);
});

let opToken = '';
let bobToken = '';
await test('setup: an operator and a second account', async () => {
    opToken = (await registerOwner(BASE, `seedop${Date.now()}`)).token;
    bobToken = (await registerOwner(BASE, `seedbob${Date.now()}`)).token;
    assert(opToken && bobToken, 'two tokens');
});

await test('every shipped cortex is listed for an account that is not the operator', async () => {
    const r = await json('/v1/cortex', bearer(bobToken));
    assert(r.status === 200, `GET /v1/cortex: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const listed = new Set<string>((r.body.data?.extensions ?? []).map((e: any) => e.name));
    assert(bundledCortexNames().size > 0, 'this build ships no cortex to check');
    const missing = [...bundledCortexNames()].filter(n => !listed.has(n));
    assert(missing.length === 0, `shipped cortexes missing for bob: ${missing.join(', ')}`);
    const foreign = (r.body.data.extensions as any[]).filter(e => bundledCortexNames().has(e.name) && !String(e.installed_by).startsWith('system@'));
    assert(foreign.length === 0, `a shipped cortex installed by an account: ${foreign.map(e => `${e.name}=${e.installed_by}`).join(', ')}`);
});

await test('the core scheduled jobs are there for the operator at the first read', async () => {
    // One read, no retry: e2e-core-jobs reads this list in a loop because the seeding ran behind the
    // first answer; with the runner waiting for `settled`, the first read is the whole list.
    const r = await json('/v1/admin/scheduler/jobs', bearer(opToken));
    assert(r.status === 200, `GET /v1/admin/scheduler/jobs: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const ids = new Set((r.body.data?.jobs ?? []).map((j: any) => j.id));
    for (const id of ['core:daily-allowance', 'core:outbox-sweep', 'core:usage-rollup', 'core:value-fold']) {
        assert(ids.has(id), `core job ${id} is missing; listed ${ids.size}`);
    }
});

await test('an account that is not the operator is refused the job list', async () => {
    const r = await json('/v1/admin/scheduler/jobs', bearer(bobToken));
    expectRefusal(r, 403);
});

await test('a profile schema is locked by the node seeder; a key no seeder owns has none', async () => {
    const seeded = await json('/v1/memory/profile.alice.bio/schema');
    assert(seeded.status === 200, `profile schema: ${seeded.status} ${JSON.stringify(seeded.body?.error)}`);
    const lock = seeded.body.data?.locked_by;
    assert(typeof lock === 'string' && lock.startsWith('system@'), `locked_by: ${JSON.stringify(lock)}`);
    const none = await json('/v1/memory/nobody-seeds-this.key/schema');
    assert(none.status === 200 && none.body.data?.has_schema === false, `unseeded key: ${none.status} ${JSON.stringify(none.body)}`);
});

finish();
