/**
 * @file test/unit/app-scope-allowance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The published apps half of the 4.0.x keep-working step (services/app-scope-allowance.ts,
 *   services/rest-scope-keep-working-migration.ts), and the take-back from anonymous mode's shared agent.
 *
 *   - An app published before the step whose code calls /v1/ext/... and declares nothing gets an
 *     allowance of ext:invoke; its live grants get the word; its change log and its owner's feed say so.
 *   - An app that declares the word, an app that never signs in, and an app published after the step
 *     get nothing.
 *   - The allowance counts as declared: a refresh's narrowing keeps it (narrowToDeclared).
 *   - The owner removes a word: it leaves the allowance and every live grant, stays removed, and a
 *     second run of the step changes nothing. A builder with a development right may not remove.
 *   - The two earlier steps skip the shared anonymous agent, and the 4.0.x step takes back the words
 *     they wrote on it, only where their run records name it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-scope-allowance.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const v = vi.hoisted(() => ({ version: '4.0.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { migrateRestScopeKeepWorkingOnce, APP_SCOPE_KEEP_WORKING_KEY, REST_SCOPE_KEEP_WORKING_KEY } from '../../src/services/rest-scope-keep-working-migration.js';
import { migrateRestScopeGatesOnce, migrateAgentReadGrantOnce } from '../../src/services/rest-scope-gates-migration.js';
import { readAppScopeAllowance, readScopeAllowanceFor, removeScopeAllowanceFor } from '../../src/services/app-scope-allowance.js';
import { narrowToDeclared } from '../../src/services/app-grant-scopes.js';
import { readAccountEvents } from '../../src/services/account-events.js';
import { readAppAudit } from '../../src/services/app-audit.js';

const NODE_ID = 'aimeat-app-scope-allowance';
const OWNER = 'allowowner';
const GHII = `${OWNER}@${NODE_ID}`;
const ANON = `shared#anonymous@${NODE_ID}`;
const DEFAULTS = ['memory:read', 'memory:write', 'storage:read', 'storage:write'];

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

/** A live grant of the app held by `holder` (one live grant per holder and app). */
async function grant(id: string, app: string, scopes: string[], ownerAdded: string[] = [], holder = OWNER): Promise<void> {
    await storage.createAppGrant({
        grantId: id, app: `${OWNER}/${app}`, appName: app, appOrigin: 'https://x.node.test', owner: holder, gaii: `${holder}@${NODE_ID}`,
        scopes, refreshTokenHash: null, createdAt: past, lastUsedAt: null, revoked: false,
        ...(ownerAdded.length ? { ownerAddedScopes: ownerAdded } : {}),
    } as never);
}
const grantScopes = async (id: string) => (await storage.getAppGrant(id))!.scopes;

const signsIn = (code: string, meta = '') =>
    `<html><head>${meta}<script src="/v1/libs/aimeat-auth.js"></script></head><body><script>${code}</script></body></html>`;
const caller = { sub: GHII, owner: OWNER, roles: ['owner'], scopes: [] as string[] };

beforeAll(async () => {
    v.version = '4.0.0';
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    for (const name of [OWNER, 'anonymous']) {
        const k = await generateKeyPair();
        await storage.createOwner({ name, displayName: name, publicKey: k.publicKey, roles: ['owner'], createdAt: past } as never);
    }
    const anonKeys = await generateKeyPair();
    await storage.createAgent({
        name: 'shared', owner: 'anonymous', gaii: ANON, publicKey: anonKeys.publicKey, trustScore: 50, morselBalance: 0,
        capabilities: [], defaultScopes: ['memory:read', 'catalogue:read'], createdAt: past, lastSeen: past,
    } as never);

    await publish('guestbook.html', signsIn("session.fetch('/v1/ext/guestbook/sign', { method: 'POST' })"));
    await publish('declares.html', signsIn("session.fetch('/v1/ext/x/y')", '<meta name="aimeat-scopes" content="memory:read ext:invoke">'));
    await publish('nosignin.html', '<html><body><script>fetch("/v1/ext/x/y")</script></body></html>');
    await grant('g-guest', 'guestbook.html', [...DEFAULTS]);
    // A visitor's grant; its holder added a word of their own by hand.
    await grant('g-guest-own', 'guestbook.html', [...DEFAULTS, 'connections:read-through'], ['connections:read-through'], 'visitor');
}, 60_000);

describe('the earlier steps and the shared anonymous agent', () => {
    it('steps 1 and 2 no longer give the shared anonymous agent their word', async () => {
        await migrateRestScopeGatesOnce(storage, NODE_ID);
        await migrateAgentReadGrantOnce(storage, NODE_ID);
        expect((await storage.getAgent(ANON))!.defaultScopes).toEqual(['memory:read', 'catalogue:read']);
    });
});

describe('the published apps half, on the first start as 4.0.x', () => {
    it('gives an app that calls /v1/ext and declares nothing ext:invoke, and puts it on its live grants', async () => {
        // A node that ran steps 1 and 2 before they skipped the shared agent: their records name it.
        await storage.updateAgent(ANON, { defaultScopes: ['memory:read', 'catalogue:read', 'packages:read', 'agent:read'] });
        for (const key of ['migrations.rest-scope-gates-4-0-0', 'migrations.rest-scope-gates-4-0-0.agent-read']) {
            const rec = await storage.getMemory(`system@${NODE_ID}`, key);
            await storage.setMemory({ ...rec!, value: { ...(rec!.value as object), agents: [ANON] } });
        }
        const startedAt = new Date().toISOString();
        await publish('fresh.html', signsIn("session.fetch('/v1/ext/x/y')"), new Date(Date.now() + 1000).toISOString());

        const r = await migrateRestScopeKeepWorkingOnce(storage, config, { version: '4.0.0', existedBefore: startedAt });
        expect(r.ran).toBe(true);
        expect(r.apps.map(a => [a.appId, a.words])).toEqual([[`${OWNER}/guestbook.html`, ['ext:invoke']]]);

        const a = await readAppScopeAllowance(storage, `${OWNER}/guestbook.html`);
        expect(a!.words).toEqual(['ext:invoke']);
        expect(a!.evidence[0].evidence).toContain('/v1/ext/guestbook/sign');
        expect(await grantScopes('g-guest')).toEqual([...DEFAULTS, 'ext:invoke']);

        for (const app of ['declares.html', 'nosignin.html', 'fresh.html']) {
            expect(await readAppScopeAllowance(storage, `${OWNER}/${app}`)).toBeNull();
        }
    });

    it('takes back from the shared anonymous agent only the words the earlier steps\' records name, and records it', async () => {
        expect((await storage.getAgent(ANON))!.defaultScopes).toEqual(['memory:read', 'catalogue:read']);
        const rec = await storage.getMemory(`system@${NODE_ID}`, REST_SCOPE_KEEP_WORKING_KEY);
        expect((rec!.value as { sharedAnonymousTakenBack: unknown }).sharedAnonymousTakenBack).toEqual({ id: ANON, removed: ['packages:read', 'agent:read'] });
    });

    it('tells the owner on the feed and in the app\'s change log', async () => {
        const kept = (await readAccountEvents(storage, GHII)).filter(e => e.kind === 'app_scope_words_kept');
        expect(kept).toHaveLength(1);
        expect(kept[0].data.names).toBe('guestbook');
        expect(kept[0].data.words).toBe('ext:invoke');
        expect(kept[0].link).toBe('/v1/appcat');
        const log = await readAppAudit(storage, GHII, 'guestbook.html');
        expect(log.some(e => e.action === 'scope_allowance.kept' && String(e.detail?.words) === 'ext:invoke')).toBe(true);
    });

    it('counts as declared, so the refresh narrowing keeps it', () => {
        expect(narrowToDeclared([...DEFAULTS, 'ext:invoke'], DEFAULTS, [], ['ext:invoke'])).toEqual([...DEFAULTS, 'ext:invoke']);
        expect(narrowToDeclared([...DEFAULTS, 'ext:invoke'], DEFAULTS, [])).toEqual(DEFAULTS);
    });

    it('the owner reads it and removes the word: it leaves the allowance and the grants, and stays removed', async () => {
        const read = await readScopeAllowanceFor(storage, config, caller, { owner: 'me', filename: 'guestbook.html' });
        expect(read.ok && read.data.words).toEqual(['ext:invoke']);

        const out = await removeScopeAllowanceFor(storage, config, caller, { owner: 'me', filename: 'guestbook.html' }, ['ext:invoke']);
        expect(out.ok).toBe(true);
        const a = await readAppScopeAllowance(storage, `${OWNER}/guestbook.html`);
        expect(a!.words).toEqual([]);
        expect(a!.removed).toEqual(['ext:invoke']);
        expect(await grantScopes('g-guest')).toEqual(DEFAULTS);

        const again = await removeScopeAllowanceFor(storage, config, caller, { owner: 'me', filename: 'guestbook.html' }, 'ext:invoke');
        expect(again.ok).toBe(false);
        expect(!again.ok && again.code).toBe('NOT_FOUND');

        const rerun = await migrateRestScopeKeepWorkingOnce(storage, config, { version: '4.0.1' });
        expect(rerun.ran).toBe(false);
        expect((await readAppScopeAllowance(storage, `${OWNER}/guestbook.html`))!.words).toEqual([]);
        expect(await storage.getMemory(`system@${NODE_ID}`, APP_SCOPE_KEEP_WORKING_KEY)).not.toBeNull();
    });

    it('the visitor\'s grant got the word and lost it again, keeping the word its holder added by hand', async () => {
        expect(await grantScopes('g-guest-own')).toEqual([...DEFAULTS, 'connections:read-through']);
    });

    it('somebody else may not read or remove it', async () => {
        const stranger = { sub: `mallory@${NODE_ID}`, owner: 'mallory', roles: ['owner'], scopes: [] as string[] };
        const out = await removeScopeAllowanceFor(storage, config, stranger, { owner: OWNER, filename: 'guestbook.html' }, ['ext:invoke']);
        expect(out.ok).toBe(false);
        expect(!out.ok && [403, 404]).toContain(!out.ok && out.status);
    });
});
