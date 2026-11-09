/**
 * @file settings-explain-flat-keys.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The setting explanations an AI reads (aimeat_handbook_get { tier: "settings/<term>" })
 *   hold every explanation a page shows, whether the locale writes it as a nested object or as a flat
 *   top-level key ("explain.concept.goal.short"). The pages' t() reads both; until 2026-11-09 the
 *   handbook read the nested ones only, and 98 explanations (the Goals page's six concepts among
 *   them) answered NOT_FOUND to an AI although the page showed them.
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (guidance audit 2026-11-09, item 1).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveFlat } from '../../src/i18n.js';
import { settingsExplainPiece, settingsExplainPieceIds } from '../../src/services/settings-explain.js';

const en = JSON.parse(readFileSync(new URL('../../locales/en.json', import.meta.url), 'utf8')) as Record<string, unknown>;

/** The terms en.json writes as flat top-level keys: "explain.<term>.short". */
const flatTerms = Object.keys(en)
    .filter(k => k.startsWith('explain.') && k.endsWith('.short'))
    .map(k => k.slice('explain.'.length, -'.short'.length));

describe('setting explanations written as flat locale keys', () => {
    it('en.json has explanations written as flat keys (the case this test is about)', () => {
        expect(flatTerms.length).toBeGreaterThan(0);
        expect(flatTerms).toContain('concept.goal');
    });

    it('resolveFlat collects a flat key under the prefix, in every language', () => {
        for (const locale of ['en', 'fi', 'es'] as const) {
            const all = resolveFlat(locale, 'explain');
            expect(all['explain.concept.goal.short'], locale).toBeTruthy();
        }
        expect(resolveFlat('fi', 'explain')['explain.concept.goal.short']).not.toBe(resolveFlat('en', 'explain')['explain.concept.goal.short']);
    });

    it('every flat term is a part the handbook serves, in three languages', () => {
        const ids = new Set(settingsExplainPieceIds());
        const missing = flatTerms.filter(term => !ids.has(term));
        expect(missing).toEqual([]);
        const goal = settingsExplainPiece('concept.goal');
        expect(goal).not.toBeNull();
        expect(goal!.text).toContain('## English');
        expect(goal!.text).toContain('## Suomi');
        expect(goal!.text).toContain('## Español');
    });

    it('a nested explanation is still served', () => {
        expect(settingsExplainPiece('ai.temperature')).not.toBeNull();
        expect(settingsExplainPiece('concept.organism')).not.toBeNull();
    });
});
