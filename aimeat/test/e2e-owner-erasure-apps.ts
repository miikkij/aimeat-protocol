/**
 * @file test/e2e-owner-erasure-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The erasure of an account that owns apps removes everything the delete of each app
 *   removes. One owner has two apps, A and B, and each gets everything that can be attached to an app
 *   (the fixture of test/e2e-app-delete-sweep.ts). A second owner has app C with the same. The first
 *   owner erases their account (DELETE /v1/owners/:name). Then the test reads EVERY table of the
 *   node's database, every text column, for the names of A and B, and fails naming the table, the
 *   column and the key of each row it finds that ERASURE_KEPT does not keep on purpose. C must keep
 *   every store it had: an erasure that reaches another owner's app is the failure this guards
 *   against just as much.
 *
 *   WHY. The delete of one app ran one list of steps (src/services/app/delete-sweep.ts), and the
 *   erasure of the account deleted the app rows and some of the app's records and left the rest:
 *   stores outside the person's own namespace, keyed by the app's id, such as the internet opening,
 *   the scope allowance, other people's grants, push devices and AI settings that name the app. The
 *   erasure now runs the same list for each app it deletes.
 *
 *   THE ADDRESS. An app delete holds the app's own address for its owner. The erased owner's name is
 *   released for reuse, so the erasure holds it for nobody: the next holder of the name must not get
 *   the origin, and what visitors kept in their browsers there, back.
 *
 *   WHAT AN ERASURE KEEPS differs from what an app delete keeps in three stores: the design spec,
 *   the roadmap and the app's audit log are the author's records, and an erased author's go with the
 *   account. The rest of the kept stores are kept for the same reasons (STORES says each one).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-erasure-apps
 * @version-history
 *   v1.2.0 — 2026-11-20 — An address the operator chose for B stays as the operator set it.
 *   v1.1.0 — 2026-11-19 — On the shared harness (test/helpers/harness.ts); another owner is refused
 *     the erasure of this account (403 ACCESS_DENIED) and its apps stay.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, part 1 of agent F).
 */
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { ROLES_KEY } from '../src/services/ai/roles.js';
import {
    type AppNames, type Hit, type SweepOwner, STORES, appNames, needlesOf, storeOf, describeHit, sweepDatabase,
    json as httpJson, auth, show, setupOwner as registerSweepOwner, attachApp, attachAiSettings,
} from './helpers/app-sweep-fixture.js';

import { BASE, assert, expectRefusal, finish, test } from './helpers/harness.js';

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

const json = (path: string, opts: RequestInit = {}) => httpJson(BASE, path, opts);
const setupOwner = (label: string) => registerSweepOwner(BASE, NODE_ID, label);

/**
 * The stores an erasure keeps on purpose: the ones STORES keeps on an app delete, less the author's
 * own records (the design spec, the roadmap and the audit log), which go with the erased account.
 */
const ERASURE_KEPT = new Set(STORES
    .filter(s => s.fate === 'kept' && !['the design spec', 'the roadmap', 'the audit log'].includes(s.name))
    .map(s => s.name));

const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
const dbUrl = serverDbUrl();
const sqlitePath = pinnedSqlitePath();
let storage!: Storage;
const sweep = (needles: string[]) => sweepDatabase(storage, provider, needles);

let OPERATOR: SweepOwner, OWNER: SweepOwner, OTHER: SweepOwner;
const stamp = Date.now().toString(36).slice(-6);
let A!: AppNames, B!: AppNames, C!: AppNames;

const kit = () => ({ base: BASE, nodeId: NODE_ID, storage });
const left = (hits: Hit[], a: AppNames) => hits.filter(h => !ERASURE_KEPT.has(storeOf(h, a)?.name ?? ''));
const missingStores = (hits: Hit[], a: AppNames) => STORES.filter(s => s.fixture && !hits.some(h => storeOf(h, a) === s)).map(s => s.name);

console.log('\n=== AIMEAT owner erasure of apps E2E ===\n');

await test('setup: an owner with two apps and another owner with one, each with everything attachable', async () => {
    const reachable = (provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl);
    assert(reachable === true, `backend "${provider}" is not reachable from this process (no shared file or URL)`);
    storage = await createStorage({ provider, sqlitePath, dbUrl });
    // The first account is the node's operator; the erased owner is an ordinary account.
    OPERATOR = await setupOwner('op');
    OWNER = await setupOwner('own');
    OTHER = await setupOwner('oth');
    A = appNames(OWNER.name, 'a', stamp);
    B = appNames(OWNER.name, 'b', stamp);
    C = appNames(OTHER.name, 'c', stamp);
    await attachApp(kit(), OWNER, OTHER, A, 'a', stamp);
    await attachApp(kit(), OWNER, OTHER, B, 'b', stamp);
    await attachApp(kit(), OTHER, OPERATOR, C, 'c', stamp);
    await attachAiSettings(storage, OTHER, [A, B]);
    await attachAiSettings(storage, OPERATOR, [C]);
    // The own address a publish gives an app on the app origin, for A and for C.
    const now = new Date().toISOString();
    for (const app of [A, C]) {
        await storage.createSubdomainSite({
            subdomain: `${app.slug}-${stamp}`, kind: 'app', target: app.id, enabled: true, createdBy: `${app.owner}@${NODE_ID}`,
            createdAt: now, updatedAt: now, origin: 'publisher', heldSince: null,
        } as never);
    }
    // An address the operator chose for B: the operator's decision, which the erasure leaves alone.
    await storage.createSubdomainSite({
        subdomain: `op-${B.slug}-${stamp}`, kind: 'app', target: B.id, enabled: true, createdBy: OPERATOR.ghii,
        createdAt: now, updatedAt: now, origin: 'operator', heldSince: null,
    } as never);
});

await test('before the erasure, every store of the fixture holds all three apps', async () => {
    for (const app of [A, B, C]) {
        const missing = missingStores(await sweep(needlesOf(app)), app);
        assert(missing.length === 0, `${app.file} is missing from: ${missing.join('; ')}`);
    }
});

await test('another owner is refused the erasure of this account, and its apps stay', async () => {
    const del = await json(`/v1/owners/${OWNER.name}`, { method: 'DELETE', headers: auth(OTHER.token) });
    expectRefusal(del, 403, 'ACCESS_DENIED');
    const open = await fetch(`${BASE}/v1/apps/${OWNER.name}/${A.file}`, { headers: auth(OWNER.token) });
    assert(open.status === 200, `A still opens: ${open.status}`);
});

await test('the owner erases the account', async () => {
    const del = await json(`/v1/owners/${OWNER.name}`, { method: 'DELETE', headers: auth(OWNER.token) });
    assert(del.status === 200 && del.body?.data?.deleted === true, `erase ${show(del)}`);
    assert((del.body.data.deletion_log as string[]).includes('apps:2'), `deletion log: ${JSON.stringify(del.body.data.deletion_log)}`);
});

await test('nothing of A or B is left in a store the erasure removes', async () => {
    const found: string[] = [];
    for (const app of [A, B]) {
        for (const h of left(await sweep(needlesOf(app)), app)) found.push(`${app.file}: ${storeOf(h, app)?.name ?? 'a store STORES does not name'}: ${describeHit(h)}`);
    }
    assert(found.length === 0, `left behind: ${found.join('; ')}`);
});

await test('the grants the other person gave A and B are revoked, and the grant to C stands', async () => {
    for (const letter of ['a', 'b']) {
        const g = await storage.getAppGrant(`appgrant-sweep-${letter}-${stamp}`);
        assert(g?.revoked === true && !g.refreshTokenHash, `${letter.toUpperCase()}'s grant: ${JSON.stringify(g)}`);
    }
    const gc = await storage.getAppGrant(`appgrant-sweep-c-${stamp}`);
    assert(gc?.revoked === false, `C's grant: ${JSON.stringify(gc)}`);
});

await test('the other person\'s AI settings no longer name A or B, and the operator\'s still name C', async () => {
    const roles = (await storage.getMemory(OTHER.ghii, ROLES_KEY))?.value as { bindings: Record<string, unknown> };
    assert(Object.keys(roles.bindings).length === 0, `bindings: ${JSON.stringify(roles.bindings)}`);
    const prefs = (await storage.getMemory(OTHER.ghii, 'openrouter.settings'))?.value as { app_quotas: Record<string, unknown>; app_allowlist: string[] };
    assert(Object.keys(prefs.app_quotas).length === 0 && prefs.app_allowlist.length === 0, `settings: ${JSON.stringify(prefs)}`);
    const cRoles = (await storage.getMemory(OPERATOR.ghii, ROLES_KEY))?.value as { bindings: Record<string, unknown> };
    assert(!!cRoles.bindings[`${C.id}#writer`], `C's binding: ${JSON.stringify(cRoles.bindings)}`);
});

await test('A\'s address is held for nobody, and C\'s still serves C', async () => {
    const a = await storage.getSubdomainSite(`${A.slug}-${stamp}`);
    assert(!!a && a.target.startsWith('erased:') && a.target.endsWith(`/${A.file}`) && !!a.heldSince, `A's address: ${JSON.stringify(a)}`);
    const c = await storage.getSubdomainSite(`${C.slug}-${stamp}`);
    assert(c?.target === C.id && !c.heldSince, `C's address: ${JSON.stringify(c)}`);
});

await test('an address the operator chose for B stays as the operator set it', async () => {
    const b = await storage.getSubdomainSite(`op-${B.slug}-${stamp}`);
    assert(b?.target === B.id && b.origin === 'operator', `B's operator address: ${JSON.stringify(b)}`);
});

await test('app C of the other owner keeps every store it had', async () => {
    const hits = await sweep(needlesOf(C));
    const missing = missingStores(hits, C);
    assert(missing.length === 0, `C lost: ${missing.join('; ')}`);
    const open = await fetch(`${BASE}/v1/apps/${OTHER.name}/${C.file}`, { headers: auth(OTHER.token) });
    assert(open.status === 200, `C still opens: ${open.status}`);
});

await test('a second erasure of the same name answers 404', async () => {
    const again = await json(`/v1/owners/${OWNER.name}`, { method: 'DELETE', headers: auth(OPERATOR.token) });
    assert(again.status === 404, `second erasure ${show(again)}`);
});

try { await (storage as unknown as { close?: () => unknown })?.close?.(); } catch { /* the process ends next */ }
finish();
