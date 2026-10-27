/**
 * @file test/unit/goals-model-reach.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A goal's model work hands the node's model only records that whoever named them in the
 *   goal may read, and a private record an agent may not read waits for the owner's one press
 *   (secaudit2026oct26, goals:model-work-runs-as-owner-without-requesting-agent-authority).
 *
 *   With the real SQLite store and a recording AI job service:
 *   - the attack: an agent without memory:read-as-owner that attached the owner's private record gets
 *     no job started; the work waits with a reason and a pending request the agent cannot answer;
 *   - allow (the owner, or an agent holding the word): the work runs with the record, as before the rule;
 *   - don't allow: the work runs without the record, and stops when no record it was given remains;
 *   - the uses kept, unchanged: material the owner attached, an agent holding memory:read-as-owner, an
 *     agent's own private record and a record at visibility owner.
 * @usage cd aimeat && pnpm exec vitest run test/unit/goals-model-reach.test.ts
 * @version-history
 *   v1.1.0 -- 2026-10-27 -- The attack waits for the owner's one press instead of stopping the work;
 *     allow, don't allow and nothing-left cases (the coordinator's review of round 8).
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

import { createStorage } from '../../src/storage/storage-factory.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { buildGoal } from '../../src/services/goals/goals-create.js';
import { createGoalRecord, readGoal, type GoalAccess } from '../../src/services/goals/goals-store.js';
import { runModelWork } from '../../src/services/goals/goals-model.js';
import { settleModelReadAsks } from '../../src/services/goals/goals-model-reach.js';
import { setActiveAiJobService, type AiJobService } from '../../src/services/ai-jobs/service.js';
import { decidePublishRequest } from '../../src/services/publish-requests/decide.js';
import { readPublishRequest } from '../../src/services/publish-requests/store.js';
import { agentSessionCaller, callerFromAuth } from '../../src/services/caller-context.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const SQLITE_PATH = `./test/.goalreach-${process.pid}.db`;
const NODE = 'aimeat-goal-reach';
const OWNER = 'reacher';
const GHII = `${OWNER}@${NODE}`;
const NARROW = `narrow#${OWNER}@${NODE}`;
const WIDE = `wide#${OWNER}@${NODE}`;
const BASE = ['task:write', 'task:read', 'memory:read', 'memory:write', 'ai:use'];
let storage: Storage;
let deps: { storage: Storage; config: AimeatConfig };
let started: Array<{ input_keys?: string[] }>;

async function agent(gaii: string, scopes: string[]): Promise<void> {
    const name = gaii.split('#')[0]!;
    await storage.createAgent({
        name, owner: OWNER, gaii, capabilities: [], publicKey: 'pk', trustScore: 0, morselBalance: 0,
        createdAt: '2026-10-27T00:00:00.000Z', lastSeen: '2026-10-27T00:00:00.000Z', defaultScopes: scopes,
    } as never);
}

async function put(ns: string, key: string, visibility: string): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii: ns, value: `dummy ${key}`, visibility, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as never);
}

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
    await agent(NARROW, BASE);
    await agent(WIDE, [...BASE, 'memory:read-as-owner']);
    await put(GHII, 'owner.private', 'private');
    await put(GHII, 'owner.shared', 'owner');
    await put(NARROW, 'narrow.own', 'private');
    deps = { storage, config: { nodeId: NODE, baseUrl: 'http://localhost' } as AimeatConfig };
    setActiveAiJobService({
        startJob: async (input: { input_keys?: string[] }) => { started.push(input); return { job_id: `job-${started.length}` }; },
    } as unknown as AiJobService);
}, 60_000);

afterAll(async () => {
    setThisNodeId(null);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

beforeEach(() => { started = []; });

const person: GoalAccess = { ownerGhii: GHII, ownerName: OWNER, person: true, agent: null, who: 'owner' };
const ownerViewer = () => ({ caller: callerFromAuth({ sub: OWNER, owner: OWNER, roles: ['owner'], scopes: [] }, NODE, storage) });
const agentViewer = (gaii: string, scopes: string[]) => ({ caller: agentSessionCaller(gaii, OWNER, scopes, NODE, storage) });

/** A goal with one model work whose material is each [key, by]. Answers the goal and work ids. */
async function goalWith(...material: Array<[string, string]>): Promise<{ id: string; workId: string }> {
    const goal = buildGoal(person, { statement: 'Summarise the notes.', works: [{ title: 'Summary', runner: 'model' }] } as never);
    material.forEach(([key, by], i) => goal.material.push({ id: `m${i}`, kind: 'memory', ref: key, title: key, by, at: new Date().toISOString() }));
    await createGoalRecord(deps, GHII, goal);
    return { id: goal.id, workId: goal.works[0]!.id };
}
const workOf = async (g: { id: string; workId: string }) => (await readGoal(deps, GHII, g.id))!.works.find(w => w.id === g.workId)!;

/** Wait until the job service saw `n` starts (the approval moves the goal on without being awaited). */
async function startsReach(n: number): Promise<void> {
    for (let i = 0; i < 100 && started.length < n; i++) await new Promise(r => setTimeout(r, 20));
}

describe('a goal\'s model work and the reach of whoever named its material', () => {
    it('usage: material the owner attached reaches the model', async () => {
        const g = await goalWith(['owner.private', 'owner']);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toContain('owner.private');
    });

    it('usage: an agent holding memory:read-as-owner sees no change', async () => {
        const g = await goalWith(['owner.private', WIDE]);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toContain('owner.private');
    });

    it('usage: an agent\'s own private record and a record at visibility owner reach the model', async () => {
        const own = await goalWith(['narrow.own', NARROW]);
        await runModelWork(deps, GHII, own.id, own.workId);
        const shared = await goalWith(['owner.shared', NARROW]);
        await runModelWork(deps, GHII, shared.id, shared.workId);
        expect(started).toHaveLength(2);
    });

    it('an agent without memory:read-as-owner that attached the owner\'s private record starts no job; the work waits on a pending question the agent cannot answer', async () => {
        const g = await goalWith(['owner.private', NARROW]);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(0);
        const work = await workOf(g);
        expect(work.status).toBe('waiting');
        expect(work.reason).toMatch(/narrow/);
        expect(work.reason).toMatch(/owner\.private/);
        const request = await readPublishRequest(storage, GHII, work.readAsk!.requestId);
        expect(request?.state).toBe('awaiting_owner');
        expect(request?.kind).toBe('goal-model-read');
        const own = await decidePublishRequest(deps, agentViewer(NARROW, BASE), request!.id, 'approve');
        expect(own.ok).toBe(false);
        // A second advance asks nothing new and still reads nothing.
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(0);
    });

    it('usage: the owner allows it, and the work runs with the record as before', async () => {
        const g = await goalWith(['owner.private', NARROW]);
        await runModelWork(deps, GHII, g.id, g.workId);
        const id = (await workOf(g)).readAsk!.requestId;
        const out = await decidePublishRequest(deps, ownerViewer(), id, 'approve');
        expect(out.ok).toBe(true);
        await startsReach(1);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toContain('owner.private');
    });

    it('usage: an agent holding memory:read-as-owner allows it for the owner', async () => {
        const g = await goalWith(['owner.private', NARROW]);
        await runModelWork(deps, GHII, g.id, g.workId);
        const id = (await workOf(g)).readAsk!.requestId;
        const out = await decidePublishRequest(deps, agentViewer(WIDE, [...BASE, 'memory:read-as-owner']), id, 'approve');
        expect(out.ok).toBe(true);
        await startsReach(1);
        expect(started[0]!.input_keys).toContain('owner.private');
    });

    it('don\'t allow: the work runs without the record and keeps the others', async () => {
        const g = await goalWith(['owner.shared', 'owner'], ['owner.private', NARROW]);
        await runModelWork(deps, GHII, g.id, g.workId);
        const id = (await workOf(g)).readAsk!.requestId;
        expect((await decidePublishRequest(deps, ownerViewer(), id, 'decline')).ok).toBe(true);
        await settleModelReadAsks(deps, GHII, (await readGoal(deps, GHII, g.id))!);
        expect((await workOf(g)).status).toBe('open');
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toEqual(['owner.shared']);
    });

    it('don\'t allow: a work left with none of its records stops with the reason', async () => {
        const g = await goalWith(['owner.private', NARROW]);
        await runModelWork(deps, GHII, g.id, g.workId);
        const id = (await workOf(g)).readAsk!.requestId;
        await decidePublishRequest(deps, ownerViewer(), id, 'decline');
        await settleModelReadAsks(deps, GHII, (await readGoal(deps, GHII, g.id))!);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(0);
        const work = await workOf(g);
        expect(work.status).toBe('failed');
        expect(work.reason).toMatch(/did not allow/);
    });
});
