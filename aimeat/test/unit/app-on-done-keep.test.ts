/**
 * @file test/unit/app-on-done-keep.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ext:invoke step for published apps whose AI jobs bind `on_done`
 *   (services/app-on-done-keep-migration.ts), and the publish check that reads the same call
 *   (services/app-scope-needs.ts, rule 'ai-job-on-done').
 *
 *   secaudit 2026-10 made an AI job's on_done ask ext:invoke of a caller that is not the owner in
 *   person. An app grant holds what its app asks for and its owner cannot add a word, so an app that
 *   bound on_done before the change would have stopped working. The developer's rule for the round:
 *   every use that worked before keeps working.
 *
 *   - An app published before the step whose code starts a job with on_done (through the SDK or a
 *     POST to /v1/ai/jobs) and does not ask for ext:invoke gets the word, on its allowance and its
 *     live grants; an allowance it already has keeps its words.
 *   - Nothing for: an app that needs ext:invoke only for an undeclared extension call (that call
 *     never worked without the word), an app that declares it, an app whose owner removed it, a job
 *     start without on_done, on_done written in prose without a job start, an app published after.
 *   - Once per node; the owner's feed and the operator's Security page say so.
 *   - The publish check names ext:invoke for such code.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-on-done-keep.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, capability-loss review).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { keepOnDoneForAppsOnce, APP_ON_DONE_KEEP_KEY } from '../../src/services/app-on-done-keep-migration.js';
import { readAppScopeAllowance, writeAppScopeAllowance, APP_SCOPE_ALLOWANCE_SPEC } from '../../src/services/app-scope-allowance-store.js';
import { undeclaredScopeNeeds } from '../../src/services/app-scope-needs.js';
import { readAccountEvents } from '../../src/services/account-events.js';
import { readAppAudit } from '../../src/services/app-audit.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';

const NODE_ID = 'aimeat-app-on-done-keep';
const OWNER = 'jobowner';
const GHII = `${OWNER}@${NODE_ID}`;
const DECLARED = '<meta name="aimeat-scopes" content="ai:use memory:read memory:write">';

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

const SDK_ON_DONE = "await AIMEAT.ai.job.start({ prompt: 'Summarise.', result_key: 'report.latest', on_done: { extension: 'mailer', action: 'send' } });";
const REST_ON_DONE = "session.fetch('/v1/ai/jobs', { method: 'POST', body: JSON.stringify({ prompt: p, result_key: k, \"on_done\": { extension: 'x', action: 'y' } }) });";

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const k = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: k.publicKey, roles: ['owner'], createdAt: past } as never);

    await publish('sdkjob.html', signsIn(SDK_ON_DONE));
    await grant('g-sdkjob', 'sdkjob.html', ['ai:use', 'memory:read', 'memory:write']);
    await publish('restjob.html', signsIn(REST_ON_DONE));
    await writeAppScopeAllowance(storage, {
        spec: APP_SCOPE_ALLOWANCE_SPEC, appId: `${OWNER}/restjob.html`, words: ['agent:read'], removed: [],
        evidence: [{ word: 'agent:read', source: 'app', evidence: 'AIMEAT.agents.list(' }], at: past,
    });
    // Needs ext:invoke for an extension call AND for on_done: the word is given, with on_done's evidence.
    await publish('both.html', signsIn(`session.fetch('/v1/ext/x/y'); ${SDK_ON_DONE}`));
    // Needs ext:invoke only for an extension call it never declared: not this step's business.
    await publish('extcall.html', signsIn("session.fetch('/v1/ext/x/y');"));
    await publish('declares.html', signsIn(SDK_ON_DONE, '<meta name="aimeat-scopes" content="ai:use ext:invoke">'));
    await publish('removed.html', signsIn(SDK_ON_DONE));
    await writeAppScopeAllowance(storage, {
        spec: APP_SCOPE_ALLOWANCE_SPEC, appId: `${OWNER}/removed.html`, words: [], removed: ['ext:invoke'], evidence: [], at: past,
    });
    await publish('nocallback.html', signsIn("await AIMEAT.ai.job.start({ prompt: 'x', result_key: 'k' });"));
    await publish('prose.html', signsIn('help.textContent = "A job can name on_done: an extension action";'));
}, 60_000);

describe('the publish check reads an AI job\'s on_done', () => {
    it('names ext:invoke for code that binds on_done, and not for a job start without it', () => {
        expect(undeclaredScopeNeeds(signsIn(SDK_ON_DONE)).missing).toContain('ext:invoke');
        expect(undeclaredScopeNeeds(signsIn(REST_ON_DONE)).missing).toContain('ext:invoke');
        expect(undeclaredScopeNeeds(signsIn("await AIMEAT.ai.job.start({ prompt: 'x', result_key: 'k' });")).missing).not.toContain('ext:invoke');
        expect(undeclaredScopeNeeds(signsIn(SDK_ON_DONE, '<meta name="aimeat-scopes" content="ai:use ext:invoke">')).missing).not.toContain('ext:invoke');
    });
});

describe('ext:invoke for published apps that bind on_done', () => {
    it('gives the word to the apps whose AI jobs bind on_done, and to nothing else', async () => {
        const startedAt = new Date().toISOString();
        await publish('fresh.html', signsIn(SDK_ON_DONE), new Date(Date.now() + 1000).toISOString());

        const r = await keepOnDoneForAppsOnce(storage, config, { existedBefore: startedAt });
        expect(r.ran).toBe(true);
        expect(r.apps.map(a => [a.appId, a.words]).sort()).toEqual([
            [`${OWNER}/both.html`, ['ext:invoke']],
            [`${OWNER}/restjob.html`, ['ext:invoke']],
            [`${OWNER}/sdkjob.html`, ['ext:invoke']],
        ]);
        expect((await allowance('sdkjob.html'))!.words).toEqual(['ext:invoke']);
        expect((await storage.getAppGrant('g-sdkjob'))!.scopes).toEqual(['ai:use', 'memory:read', 'memory:write', 'ext:invoke']);
        const rest = await allowance('restjob.html');
        expect(rest!.words).toEqual(['agent:read', 'ext:invoke']);
        expect(rest!.evidence.map(e => e.word)).toEqual(['agent:read', 'ext:invoke']);
        expect((await allowance('both.html'))!.evidence.map(e => e.evidence).join(' ')).toContain('on_done');
        expect((await allowance('removed.html'))!.words).toEqual([]);
        for (const app of ['extcall.html', 'declares.html', 'nocallback.html', 'prose.html', 'fresh.html']) expect(await allowance(app)).toBeNull();
    });

    it('tells the owner on the feed and in each app\'s change log, and the operator on the Security page', async () => {
        const kept = (await readAccountEvents(storage, GHII)).filter(e => e.kind === 'app_scope_words_kept');
        expect(kept).toHaveLength(1);
        expect(kept[0].subject).toBe(APP_ON_DONE_KEEP_KEY);
        const log = await readAppAudit(storage, GHII, 'sdkjob.html');
        expect(log.some(e => e.action === 'scope_allowance.kept' && String(e.detail?.reason).includes('on_done'))).toBe(true);
        const { items } = await listSecurityIncidents(storage, config);
        expect(items.find(i => i.type === 'scope_words_kept')!.detail).toContain(`${OWNER}/sdkjob.html`);
    });

    it('runs once', async () => {
        await publish('later.html', signsIn(SDK_ON_DONE));
        const again = await keepOnDoneForAppsOnce(storage, config);
        expect(again.ran).toBe(false);
        expect(await allowance('later.html')).toBeNull();
    });
});
