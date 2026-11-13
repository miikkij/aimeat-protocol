/**
 * @file test/unit/context-check-text.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When does a source quote still stand in its record (services/context/check.ts
 *   quoteStands)? A quote taken from a JSON record names a field and its value; one taken from text
 *   is the words. Both are found, and a quote whose words or values are not in the record is not.
 *   The JSON cases are the shapes of three quotes a real module carried on 2026-11-13, reported as
 *   gone although their records had not changed. isDefinition: a class needs no source, a statement does.
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { quoteStands, isDefinition } from '../../src/services/context/check.js';

const scores = { A: { mode: 'A', seed: 42, runId: 'parvi-a-42-ke6a8n-8psvso', ticks: 0 } };
const results = {
    spec: 'parvi.results/1', seeds: 10, measured: '2026-09-08',
    consumers: { qwen: { prose: { n: 9, right: 0, wrong: 4, abstained: 5 } } },
};

describe('quoteStands', () => {
    it('finds a field and its value written out of a JSON record', () => {
        expect(quoteStands(scores, 'runId parvi-a-42-ke6a8n-8psvso')).toBe(true);
        expect(quoteStands(results, 'spec parvi.results/1, seeds 10, measured 2026-09-08')).toBe(true);
        expect(quoteStands(results, 'qwen prose n 9 right 0 wrong 4 abstained 5')).toBe(true);
    });

    it('does not find a value the record does not hold', () => {
        expect(quoteStands(results, 'seeds 12')).toBe(false);
        expect(quoteStands(results, 'qwen prose n 9 right 1 wrong 4')).toBe(false);
        expect(quoteStands(scores, 'runId parvi-b-42')).toBe(false);
    });

    it('still finds words in text, blind to case, spacing and Markdown marks', () => {
        const note = { text: 'The **release** is on\n3 October, after the  mastering.' };
        expect(quoteStands(note, 'the release is on 3 October')).toBe(true);
        expect(quoteStands('A plain string record.', 'plain string')).toBe(true);
        expect(quoteStands(note, 'the release is on 4 October')).toBe(false);
    });

    it('reads a plain string record by its words only', () => {
        expect(quoteStands('seeds: 10', 'seeds 10')).toBe(false);
    });
});

describe('isDefinition', () => {
    it('takes a concept under /class/ as a definition, whatever its type', () => {
        expect(isDefinition('vocab:ctx.om/class/Product', 'skos:Concept')).toBe(true);
        expect(isDefinition('vocab:ctx.core/Person', 'owl:Class')).toBe(true);
    });
    it('takes a statement as a statement, which needs a source', () => {
        expect(isDefinition('vocab:ctx.om/decision/price-2026', 'skos:Concept')).toBe(false);
        expect(isDefinition('vocab:ctx.om/classic-car', 'skos:Concept')).toBe(false);
    });
});
