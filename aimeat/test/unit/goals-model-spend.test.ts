/**
 * @file test/unit/goals-model-spend.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A goal's model work spends the owner's AI allowance under the permission of the agent
 *   that asked for it, the same ai:use that POST /v1/ai/jobs asks (secaudit2026oct26 round 8c,
 *   goals:model-work-runs-as-owner-without-requesting-agent-authority, background-05).
 *
 *   With the real SQLite store and a recording AI job service:
 *   - the attack: an agent without ai:use that made a goal with a model work gets no job started; the
 *     work waits with a reason and a pending request the agent cannot answer for itself;
 *   - allow: the work runs as before, and a later model work of the same agent in the goal runs
 *     without asking; an agent holding ai:use may allow it for the owner;
 *   - don't allow: the work stops with the reason, nothing is spent;
 *   - a work the node made from the goal's own plan carries the goal's author; a goal the owner
 *     approved as a proposal is the owner's own yes;
 *   - the uses kept, unchanged: the owner in person, and an agent holding ai:use.
 * @usage cd aimeat && pnpm exec vitest run test/unit/goals-model-spend.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-29 -- Initial (secaudit2026oct26 round 8c, background-05).
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
import { createGoalRecord, readGoal, updateGoal, type GoalAccess } from '../../src/services/goals/goals-store.js';
import { makeWork, appendWorks } from '../../src/services/goals/goals-work.js';
import { runModelWork } from '../../src/services/goals/goals-model.js';
import { settleModelSpendAsks } from '../../src/services/goals/goals-model-spend.js';
import { setActiveAiJobService, type AiJobService } from '../../src/services/ai-jobs/service.js';
import { decidePublishRequest } from '../../src/services/publish-requests/decide.js';
import { readPublishRequest } from '../../src/services/publish-requests/store.js';
import { agentSessionCaller, callerFromAuth } from '../../src/services/caller-context.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const SQLITE_PATH = `./test/.goalspend-${process.pid}.db`;
const NODE = 'aimeat-goal-spend';
const OWNER = 'spender';
const GHII = `${OWNER}@${NODE}`;
const NOAI = `noai#${OWNER}@${NODE}`;
const WITHAI = `withai#${OWNER}@${NODE}`;
const BASE = ['task:write', 'task:read', 'memory:read', 'memory:write'];
let storage: Storage;
let deps: { storage: Storage; config: AimeatConfig };
let started: unknown[];

async function agent(gaii: string, scopes: string[]): Promise<void> {
    const name = gaii.split('#')[0]!;
    await storage.createAgent({
        name, owner: OWNER, gaii, capabilities: [], publicKey: 'pk', trustScore: 0, morselBalance: 0,
        createdAt: '2026-10-29T00:00:00.000Z', lastSeen: '2026-10-29T00:00:00.000Z', defaultScopes: scopes,
    } as never);
}

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
    await agent(NOAI, BASE);
    await agent(WITHAI, [...BASE, 'ai:use']);
    deps = { storage, config: { nodeId: NODE, baseUrl: 'http://localhost' } as AimeatConfig };
    setActiveAiJobService({
        startJob: async (input: unknown) => { started.push(input); return { job_id: `job-${started.length}` }; },
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
const asAgent = (gaii: string): GoalAccess => ({ ownerGhii: GHII, ownerName: OWNER, person: false, agent: gaii.split('#')[0]!, who: gaii });
const ownerViewer = () => ({ caller: callerFromAuth({ sub: OWNER, owner: OWNER, roles: ['owner'], scopes: [] }, NODE, storage) });
const agentViewer = (gaii: string, scopes: string[]) => ({ caller: agentSessionCaller(gaii, OWNER, scopes, NODE, storage) });

/** A goal made by `access` with one model work. Answers the goal and work ids. */
async function goalBy(access: GoalAccess, extra: Record<string, unknown> = {}): Promise<{ id: string; workId: string }> {
    const goal = buildGoal(access, { statement: 'Summarise the week.', works: [{ title: 'Summary', runner: 'model' }], ...extra } as never);
    await createGoalRecord(deps, GHII, goal);
    return { id: goal.id, workId: goal.works[0]!.id };
}
const workOf = async (g: { id: string; workId: string }) => (await readGoal(deps, GHII, g.id))!.works.find(w => w.id === g.workId)!;

async function startsReach(n: number): Promise<void> {
    for (let i = 0; i < 100 && started.length < n; i++) await new Promise(r => setTimeout(r, 20));
}

/** A second model work in the goal, made by `who` ('node' for one the goal's plan made). */
async function addModelWork(goalId: string, who: string): Promise<string> {
    let id = '';
    await updateGoal(deps, GHII, goalId, cur => {
        const w = makeWork(cur, { title: 'Next summary', runner: 'model' }, who);
        id = w.id;
        return appendWorks(cur, [w]);
    });
    return id;
}

describe('a goal\'s model work and the permission to spend the owner\'s AI allowance', () => {
    it('usage: the owner\'s own goal runs its model work', async () => {
        const g = await goalBy(person);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
    });

    it('usage: an agent holding ai:use sees no change', async () => {
        const g = await goalBy(asAgent(WITHAI));
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(1);
    });

    it('an agent without ai:use starts no job; the work waits on a pending question the agent cannot answer', async () => {
        const g = await goalBy(asAgent(NOAI));
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(0);
        const work = await workOf(g);
        expect(work.status).toBe('waiting');
        expect(work.reason).toMatch(/noai/);
        const request = await readPublishRequest(storage, GHII, work.spendAsk!.requestId);
        expect(request?.state).toBe('awaiting_owner');
        expect(request?.kind).toBe('goal-model-spend');
        expect((await decidePublishRequest(deps, agentViewer(NOAI, BASE), request!.id, 'approve')).ok).toBe(false);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(0);
    });

    it('allow: the work runs, and the agent\'s next model work in the goal runs without asking', async () => {
        const g = await goalBy(asAgent(NOAI));
        await runModelWork(deps, GHII, g.id, g.workId);
        const id = (await workOf(g)).spendAsk!.requestId;
        expect((await decidePublishRequest(deps, ownerViewer(), id, 'approve')).ok).toBe(true);
        await startsReach(1);
        expect(started).toHaveLength(1);
        const next = await addModelWork(g.id, NOAI);
        await runModelWork(deps, GHII, g.id, next);
        expect(started).toHaveLength(2);
    });

    it('allow: an agent holding ai:use answers for the owner', async () => {
        const g = await goalBy(asAgent(NOAI));
        await runModelWork(deps, GHII, g.id, g.workId);
        const id = (await workOf(g)).spendAsk!.requestId;
        expect((await decidePublishRequest(deps, agentViewer(WITHAI, [...BASE, 'ai:use']), id, 'approve')).ok).toBe(true);
        await startsReach(1);
        expect(started).toHaveLength(1);
    });

    it('don\'t allow: the work stops with the reason and nothing is spent', async () => {
        const g = await goalBy(asAgent(NOAI));
        await runModelWork(deps, GHII, g.id, g.workId);
        const id = (await workOf(g)).spendAsk!.requestId;
        expect((await decidePublishRequest(deps, ownerViewer(), id, 'decline')).ok).toBe(true);
        await settleModelSpendAsks(deps, GHII, (await readGoal(deps, GHII, g.id))!);
        await runModelWork(deps, GHII, g.id, g.workId);
        expect(started).toHaveLength(0);
        const work = await workOf(g);
        expect(work.status).toBe('failed');
        expect(work.reason).toMatch(/did not allow/);
    });

    it('a work the goal\'s plan made carries the goal\'s author', async () => {
        const g = await goalBy(asAgent(NOAI), { works: [{ title: 'Human first', kind: 'human', human_kind: 'answer' }] });
        const w = await addModelWork(g.id, 'node');
        await runModelWork(deps, GHII, g.id, w);
        expect(started).toHaveLength(0);
        expect((await readGoal(deps, GHII, g.id))!.works.find(x => x.id === w)!.status).toBe('waiting');
    });

    it('usage: a goal the owner approved as a proposal runs the works the node makes from it', async () => {
        const g = await goalBy(asAgent(NOAI), { works: [{ title: 'Human first', kind: 'human', human_kind: 'answer' }] });
        await updateGoal(deps, GHII, g.id, cur => ({ ...cur, approvedAt: new Date().toISOString() }));
        const w = await addModelWork(g.id, 'node');
        await runModelWork(deps, GHII, g.id, w);
        expect(started).toHaveLength(1);
    });
});
