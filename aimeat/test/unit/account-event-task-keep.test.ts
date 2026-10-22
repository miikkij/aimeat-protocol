/**
 * @file test/unit/account-event-task-keep.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-only step services/account-event-task-keep.ts (secaudit 2026-10, v89; the
 *   developer's ruling of 2026-10-22), on a real store:
 *   - the step lists a live app grant made before it that holds memory:read and not task:read, and
 *     leaves alone a revoked grant, one that holds task:read or `*`, one without memory:read, one made
 *     after the step began, and anonymous mode's shared account;
 *   - it runs once;
 *   - a kept grant reads a task's title and reason while its token covers what it held, and not after
 *     a word was removed; an unlisted grant, another owner's token with the same grant id, an agent
 *     and an ecosystem app are never kept.
 * @usage cd aimeat && pnpm exec vitest run test/unit/account-event-task-keep.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v89).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import { projectAccountEvent } from '../../src/services/account-event-view.js';
import {
    keepTaskContentForAppGrantsOnce, taskContentKept, accountEventReader, TASK_CONTENT_KEEP_KEY,
} from '../../src/services/account-event-task-keep.js';

const NODE_ID = 'keep-node';
const OWNER = 'tara';
const earlier = () => new Date(Date.now() - 60_000).toISOString();

let storage: Storage;
let began = '';

async function grant(grantId: string, scopes: string[], opts: { owner?: string; revoked?: boolean; createdAt?: string } = {}): Promise<void> {
    const owner = opts.owner ?? OWNER;
    await storage.createAppGrant({
        grantId, app: `${owner}/${grantId}.html`, appName: grantId, appOrigin: 'https://app.test', owner, gaii: `${owner}@${NODE_ID}`,
        scopes, refreshTokenHash: `hash-${grantId}`, createdAt: opts.createdAt ?? earlier(), lastUsedAt: null, revoked: opts.revoked ?? false,
    });
}
const appAuth = (grantId: string, scopes: string[], owner = OWNER) => ({ sub: `${owner}@${NODE_ID}`, owner, roles: ['app'], scopes, app_grant: grantId });

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    await grant('reader', ['memory:read', 'memory:write']);
    await grant('domain', ['memory:*']);
    await grant('gone', ['memory:read'], { revoked: true });
    await grant('tasks', ['memory:read', 'task:read']);
    await grant('wild', ['*']);
    await grant('writer', ['memory:write']);
    await grant('shared', ['memory:read'], { owner: 'anonymous' });
    began = new Date().toISOString();
    // Made after the step began: never listed.
    await grant('late', ['memory:read'], { createdAt: new Date(Date.now() + 60_000).toISOString() });
}, 60_000);

describe('the task content keep step', () => {
    it('lists exactly the earlier live grants that read on memory:read without task:read', async () => {
        const result = await keepTaskContentForAppGrantsOnce(storage, { nodeId: NODE_ID }, { existedBefore: began });
        expect(result.ran).toBe(true);
        expect(result.kept.map(g => g.grantId).sort()).toEqual(['domain', 'reader']);
        const rec = await storage.getMemory(`system@${NODE_ID}`, TASK_CONTENT_KEEP_KEY);
        const listed = (rec?.value as { grants: Array<{ grantId: string; owner: string; scopes: string[] }> }).grants;
        expect(listed.find(g => g.grantId === 'reader')).toMatchObject({ owner: OWNER, scopes: ['memory:read', 'memory:write'] });
    });

    it('runs once', async () => {
        await grant('afterwards', ['memory:read']);
        const again = await keepTaskContentForAppGrantsOnce(storage, { nodeId: NODE_ID }, { existedBefore: new Date(Date.now() + 120_000).toISOString() });
        expect(again.ran).toBe(false);
        expect(await taskContentKept(storage, NODE_ID, appAuth('afterwards', ['memory:read']))).toBe(false);
    });

    it('keeps a listed grant while its token covers what it held, and not after a word was removed', async () => {
        expect(await taskContentKept(storage, NODE_ID, appAuth('reader', ['memory:read', 'memory:write']))).toBe(true);
        expect(await taskContentKept(storage, NODE_ID, appAuth('reader', ['memory:read', 'memory:write', 'storage:read']))).toBe(true);
        expect(await taskContentKept(storage, NODE_ID, appAuth('reader', ['memory:read']))).toBe(false);
        expect(await taskContentKept(storage, NODE_ID, appAuth('domain', ['memory:*']))).toBe(true);
    });

    it('never keeps an unlisted grant, another owner\'s token, an agent or an ecosystem app', async () => {
        expect(await taskContentKept(storage, NODE_ID, appAuth('late', ['memory:read']))).toBe(false);
        expect(await taskContentKept(storage, NODE_ID, appAuth('writer', ['memory:write']))).toBe(false);
        expect(await taskContentKept(storage, NODE_ID, appAuth('reader', ['memory:read', 'memory:write'], 'mallory'))).toBe(false);
        const scopes = ['memory:read', 'memory:write'];
        expect(await taskContentKept(storage, NODE_ID, { owner: OWNER, roles: ['agent'], scopes, app_grant: 'reader' })).toBe(false);
        expect(await taskContentKept(storage, NODE_ID, { owner: OWNER, roles: ['ecosystem'], scopes, app_grant: 'reader' })).toBe(false);
        expect(await taskContentKept(storage, NODE_ID, { owner: OWNER, roles: ['app'], scopes })).toBe(false);
    });

    it('a kept grant reads a task row whole through the reader; a later grant has it withheld', async () => {
        const row = { kind: 'agent_task_declined', at: earlier(), actorGaii: `worker#${OWNER}@${NODE_ID}`, link: '/x', data: { agent: 'worker', title: 'T', reason: 'R' } };
        const keptAuth = appAuth('reader', ['memory:read', 'memory:write']);
        const kept = await accountEventReader(callerFromAuth(keptAuth, NODE_ID, storage), keptAuth, storage, NODE_ID);
        expect(projectAccountEvent(row, kept)).toBe(row);
        const lateAuth = appAuth('late', ['memory:read']);
        const late = await accountEventReader(callerFromAuth(lateAuth, NODE_ID, storage), lateAuth, storage, NODE_ID);
        expect(projectAccountEvent(row, late).withheld).toEqual(['title', 'reason']);
        const narrowedAuth = appAuth('reader', ['memory:read']);
        const narrowed = await accountEventReader(callerFromAuth(narrowedAuth, NODE_ID, storage), narrowedAuth, storage, NODE_ID);
        expect(projectAccountEvent(row, narrowed).withheld).toEqual(['title', 'reason']);
    });
});
