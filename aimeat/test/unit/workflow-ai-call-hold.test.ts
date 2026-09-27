/**
 * @file test/unit/workflow-ai-call-hold.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a run holds of its spending limit (maxCostUsd) while an ai step's model call is
 *   open, and what it has spent, through the engine over an in-memory storage: the watchdog finding
 *   the step's output while its call runs, a timeout, a retry beside a call still open, a failing
 *   call, a cancel, a restart, a cost that arrives after the run finished, and a watchdog pass that
 *   comes between a run's first save and its first step. Then a late answer of an earlier attempt,
 *   while the step runs again after a retry, for an ai step and an extension step; a finished agent
 *   task, which decides only the agent step whose current attempt it was dispatched for; an answer
 *   that comes after its step ended, which writes nothing; and an error inside the engine while it
 *   takes an answer in, which is not a failure of the attempt. The model, the extension's action and
 *   a datapackage step's read of its source are stand-ins that stay open until the case lets them
 *   answer; the publish is a stand-in that answers at once. The same code path with a real provider
 *   is test/e2e-workflows.ts.
 * @version-history
 *   v1.6.0 — 2026-09-26 — An answer that comes after its step ended writes nothing: an ai and an
 *     extension step's result and a datapackage step's version, after an earlier attempt turned the
 *     step green, and an ai step's result after a cancel (secaudit 2026-09, R4).
 *   v1.5.0 — 2026-09-26 — An error inside the engine while it takes a model call's answer in leaves
 *     the attempt as it was, and the watchdog decides the step by its output (secaudit 2026-09, R4).
 *   v1.4.0 — 2026-09-26 — A finished agent task decides only the agent step whose current attempt it
 *     was dispatched for, and the step's own task still decides it, also after a restart (secaudit
 *     2026-09, R4 row 10).
 *   v1.3.0 — 2026-09-26 — An answer of an earlier attempt: a late failure leaves the step to the
 *     attempt that runs now, for an ai step and for an extension step, and a success without the
 *     output uses up no retry (secaudit 2026-09, R3 problem 2).
 *   v1.2.0 — 2026-09-26 — A watchdog pass between a run's first save and its first tick starts
 *     nothing twice (secaudit 2026-09, A6-11).
 *   v1.1.0 — 2026-09-26 — A step keeps the most one attempt cost, and the next run expects one attempt
 *     (secaudit 2026-09, A6-11).
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, A6-11).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import { reservedUsd, spentUsd, pinCostEstimates } from '../../src/services/workflow/run-cost.js';
import { logger } from '../../src/utils/logger.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord, AgentTaskRecord } from '../../src/storage/interface.js';
import type {
    WorkflowDef, WorkflowRun, WorkflowRunStep, WorkflowStep, ResolvedStepSignals, Signal,
} from '../../src/models/workflow-schemas.js';

/** The model's calls, each open until the case answers it. */
const model = vi.hoisted(() => ({ calls: [] as Array<{ prompt: string; resolve: (v: unknown) => void }> }));
/** The runs of an extension step's action, each open until the case settles it. */
const sandbox = vi.hoisted(() => ({ runs: [] as Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> }));
/** The versions the publish stand-in made, by package name. Each one writes `out.pkg`. */
const packages = vi.hoisted(() => ({ published: [] as string[] }));

vi.mock('../../src/services/ai-completion.js', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/services/ai-completion.js')>(),
    completeForOwner: (_s: unknown, _c: unknown, _g: string, opts: { prompt: string }) =>
        new Promise(resolve => { model.calls.push({ prompt: opts.prompt, resolve }); }),
}));

vi.mock('../../src/services/extension-system-run.js', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/services/extension-system-run.js')>(),
    runExtensionActionAsSystem: () => new Promise((resolve, reject) => { sandbox.runs.push({ resolve, reject }); }),
}));

vi.mock('../../src/services/datapackage/store.js', async importOriginal => ({
    ...await importOriginal<typeof import('../../src/services/datapackage/store.js')>(),
    publishPackage: async (deps: { storage: Storage }, owner: string, input: { name: string }) => {
        packages.published.push(input.name);
        const at = new Date().toISOString();
        await deps.storage.setMemory({
            key: 'out.pkg', ownerGaii: owner, value: packages.published.length, visibility: 'private', tags: [],
            ttlHours: null, version: packages.published.length, createdAt: at, updatedAt: at,
        } as MemoryRecord);
        return { ok: true, descriptor: { aimeat: { packageId: input.name } }, contentHash: 'h', unchanged: false, resources: [{ rowCount: 1 }] };
    },
}));

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const WF = 'held';
const RUN = 'run-1';
const RUN_KEY = `workflows.run.${WF}.${RUN}`;

/** The agent tasks the node holds, by id. */
const tasks = new Map<string, AgentTaskRecord>();
/** Reads of `key` wait until the case lets each one through: the source a datapackage step reads. */
const held = { key: '', reads: [] as Array<() => void> };
/** The next this many writes of the run record fail: an error inside the engine, not in the step. */
const faults = { runWritesToFail: 0 };

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
            if (key === held.key) await new Promise<void>(resolve => { held.reads.push(resolve); });
            const rec = map.get(k(owner, key));
            return rec ? structuredClone(rec) : null;
        },
        setMemory: async (rec: MemoryRecord) => {
            if (faults.runWritesToFail > 0 && rec.key === RUN_KEY) {
                faults.runWritesToFail -= 1;
                throw new Error('the store did not answer');
            }
            map.set(k(rec.ownerGaii, rec.key), structuredClone(rec));
            if (onSet) await onSet(rec);
            return rec;
        },
        deleteMemory: async (owner: string, key: string) => map.delete(k(owner, key)),
        listMemory: async (owner: string, o?: { prefix?: string }) => listed(r => r.ownerGaii === owner, o?.prefix),
        listMemoryForOwners: async (owners: string[], o?: { prefix?: string }) => listed(r => owners.includes(r.ownerGaii), o?.prefix),
        getAgent: async () => null,
        getAgentTask: async (id: string) => { const t = tasks.get(id); return t ? structuredClone(t) : null; },
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

/** An extension step writing its action's result into `out.<id>`, timing out after a minute. */
const extension = (id: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
    id, description: id, required_to_function: 'none', timeout_min: 1,
    action: { kind: 'extension', extension: 'demo', action: 'run', result_to_key: `out.${id}` }, ...extra,
} as unknown as WorkflowStep);

/** A datapackage step publishing the rows at `in.rows`, timing out after a minute. Its output is `out.pkg`. */
const datapackage = (id: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
    id, description: id, required_to_function: 'none', timeout_min: 1,
    action: { kind: 'datapackage', name: 'rows', from_key: 'in.rows', changes: 'Each run.' }, ...extra,
} as unknown as WorkflowStep);

/** A step the owner's agent `writer` does: it gets a task, writes `out.<id>` and finishes the task. */
const agentStep = (id: string, extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
    id, description: id, required_to_function: 'none', timeout_min: 1, agent: 'writer', ...extra,
} as unknown as WorkflowStep);

/** A task that names this run and `stepId` the way a task the engine dispatches does, held by the node. */
function taskFor(id: string, stepId: string, status: AgentTaskRecord['status'] = 'done'): AgentTaskRecord {
    const task = {
        id, agentGaii: `writer#alice@${NODE}`, ownerGaii: OWNER, title: stepId,
        scope: [{ name: 'workflow-run', value: `${WF}/${RUN}`, type: 'text', description: stepId }],
        rules: [], verification: { userExpects: '', technicalChecks: [] }, todos: [],
        status, createdAt: 't', updatedAt: 't', lastEventAt: 't',
    } as unknown as AgentTaskRecord;
    tasks.set(id, task);
    return task;
}

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

/** The value at `key` in the owner's namespace, or undefined. */
const valueAt = async (storage: Storage, key: string) => (await storage.getMemory(OWNER, key))?.value;

beforeEach(() => {
    model.calls.length = 0; sandbox.runs.length = 0; packages.published.length = 0;
    tasks.clear(); held.key = ''; held.reads.length = 0; faults.runWritesToFail = 0;
});

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

describe('an answer of an earlier attempt, while the step runs again after a retry', () => {
    it('a late failure of attempt 0 while attempt 1\'s call is open: its cost and hold are settled, and attempt 1 decides the step', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 120_000 }),
        });
        const engine = engineFor(storage);

        // The watchdog gives the stalled step its retry, and attempt 1's call starts beside attempt 0's.
        await engine.sweep();
        let run = await readRun(storage);
        expect(run.steps.left.attempt).toBe(1);
        expect(model.calls).toHaveLength(1);

        // Attempt 0's call fails late. The step stays on attempt 1, whose call is still open.
        await callAnswers(engine, 'left', false, 0.01, 0);
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(run.steps.left.attempt).toBe(1);
        expect(run.status).toBe('waiting-step');
        expect(model.calls).toHaveLength(1);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
        expect(spentUsd(run)).toBeCloseTo(0.01, 10);

        // Attempt 1's call answers, and its result is the step's.
        await answer(0, 0.02);
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(run.status).toBe('done');
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.03, 10);
    });

    it('an answer of attempt 0 that succeeded without the output uses up no retry, and attempt 1\'s own answer still can', async () => {
        const storage = memStorage();
        const wantsJson: Signal = { kind: 'deterministic', key: 'out.left', op: 'json_field', path: 'ok', equals: true };
        await seed(storage, defOf([ai('left', { retry: { max: 2, backoff_min: 0 } })], 0.05), {
            left: stepAt('dispatched', { holds: 0.01, estimate: 0.01, startedMsAgo: 120_000 }),
        }, { left: wantsJson });
        const engine = engineFor(storage);

        await engine.sweep();
        expect(model.calls).toHaveLength(1);

        // Attempt 0 wrote words where the step wanted JSON, and says it succeeded.
        await put(storage, OWNER, 'out.left', 'plain words');
        await callAnswers(engine, 'left', true, 0.01, 0);
        let run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(run.steps.left.attempt).toBe(1);
        expect(model.calls).toHaveLength(1);

        // Attempt 1 answers in words too: it is the current attempt, so the step takes its last retry.
        await answer(0, 0.01, 'plain words');
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(run.steps.left.attempt).toBe(2);
        expect(model.calls).toHaveLength(2);

        await answer(1, 0.01, '{"ok": true}');
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(run.status).toBe('done');
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.03, 10);
    });

    it('an extension step: a late failure of attempt 0 while attempt 1 runs leaves the step to attempt 1', async () => {
        const storage = memStorage();
        await seed(storage, defOf([extension('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), { left: stepAt('pending') });
        const engine = engineFor(storage);

        // Attempt 0 starts, and then stalls past its minute.
        await engine.sweep();
        let run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(sandbox.runs).toHaveLength(1);
        run.steps.left.startedAt = new Date(Date.now() - 120_000).toISOString();
        await put(storage, OWNER, RUN_KEY, run);

        // The watchdog gives it its retry, and attempt 1 starts beside attempt 0.
        await engine.sweep();
        run = await readRun(storage);
        expect(run.steps.left.attempt).toBe(1);
        expect(sandbox.runs).toHaveLength(2);

        sandbox.runs[0].reject(new Error('attempt 0 failed late'));
        await settle();
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(run.steps.left.attempt).toBe(1);
        expect(run.status).toBe('waiting-step');

        sandbox.runs[1].resolve({ result: 'done', reads: [], writes: [] });
        await settle();
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(run.status).toBe('done');
    });
});

describe('a run\'s first step starts once', () => {
    it('a watchdog pass that finds the run between its first save and its first tick does not start its steps a second time', async () => {
        let sweeping: Promise<void> | undefined;
        const storage = memStorage(async rec => {
            if (sweeping || rec.key !== 'workflows.active') return;
            // The watchdog's minute comes round the moment the run is listed as in flight. It gets
            // as far as it can in 50 ms, and the start goes on after that.
            sweeping = engine.sweep();
            await Promise.race([sweeping, new Promise(resolve => { setTimeout(resolve, 50); })]);
        });
        const engine = engineFor(storage);
        await put(storage, OWNER, `workflows.def.${WF}`, defOf([ai('left')], 0.05));

        const started = await engine.startRun(OWNER, 'alice', WF, { mode: 'full-live', caller: { roles: ['owner'], scopes: [] } });
        await sweeping;
        expect('runId' in started && !started.skipped).toBe(true);
        const run = await readRun(storage, `workflows.run.${WF}.${(started as { runId: string }).runId}`);
        expect(run.steps.left.state).toBe('dispatched');
        expect(model.calls).toHaveLength(1);
        expect(reservedUsd(run)).toBeCloseTo(0.05, 10);
        expect(spentUsd(run)).toBe(0);
    });
});

describe('a finished agent task decides only the agent step whose current attempt it was dispatched for', () => {
    it('a task named after an ai step decides nothing: the step waits for its own model call', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), {
            left: stepAt('dispatched', { holds: 0.02, estimate: 0.02, startedMsAgo: 10_000 }),
        });
        const engine = engineFor(storage);

        // A task made with the ai step's scope ends while the step's model call is still open.
        await engine.onTaskTerminal(taskFor('t-made', 'left'), 'done');
        const run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(run.steps.left.attempt).toBe(0);
        expect(model.calls).toHaveLength(0);
        expect(reservedUsd(run)).toBeCloseTo(0.02, 10);
    });

    it('a task of an earlier attempt decides nothing, also when the task of the attempt that runs now is gone', async () => {
        const storage = memStorage();
        await seed(storage, defOf([agentStep('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), {
            left: { ...stepAt('dispatched', { startedMsAgo: 10_000 }), attempt: 1, taskIds: ['t-now'] },
        });
        const engine = engineFor(storage);

        // The task of attempt 0 ends late. The task of attempt 1, t-now, was deleted.
        await engine.onTaskTerminal(taskFor('t-before', 'left'), 'done');
        const run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');
        expect(run.steps.left.attempt).toBe(1);
        expect(run.steps.left.taskIds).toEqual(['t-now']);
        expect(run.status).toBe('waiting-step');
    });

    it('a task made with the step\'s scope decides nothing, and the step\'s own task still decides it', async () => {
        const storage = memStorage();
        await seed(storage, defOf([agentStep('left')], 0.05), {
            left: { ...stepAt('dispatched', { startedMsAgo: 10_000 }), taskIds: ['t-own'] },
        });
        taskFor('t-own', 'left', 'active');
        const engine = engineFor(storage);

        await engine.onTaskTerminal(taskFor('t-made', 'left'), 'done');
        let run = await readRun(storage);
        expect(run.steps.left.state).toBe('dispatched');

        // The agent writes the output and finishes the step's own task.
        await put(storage, OWNER, 'out.left', 'written by the agent');
        await engine.onTaskTerminal(taskFor('t-own', 'left', 'done'), 'done');
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(run.status).toBe('done');
    });

    it('after a restart, the step\'s own task that ended while the node was down decides the step', async () => {
        const storage = memStorage();
        await seed(storage, defOf([agentStep('left')], 0.05), {
            left: { ...stepAt('dispatched', { startedMsAgo: 10_000 }), taskIds: ['t-own'] },
        });
        taskFor('t-own', 'left', 'done');
        await put(storage, OWNER, 'out.left', 'written by the agent');

        await engineFor(storage).resumeInflight();
        const run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(run.status).toBe('done');
    });
});

/**
 * Attempt 0 of `stepId` starts at a watchdog pass and stalls past its minute. The next pass gives the
 * step its retry, and attempt 1 starts while the work of attempt 0 is still open.
 */
async function retryBesideFirst(storage: Storage, engine: WorkflowEngine, stepId: string): Promise<WorkflowRun> {
    await engine.sweep();
    const run = await readRun(storage);
    expect(run.steps[stepId].state).toBe('dispatched');
    run.steps[stepId].startedAt = new Date(Date.now() - 120_000).toISOString();
    await put(storage, OWNER, RUN_KEY, run);
    await engine.sweep();
    return readRun(storage);
}

describe('an answer that comes after its step ended writes nothing', () => {
    it('an ai step: the answer of attempt 0 turns the step green, and the answer of attempt 1 only settles its cost and hold', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), { left: stepAt('pending', { estimate: 0.02 }) });
        const engine = engineFor(storage);
        let run = await retryBesideFirst(storage, engine, 'left');
        expect(run.steps.left.attempt).toBe(1);
        expect(model.calls).toHaveLength(2);

        await answer(0, 0.01, 'the answer of attempt 0');
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(await valueAt(storage, 'out.left')).toBe('the answer of attempt 0');

        await answer(1, 0.02, 'the answer of attempt 1');
        run = await readRun(storage);
        expect(run.steps.left.state).toBe('green');
        expect(await valueAt(storage, 'out.left')).toBe('the answer of attempt 0');
        expect(reservedUsd(run)).toBe(0);
        expect(spentUsd(run)).toBeCloseTo(0.03, 10);
    });

    it('an extension step: the result of attempt 1, after attempt 0 turned the step green, is not written', async () => {
        const storage = memStorage();
        await seed(storage, defOf([extension('left', { retry: { max: 1, backoff_min: 0 } })], 0.05), { left: stepAt('pending') });
        const engine = engineFor(storage);
        const run = await retryBesideFirst(storage, engine, 'left');
        expect(run.steps.left.attempt).toBe(1);
        expect(sandbox.runs).toHaveLength(2);

        sandbox.runs[0].resolve({ result: 'the result of attempt 0', reads: [], writes: [] });
        await settle();
        expect((await readRun(storage)).steps.left.state).toBe('green');
        expect(await valueAt(storage, 'out.left')).toBe('the result of attempt 0');

        sandbox.runs[1].resolve({ result: 'the result of attempt 1', reads: [], writes: [] });
        await settle();
        expect((await readRun(storage)).steps.left.state).toBe('green');
        expect(await valueAt(storage, 'out.left')).toBe('the result of attempt 0');
    });

    it('a datapackage step: attempt 0 publishes and the step is green, and attempt 1 publishes no second version', async () => {
        const storage = memStorage();
        await seed(storage, defOf([datapackage('pkg', { retry: { max: 1, backoff_min: 0 } })], 0.05), { pkg: stepAt('pending') });
        await put(storage, OWNER, 'in.rows', [{ n: 1 }]);
        // Each attempt reads its source, and waits there until the case lets the read through.
        held.key = 'in.rows';
        const engine = engineFor(storage);
        let run = await retryBesideFirst(storage, engine, 'pkg');
        expect(run.steps.pkg.attempt).toBe(1);
        expect(held.reads).toHaveLength(2);

        held.reads[0]();
        await settle();
        run = await readRun(storage);
        expect(run.steps.pkg.state).toBe('green');
        expect(packages.published).toEqual(['rows']);

        held.reads[1]();
        await settle();
        expect((await readRun(storage)).steps.pkg.state).toBe('green');
        expect(packages.published).toEqual(['rows']);
    });

    it('a cancelled run: the answer of the model call open at the cancel is not written, and its cost is kept', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left')], 0.05), { left: stepAt('pending', { estimate: 0.02 }) });
        const engine = engineFor(storage);
        await engine.sweep();
        expect(model.calls).toHaveLength(1);

        expect(await engine.cancelRun(OWNER, WF, RUN)).toBe(true);
        await answer(0, 0.01, 'an answer after the cancel');
        const run = await readRun(storage);
        expect(run.status).toBe('cancelled');
        expect(await valueAt(storage, 'out.left')).toBeUndefined();
        expect(run.steps.left.costUsd).toBeCloseTo(0.01, 10);
        expect(reservedUsd(run)).toBe(0);
    });
});

describe('an error inside the engine while it takes an answer in is the engine\'s, not a failure of the attempt', () => {
    it('the engine\'s own save fails once as it takes a model call\'s answer in: the attempt stays, and the watchdog decides the step by its output', async () => {
        const storage = memStorage();
        await seed(storage, defOf([ai('left')], 0.05), { left: stepAt('pending', { estimate: 0.02 }) });
        const engine = engineFor(storage);
        await engine.sweep();
        expect(model.calls).toHaveLength(1);

        const errors = vi.spyOn(logger, 'error').mockImplementation(() => logger);
        try {
            faults.runWritesToFail = 1;
            await answer(0, 0.01, 'the answer');
            let run = await readRun(storage);
            expect(run.steps.left.state).toBe('dispatched');
            expect(run.steps.left.attempt).toBe(0);
            expect(errors).toHaveBeenCalledWith(expect.stringContaining('the engine failed'), expect.anything());

            // The next watchdog pass finds the step's output and turns the step green.
            await engine.sweep();
            run = await readRun(storage);
            expect(run.steps.left.state).toBe('green');
            expect(run.status).toBe('done');
        } finally {
            errors.mockRestore();
        }
    });
});
