/**
 * @file test/unit/app-storage-read-keep.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The storage:read step for published apps (services/app-storage-read-keep-migration.ts),
 *   on a node that ran the 4.0.x keep-working step before QA audit S3-03 gated GET /v1/pub.
 *
 *   - An app published before the step that declares its own aimeat-scopes without storage:read and
 *     reads /v1/pub gets the word: from a string literal, and from the path written escaped in a
 *     regex (the originalmiskate.com case, OM Koti). Its live grants get it, an allowance it already
 *     has keeps its words, and only storage:read is given.
 *   - Nothing for: an app on the default set (it has storage:read), an app that declares it, an app
 *     whose owner removed it, an app that only mentions the path in prose, an app published after.
 *   - Once per node, never before 4.0.0; the owner's feed and the operator's Security page say so.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-storage-read-keep.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const v = vi.hoisted(() => ({ version: '4.1.1' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { keepStorageReadForAppsOnce, APP_STORAGE_READ_KEEP_KEY } from '../../src/services/app-storage-read-keep-migration.js';
import { readAppScopeAllowance, writeAppScopeAllowance, APP_SCOPE_ALLOWANCE_SPEC } from '../../src/services/app-scope-allowance-store.js';
import { readAccountEvents } from '../../src/services/account-events.js';
import { readAppAudit } from '../../src/services/app-audit.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';

const NODE_ID = 'aimeat-app-storage-read-keep';
const OWNER = 'pubowner';
const GHII = `${OWNER}@${NODE_ID}`;
const DECLARED = '<meta name="aimeat-scopes" content="memory:read memory:write ext:invoke">';

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

async function grant(id: string, app: string, scopes: string[]): Promise<void> {
    await storage.createAppGrant({
        grantId: id, app: `${OWNER}/${app}`, appName: app, appOrigin: 'https://x.node.test', owner: OWNER, gaii: GHII,
        scopes, refreshTokenHash: null, createdAt: past, lastUsedAt: null, revoked: false,
    } as never);
}

const signsIn = (code: string, meta = DECLARED) =>
    `<html><head>${meta}<script src="/v1/libs/aimeat-auth.js"></script></head><body><script>${code}</script></body></html>`;
const allowance = (app: string) => readAppScopeAllowance(storage, `${OWNER}/${app}`);

beforeAll(async () => {
    v.version = '4.1.1';
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const k = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: k.publicKey, roles: ['owner'], createdAt: past } as never);

    // OM Koti's shape: the path only in the pattern that finds an image address in a document.
    await publish('omkoti.html', signsIn(String.raw`const IMG = /\/v1\/pub\/([^/]+)\/(.+)/; doc.replace(IMG, blobUrl);`));
    await writeAppScopeAllowance(storage, {
        spec: APP_SCOPE_ALLOWANCE_SPEC, appId: `${OWNER}/omkoti.html`, words: ['agent:read'], removed: [],
        evidence: [{ word: 'agent:read', source: 'app', evidence: 'AIMEAT.agents.list(' }], at: past,
    });
    await grant('g-omkoti', 'omkoti.html', ['memory:read', 'memory:write', 'ext:invoke', 'agent:read']);
    // A literal path, and an undeclared extension call this step does not give.
    await publish('literal.html', signsIn("session.fetch('/v1/pub/' + gaii + '/' + key); session.fetch('/v1/ext/x/y');", '<meta name="aimeat-scopes" content="memory:read">'));
    await publish('defaults.html', signsIn("session.fetch('/v1/pub/' + gaii + '/' + key)", ''));
    await publish('declares.html', signsIn("session.fetch(`${NODE}/v1/pub/${gaii}/${key}`)", '<meta name="aimeat-scopes" content="memory:read storage:read">'));
    await publish('removed.html', signsIn("session.fetch('/v1/pub/' + key)"));
    await writeAppScopeAllowance(storage, {
        spec: APP_SCOPE_ALLOWANCE_SPEC, appId: `${OWNER}/removed.html`, words: [], removed: ['storage:read'], evidence: [], at: past,
    });
    await publish('prose.html', signsIn('help.textContent = "Files are served under /v1/pub/ on the node";'));
}, 60_000);

describe('storage:read for apps that read /v1/pub', () => {
    it('does nothing on a 3.x node and leaves no record', async () => {
        const r = await keepStorageReadForAppsOnce(storage, config, { version: '3.27.0' });
        expect(r.ran).toBe(false);
        expect(await storage.getMemory(`system@${NODE_ID}`, APP_STORAGE_READ_KEEP_KEY)).toBeNull();
    });

    it('gives the word to the apps whose code reads /v1/pub and whose sign-in does not ask for it, and to nothing else', async () => {
        const startedAt = new Date().toISOString();
        await publish('fresh.html', signsIn("session.fetch('/v1/pub/' + key)"), new Date(Date.now() + 1000).toISOString());

        const r = await keepStorageReadForAppsOnce(storage, config, { existedBefore: startedAt });
        expect(r.ran).toBe(true);
        expect(r.apps.map(a => [a.appId, a.words]).sort()).toEqual([
            [`${OWNER}/literal.html`, ['storage:read']],
            [`${OWNER}/omkoti.html`, ['storage:read']],
        ]);

        const om = await allowance('omkoti.html');
        expect(om!.words).toEqual(['agent:read', 'storage:read']);
        expect(om!.evidence.map(e => e.word)).toEqual(['agent:read', 'storage:read']);
        expect(om!.evidence[1].evidence).toContain(String.raw`\/v1\/pub\/`);
        expect((await storage.getAppGrant('g-omkoti'))!.scopes).toEqual(['memory:read', 'memory:write', 'ext:invoke', 'agent:read', 'storage:read']);

        expect((await allowance('literal.html'))!.words).toEqual(['storage:read']);
        expect((await allowance('removed.html'))!.words).toEqual([]);
        for (const app of ['defaults.html', 'declares.html', 'prose.html', 'fresh.html']) expect(await allowance(app)).toBeNull();
    });

    it('tells the owner on the feed and in each app\'s change log, and the operator on the Security page', async () => {
        const kept = (await readAccountEvents(storage, GHII)).filter(e => e.kind === 'app_scope_words_kept');
        expect(kept).toHaveLength(1);
        expect(kept[0].subject).toBe(APP_STORAGE_READ_KEEP_KEY);
        expect(kept[0].data.words).toBe('storage:read');
        const log = await readAppAudit(storage, GHII, 'omkoti.html');
        expect(log.some(e => e.action === 'scope_allowance.kept' && String(e.detail?.reason).includes('/v1/pub'))).toBe(true);
        const { items } = await listSecurityIncidents(storage, config);
        const incident = items.find(i => i.type === 'scope_words_kept');
        expect(incident!.detail).toContain(`${OWNER}/omkoti.html`);
    });

    it('runs once', async () => {
        await publish('later.html', signsIn("session.fetch('/v1/pub/' + key)"));
        const again = await keepStorageReadForAppsOnce(storage, config);
        expect(again.ran).toBe(false);
        expect(await allowance('later.html')).toBeNull();
    });
});
