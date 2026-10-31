/**
 * @file test/unit/goals-model-take-race.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A goal's model work hands the model only the records whose reach was checked, also when
 *   the goal changes between the check and the take (services/goals/goals-model.ts runModelWork;
 *   secaudit 2026-10-31 inv-21a).
 *
 *   runModelWork checks the records of the goal it read first (goals-model-reach.ts), then takes the
 *   work on the goal as updateGoal reads it again, and builds the model's input from that second
 *   read. With the real SQLite store, a material is added between the two reads, as a concurrent
 *   request would add it:
 *   - refused: a private record an agent without memory:read-as-owner named in that gap reaches no
 *     model; the work waits for the owner, as it does when the record was named before;
 *   - kept: material the owner adds in the gap reaches the model, and a goal that does not change
 *     runs as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/goals-model-take-race.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-21a).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : () => quiet) });
    return { ...real, logger: quiet };
});

import { createStorage } from '../../src/storage/storage-factory.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { buildGoal } from '../../src/services/goals/goals-create.js';
import { createGoalRecord, readGoal, updateGoal, type GoalAccess } from '../../src/services/goals/goals-store.js';
import { goalKey } from '../../src/services/goals/goals-types.js';
import { runModelWork } from '../../src/services/goals/goals-model.js';
import { setActiveAiJobService, type AiJobService } from '../../src/services/ai-jobs/service.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const SQLITE_PATH = `./test/.goalrace-${process.pid}.db`;
const NODE = 'aimeat-goal-race';
const OWNER = 'racer';
const GHII = `${OWNER}@${NODE}`;
const NARROW = `narrow#${OWNER}@${NODE}`;
const BASE = ['task:write', 'task:read', 'memory:read', 'memory:write', 'ai:use'];
let real: Storage;
let deps: { storage: Storage; config: AimeatConfig };
let started: Array<{ input_keys?: string[] }>;

/** Run once, on the second read of the goal record: what a concurrent request does between check and take. */
let between: { goalId: string; reads: number; act: () => Promise<void> } | null = null;

function watched(s: Storage): Storage {
    return new Proxy(s, {
        get(target, prop, receiver) {
            const orig = Reflect.get(target, prop, receiver);
            if (typeof orig !== 'function') return orig;
            if (prop === 'getMemory') {
                return async (owner: string, key: string) => {
                    const b = between;
                    if (b && owner === GHII && key === goalKey(b.goalId) && ++b.reads === 2) {
                        between = null;
                        await b.act();
                    }
                    return orig.call(target, owner, key);
                };
            }
            return orig.bind(target);
        },
    });
}

async function put(ns: string, key: string, visibility: string): Promise<void> {
    const now = new Date().toISOString();
    await real.setMemory({ key, ownerGaii: ns, value: `dummy ${key}`, visibility, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as never);
}

beforeAll(async () => {
    setThisNodeId(NODE);
    real = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await real.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
    await real.createAgent({
        name: 'narrow', owner: OWNER, gaii: NARROW, capabilities: [], publicKey: 'pk', trustScore: 0, morselBalance: 0,
        createdAt: '2026-10-27T00:00:00.000Z', lastSeen: '2026-10-27T00:00:00.000Z', defaultScopes: BASE,
    } as never);
    await put(GHII, 'owner.private', 'private');
    await put(GHII, 'owner.shared', 'owner');
    deps = { storage: watched(real), config: { nodeId: NODE, baseUrl: 'http://localhost' } as AimeatConfig };
    setActiveAiJobService({
        startJob: async (input: { input_keys?: string[] }) => { started.push(input); return { job_id: `job-${started.length}` }; },
    } as unknown as AiJobService);
}, 60_000);

afterAll(async () => {
    setThisNodeId(null);
    await (real as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

beforeEach(() => { started = []; between = null; });

const person: GoalAccess = { ownerGhii: GHII, ownerName: OWNER, person: true, agent: null, who: 'owner' };

async function goalWith(material: Array<[string, string]>): Promise<{ id: string; workId: string }> {
    const goal = buildGoal(person, { statement: 'Summarise the notes.', works: [{ title: 'Summary', runner: 'model' }] } as never);
    material.forEach(([key, by], i) => goal.material.push({ id: `m${i}`, kind: 'memory', ref: key, title: key, by, at: new Date().toISOString() }));
    await createGoalRecord({ storage: real, config: deps.config }, GHII, goal);
    return { id: goal.id, workId: goal.works[0]!.id };
}

/** Add `key` as material named by `by`, straight to the store, as a concurrent request would. */
const addMaterial = (goalId: string, key: string, by: string) => async () => {
    await updateGoal({ storage: real, config: deps.config }, GHII, goalId, cur => ({
        ...cur, material: [...cur.material, { id: `late-${key}`, kind: 'memory' as const, ref: key, title: key, by, at: new Date().toISOString() }],
    }));
};

describe('a goal\'s model work when the goal changes between the reach check and the take', () => {
    it('a private record an agent names in the gap reaches no model; the work waits for the owner', async () => {
        const g = await goalWith([['owner.shared', 'owner']]);
        between = { goalId: g.id, reads: 0, act: addMaterial(g.id, 'owner.private', NARROW) };
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started.flatMap(s => s.input_keys ?? [])).not.toContain('owner.private');
        const work = (await readGoal({ storage: real, config: deps.config }, GHII, g.id))!.works.find(w => w.id === g.workId)!;
        expect(work.status).toBe('waiting');
        expect(work.readAsk?.keys).toEqual(['owner.private']);
    });

    it('usage: material the owner adds in the gap reaches the model', async () => {
        const g = await goalWith([['owner.shared', 'owner']]);
        between = { goalId: g.id, reads: 0, act: addMaterial(g.id, 'owner.private', 'owner') };
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toEqual(['owner.shared', 'owner.private']);
    });

    it('usage: a goal that does not change runs as before', async () => {
        const g = await goalWith([['owner.shared', NARROW]]);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
        expect(started[0]!.input_keys).toEqual(['owner.shared']);
    });
});
