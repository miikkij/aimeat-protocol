/**
 * @file test/unit/workflow-ai-step-input-keys.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which record an `ai` step's `input_keys` actually reads, in a sandbox run and in a
 *   live one.
 *
 *   WHY THIS EXISTS. `result_to_key` has always been written behind `run.keyPrefix`, which is
 *   `wf-test.<runId>.` in a sandbox run and empty otherwise, and the datapackage step's `from_key`
 *   has always read behind it. `input_keys` did neither: it read the bare key. Two fields with the
 *   same job disagreed, so a sandbox run of the one shape this step exists for — several steps
 *   answering in parallel and one assembling their answers — wrote prefixed keys and then read the
 *   LIVE ones. The producing steps still went green, because signal evaluation has been
 *   prefix-aware since it was written, and the assembling step answered from the previous live run's
 *   data with nothing to say it had.
 *
 *   So the assertion is not "it found a record". Both keys are populated here, with different
 *   values, and the question asked is WHICH ONE reached the prompt. A test that seeded only the
 *   prefixed key would pass against the defect the day the live key happened to be empty.
 * @usage pnpm test -- workflow-ai-step-input-keys
 * @version-history
 *   v1.0.0 — 2026-08-30 — Written for the keyPrefix fix in engine-ai-step.ts v1.2.0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowRun, WorkflowStep } from '../../src/models/workflow-schemas.js';

/** The prompt the step handed to the model, captured instead of a provider call. */
const captured = vi.hoisted(() => ({ prompt: '' }));

vi.mock('../../src/services/ai-completion.js', () => ({
    completeForOwner: async (_s: unknown, _c: unknown, _g: string, opts: { prompt: string }) => {
        captured.prompt = opts.prompt;
        return { content: 'assembled' };
    },
}));

const { dispatchAiStep } = await import('../../src/services/workflow/engine-ai-step.js');

const NODE_ID = 'aimeat-test-001';
const OWNER = 'alice';
const OWNER_GHII = `${OWNER}@${NODE_ID}`;
const RUN_ID = 'run-1';
const BARE_KEY = 'probability.perspectives.a';
const SANDBOX_KEY = `wf-test.${RUN_ID}.${BARE_KEY}`;

const LIVE_VALUE = 'THE-LIVE-ANSWER-FROM-AN-EARLIER-RUN';
const SANDBOX_VALUE = 'THE-ANSWER-THIS-RUN-JUST-WROTE';

/**
 * Storage holding BOTH keys, so the test can tell the two readings apart. Only the calls
 * getOwnerScopeMemory and the result write make are implemented; anything else is a mistake in the
 * test rather than a shape the step is allowed to depend on.
 */
function storageWithBothKeys(): { storage: unknown; writes: Array<{ key: string; value: unknown }> } {
    const records = new Map<string, { key: string; value: unknown; version: number; createdAt: string }>([
        [BARE_KEY, { key: BARE_KEY, value: LIVE_VALUE, version: 1, createdAt: '2026-08-01T00:00:00.000Z' }],
        [SANDBOX_KEY, { key: SANDBOX_KEY, value: SANDBOX_VALUE, version: 1, createdAt: '2026-08-30T00:00:00.000Z' }],
    ]);
    const writes: Array<{ key: string; value: unknown }> = [];
    const storage = {
        getMemory: async (ghii: string, key: string) => (ghii === OWNER_GHII ? records.get(key) ?? null : null),
        getAgentsByOwner: async () => [],
        getEcosystemAppsByOwner: async () => [],
        listMemoryForOwners: async () => [],
        setMemory: async (rec: { key: string; value: unknown }) => { writes.push({ key: rec.key, value: rec.value }); },
    };
    return { storage, writes };
}

function runWith(keyPrefix: string): WorkflowRun {
    return {
        runId: RUN_ID, workflowId: 'probability', vars: {}, keyPrefix,
        mode: keyPrefix ? 'full-sandbox' : 'full-live', status: 'running', steps: {},
        startedAt: '2026-08-30T00:00:00.000Z',
    } as unknown as WorkflowRun;
}

const STEP = { id: 'assemble', description: { en_US: 'Assemble' } } as unknown as WorkflowStep;

const ACTION = {
    kind: 'ai' as const,
    prompt: 'Combine the perspectives.',
    input_keys: [BARE_KEY],
    result_to_key: 'probability.result',
};

/** Fire the step and wait for the engine callback it finishes through. */
async function runStep(keyPrefix: string): Promise<{ ok: boolean; writes: Array<{ key: string; value: unknown }> }> {
    const { storage, writes } = storageWithBothKeys();
    const deps = { storage, config: { nodeId: NODE_ID } } as never;
    const done = new Promise<boolean>(resolve => {
        dispatchAiStep(deps, OWNER_GHII, runWith(keyPrefix), STEP, ACTION as never,
            (_o, _w, _r, _s, ok) => resolve(ok));
    });
    return { ok: await done, writes };
}

describe('an ai step reads input_keys from the same keyspace it writes into', () => {
    beforeEach(() => { captured.prompt = ''; });

    it('a SANDBOX run reads the record this run wrote, not the live one of the same name', async () => {
        const { ok, writes } = await runStep(`wf-test.${RUN_ID}.`);

        expect(ok).toBe(true);
        // The whole point: both records exist, and the prefixed one is the one that reached the model.
        expect(captured.prompt).toContain(SANDBOX_VALUE);
        expect(captured.prompt).not.toContain(LIVE_VALUE);
        // And the read is symmetric with the write, which is what made the mismatch invisible.
        expect(writes.map(w => w.key)).toEqual([`wf-test.${RUN_ID}.probability.result`]);
    });

    it('a LIVE run reads the live record', async () => {
        const { ok, writes } = await runStep('');

        expect(ok).toBe(true);
        expect(captured.prompt).toContain(LIVE_VALUE);
        expect(captured.prompt).not.toContain(SANDBOX_VALUE);
        expect(writes.map(w => w.key)).toEqual(['probability.result']);
    });

    it('names a missing record out loud rather than leaving a silence to fill', async () => {
        const { storage } = storageWithBothKeys();
        const deps = { storage, config: { nodeId: NODE_ID } } as never;
        const action = { ...ACTION, input_keys: ['probability.perspectives.nothing-here'] };
        const ok = await new Promise<boolean>(resolve => {
            dispatchAiStep(deps, OWNER_GHII, runWith(''), STEP, action as never,
                (_o, _w, _r, _s, done) => resolve(done));
        });

        expect(ok).toBe(true);
        expect(captured.prompt).toContain('no such record');
    });
});
