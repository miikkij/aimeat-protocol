/**
 * @file test/unit/goals-model-reach.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A goal's model work hands the node's model only records that whoever named them in the
 *   goal may read (secaudit2026oct26, goals:model-work-runs-as-owner-without-requesting-agent-authority).
 *
 *   With the real SQLite store and a recording AI job service: an agent without memory:read-as-owner
 *   that attached the owner's private record gets no job started, and the work says why, naming the
 *   word and the agent's page. The usage cases start the job with the record as before: material the
 *   owner attached, an agent holding memory:read-as-owner, an agent's own private record, and a record
 *   at visibility owner.
 * @usage cd aimeat && pnpm exec vitest run test/unit/goals-model-reach.test.ts
 * @version-history
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
import { setActiveAiJobService, type AiJobService } from '../../src/services/ai-jobs/service.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const SQLITE_PATH = `./test/.goalreach-${process.pid}.db`;
const NODE = 'aimeat-goal-reach';
const OWNER = 'reacher';
const GHII = `${OWNER}@${NODE}`;
const NARROW = `narrow#${OWNER}@${NODE}`;
const WIDE = `wide#${OWNER}@${NODE}`;
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
    await agent(NARROW, ['task:write', 'task:read', 'memory:read', 'ai:use']);
    await agent(WIDE, ['task:write', 'task:read', 'memory:read', 'memory:read-as-owner', 'ai:use']);
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

/** A goal with one model work whose material is `key`, attached by `by`. Answers the goal and work ids. */
async function goalWith(key: string, by: string): Promise<{ id: string; workId: string }> {
    const goal = buildGoal(person, { statement: 'Summarise the notes.', works: [{ title: 'Summary', runner: 'model' }] } as never);
    goal.material.push({ id: 'm1', kind: 'memory', ref: key, title: key, by, at: new Date().toISOString() });
    await createGoalRecord(deps, GHII, goal);
    return { id: goal.id, workId: goal.works[0]!.id };
}

describe('a goal\'s model work and the reach of whoever named its material', () => {
    it('usage: material the owner attached reaches the model', async () => {
        const g = await goalWith('owner.private', 'owner');
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toContain('owner.private');
    });

    it('usage: an agent holding memory:read-as-owner sees no change', async () => {
        const g = await goalWith('owner.private', WIDE);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toContain('owner.private');
    });

    it('usage: an agent\'s own private record and a record at visibility owner reach the model', async () => {
        const own = await goalWith('narrow.own', NARROW);
        await runModelWork(deps, GHII, own.id, own.workId);
        const shared = await goalWith('owner.shared', NARROW);
        await runModelWork(deps, GHII, shared.id, shared.workId);
        expect(started).toHaveLength(2);
    });

    it('an agent without memory:read-as-owner that attached the owner\'s private record starts no job, and the work says why', async () => {
        const g = await goalWith('owner.private', NARROW);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(0);
        const work = (await readGoal(deps, GHII, g.id))!.works[0]!;
        expect(work.status).toBe('failed');
        expect(work.reason).toMatch(/memory:read-as-owner/);
        expect(work.reason).toMatch(/agent=narrow/);
    });
});
