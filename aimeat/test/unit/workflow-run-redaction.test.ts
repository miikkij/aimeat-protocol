/**
 * @file test/unit/workflow-run-redaction.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A run as the run doors serve it (services/workflow/run-redaction.ts): an observation
 *   of a credential record shows what the memory doors show of that record, however deep in the
 *   signal tree it sits, and everything else is served as it was recorded.
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { shownRun } from '../../src/services/workflow/run-redaction.js';
import type { WorkflowRun } from '../../src/models/workflow-schemas.js';

const run = (outputObserved: unknown, inputObserved?: unknown) => ({
    runId: 'r1', workflowId: 'w1', status: 'done', mode: 'signals-only', startedAt: '2026-09-24T10:00:00Z',
    steps: { s: { state: 'green', attempt: 0, reads: [], writes: [], outputObserved, ...(inputObserved ? { inputObserved } : {}) } },
}) as unknown as WorkflowRun;

const seen = (r: WorkflowRun, field: 'outputObserved' | 'inputObserved' = 'outputObserved') => r.steps.s[field] as Record<string, unknown>;

describe('shownRun', () => {
    it('shows a credential record\'s field as the memory doors show the record', () => {
        const r = shownRun(run({ op: 'json_field', key: 'openrouter.apikey', path: 'encrypted', value: 'CIPHERTEXT' }));
        expect(seen(r).value).toEqual({ configured: true });
        expect(JSON.stringify(r)).not.toContain('CIPHERTEXT');
    });

    it('reaches a leaf inside all, any and when, on the input side as well', () => {
        const leaf = { op: 'json_field', key: 'decide.apikey', path: 'encrypted', value: 'SEALED' };
        const r = shownRun(run({ all: [{ any: [leaf] }, { when: leaf, then: leaf }] }, { all: [leaf] }));
        expect(JSON.stringify(r)).not.toContain('SEALED');
    });

    it('keeps what an llm leaf said only when the record holds no credential', () => {
        const r = shownRun(run({ all: [
            { op: 'llm', key: 'openrouter.apikey', reason: 'it starts with sk-or' },
            { op: 'llm', key: 'news.article', reason: 'reads well' },
        ] }));
        const [cred, plain] = (seen(r).all as Array<Record<string, unknown>>);
        expect(cred.reason).not.toContain('sk-or');
        expect(plain.reason).toBe('reads well');
    });

    it('leaves every other observation exactly as recorded', () => {
        const observed = { op: 'json_field', key: 'news.article', path: 'title', value: 'Hello' };
        const r = shownRun(run(observed));
        expect(seen(r)).toEqual(observed);
        expect(r.status).toBe('done');
    });

    it('passes a record that is not a run through untouched', () => {
        expect(shownRun(null as unknown as WorkflowRun)).toBeNull();
        const odd = { runId: 'x' } as unknown as WorkflowRun;
        expect(shownRun(odd)).toBe(odd);
    });
});
