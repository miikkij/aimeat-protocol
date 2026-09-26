/**
 * @file test/unit/workflow-run-verdict.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sentence a run's page says for a run the node stopped at its spending limit
 *   (public/views/profile/workflows/frame.js verdictOf), over the real en.json: the spend and the
 *   limit when the run had spent it, and the step's estimate beside them when the estimate is what
 *   did not fit in what was left.
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, A6-11).
 */
import { describe, it, expect, vi } from 'vitest';

// The same flatten + interpolation contract as public/js/i18n.js, over the real en.json.
vi.mock('/js/i18n.js', async () => {
    const { readFileSync } = await import('node:fs');
    const flatten = (obj: Record<string, unknown>, prefix = ''): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
            else out[key] = String(v);
        }
        return out;
    };
    const dict = flatten(JSON.parse(readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf-8')));
    const t = (key: string, vars?: Record<string, unknown>) => {
        let s = dict[key] ?? key;
        if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
        return s;
    };
    return { t, getLocale: () => 'en' };
});
vi.mock('/js/swallowed.js', () => ({ swallowed: vi.fn() }));

const { verdictOf } = await import('../../public/views/profile/workflows/frame.js');
// Amounts in the reader's own number format, which is the machine's here.
const { money } = await import('../../public/js/format.js');

const stoppedRun = (costCap: Record<string, unknown>) => ({
    status: 'stopped', startedAt: '2026-09-26T10:00:00.000Z', endedAt: '2026-09-26T10:01:00.000Z',
    defSnapshot: { steps: [{ id: 'left', description: 'Left' }, { id: 'right', description: 'Right' }] },
    steps: { left: { state: 'green' }, right: { state: 'skipped' } },
    costCap,
});

describe('a run stopped at its spending limit, in words', () => {
    it('names the spend and the limit when the run had spent it', () => {
        const v = verdictOf(stoppedRun({ capUsd: 0.01, spentUsd: 0.02, stoppedBefore: 'right' }));
        expect(v.tone).toBe('bad');
        expect(v.head).toBe(`Stopped before Right: its AI steps had spent ${money(0.02)}, and the limit is ${money(0.01)} per run`);
    });

    it('names the step\'s estimate beside them when the estimate did not fit in what was left', () => {
        const v = verdictOf(stoppedRun({ capUsd: 0.03, spentUsd: 0.02, stoppedBefore: 'right', neededUsd: 0.025 }));
        expect(v.tone).toBe('bad');
        expect(v.head).toBe(`Stopped before Right: it was expected to cost ${money(0.025)}, ${money(0.02)} was already spent, and the limit is ${money(0.03)} per run`);
    });
});
