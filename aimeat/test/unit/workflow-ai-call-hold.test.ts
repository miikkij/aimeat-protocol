/**
 * @file test/unit/workflow-ai-call-hold.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a run holds of its spending limit (maxCostUsd) while an ai step's model call is
 *   open, and what it has spent, through the engine over an in-memory storage: the watchdog finding
 *   the step's output while its call runs, a timeout, a retry beside a call still open, a failing
 *   call, a cancel, a restart, and a cost that arrives after the run finished. The model is a
 *   stand-in whose calls stay open until the case answers them. The same road with a real provider is
 *   test/e2e-workflows.ts.
 * @version-history
 *   v1.1.0 — 2026-09-26 — A step keeps the most one attempt cost, and the next run expects one attempt
 *     (secaudit 2026-09, A6-11).
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, A6-11).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import { reservedUsd, spentUsd, pinCostEstimates } from '../../src/services/workflow/run-cost.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type {
    WorkflowDef, WorkflowRun, WorkflowRunStep, WorkflowStep, ResolvedStepSignals, Signal,
} from '../../src/models/workflow-schemas.js';

/** The model's calls, each open until the case answers it. */
const model = vi.hoisted(() => ({ calls: [] as Array<{ prompt: string; resolve: (v: unknown) => void }> }));

vi.mock('../../src/services/ai-completion.js', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/services/ai-completion.js')>(),
    completeForOwner: (_s: unknown, _c: unknown, _g: string, opts: { prompt: string }) =>
        new Promise(resolve => { model.calls.push({ prompt: opts.prompt, resolve }); }),
}));

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const WF = 'held';
const RUN = 'run-1';
const RUN_KEY = `workflows.run.${WF}.${RUN}`;

/**
 * Memory the way a real backend keeps it: a value goes in and comes out as a copy, so two readers
 * never share one object. `onSet` runs after a write lands.
 */
function memStorage(onSet?: (rec: MemoryRecord) => Promise<void>): Storage {
    const map = new Map<string, MemoryRecord>();
    const k = (owner: string, key: string) => `${owner}|${key}`;
    const listed = (match: (r: MemoryRecord) => boolean, prefix = '') =>
        [...map.values()].filter(r => match(r) && r.key.startsWith(prefix)).map(r => structuredClone(r));
    return {
        getMemory: async (owner: string, key: string) => {
            const rec = map.get(k(owner, key));
            return rec ? structuredClone(rec) : null;
        },
        setMemory: async (rec: MemoryRecord) => {
            map.set(k(rec.ownerGaii, rec.key), structuredClone(rec));
            if (onSet) await onSet(rec);
            return rec;
        },
        deleteMemory: async (owner: string, key: string) => map.delete(k(owner, key)),
        listMemory: async (owner: string, o?: { prefix?: string }) => listed(r => r.ownerGaii === owner, o?.prefix),
        listMemoryForOwners: async (owners: string[], o?: { prefix?: string }) => listed(r => owners.includes(r.ownerGaii), o?.prefix),
        getAgent: async () => null,
        getAgentTask: async () => null,
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
    } as unknown as Storage;
}

const put = (storage: Storage, owner: string, key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
    createdAt: '2026-09-26T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z',
} as MemoryRecord);

/** An ai step answering into `out.<id>`, timing out after a minute unless it says otherwise. */
const ai = (id: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
    id, description: id, required_to_function: 'none', timeout_min: 1,
    action: { kind: 'ai', prompt: `Say ${id}.`, result_to_key: `out.${id}` }, ...extra,
} as unknown as WorkflowStep);

const defOf = (steps: WorkflowStep[], cap: number): WorkflowDef => ({
    id: WF, title: WF, description: 'd', trigger: { kind: 'manual' }, vars: [], steps,
    on_step_fail: 'inspect', createdBy: OWNER, createdAt: 't', updatedAt: 't', maxCostUsd: cap,
});

/**
 * A step as the run left it. `holds`: its attempt's model call is still open and holds that much of
 * the limit. A run saved before calls were marked kept that hold on the step itself (`reservedUsd`),
 * so both are written: the case must read the same for a record of either shape.
 */
function stepAt(state: WorkflowRunStep['state'], o: { holds?: number; estimate?: number; startedMsAgo?: number } = {}): WorkflowRunStep {
    const rs = { state, attempt: 0, reads: [], writes: [] } as WorkflowRunStep & Record<string, unknown>;
    if (o.estimate !== undefined) rs.estimateUsd = o.estimate;
    if (o.startedMsAgo !== undefined) rs.startedAt = new Date(Date.now() - o.startedMsAgo).toISOString();
    if (o.holds !== undefined) {
        rs.openCalls = [{ attempt: 0, reservedUsd: o.holds }];
        rs.reservedUsd = o.holds;
    }
    return rs;
}

/** Save a run as the engine had left it, listed among the runs in flight. */
async function seed(
    storage: Storage, def: WorkflowDef, steps: Record<string, WorkflowRunStep>, signals: Record<string, Signal> = {},
): Promise<void> {
    const resolved: ResolvedStepSignals[] = def.steps.map(s => ({
        stepId: s.id, agents: [], offerId: '', required_to_function: 'none',
        success_signal: signals[s.id] ?? { kind: 'deterministic', key: `out.${s.id}`, op: 'nonempty' },
    }));
    const run: WorkflowRun = {
        runId: RUN, workflowId: WF, defSnapshot: def, resolved, vars: {}, mode: 'full-live', keyPrefix: '',
        status: 'waiting-step', steps, startedAt: new Date(Date.now() - 600_000).toISOString(),
    };
    await put(storage, OWNER, RUN_KEY, run);
    await put(storage, `system@${NODE}`, 'workflows.active', [{ ownerGhii: OWNER, workflowId: WF, runId: RUN }]);
}

const engineFor = (storage: Storage) => new WorkflowEngine({ nodeId: NODE } as AimeatConfig, storage);
const readRun = async (storage: Storage, key = RUN_KEY) => (await storage.getMemory(OWNER, key))!.value as WorkflowRun;

/** Let the engine take in an answer: every storage call here settles without a timer. */
const settle = () => new Promise<void>(resolve => { setTimeout(resolve, 20); });

/** The model answers its call number `i`, at that cost. */
async function answer(i: number, costUsd: number, content = 'an answer'): Promise<void> {
    model.calls[i].resolve({ content, usage: { costUsd } });
    await settle();
}

/** A step's call started before the case began answers now, the way the ai step reports it. */
const callAnswers = (engine: WorkflowEngine, stepId: string, ok: boolean, costUsd: number, attempt = 0) =>
    engine.onPushTerminal(OWNER, WF, RUN, stepId, ok, costUsd, attempt);

beforeEach(() => { model.calls.length = 0; });

describe('an ai step\'s call holds its share of the limit until it answers', () => {
    it('the watchdog finds the output while the call runs: the call keeps its hold, and the waiting step starts when it answers', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left'), ai('right')], 0.03), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 10_000 }),
            right: stepAt('pending', { estimate: 0.02 }),
        });
        // The result key the watchdog asks about is already filled, by the run before this one.
        await put(storage, OWNER, 'out.left', 'written by the run before');
        const engine = engineFor(storage);

        await engine.sweep();
        let run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(run.steps.right.state).toBe('pending');
        expect(model.calls).toHaveLength(0);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBe(0);
        expect(run.status).toBe('waiting-step');

        await callAnswers(engine, 'left', true, 0.01);
        run = await readRun(storage);
        expect(run.steps.left.costUsd).toBeCloseTo(0.01, 10);
        expect(run.steps.right.state).toBe('dispatched');
        expect(model.calls).toHaveLength(1);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBeCloseTo(0.01, 10);

        await answer(0, 0.01);
        run = await readRun(storage);
        expect(run.status).toBe('done');
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.02, 10);
    });

    it('a timeout: the timed-out step\'s call keeps its hold until it answers late, and what it cost then counts', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left'), ai('right')], 0.03), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 120_000 }),
            right: stepAt('pending', { estimate: 0.02 }),
        });
        const engine = engineFor(storage);

        await engine.sweep();
        let run = await readRun(storage);
        expect(run.steps.left.state).toBe('timed-out');
        expect(run.steps.right.state).toBe('pending');
        expect(model.calls).toHaveLength(0);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBe(0);

        await callAnswers(engine, 'left', true, 0.01);
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('timed-out');
        expect(run.steps.left.costUsd).toBeCloseTo(0.01, 10);
        expect(run.steps.right.state).toBe('dispatched');
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBeCloseTo(0.01, 10);

        await answer(0, 0.01);
        run = await readRun(storage);
        expect(run.status).toBe('partial');
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.02, 10);
    });

    it('a retry beside a call still open: each call holds its own share, and each answer gives back its own', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 120_000 }),
        });
        const engine = engineFor(storage);

        // The watchdog gives the stalled step its retry, and the retry's call starts beside the first.
        await engine.sweep();
        let run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(run.steps.left.attempt).toBe(1);
        expect(model.calls).toHaveLength(1);
        expect(reservedUsd(run)).toBeCloseTo(0.04, 10);
        expect(spentUsd(run)).toBe(0);

        // The first call answers late, with its result: the step is green, and the retry's call holds on.
        await put(storage, OWNER, 'out.left', 'the first call\'s answer');
        await callAnswers(engine, 'left', true, 0.015, 0);
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(run.status).toBe('done');
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBeCloseTo(0.015, 10);

        await answer(0, 0.02);
        run = await readRun(storage);
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.035, 10);
        expect(run.steps.left.attemptMaxUsd).toBeCloseTo(0.02, 10);
    });

    it('a failing call: its cost is kept and its hold goes when it answers; after the retry fails too the step is red, and it keeps one attempt as its most', async () => {
        const storage = memStorage();
        const wantsJson: Signal = { kind: 'deterministic', key: 'out.left', op: 'json_field', path: 'ok', equals: true };
        await seed(storage, defOf([ai('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 5_000 }),
        }, { left: wantsJson });
        const engine = engineFor(storage);

        await callAnswers(engine, 'left', false, 0.01);
        let run = await readRun(storage);
        expect(run.steps.left.attempt).toBe(1);
        expect(run.steps.left.state).toBe('dispatched');
        expect(model.calls).toHaveLength(1);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBeCloseTo(0.01, 10);
        expect(run.steps.left.attemptMaxUsd).toBeCloseTo(0.01, 10);

        // The retry answers in words where the step wanted JSON: red, with no retry left.
        await answer(0, 0.03, 'plain words');
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('output-red');
        expect(run.status).toBe('partial');
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.04, 10);
        expect(run.steps.left.attemptMaxUsd).toBeCloseTo(0.03, 10);

        // The next run expects the step to cost one attempt, not the two this run made.
        const next: Record<string, WorkflowRunStep> = { left: stepAt('pending') };
        pinCostEstimates(run.defSnapshot, next, [run]);
        expect(next.left.estimateUsd).toBeCloseTo(0.03, 10);
    });

    it('a cancel while a call is open: the cancelled run holds the call\'s share until it answers, then keeps what it cost', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left'), ai('right')], 0.03), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 10_000 }),
            right: stepAt('pending', { estimate: 0.02 }),
        });
        const engine = engineFor(storage);

        expect(await engine.cancelRun(OWNER, WF, RUN)).toBe(true);
        let run = await readRun(storage);
        expect(run.status).toBe('cancelled');
        expect([run.steps.left.state, run.steps.right.state]).toEqual(['skipped', 'skipped']);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBe(0);

        await callAnswers(engine, 'left', true, 0.015);
        run = await readRun(storage);
        expect(run.status).toBe('cancelled');
        expect(run.steps.left.costUsd).toBeCloseTo(0.015, 10);
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.015, 10);
        expect(model.calls).toHaveLength(0);
    });

    it('a restart: the calls ended with the process, so their holds go, and a waiting step starts at the next pass', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left'), ai('right')], 0.03), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 30_000 }),
            right: stepAt('pending', { estimate: 0.02 }),
        });
        const engine = engineFor(storage);

        await engine.resumeInflight();
        let run = await readRun(storage);
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBe(0);
        expect(run.steps.left.openCalls).toBeUndefined();
        // The watchdog ends the step itself later, by its output or its timeout.
        expect(run.steps.left.state).toBe('dispatched');

        await engine.sweep();
        run = await readRun(storage);
        expect(run.steps.right.state).toBe('dispatched');
        expect(model.calls).toHaveLength(1);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBe(0);
    });

    it('a cost that arrives after the run finished counts on the run, and in the next run\'s estimate', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left')], 0.03), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 10_000 }),
        });
        await put(storage, OWNER, 'out.left', 'written by the run before');
        const engine = engineFor(storage);

        await engine.sweep();
        let run = await readRun(storage);
        expect(run.status).toBe('done');
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBe(0);

        await callAnswers(engine, 'left', true, 0.025);
        run = await readRun(storage);
        expect(run.status).toBe('done');
        expect(run.steps.left.costUsd).toBeCloseTo(0.025, 10);
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.025, 10);

        const next: Record<string, WorkflowRunStep> = { left: stepAt('pending') };
        pinCostEstimates(run.defSnapshot, next, [run]);
        expect(next.left.estimateUsd).toBeCloseTo(0.025, 10);
    });
});
