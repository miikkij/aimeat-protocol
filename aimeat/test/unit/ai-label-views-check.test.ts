/**
 * @file test/unit/ai-label-views-check.test.ts
 * @description Assertion 8 of check:ai-disclosure (scripts/lib/check-ai-label-views.ts) refuses a
 *   view that no longer draws the AI label and a route that no longer decides it, and passes the
 *   tree as it stands.
 * @usage pnpm test -- ai-label-views-check
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (the AI label on every public page).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiLabelViewsCheck, LABEL_VIEWS, LABEL_ROUTES } from '../../scripts/lib/check-ai-label-views.js';
import { stripComments } from '../../scripts/check-ai-disclosure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const real = (file: string) => stripComments(readFileSync(file, 'utf8'));

function run(stripped: (file: string) => string): string[] {
    const failures: string[] = [];
    createAiLabelViewsCheck({ root, stripped, fail: (a, what) => failures.push(`${a}: ${what}`) }).check();
    return failures;
}

describe('check:ai-disclosure assertion 8, label views', () => {
    it('passes the tree as it stands', () => {
        expect(run(real)).toEqual([]);
    });

    it('refuses a view whose AiLabel is gone, even when a comment still names it', () => {
        const view = join(root, LABEL_VIEWS[0]!.file);
        const failures = run(f => (f === view ? '// <${AiLabel} record=${r} />\nexport function V() {}' : real(f)));
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain(LABEL_VIEWS[0]!.file);
    });

    it('refuses a route that no longer decides the label', () => {
        const route = join(root, LABEL_ROUTES[0]!.file);
        const failures = run(f => (f === route ? real(f).split(LABEL_ROUTES[0]!.literal).join('removed(') : real(f)));
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain(LABEL_ROUTES[0]!.literal);
    });
});
