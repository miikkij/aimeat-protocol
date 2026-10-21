/**
 * @file test/unit/app-datapackage-read-keep.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The storage:read step for published apps that read data packages
 *   (services/app-datapackage-read-keep-migration.ts, secaudit 2026-10 v41), and the publish warning
 *   that names the word for a new app (services/app-scope-needs.ts rule 'datapackage-read').
 *
 *   - An app published before the step that declares its own aimeat-scopes without storage:read and
 *     reads data packages gets the word: through AIMEAT.datapackage.rows, and through a
 *     /v1/datapackages/... or /v1/odata/... literal. Its live grants get it, and only storage:read.
 *   - Nothing for: an app on the default set (it has storage:read), an app that only publishes
 *     (POST /v1/datapackages, /validate), an app that needs storage:read only for /v1/pub (that is the
 *     other step's), an app whose owner removed the word, an app published after.
 *   - Once per node; the owner's feed says so.
 *   - The publish warning names storage:read for a new app that reads packages and does not ask for it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-datapackage-read-keep.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { keepDatapackageReadForAppsOnce, APP_DATAPACKAGE_READ_KEEP_KEY } from '../../src/services/app-datapackage-read-keep-migration.js';
import { readAppScopeAllowance, writeAppScopeAllowance, APP_SCOPE_ALLOWANCE_SPEC } from '../../src/services/app-scope-allowance-store.js';
import { readAccountEvents } from '../../src/services/account-events.js';
import { undeclaredScopeFindings } from '../../src/services/app-scope-needs.js';

const NODE_ID = 'aimeat-app-datapackage-read-keep';
const OWNER = 'dpowner';
const GHII = `${OWNER}@${NODE_ID}`;
const DECLARED = '<meta name="aimeat-scopes" content="memory:read memory:write">';

let storage: Storage;
let config: AimeatConfig;
const past = new Date(Date.now() - 3_600_000).toISOString();

async function publish(filename: string, html: string, createdAt = past): Promise<void> {
    const data = Buffer.from(html);
    await storage.createApp({
        ownerGaii: GHII, ownerName: OWNER, filename, versionNumber: 1,
        manifest: { name: filename.replace('.html', ''), description: 'd', version: '1.0.0', author: OWNER, category: 'tool', tags: [] } as never,
        mimeType: 'text/html', size: data.length, data, createdAt,
    });
}

const signsIn = (code: string, meta = DECLARED) =>
    `<html><head>${meta}<script src="/v1/libs/aimeat-auth.js"></script></head><body><script>${code}</script></body></html>`;
const allowance = (app: string) => readAppScopeAllowance(storage, `${OWNER}/${app}`);

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const k = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: k.publicKey, roles: ['owner'], createdAt: past } as never);

    await publish('sdkrows.html', signsIn("const page = await AIMEAT.datapackage.rows('pkg:dpowner/sales', 'items');"));
    await storage.createAppGrant({
        grantId: 'g-sdkrows', app: `${OWNER}/sdkrows.html`, appName: 'sdkrows.html', appOrigin: 'https://x.node.test', owner: OWNER, gaii: GHII,
        scopes: ['memory:read', 'memory:write'], refreshTokenHash: null, createdAt: past, lastUsedAt: null, revoked: false,
    } as never);
    await publish('literal.html', signsIn("session.fetch('/v1/datapackages/' + owner + '/' + name + '/rows/items');"));
    await publish('odata.html', signsIn('session.fetch(`${NODE}/v1/odata/${owner}/${name}/items`);'));
    await publish('defaults.html', signsIn("AIMEAT.datapackage.open('pkg:dpowner/sales')", ''));
    await publish('publishes.html', signsIn("session.fetch('/v1/datapackages', { method: 'POST' }); session.fetch('/v1/datapackages/validate', { method: 'POST' });"));
    await publish('pubonly.html', signsIn("session.fetch('/v1/pub/' + gaii + '/' + key)"));
    await publish('removed.html', signsIn("AIMEAT.datapackage.versions('pkg:dpowner/sales')"));
    await writeAppScopeAllowance(storage, {
        spec: APP_SCOPE_ALLOWANCE_SPEC, appId: `${OWNER}/removed.html`, words: [], removed: ['storage:read'], evidence: [], at: past,
    });
}, 60_000);

describe('storage:read for apps that read data packages', () => {
    it('gives the word to the apps whose code reads data packages and whose sign-in does not ask for it, and to nothing else', async () => {
        const startedAt = new Date().toISOString();
        await publish('fresh.html', signsIn("AIMEAT.datapackage.rows('pkg:dpowner/sales', 'items')"), new Date(Date.now() + 1000).toISOString());

        const r = await keepDatapackageReadForAppsOnce(storage, config, { existedBefore: startedAt });
        expect(r.ran).toBe(true);
        expect(r.apps.map(a => [a.appId, a.words]).sort()).toEqual([
            [`${OWNER}/literal.html`, ['storage:read']],
            [`${OWNER}/odata.html`, ['storage:read']],
            [`${OWNER}/sdkrows.html`, ['storage:read']],
        ]);
        expect((await allowance('sdkrows.html'))!.words).toEqual(['storage:read']);
        expect((await storage.getAppGrant('g-sdkrows'))!.scopes).toEqual(['memory:read', 'memory:write', 'storage:read']);
        expect((await allowance('removed.html'))!.words).toEqual([]);
        for (const app of ['defaults.html', 'publishes.html', 'pubonly.html', 'fresh.html']) expect(await allowance(app)).toBeNull();
    });

    it('tells the owner on the feed', async () => {
        const kept = (await readAccountEvents(storage, GHII)).filter(e => e.kind === 'app_scope_words_kept');
        expect(kept).toHaveLength(1);
        expect(kept[0].subject).toBe(APP_DATAPACKAGE_READ_KEEP_KEY);
        expect(kept[0].data.words).toBe('storage:read');
    });

    it('runs once', async () => {
        await publish('later.html', signsIn("AIMEAT.datapackage.rows('pkg:dpowner/sales', 'items')"));
        const again = await keepDatapackageReadForAppsOnce(storage, config);
        expect(again.ran).toBe(false);
        expect(await allowance('later.html')).toBeNull();
    });

    it('warns at publish when a new app reads data packages without asking for storage:read', async () => {
        const warn = await undeclaredScopeFindings(signsIn("AIMEAT.datapackage.rows('pkg:dpowner/sales', 'items')"), async () => null);
        expect(warn).toHaveLength(1);
        expect(warn[0].message).toContain('`storage:read`');
        const declares = await undeclaredScopeFindings(signsIn("AIMEAT.datapackage.rows('pkg:x/y', 'items')", '<meta name="aimeat-scopes" content="memory:read storage:read">'), async () => null);
        expect(declares).toHaveLength(0);
        const publishesOnly = await undeclaredScopeFindings(signsIn("session.fetch('/v1/datapackages', { method: 'POST' })"), async () => null);
        expect(publishesOnly).toHaveLength(0);
    });
});
