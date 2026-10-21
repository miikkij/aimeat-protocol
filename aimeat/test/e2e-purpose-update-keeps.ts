/**
 * @file test/e2e-purpose-update-keeps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PURPOSE: what exists at an update keeps working. A published app whose code reads its
 *   owner's data packages was published before data packages asked an app for storage:read; at the
 *   node's first start after the update the once-only keep step gives the app the word, and the app,
 *   unchanged and not republished, reads its owner's private package again. A published app's
 *   permissions change only when its author republishes it. AIMEAT-PURPOSE.md uses 4 and 6,
 *   invariant 20.
 *
 *   THE UPDATE, SIMULATED. The step (services/app-datapackage-read-keep-migration.ts, P2 of the
 *   October 2026 round) runs at boot before the node serves. Here its record is taken away and the
 *   step is run against the server's own storage, as test/e2e-secrets-approvals.ts tests 23 to 25 run
 *   the extension first-use step.
 *
 *   The other things that existed at that update are proved by suites in the purpose tier itself:
 *   an extension installed before it keeps its first use of a key (e2e-secrets-approvals 23, 23b),
 *   an app's extension schedule made before it keeps firing (e2e-scheduled-ext-files 23c, 23d), a
 *   workflow run started before it finishes (e2e-workflow-extension-step 13e), the agents and apps of
 *   the 4.0 update keep their routes (e2e-rest-scope-keep-working, e2e-app-scope-allowance). The
 *   on_done keep step (P3) has its unit test, test/unit/app-on-done-keep.test.ts.
 *
 *   FAIL FIRST, 2026-10-21, both backends: with keepWorkingAppsOnce in services/app-scope-allowance.ts
 *   writing no grant (the loop over liveGrantsOf given no grant), test 3 is red; restored byte for byte.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-purpose-update-keeps
 * @version-history
 *   v1.0.0 -- 2026-10-21 -- Initial (wish wish-tarkoitustestit-e2e-sarjat-jotka-varmistavat-aimeatin-suunni).
 */
import { registerOwner } from './helpers/owner-login.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import { APP_DATAPACKAGE_READ_KEEP_KEY, keepDatapackageReadForAppsOnce } from '../src/services/app-datapackage-read-keep-migration.js';
import { BASE, NODE_ID, assert, appGrant, auth, harness, json } from './helpers/purpose-kit.js';

const h = harness('Purpose: what exists at an update keeps working');
const STAMP = Date.now().toString(36);
const owner = await registerOwner(BASE, `purposeupd${STAMP}`);
const PKG = `purpose-ledger-${STAMP}`;
const APP = `purpose-ledger-${STAMP}.html`;
// The app's own code, as its author wrote it before the update, the way the served library's aiDoc
// says to: it signs in, asks memory:read, and reads its owner's package with AIMEAT.datapackage.
const APP_HTML = `<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="memory:read">
<script src="/v1/libs/aimeat-auth.js"></script><script src="/v1/libs/aimeat-datapackage.js"></script></head><body>
<script>AIMEAT.datapackage.rows('pkg:${owner.name}/${PKG}', 'orders').then(function (page) { document.body.textContent = page.rows.length; });</script>
</body></html>`;

let app = { token: '', refresh: '' };
const readRows = (token: string) => json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${PKG}/rows/orders`, { headers: auth(token) });

await h.test('1. Setup: the owner keeps a private data package, and an app published earlier reads it', async () => {
    const p = await json('/v1/datapackages', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name: PKG, changes: 'purpose e2e', visibility: 'private', resources: [{ name: 'orders', rows: [{ id: 1, sum: 12 }, { id: 2, sum: 30 }] }] }),
    });
    assert(p.status === 201, `publish the package: ${p.status} ${JSON.stringify(p.body?.error)}`);
    app = await appGrant(owner, APP, 'memory:read', APP_HTML);
});

await h.test('2. Before the keep step runs, the new rule asks the app for storage:read (the state the update repairs)', async () => {
    const r = await readRows(app.token);
    assert(r.status === 403 && /storage:read/.test(r.body?.error?.message ?? ''), `refused, naming the word: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

await h.test("3. KEPT: after the node's first start with the rule, the same app, not republished, reads its owner's private package", async () => {
    const provider = (process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
    const storage = await createStorage({ provider, sqlitePath: pinnedSqlitePath(), dbUrl: serverDbUrl() });
    await storage.deleteMemory(`system@${NODE_ID}`, APP_DATAPACKAGE_READ_KEEP_KEY, `system@${NODE_ID}`);
    const step = await keepDatapackageReadForAppsOnce(storage, { nodeId: NODE_ID, accountEventWindow: 100 }, { existedBefore: new Date().toISOString() });
    const kept = step.apps.find(a => a.appId === `${owner.name}/${APP}`);
    assert(step.ran && kept && kept.words.includes('storage:read') && kept.grants === 1, `the step keeps the app: ${JSON.stringify(step)}`);
    // The app renews its session the way it does every hour, and carries on.
    const renewed = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: app.refresh }) });
    assert(renewed.status === 200 && typeof renewed.body?.data?.access_token === 'string', `refresh: ${renewed.status} ${JSON.stringify(renewed.body?.error)}`);
    const r = await readRows(renewed.body.data.access_token);
    assert(r.status === 200 && r.body.data.rows.length === 2, `the kept app reads the package: ${r.status} ${JSON.stringify(r.body?.error)}`);
});

await h.test('4. The owner can read why the app kept the word, and the author has changed nothing', async () => {
    const allowance = await json(`/v1/apps/${encodeURIComponent(owner.name)}/${APP}/scope-allowance`, { headers: auth(owner.token) });
    const body = JSON.stringify(allowance.body?.data ?? {});
    assert(allowance.status === 200 && body.includes('storage:read') && body.includes('AIMEAT.datapackage.rows'),
        `the allowance names the word and the code that needs it: ${allowance.status} ${body.slice(0, 300)}`);
    const served = await fetch(`${BASE}/v1/apps/${encodeURIComponent(owner.name)}/${APP}`);
    assert((await served.text()).includes('content="memory:read"'), 'the app\'s own declaration is as its author wrote it');
});

h.finish();
