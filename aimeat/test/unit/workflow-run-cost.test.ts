/**
 * @file test/unit/workflow-run-cost.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-run cap on what a workflow's ai steps spend (services/workflow/run-cost.ts):
 *   what counts as spent, what a running ai step holds, when a step starts, waits or stops the run,
 *   and what the run says when it stops. The whole road, with the cost coming from a provider, is
 *   test/e2e-workflows.ts.
 * @version-history
 *   v1.5.0 — 2026-09-26 — A call of an ai, extension or datapackage step is marked open for its
 *     attempt; a mark that holds nothing gives no room back, so the run does not wait for it
 *     (secaudit 2026-09, R4).
 *   v1.4.0 — 2026-09-26 — The estimate is what one attempt cost, and a step expected to cost more than
 *     the whole cap starts once, alone, while the run has spent less than the cap (A6-11).
 *   v1.3.0 — 2026-09-26 — A hold belongs to the model call (A6-11): it counts while the call is open,
 *     whatever became of the step, a retry's call holds its own, and it goes when the call answers or
 *     at a restart.
 *   v1.2.0 — 2026-09-26 — What an ai step holds while it runs (A6-11): its estimate from the
 *     workflow's recent runs, else an equal share of the cap nobody holds; start, wait and stop, in
 *     any order of the ready steps, and the hold dropped once the step no longer runs. The stop cases
 *     go through one pass as the engine makes it (admitAiStep, then stopWhenNoRoomComes).
 *   v1.1.0 — 2026-09-26 — What the node's model costs judging a run's llm signals counts toward the
 *     cap (A6-11). Failed on the code before the fix: the two functions did not exist.
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
    spentUsd, spendsAi, usd, recordSignalCost, costCapReached, capUsd, reservedUsd, admitAiStep,
    stopWhenNoRoomComes, pinCostEstimates, aiCallAnswered, aiCallOpen, clearOpenCalls, COST_HISTORY_RUNS,
    markCallOpen, currentCallOpen,
} from '../../src/services/workflow/run-cost.js';
import type { WorkflowRun, WorkflowRunStep, WorkflowStep } from '../../src/models/workflow-schemas.js';

const step = (state: WorkflowRunStep['state'], costUsd?: number, extra: Partial<WorkflowRunStep> = {}): WorkflowRunStep =>
    ({ state, attempt: 0, reads: [], writes: [], ...(costUsd !== undefined ? { costUsd } : {}), ...extra });

/** The step's call of attempt 0 is open and holds `usd` of the cap. */
const holding = (usd: number): Partial<WorkflowRunStep> => ({ openCalls: [{ attempt: 0, reservedUsd: usd }] });

/** What the step's open calls hold together. */
const holdOf = (rs: WorkflowRunStep): number => (rs.openCalls ?? []).reduce((sum, c) => sum + (c.reservedUsd ?? 0), 0);

/** An ai step of the definition. */
const ai = (id: string, prompt = `Say ${id}.`): WorkflowStep =>
    ({ id, description: id, required_to_function: 'none', action: { kind: 'ai', prompt, result_to_key: `out.${id}` } } as unknown as WorkflowStep);

function run(cap: number | null | undefined, steps: Record<string, WorkflowRunStep>, defSteps: WorkflowStep[] = []): WorkflowRun {
    return {
        runId: 'r1', workflowId: 'wf', resolved: [], vars: {}, mode: 'full-live', status: 'running',
        startedAt: '2026-09-25T00:00:00.000Z', steps,
        defSnapshot: {
            id: 'wf', title: 'wf', description: 'd', trigger: { kind: 'manual' }, vars: [], steps: defSteps,
            on_step_fail: 'inspect', createdBy: 'o@n', createdAt: 't', updatedAt: 't',
            ...(cap !== undefined ? { maxCostUsd: cap } : {}),
        },
    };
}

const NOW = '2026-09-25T01:00:00.000Z';

/**
 * One pass of the engine over the ai steps `ids`, ready in that order: each is asked whether it may
 * start, one that may is dispatched, and after the pass the run stops if a step waits and no ai step
 * is running (engine.ts tick).
 */
function pass(r: WorkflowRun, ids: string[]): { started: string[]; waiting: string[]; stopped: boolean } {
    const started: string[] = [];
    const waiting: string[] = [];
    for (const id of ids) {
        if (admitAiStep(r, id) === 'start') { r.steps[id].state = 'dispatched'; started.push(id); } else waiting.push(id);
    }
    return { started, waiting, stopped: stopWhenNoRoomComes(r, waiting, NOW) };
}

describe('what a run has spent', () => {
    it('is the sum of what its steps recorded, and nothing that is not an amount', () => {
        expect(spentUsd({ steps: { a: step('green', 0.02), b: step('green', 0.005), c: step('pending') } })).toBeCloseTo(0.025, 10);
        expect(spentUsd({ steps: { a: step('green', Number.NaN), b: step('green', -1), c: step('green', Number.POSITIVE_INFINITY) } })).toBe(0);
    });

    it('comes from an ai step, which is the step that calls the owner\'s model', () => {
        expect(spendsAi({ action: { kind: 'ai' } as never })).toBe(true);
        expect(spendsAi({})).toBe(false);
        expect(spendsAi({ action: { kind: 'extension' } as never })).toBe(false);
    });

    it('is not what an open call holds', () => {
        const steps = { a: step('dispatched', undefined, holding(0.02)), b: step('green', 0.01) };
        expect(spentUsd({ steps })).toBeCloseTo(0.01, 10);
        expect(reservedUsd({ steps })).toBeCloseTo(0.02, 10);
    });
});

describe('the cap', () => {
    it('is a positive amount or none', () => {
        expect(capUsd({ maxCostUsd: 0.03 })).toBe(0.03);
        for (const none of [undefined, null, 0, -1, Number.NaN]) expect(capUsd({ maxCostUsd: none as never })).toBeNull();
    });

    it('stops nothing and holds nothing when the workflow sets none', () => {
        for (const cap of [undefined, null]) {
            const r = run(cap, { a: step('green', 5), b: step('pending') }, [ai('a'), ai('b')]);
            expect(admitAiStep(r, 'b')).toBe('start');
            expect(stopWhenNoRoomComes(r, ['b'], NOW)).toBe(false);
            expect(r.status).toBe('running');
            expect(r.steps.b.openCalls).toBeUndefined();
        }
    });

    it('stops the run once the spend has reached it, and says which cap, how much and before which step', () => {
        const r = run(0.01, { a: step('green', 0.02), b: step('pending'), c: step('dispatched'), d: step('waiting-human') }, [ai('a'), ai('b')]);
        expect(pass(r, ['b'])).toEqual({ started: [], waiting: ['b'], stopped: true });
        expect(r.status).toBe('stopped');
        expect(r.endedAt).toBe(NOW);
        expect(r.costCap).toEqual({ capUsd: 0.01, spentUsd: 0.02, stoppedBefore: 'b' });
        expect(r.reason).toContain('$0.01');
        expect(r.reason).toContain('$0.02');
        expect(r.reason).toContain('"b"');
        // What finished keeps its state; what had not finished is skipped, as a cancel skips it.
        expect(r.steps.a.state).toBe('green');
        expect(['b', 'c', 'd'].map(id => r.steps[id].state)).toEqual(['skipped', 'skipped', 'skipped']);
    });

    it('counts reaching it exactly as reaching it', () => {
        expect(pass(run(0.02, { a: step('green', 0.02), b: step('pending') }, [ai('a'), ai('b')]), ['b']).stopped).toBe(true);
    });

    // A6-11. The node's model judging an `llm` signal spends the owner's AI too.
    it('counts what the node\'s model cost judging the run\'s llm signals', () => {
        const r = run(0.03, { a: step('green', 0.02), b: step('pending') }, [ai('a'), ai('b')]);
        recordSignalCost(r, 0.02);
        expect(spentUsd(r)).toBeCloseTo(0.04, 10);
        expect(pass(r, ['b']).stopped).toBe(true);
        expect(r.costCap).toEqual({ capUsd: 0.03, spentUsd: 0.04, stoppedBefore: 'b' });
    });

    it('keeps only an amount as the judge\'s cost, and adds each call to the last', () => {
        const r = run(1, { a: step('green') });
        for (const bad of [Number.NaN, -1, 0, Number.POSITIVE_INFINITY]) recordSignalCost(r, bad);
        expect(r.signalCostUsd).toBeUndefined();
        recordSignalCost(r, 0.01);
        recordSignalCost(r, 0.005);
        expect(r.signalCostUsd).toBeCloseTo(0.015, 10);
    });

    it('says when the run has spent it, so the judge is not asked past it; what open calls hold is not spent', () => {
        expect(costCapReached(run(undefined, { a: step('green', 5) }))).toBe(false);
        expect(costCapReached(run(0.05, { a: step('green', 0.02) }))).toBe(false);
        const r = run(0.03, { a: step('green', 0.02) });
        recordSignalCost(r, 0.01);
        expect(costCapReached(r)).toBe(true);
        // The judge keeps counting as it did: a call that holds the rest of the cap has spent none of it.
        expect(costCapReached(run(0.03, { a: step('green', 0.02), b: step('dispatched', undefined, holding(0.02)) }))).toBe(false);
    });
});

describe('what an ai step holds while it runs', () => {
    it('with no history, is an equal share of the cap nobody holds, across the ai steps not started', () => {
        const r = run(0.06, { a: step('pending'), b: step('pending'), c: step('pending') }, [ai('a'), ai('b'), ai('c')]);
        expect(admitAiStep(r, 'a')).toBe('start');
        expect(holdOf(r.steps.a)).toBeCloseTo(0.02, 10);
        r.steps.a.state = 'dispatched';
        // b and c share what a does not hold.
        expect(admitAiStep(r, 'b')).toBe('start');
        expect(holdOf(r.steps.b)).toBeCloseTo(0.02, 10);
    });

    it('with history, is the step\'s own estimate, held by the call of the attempt it starts', () => {
        const r = run(0.05, { a: step('pending', undefined, { estimateUsd: 0.03, attempt: 1 }) }, [ai('a')]);
        expect(admitAiStep(r, 'a')).toBe('start');
        expect(r.steps.a.openCalls).toEqual([{ attempt: 1, reservedUsd: 0.03 }]);
    });

    it('lets two steps start together when both estimates fit', () => {
        const r = run(0.05, { a: step('pending', undefined, { estimateUsd: 0.02 }), b: step('pending', undefined, { estimateUsd: 0.02 }) }, [ai('a'), ai('b')]);
        expect(pass(r, ['a', 'b'])).toEqual({ started: ['a', 'b'], waiting: [], stopped: false });
        expect(reservedUsd(r)).toBeCloseTo(0.04, 10);
    });

    it('keeps the second of two steps waiting while the first runs, when both estimates together pass the cap', () => {
        const r = run(0.03, { a: step('pending', undefined, { estimateUsd: 0.02 }), b: step('pending', undefined, { estimateUsd: 0.02 }) }, [ai('a'), ai('b')]);
        expect(pass(r, ['a', 'b'])).toEqual({ started: ['a'], waiting: ['b'], stopped: false });
        expect(r.steps.b.state).toBe('pending');
        expect(r.steps.b.openCalls).toBeUndefined();
        expect(r.status).toBe('running');
    });

    it('starts the waiting step once the first one\'s call answers with a real cost that leaves room', () => {
        const r = run(0.035, { a: step('dispatched', undefined, { estimateUsd: 0.02, ...holding(0.02) }), b: step('pending', undefined, { estimateUsd: 0.02 }) }, [ai('a'), ai('b')]);
        expect(pass(r, ['b'])).toEqual({ started: [], waiting: ['b'], stopped: false });
        aiCallAnswered(r.steps.a, 0, 0.01);
        r.steps.a.state = 'green';
        expect(pass(r, ['b'])).toEqual({ started: ['b'], waiting: [], stopped: false });
        expect(holdOf(r.steps.b)).toBe(0.02);
    });

    it('stops the run when the estimate does not fit and no ai step is running, and names the estimate', () => {
        const r = run(0.03, { a: step('green', 0.02, { estimateUsd: 0.02 }), b: step('pending', undefined, { estimateUsd: 0.02 }) }, [ai('a'), ai('b')]);
        expect(pass(r, ['b'])).toEqual({ started: [], waiting: ['b'], stopped: true });
        expect(r.status).toBe('stopped');
        expect(r.costCap).toEqual({ capUsd: 0.03, spentUsd: 0.02, stoppedBefore: 'b', neededUsd: 0.02 });
        expect(r.reason).toContain('expected to cost $0.02');
        expect(r.reason).toContain('$0.03');
        expect(r.steps.b.state).toBe('skipped');
    });

    it('starts a step that fits even when one before it does not, and stops before the first that never fits', () => {
        const r = run(0.05, {
            c: step('dispatched', undefined, holding(0.02)),
            a: step('pending', undefined, { estimateUsd: 0.04 }), b: step('pending', undefined, { estimateUsd: 0.01 }),
        }, [ai('c'), ai('a'), ai('b')]);
        expect(pass(r, ['a', 'b'])).toEqual({ started: ['b'], waiting: ['a'], stopped: false });
        for (const [id, cost] of [['c', 0.02], ['b', 0.01]] as const) {
            aiCallAnswered(r.steps[id], 0, cost);
            r.steps[id].state = 'green';
        }
        expect(pass(r, ['a'])).toEqual({ started: [], waiting: ['a'], stopped: true });
        expect(r.costCap).toEqual({ capUsd: 0.05, spentUsd: 0.03, stoppedBefore: 'a', neededUsd: 0.04 });
    });

    it('starts a step expected to cost more than the whole cap once, alone, and starts nothing beside it', () => {
        const r = run(0.03, { a: step('pending', undefined, { estimateUsd: 0.05 }), b: step('pending', undefined, { estimateUsd: 0.01 }) }, [ai('a'), ai('b')]);
        expect(pass(r, ['a', 'b'])).toEqual({ started: ['a'], waiting: ['b'], stopped: false });
        expect(reservedUsd(r)).toBeCloseTo(0.05, 10);
        // What it really cost counts as usual: past the cap, the run stops before the next ai step.
        aiCallAnswered(r.steps.a, 0, 0.04);
        r.steps.a.state = 'green';
        expect(pass(r, ['b'])).toEqual({ started: [], waiting: ['b'], stopped: true });
        expect(r.costCap).toEqual({ capUsd: 0.03, spentUsd: 0.04, stoppedBefore: 'b' });
    });

    it('lets a step expected to cost more than the cap wait while a call is open, and starts it once no call is', () => {
        const r = run(0.03, { b: step('dispatched', undefined, holding(0.01)), a: step('pending', undefined, { estimateUsd: 0.05 }) }, [ai('b'), ai('a')]);
        expect(pass(r, ['a'])).toEqual({ started: [], waiting: ['a'], stopped: false });
        aiCallAnswered(r.steps.b, 0, 0.01);
        r.steps.b.state = 'green';
        expect(pass(r, ['a'])).toEqual({ started: ['a'], waiting: [], stopped: false });
    });

    it('does not start a step expected to cost more than the cap once the run has spent the cap', () => {
        const r = run(0.03, { b: step('green', 0.03), a: step('pending', undefined, { estimateUsd: 0.05 }) }, [ai('b'), ai('a')]);
        expect(pass(r, ['a'])).toEqual({ started: [], waiting: ['a'], stopped: true });
        expect(r.costCap).toEqual({ capUsd: 0.03, spentUsd: 0.03, stoppedBefore: 'a' });
    });

    it('names the first waiting step in the definition\'s order', () => {
        const r = run(0.01, { a: step('green', 0.02), b: step('pending'), c: step('pending') }, [ai('a'), ai('b'), ai('c')]);
        expect(stopWhenNoRoomComes(r, ['c', 'b'], NOW)).toBe(true);
        expect(r.costCap?.stoppedBefore).toBe('b');
    });

    it('waits rather than stops while a call is open, even once the spend has reached the cap', () => {
        const r = run(0.03, { a: step('green', 0.04), b: step('dispatched', undefined, holding(0.01)), c: step('pending') }, [ai('a'), ai('b'), ai('c')]);
        expect(pass(r, ['c'])).toEqual({ started: [], waiting: ['c'], stopped: false });
        expect(r.status).toBe('running');
    });

    it('does not count a step that is not an ai step as running', () => {
        const agentStep = { id: 'x', description: 'x', agent: 'bot', offer: 'o' } as unknown as WorkflowStep;
        const r = run(0.03, { a: step('green', 0.02), x: step('dispatched'), b: step('pending', undefined, { estimateUsd: 0.02 }) }, [ai('a'), agentStep, ai('b')]);
        expect(pass(r, ['b']).stopped).toBe(true);
        expect(r.steps.x.state).toBe('skipped');
    });

    it('counts while its call is open, whatever became of the step, and a retry\'s call holds its own', () => {
        const steps = {
            a: step('green', 0.01, holding(0.02)), b: step('timed-out', undefined, holding(0.02)), c: step('skipped'),
            d: step('dispatched', undefined, { attempt: 1, openCalls: [{ attempt: 0, reservedUsd: 0.02 }, { attempt: 1, reservedUsd: 0.02 }] }),
        };
        expect(reservedUsd({ steps })).toBeCloseTo(0.08, 10);
        expect(aiCallOpen({ steps })).toBe(true);
        expect(aiCallOpen({ steps: { c: step('skipped'), e: step('dispatched') } })).toBe(false);
    });

    it('goes when its call answers, and what the call cost stays on the step', () => {
        const rs = step('timed-out', undefined, { attempt: 1, openCalls: [{ attempt: 0, reservedUsd: 0.02 }, { attempt: 1, reservedUsd: 0.02 }] });
        expect(aiCallAnswered(rs, 0, 0.015)).toBe(true);
        expect(rs.openCalls).toEqual([{ attempt: 1, reservedUsd: 0.02 }]);
        expect(rs.costUsd).toBe(0.015);
        expect(rs.attemptMaxUsd).toBe(0.015);
        expect(aiCallAnswered(rs, 1, 0.01)).toBe(true);
        expect(rs.openCalls).toBeUndefined();
        expect(rs.costUsd).toBeCloseTo(0.025, 10);
        expect(rs.attemptMaxUsd).toBe(0.015);
        // Nothing to keep and nothing open: an answer of a step that is not an ai step, or a call already gone.
        expect(aiCallAnswered(rs, undefined, undefined)).toBe(false);
        expect(aiCallAnswered(rs, 1, 0)).toBe(false);
    });

    it('goes at a restart, since the calls ended with the process', () => {
        const r = run(0.05, { a: step('dispatched', undefined, holding(0.02)), b: step('green', 0.01) });
        expect(clearOpenCalls(r)).toBe(true);
        expect(reservedUsd(r)).toBe(0);
        expect(r.steps.a.state).toBe('dispatched');
        expect(clearOpenCalls(r)).toBe(false);
    });

    it('a call that holds nothing is marked open for its attempt, and it gives no room back, so the run does not wait for it', () => {
        // An extension step's call, or an ai step's call with no cap: marked, holding nothing.
        const rs = step('dispatched', undefined, { attempt: 1 });
        markCallOpen(rs);
        markCallOpen(rs);
        expect(rs.openCalls).toEqual([{ attempt: 1, reservedUsd: 0 }]);
        expect(currentCallOpen(rs)).toBe(true);
        expect(aiCallOpen({ steps: { a: rs } })).toBe(false);
        // A capped ai step's call keeps the one mark admitAiStep gave it, with its hold.
        const held = step('dispatched', undefined, holding(0.02));
        markCallOpen(held);
        expect(held.openCalls).toEqual([{ attempt: 0, reservedUsd: 0.02 }]);
        expect(aiCallOpen({ steps: { a: held } })).toBe(true);
        // The answer of the attempt takes the mark away.
        aiCallAnswered(rs, 1, undefined);
        expect(currentCallOpen(rs)).toBe(false);
    });
});

describe('the estimate from the workflow\'s recent runs', () => {
    const past = (status: WorkflowRun['status'], costs: Record<string, number>, defSteps: WorkflowStep[] = [ai('a'), ai('b')]): WorkflowRun => {
        const r = run(null, Object.fromEntries(Object.entries(costs).map(([id, c]) => [id, step('green', c)])), defSteps);
        r.status = status;
        return r;
    };
    const fresh = (): Record<string, WorkflowRunStep> => ({ a: step('pending'), b: step('pending') });
    const def = (cap: number | null = 0.05) => ({ maxCostUsd: cap, steps: [ai('a'), ai('b')] });

    it('is the most the step cost in the finished runs', () => {
        const steps = fresh();
        pinCostEstimates(def(), steps, [past('done', { a: 0.01, b: 0.03 }), past('stopped', { a: 0.02 }), past('partial', { a: 0.015, b: 0.01 })]);
        expect(steps.a.estimateUsd).toBe(0.02);
        expect(steps.b.estimateUsd).toBe(0.03);
    });

    it('is what one attempt cost, so a step that retried twice is expected to cost one attempt', () => {
        const steps = fresh();
        const kept = past('done', { a: 0.06 });
        Object.assign(kept.steps.a, { attempt: 2, attemptMaxUsd: 0.025 });
        // A run saved before a step kept its most per attempt: its cost, split over its three attempts.
        const older = past('done', { b: 0.06 });
        older.steps.b.attempt = 2;
        pinCostEstimates(def(), steps, [kept, older]);
        expect(steps.a.estimateUsd).toBe(0.025);
        expect(steps.b.estimateUsd).toBeCloseTo(0.02, 10);
    });

    it('leaves out a run still going and one that never started', () => {
        const steps = fresh();
        pinCostEstimates(def(), steps, [past('running', { a: 0.5 }), past('waiting-step', { a: 0.5 }), past('refused', { a: 0.5 }), past('done', { a: 0.01 })]);
        expect(steps.a.estimateUsd).toBe(0.01);
    });

    it(`reads only the latest ${COST_HISTORY_RUNS} finished runs, newest first`, () => {
        const steps = fresh();
        const runs = Array.from({ length: COST_HISTORY_RUNS }, () => past('done', { a: 0.01 }));
        pinCostEstimates(def(), steps, [...runs, past('done', { a: 0.9 })]);
        expect(steps.a.estimateUsd).toBe(0.01);
    });

    it('counts a run only when the step had the same action, whatever the order of its keys', () => {
        const steps = fresh();
        const reordered = { ...ai('a'), action: { result_to_key: 'out.a', prompt: 'Say a.', kind: 'ai' } } as unknown as WorkflowStep;
        pinCostEstimates(def(), steps, [past('done', { a: 0.4 }, [ai('a', 'An older prompt.'), ai('b')]), past('done', { a: 0.02 }, [reordered, ai('b')])]);
        expect(steps.a.estimateUsd).toBe(0.02);
    });

    it('gives a step with no such run no estimate, and reads nothing when the workflow has no cap', () => {
        const steps = fresh();
        pinCostEstimates(def(), steps, [past('done', { b: 0.02 })]);
        expect(steps.a.estimateUsd).toBeUndefined();
        const uncapped = fresh();
        pinCostEstimates(def(null), uncapped, [past('done', { a: 0.02, b: 0.02 })]);
        expect(uncapped.a.estimateUsd).toBeUndefined();
    });
});

describe('an amount as a person reads it', () => {
    it('shows two decimals, and more only when a cent would hide the amount', () => {
        expect(usd(0.02)).toBe('$0.02');
        expect(usd(1.5)).toBe('$1.50');
        expect(usd(0.0003)).toBe('$0.0003');
        expect(usd(0.015)).toBe('$0.015');
        expect(usd(12)).toBe('$12.00');
    });
});
