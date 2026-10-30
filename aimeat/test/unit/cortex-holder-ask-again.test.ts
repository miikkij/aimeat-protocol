/**
 * @file test/unit/cortex-holder-ask-again.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app held from a cortex's new holder is never a dead end (services/cortex-holder-change.ts;
 *   secaudit2026oct26 round 8c, rule 1): when its owner's question expired, the app's next library
 *   request files the question again; while a question waits, or a Don't allow stands, nothing more is
 *   filed; a refile happens at most once a day. Run on SQLite storage, with the node's record and the
 *   request store as the library route reads them.
 * @structure the question expired → the next load files it again · a waiting or declined question → no
 *   second one · asked less than a day ago → not asked again
 * @usage pnpm exec vitest run test/unit/cortex-holder-ask-again.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (secaudit2026oct26 round 8c).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, CortexExtensionRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { heldForRequest, askAgainIfDue, HOLDER_CHANGE_KEY, type CortexHolderChange } from '../../src/services/cortex-holder-change.js';
import { readPublishRequest, settlePublishRequest } from '../../src/services/publish-requests/store.js';

const SQLITE_PATH = `./test/.cortex-holder-ask-${process.pid}.db`;
const NODE = 'holder-test-node';
const config = { nodeId: NODE, baseUrl: 'http://node.test', appHost: '' } as unknown as AimeatConfig;
let storage: Storage;

beforeAll(async () => { storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }); }, 60_000);
afterAll(async () => {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
    }
});

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const DAY = 24 * 60 * 60 * 1000;

/** A cortex `name` held by `holder`, and the node's record that `owner`'s app loaded it before. */
async function heldSetup(): Promise<{ name: string; owner: string; app: string }> {
    const s = stamp();
    const name = `cxh${s}`, holder = `erin${s}`, owner = `carol${s}`, app = `${owner}/uses.html`;
    const now = new Date().toISOString();
    await storage.createCortexExtension({
        name, namespace: holder, shortName: name, apiVersion: 'v1', version: '1.0.0', description: 'held', author: holder,
        tags: [], labels: {}, status: 'active', visibility: 'public', installedAt: now, installedBy: holder, manifest: '',
        components: [], activationArtifacts: { schemaKeys: [], promptKeys: [], actionIds: [], boardIds: [], seedDataKeys: [], ontologyKeys: [], libFiles: [] },
    } as CortexExtensionRecord);
    const change: CortexHolderChange = {
        name, holder, freedAt: now, since: now, asker: `${holder}@${NODE}`,
        owners: { [owner]: { apps: [app], request_id: null, allowed: false } },
    };
    await storage.setMemory({
        key: HOLDER_CHANGE_KEY(name), ownerGaii: `system@${NODE}`, value: change as unknown as Record<string, unknown>, visibility: 'private',
        tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    return { name, owner, app };
}

const readChange = async (name: string) =>
    (await storage.getMemory(`system@${NODE}`, HOLDER_CHANGE_KEY(name)))!.value as unknown as CortexHolderChange;

/** Rewrite the stored record so it reads as asked `daysAgo` days ago. */
async function askedDaysAgo(name: string, owner: string, daysAgo: number): Promise<void> {
    const row = (await storage.getMemory(`system@${NODE}`, HOLDER_CHANGE_KEY(name)))!;
    const change = row.value as unknown as CortexHolderChange;
    change.owners[owner].asked_at = new Date(Date.now() - daysAgo * DAY).toISOString();
    await storage.setMemory({ ...row, value: change as unknown as Record<string, unknown>, version: row.version + 1 });
}

/** The app's library request, as the route asks it, then until its background question settles. */
async function loadFromApp(name: string, app: string): Promise<boolean> {
    const held = await heldForRequest({ storage, config }, name, { referer: `http://node.test/v1/apps/${app}?mode=inline` });
    await new Promise(r => setTimeout(r, 300));
    return held;
}

describe('an app held from a cortex\'s new holder', () => {
    it('files its owner\'s question again on the next load after the question expired', async () => {
        const { name, owner, app } = await heldSetup();
        await askAgainIfDue({ storage, config }, name, owner);
        const first = (await readChange(name)).owners[owner].request_id;
        expect(first, 'the first question is filed').toBeTruthy();

        // The question expired unanswered, a week after it was asked.
        const ownerGhii = `${owner}@${NODE}`;
        const key = `publish.requests.${first}`;
        const row = (await storage.getMemory(ownerGhii, key))!;
        await storage.setMemory({ ...row, value: { ...(row.value as Record<string, unknown>), expires_at: new Date(Date.now() - DAY).toISOString() }, version: row.version + 1 });
        await askedDaysAgo(name, owner, 8);

        expect(await loadFromApp(name, app), 'the app is still held').toBe(true);
        const again = (await readChange(name)).owners[owner];
        expect(again.request_id, 'a new question was filed').toBeTruthy();
        expect(again.request_id).not.toBe(first);
        expect((await readPublishRequest(storage, ownerGhii, again.request_id!))?.state).toBe('awaiting_owner');
        expect(again.earlier ?? [], 'the expired one is remembered, so approving it still counts').toContain(first);
    });

    it('files nothing more while the question waits, after a Don\'t allow, or within a day', async () => {
        const { name, owner, app } = await heldSetup();
        await askAgainIfDue({ storage, config }, name, owner);
        const first = (await readChange(name)).owners[owner].request_id!;

        // Waiting: the loads add nothing, also a week later.
        await askedDaysAgo(name, owner, 8);
        await loadFromApp(name, app);
        expect((await readChange(name)).owners[owner].request_id).toBe(first);

        // Declined: the app stays held and no second question is filed.
        const ownerGhii = `${owner}@${NODE}`;
        const request = (await readPublishRequest(storage, ownerGhii, first))!;
        await settlePublishRequest({ storage, config }, ownerGhii, request, 'declined', { by: ownerGhii });
        expect(await loadFromApp(name, app)).toBe(true);
        expect((await readChange(name)).owners[owner].request_id).toBe(first);

        // Asked an hour ago and expired at once: not asked again within the day.
        const fresh = await heldSetup();
        await askAgainIfDue({ storage, config }, fresh.name, fresh.owner);
        const id = (await readChange(fresh.name)).owners[fresh.owner].request_id!;
        const freshGhii = `${fresh.owner}@${NODE}`;
        const row = (await storage.getMemory(freshGhii, `publish.requests.${id}`))!;
        await storage.setMemory({ ...row, value: { ...(row.value as Record<string, unknown>), expires_at: new Date(Date.now() - 1000).toISOString() }, version: row.version + 1 });
        await loadFromApp(fresh.name, fresh.app);
        expect((await readChange(fresh.name)).owners[fresh.owner].request_id).toBe(id);
    });
});
