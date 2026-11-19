/**
 * @file test/e2e-app-delete-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The delete completeness test (wish "Sovelluksen poiston kattavuustesti"): one owner
 *   has two apps, A and B, and each gets everything that can be attached to an app. The owner
 *   deletes A. Then the test reads EVERY table of the node's database, every text column, for A's
 *   name, and fails naming the table, the column and the key of each row it finds that no entry of
 *   STORES keeps on purpose. B's records must all still be there: a delete that reaches the other
 *   app of the same owner is the failure this guards against just as much.
 *
 *   ONE LIST. STORES (test/helpers/app-sweep-fixture.ts) names every store an app can leave a trace
 *   in, whether the delete removes it or keeps it, and why it keeps it. A new store is one line there
 *   and one step in src/services/app/delete-sweep.ts. A row the sweep finds in a store the list does
 *   not name fails with that store's name, so a store added later without a line there is found the
 *   first time this runs. test/e2e-owner-erasure-apps.ts reads the same list for an account erasure.
 *
 *   HOW THE FIXTURE IS ATTACHED: test/helpers/app-sweep-fixture.ts attachApp. What is tested is the
 *   delete, and the delete reads the same rows whichever way they were written.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-delete-sweep
 * @version-history
 *   v1.1.0 — 2026-11-19 — The list, the fixture and the database read moved to
 *     test/helpers/app-sweep-fixture.ts unchanged, so the owner erasure suite reads the same ones.
 *     Every test and assertion here is as it was.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.3).
 */
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { ROLES_KEY } from '../src/services/ai/roles.js';
import {
    type AppNames, type Hit, type SweepOwner, STORES, appNames, needlesOf, storeOf, describeHit, sweepDatabase,
    json as httpJson, auth, show, setupOwner as registerSweepOwner, attachApp, attachAiSettings,
} from './helpers/app-sweep-fixture.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

const json = (path: string, opts: RequestInit = {}) => httpJson(BASE, path, opts);
const setupOwner = (label: string) => registerSweepOwner(BASE, NODE_ID, label);

// ── The database, read from here ──────────────────────────────────────────────────────────────────

const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
const dbUrl = serverDbUrl();
const sqlitePath = pinnedSqlitePath();
let storage!: Storage;

const sweep = (needles: string[]) => sweepDatabase(storage, provider, needles);

// ── The fixture ───────────────────────────────────────────────────────────────────────────────────

let OWNER: SweepOwner;
let OTHER: SweepOwner;
const stamp = Date.now().toString(36).slice(-6);
const names = (letter: 'a' | 'b'): AppNames => appNames(OWNER.name, letter, stamp);
const attach = (a: AppNames, letter: string) => attachApp({ base: BASE, nodeId: NODE_ID, storage }, OWNER, OTHER, a, letter, stamp);
const attachShared = (a: AppNames, b: AppNames) => attachAiSettings(storage, OTHER, [a, b]);

// ── The run ───────────────────────────────────────────────────────────────────────────────────────

console.log('\n=== AIMEAT app delete completeness E2E ===\n');

let A!: AppNames, B!: AppNames;
const unnamed = (hits: Hit[], a: AppNames) => hits.filter(h => !storeOf(h, a));
const describe = describeHit;

await test('setup: one owner with two apps, each with everything attachable', async () => {
    const reachable = (provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl);
    assert(reachable === true, `backend "${provider}" is not reachable from this process (no shared file or URL)`);
    storage = await createStorage({ provider, sqlitePath, dbUrl });
    OWNER = await setupOwner('own');
    OTHER = await setupOwner('oth');
    A = names('a'); B = names('b');
    await attach(A, 'a');
    await attach(B, 'b');
    await attachShared(A, B);
});

await test('before the delete, every store of the fixture holds both apps', async () => {
    for (const app of [A, B]) {
        const hits = await sweep(needlesOf(app));
        const missing = STORES.filter(s => s.fixture && !hits.some(h => storeOf(h, app) === s)).map(s => s.name);
        assert(missing.length === 0, `${app.file} is missing from: ${missing.join('; ')}`);
        const strays = unnamed(hits, app);
        assert(strays.length === 0, `${app.file} is in a store STORES does not name: ${strays.map(describe).join('; ')}`);
    }
});

await test('the owner deletes app A', async () => {
    const del = await json(`/v1/apps/${A.file}`, { method: 'DELETE', headers: auth(OWNER.token) });
    assert(del.status === 200, `delete ${show(del)}`);
});

await test('nothing of A is left in a store the delete removes', async () => {
    const hits = await sweep(needlesOf(A));
    const left = hits.filter(h => storeOf(h, A)?.fate !== 'kept');
    assert(left.length === 0, `left behind: ${left.map(h => `${storeOf(h, A)?.name ?? 'a store STORES does not name'}: ${describe(h)}`).join('; ')}`);
});

await test('the grants people gave A are revoked, and B\'s still stand', async () => {
    const ga = await storage.getAppGrant(`appgrant-sweep-a-${stamp}`);
    const gb = await storage.getAppGrant(`appgrant-sweep-b-${stamp}`);
    assert(ga?.revoked === true && !ga.refreshTokenHash, `A's grant: ${JSON.stringify(ga)}`);
    assert(gb?.revoked === false, `B's grant: ${JSON.stringify(gb)}`);
});

await test('app B keeps every store it had', async () => {
    const hits = await sweep(needlesOf(B));
    const missing = STORES.filter(s => s.fixture && !hits.some(h => storeOf(h, B) === s)).map(s => s.name);
    assert(missing.length === 0, `B lost: ${missing.join('; ')}`);
    const open = await fetch(`${BASE}/v1/apps/${OWNER.name}/${B.file}`, { headers: auth(OWNER.token) });
    assert(open.status === 200, `B still opens: ${open.status}`);
});

await test('the other person\'s AI settings name B and no longer A', async () => {
    const roles = (await storage.getMemory(OTHER.ghii, ROLES_KEY))?.value as { bindings: Record<string, unknown> };
    assert(!roles.bindings[`${A.id}#writer`] && !!roles.bindings[`${B.id}#writer`], `bindings: ${JSON.stringify(roles.bindings)}`);
    const prefs = (await storage.getMemory(OTHER.ghii, 'openrouter.settings'))?.value as { app_quotas: Record<string, unknown>; app_allowlist: string[] };
    assert(!prefs.app_quotas[A.id] && !!prefs.app_quotas[B.id], `quotas: ${JSON.stringify(prefs.app_quotas)}`);
    assert(JSON.stringify(prefs.app_allowlist) === JSON.stringify([B.id]), `allowlist: ${JSON.stringify(prefs.app_allowlist)}`);
});

await test('deleting an app that is not there answers 404 and leaves B alone', async () => {
    const del = await json(`/v1/apps/${A.file}`, { method: 'DELETE', headers: auth(OWNER.token) });
    assert(del.status === 404, `second delete ${show(del)}`);
    const other = await json(`/v1/apps/${B.file}`, { method: 'DELETE', headers: auth(OTHER.token) });
    assert(other.status === 404, `another account deleting B: ${show(other)}`);
    const hits = await sweep(needlesOf(B));
    assert(hits.some(h => storeOf(h, B)?.name === 'the design spec'), 'B keeps its design spec');
});

await test('the operator deletes app B through the admin route, and nothing of B is left either', async () => {
    // The suite's first account is the node's operator (a fresh database per suite).
    const del = await json(`/v1/admin/apps/${OWNER.name}/${B.file}`, { method: 'DELETE', headers: auth(OWNER.token) });
    assert(del.status === 200, `operator delete of B ${show(del)}`);
    const hits = await sweep(needlesOf(B));
    const left = hits.filter(h => storeOf(h, B)?.fate !== 'kept');
    assert(left.length === 0, `left behind: ${left.map(h => `${storeOf(h, B)?.name ?? 'a store STORES does not name'}: ${describe(h)}`).join('; ')}`);
});

try { await (storage as unknown as { close?: () => unknown })?.close?.(); } catch { /* the process ends next */ }
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
