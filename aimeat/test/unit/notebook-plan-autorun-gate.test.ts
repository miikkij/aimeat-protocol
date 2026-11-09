/**
 * @file test/unit/notebook-plan-autorun-gate.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The notebook's plan run loop (public/js/services/notebook-plan.js runPlanSteps): the
 *   automatic run ("Run plan automatically") starts only the steps whose gate is false and stops
 *   before the first step that asks first, so a step that goes to an agent waits for the person's
 *   press; a press on Run all steps still runs every step, and a skip pressed during the run is honoured.
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial: the automatic run read no gate, so an agent step started unasked.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

// The module's network helpers are not used by the loop; stub them so it loads without a browser.
vi.mock('/js/api.js', () => ({ api: vi.fn() }));
vi.mock('/js/services/memory.js', () => ({ librarianSearch: vi.fn() }));
vi.mock('/js/services/offers.js', () => ({ listOffers: vi.fn(), ask: vi.fn(), rankOffersByNeed: vi.fn(), getDeliverableContent: vi.fn() }));
vi.mock('/js/services/agent-tasks.js', () => ({ getTask: vi.fn() }));
vi.mock('/js/swallowed.js', () => ({ swallowed: vi.fn() }));

const { runPlanSteps, stepAsksFirst } = await import('../../public/js/services/notebook-plan.js');

const plan = [
    { id: 's1', kind: 'llm_reason', gate: false },
    { id: 's2', kind: 'librarian_assess', gate: false },
    { id: 's3', kind: 'delegate', gate: true, agent: 'researcher' },
    { id: 's4', kind: 'llm_reason', gate: false },
];

function recorder() {
    const ran: string[] = [];
    return { ran, execute: async (step: { id: string }) => { ran.push(step.id); } };
}

describe('notebook plan: the automatic run asks before a gated step', () => {
    it('the automatic run stops before a step whose gate is true and does not start it', async () => {
        const { ran, execute } = recorder();
        const waiting = await runPlanSteps(plan, { stopAtGate: true, isHandled: () => false, execute });
        expect(ran).toEqual(['s1', 's2']);
        expect(waiting?.id).toBe('s3');
    });

    it('after the person runs the gated step, the automatic run goes on to the steps without a gate', async () => {
        const { ran, execute } = recorder();
        const handled = new Set(['s1', 's2', 's3']);
        const waiting = await runPlanSteps(plan, { stopAtGate: true, isHandled: (s: { id: string }) => handled.has(s.id), execute });
        expect(ran).toEqual(['s4']);
        expect(waiting).toBeNull();
    });

    it('a step with no gate field asks first, the planner default', async () => {
        expect(stepAsksFirst({ id: 'x' })).toBe(true);
        expect(stepAsksFirst({ id: 'x', gate: true })).toBe(true);
        expect(stepAsksFirst({ id: 'x', gate: false })).toBe(false);
        const { ran, execute } = recorder();
        const waiting = await runPlanSteps([{ id: 'x' }], { stopAtGate: true, isHandled: () => false, execute });
        expect(ran).toEqual([]);
        expect(waiting?.id).toBe('x');
    });

    it('Run all steps, a press by the person, still runs every step including a gated one', async () => {
        const { ran, execute } = recorder();
        const waiting = await runPlanSteps(plan, { isHandled: () => false, execute });
        expect(ran).toEqual(['s1', 's2', 's3', 's4']);
        expect(waiting).toBeNull();
    });

    it('a skip pressed during the run is read before each step', async () => {
        const skipped = new Set<string>();
        const ran: string[] = [];
        const execute = async (step: { id: string }) => { ran.push(step.id); if (step.id === 's1') skipped.add('s2'); };
        await runPlanSteps(plan, { isHandled: (s: { id: string }) => skipped.has(s.id), execute });
        expect(ran).toEqual(['s1', 's3', 's4']);
    });

    it('the card runs its automatic run through this loop with stopAtGate on', () => {
        const card = readFileSync(new URL('../../public/views/profile/notebook-card.js', import.meta.url), 'utf8');
        // runStepsBatch delegates to runPlanSteps and forwards stopAtGate.
        expect(card).toMatch(/runPlanSteps\(steps, \{\s*stopAtGate,/);
        // The run started by "Run plan automatically" passes stopAtGate = true.
        const auto = card.match(/if \(settings\?\.autoRunPlan && plan\.steps\.length\) \{[\s\S]*?\n {6}\}/)?.[0] || '';
        expect(auto).toMatch(/runStepsBatch\([^;]*, true\);/);
    });

    it('a failing step stops the run and the error reaches the caller', async () => {
        const ran: string[] = [];
        const execute = async (step: { id: string }) => { ran.push(step.id); if (step.id === 's1') throw new Error('TIMEOUT'); };
        await expect(runPlanSteps(plan, { stopAtGate: true, isHandled: () => false, execute })).rejects.toThrow('TIMEOUT');
        expect(ran).toEqual(['s1']);
    });
});
