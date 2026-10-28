/**
 * @file compliance-questionnaire-locale.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shipped question set reaches every reader in their language, and only while it
 *   is still as shipped.
 *
 *   WHY IT MATTERS. On innokas.aimeat.io (2026-10-28) the Finnish printout carried twelve English
 *   questions, because the question set is stored data and nothing translated it. The page now
 *   translates a question the node reports as still shipped (`builtInQuestionIds`, GET
 *   questionnaire's `built_in`), so two things must hold: every language carries every shipped
 *   question, and a question an operator reworded is not reported as shipped, or the reader would
 *   get the shipped translation in place of the operator's words.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-questionnaire-locale.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-28 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMPLIANCE_QUESTIONNAIRE_SEED as SEED, builtInQuestionIds } from '../../src/data/compliance-questionnaire.js';

const locale = (tag: string) => JSON.parse(readFileSync(new URL(`../../locales/${tag}.json`, import.meta.url), 'utf8')).admin.compliance;

describe('the shipped question set in the locales', () => {
  it.each(['en', 'fi', 'es'])('%s carries every shipped question, help and option', (tag) => {
    const l = locale(tag);
    for (const q of SEED.questions) {
      expect(l.question?.[q.id]?.text, `${tag} ${q.id}`).toBeTruthy();
      if (q.help) expect(l.question[q.id].help, `${tag} ${q.id} help`).toBeTruthy();
      for (const o of q.options || []) expect(l.option?.[o.value], `${tag} ${o.value}`).toBeTruthy();
    }
  });
});

describe('builtInQuestionIds', () => {
  it('names every question of the shipped set', () => {
    expect(builtInQuestionIds(SEED)).toEqual(SEED.questions.map(q => q.id));
  });

  it('leaves out a question whose text, help or option label an operator changed, and one the seed never had', () => {
    const [a, b, c, ...rest] = SEED.questions;
    const area = rest.find(q => q.id === 'q-annex3-area')!;
    const edited = [
      { ...a, text: `${a.text} (our wording)` },
      { ...b, help: 'Our own note.' },
      c,
      { ...area, options: area.options!.map(o => (o.value === 'employment' ? { ...o, label: 'HR decisions' } : o)) },
      { id: 'q-our-own', text: 'Does it touch payroll?', type: 'boolean' as const, implies: {} },
    ];
    expect(builtInQuestionIds({ questions: edited })).toEqual([c.id]);
  });
});
