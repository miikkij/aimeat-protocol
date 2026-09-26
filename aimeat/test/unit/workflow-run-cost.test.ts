/**
 * @file test/unit/workflow-run-cost.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-run cap on what a workflow's ai steps spend (services/workflow/run-cost.ts):
 *   what counts as spent, when the run stops, and what it says when it does. The whole road, with the
 *   cost coming from a provider, is test/e2e-workflows.ts.
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { spentUsd, stopAtCostCap, spendsAi, usd } from '../../src/services/workflow/run-cost.js';
import type { WorkflowRun, WorkflowRunStep } from '../../src/models/workflow-schemas.js';

const step = (state: WorkflowRunStep['state'], costUsd?: number): WorkflowRunStep =>
    ({ state, attempt: 0, reads: [], writes: [], ...(costUsd !== undefined ? { costUsd } : {}) });

function run(cap: number | null | undefined, steps: Record<string, WorkflowRunStep>): WorkflowRun {
    return {
        runId: 'r1', workflowId: 'wf', resolved: [], vars: {}, mode: 'full-live', status: 'running',
        startedAt: '2026-09-25T00:00:00.000Z', steps,
        defSnapshot: {
            id: 'wf', title: 'wf', description: 'd', trigger: { kind: 'manual' }, vars: [], steps: [],
            on_step_fail: 'inspect', createdBy: 'o@n', createdAt: 't', updatedAt: 't',
            ...(cap !== undefined ? { maxCostUsd: cap } : {}),
        },
    };
}

const NOW = '2026-09-25T01:00:00.000Z';

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
});

describe('the cap', () => {
    it('stops nothing when the workflow sets none', () => {
        for (const cap of [undefined, null]) {
            const r = run(cap, { a: step('green', 5), b: step('pending') });
            expect(stopAtCostCap(r, 'b', NOW)).toBe(false);
            expect(r.status).toBe('running');
        }
    });

    it('stops nothing while the spend is under it', () => {
        const r = run(0.05, { a: step('green', 0.02), b: step('pending') });
        expect(stopAtCostCap(r, 'b', NOW)).toBe(false);
        expect(r.steps.b.state).toBe('pending');
    });

    it('stops the run once the spend has reached it, and says which cap, how much and before which step', () => {
        const r = run(0.01, { a: step('green', 0.02), b: step('pending'), c: step('dispatched'), d: step('waiting-human') });
        expect(stopAtCostCap(r, 'b', NOW)).toBe(true);
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
        expect(stopAtCostCap(run(0.02, { a: step('green', 0.02), b: step('pending') }), 'b', NOW)).toBe(true);
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
