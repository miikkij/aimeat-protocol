/**
 * @file test/unit/task-start-rulings.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The follow-up rulings on task start (Jouni, 2026-10-02), against a real in-memory
 *   SQLite storage:
 *     A. the one-time switch of the basic agents nobody has set, with one notice per owner;
 *     B. app grants that held memory:delete keep deleting their records (memory:purge), and the new
 *        word puts an agent on the floor;
 *     C. the record of what a `*` agent uses, when it is ready, and the narrowing the owner applies
 *        (since 2026-10-28 the node never narrows by itself, and `*` holds no task).
 * @usage pnpm test -- task-start-rulings
 * @version-history
 *   v1.2.0 — 2026-10-28 — C: a ready record only offers the narrowing; `*` is never on the floor; an
 *     admitted provenance declaration is noted as provenance:write.
 *   v1.1.0 — 2026-10-18 — C: a ready record narrows the agent at the start decision (startFactsOf),
 *     where it put `*` on the floor before.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, AgentRecord, AppGrantRecord } from '../../src/storage/interface.js';
import { migrateBasicAgentsTaskStartOnce, grantPurgeToAppGrantsOnce, BASIC_AGENTS_START_TYPE } from '../../src/services/task-start-migrations.js';
import {
    noteScopeUse, flushScopeUse, readScopeUse, wildcardStatus, OBSERVE_DAYS,
} from '../../src/services/scope-use.js';
import { narrowAgent } from '../../src/services/scope-narrowing.js';
import { provenanceForWrite } from '../../src/services/ai-provenance.js';
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

    it('a ready record only offers the narrowing: `*` holds no task and stays on the agent', async () => {
        const old = new Date(Date.now() - (OBSERVE_DAYS + 1) * 86_400_000).toISOString();
        const use = { since: old, words: { 'memory:read': old } };
        expect(wildcardStatus({ defaultScopes: ['*'] }, use)).toMatchObject({ ready: true, proposal: ['memory:read'] });
        expect(wildcardStatus({ defaultScopes: ['*'] }, { since: old, words: {} }).ready).toBe(false);
        // The owner gave `*`, so it is never on the floor (Jouni, 2026-10-28).
        expect(floorScopesOf({ defaultScopes: ['*'] })).toEqual([]);
        expect(decideTaskStart({ mode: 'task-runner', defaultScopes: ['*'] }).startsNow).toBe(true);
    });

    it('an agent admitted to declare provenance is noted as using provenance:write, so a narrowing keeps it', async () => {
        await storage.createAgent(agent('star', 'alice', { defaultScopes: ['*'] }));
        const gaii = `star#alice@${NODE}`;
        await provenanceForWrite(storage, { principal: gaii, nodeId: NODE, content: 'a note', declared: { level: 'ai-generated', model: 'test-model' } });
        await flushScopeUse(storage);
        const record = await readScopeUse(storage, `alice@${NODE}`);
        expect(Object.keys(record.agents.star?.words ?? {})).toContain('provenance:write');
        expect(wildcardStatus({ defaultScopes: ['*'] }, record.agents.star).proposal).toContain('provenance:write');
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
