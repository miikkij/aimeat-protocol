/**
 * @file test/unit/task-start-rulings.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The follow-up rulings on task start (Jouni, 2026-10-02), against a real in-memory
 *   SQLite storage:
 *     A. the one-time switch of the basic agents nobody has set, with one notice per owner;
 *     B. app grants that held memory:delete keep deleting their records (memory:purge), and the new
 *        word puts an agent on the floor;
 *     C. the record of what a `*` agent uses, when `*` starts to hold its tasks, and the narrowing.
 * @usage pnpm test -- task-start-rulings
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentRecord, AppGrantRecord } from '../../src/storage/interface.js';
import { migrateBasicAgentsTaskStartOnce, grantPurgeToAppGrantsOnce, BASIC_AGENTS_START_TYPE } from '../../src/services/task-start-migrations.js';
import {
    noteScopeUse, flushScopeUse, readScopeUse, wildcardStatus, withWildcardFacts, OBSERVE_DAYS, SCOPE_USE_KEY,
} from '../../src/services/scope-use.js';
import { narrowAgent } from '../../src/services/scope-narrowing.js';
import { decideTaskStart, floorScopesOf } from '../../src/services/agent-task-rules.js';

const NODE = 'aimeat-test-001';
let storage: Storage;

function agent(name: string, owner: string, extra: Partial<AgentRecord> = {}): AgentRecord {
    const now = new Date().toISOString();
    return {
        gaii: `${name}#${owner}@${NODE}`, name, owner, capabilities: [], publicKey: '', trustScore: 50, morselBalance: 0,
        createdAt: now, lastSeen: now, mode: 'interactive', ...extra,
    } as AgentRecord;
}

beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

describe('A. basic agents nobody has set start on their own, once', () => {
    it('switches only an unset basic agent, keeps an owner\'s "wait", and tells each owner once', async () => {
        await storage.createAgent(agent('concierge', 'alice', { tags: ['crew.basic', 'role.concierge'] }));
        await storage.createAgent(agent('workflow-manager', 'alice', { tags: ['crew.basic'], mode: 'task-runner', taskStart: 'confirm' }));
        await storage.createAgent(agent('concierge', 'bob', { tags: ['something-else'] }));
        await storage.createAgent(agent('news', 'carol', { tags: ['crew.basic'] }));

        const first = await migrateBasicAgentsTaskStartOnce(storage, { nodeId: NODE });
        expect(first).toEqual({ ran: true, agents: 1, owners: 1 });
        expect((await storage.getAgent(`concierge#alice@${NODE}`))?.taskStart).toBe('automatic');
        expect((await storage.getAgent(`workflow-manager#alice@${NODE}`))?.taskStart).toBe('confirm');
        expect((await storage.getAgent(`concierge#bob@${NODE}`))?.taskStart).toBeUndefined();
        expect((await storage.getAgent(`news#carol@${NODE}`))?.taskStart).toBeUndefined();

        const notices = (await storage.listMemory(`alice@${NODE}`, { prefix: 'notif.' })).map(m => m.value as { type: string; body: string });
        expect(notices.filter(n => n.type === BASIC_AGENTS_START_TYPE)).toHaveLength(1);
        expect(notices[0].body).toMatch(/concierge/);
        expect(await storage.listMemory(`bob@${NODE}`, { prefix: 'notif.' })).toHaveLength(0);

        expect(await migrateBasicAgentsTaskStartOnce(storage, { nodeId: NODE })).toEqual({ ran: false, agents: 0, owners: 0 });
    });
});

describe('B. deleting shared records for good is its own word', () => {
    it('an app grant that held memory:delete gets memory:purge once; another does not', async () => {
        const now = new Date().toISOString();
        // One grant per (owner, app), so each grant names its own app.
        const grant = (id: string, scopes: string[]) => ({
            grantId: id, app: `alice/${id}.html`, appName: 'App', appOrigin: 'https://app', owner: 'alice', gaii: `alice@${NODE}`,
            scopes, createdAt: now,
        }) as unknown as AppGrantRecord;
        await storage.createAppGrant(grant('g1', ['memory:read', 'memory:delete']));
        await storage.createAppGrant(grant('g2', ['memory:read']));
        expect(await grantPurgeToAppGrantsOnce(storage, NODE)).toEqual({ ran: true, grants: 1 });
        expect((await storage.getAppGrant('g1'))?.scopes).toContain('memory:purge');
        expect((await storage.getAppGrant('g2'))?.scopes).not.toContain('memory:purge');
        expect(await grantPurgeToAppGrantsOnce(storage, NODE)).toEqual({ ran: false, grants: 0 });
    });

    it('memory:purge holds every task of the agent; memory:delete alone does not', () => {
        expect(floorScopesOf({ defaultScopes: ['memory:delete', 'memory:purge'] })).toEqual(['memory:purge']);
        expect(decideTaskStart({ mode: 'task-runner', defaultScopes: ['memory:delete'] }).startsNow).toBe(true);
    });
});

describe('C. what a `*` agent uses, and when `*` holds its tasks', () => {
    it('records the words of a `*` agent only, and offers them as the narrowing', async () => {
        await storage.createAgent(agent('star', 'alice', { defaultScopes: ['*'] }));
        await storage.createAgent(agent('named', 'alice', { defaultScopes: ['memory:read'] }));
        noteScopeUse(`star#alice@${NODE}`, ['memory:read', 'task:write', 'memory:write-reserved']);
        noteScopeUse(`named#alice@${NODE}`, ['memory:read']);
        await flushScopeUse(storage);

        const record = await readScopeUse(storage, `alice@${NODE}`);
        expect(Object.keys(record.agents)).toEqual(['star']);
        const status = wildcardStatus({ defaultScopes: ['*'] }, record.agents.star);
        expect(status).toMatchObject({ holds: true, ready: false, daysLeft: OBSERVE_DAYS });
        // A word outside every wildcard was never given by `*`, so the narrowing does not hand it out.
        expect(status.proposal).toEqual(['memory:read', 'task:write']);
    });

    it('`*` holds the tasks once the record is old enough and names something', async () => {
        const old = new Date(Date.now() - (OBSERVE_DAYS + 1) * 86_400_000).toISOString();
        const use = { since: old, words: { 'memory:read': old } };
        expect(wildcardStatus({ defaultScopes: ['*'] }, use).ready).toBe(true);
        expect(wildcardStatus({ defaultScopes: ['*'] }, { since: old, words: {} }).ready).toBe(false);
        expect(floorScopesOf({ defaultScopes: ['*'], wildcardReady: true })).toEqual(['*']);
        expect(decideTaskStart({ mode: 'task-runner', defaultScopes: ['*'], wildcardReady: true }))
            .toMatchObject({ startsNow: false, waitsBecause: 'floor' });
        expect(decideTaskStart({ mode: 'task-runner', defaultScopes: ['*'] }).startsNow).toBe(true);

        await storage.createAgent(agent('star', 'alice', { defaultScopes: ['*'], mode: 'task-runner' }));
        await storage.setMemory({ key: SCOPE_USE_KEY, ownerGaii: `alice@${NODE}`, value: { agents: { star: use } },
            visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: old, updatedAt: old });
        const facts = await withWildcardFacts(storage, await storage.getAgent(`star#alice@${NODE}`));
        expect(facts?.wildcardReady).toBe(true);
    });

    it('the narrowing replaces `*` with what was used, and refuses with nothing on record', async () => {
        await storage.createAgent(agent('star', 'alice', { defaultScopes: ['*'] }));
        const empty = await narrowAgent(storage, `alice@${NODE}`, await storage.getAgent(`star#alice@${NODE}`));
        expect(empty).toMatchObject({ ok: false, code: 'NOTHING_RECORDED' });

        noteScopeUse(`star#alice@${NODE}`, ['memory:read', 'memory:write']);
        const out = await narrowAgent(storage, `alice@${NODE}`, await storage.getAgent(`star#alice@${NODE}`));
        expect(out.ok).toBe(true);
        expect((await storage.getAgent(`star#alice@${NODE}`))?.defaultScopes).toEqual(['memory:read', 'memory:write']);
        expect((await readScopeUse(storage, `alice@${NODE}`)).agents.star).toBeUndefined();
    });
});
