/**
 * @file compliance-asked-when.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A question asked only when another answer allows it (`askedWhen`, Jouni 2026-10-29:
 *   the full EU AI Act survey only in an Annex III area). The shipped set asks a use outside those
 *   areas three questions instead of twelve and classifies it from those; a named area brings the
 *   rest back; an answer given anyway still counts; a stored set without conditions takes the shipped
 *   ones for the questions it holds as shipped. The page's copy of the rule (compliance-tab.gaps.js)
 *   is held to the server's on every case.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-asked-when.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  askedQuestions, classifyUseCase, effectiveQuestionnaire, QuestionnaireSchema, type ComplianceQuestionnaire,
} from '../../src/services/compliance-register.js';
import { COMPLIANCE_QUESTIONNAIRE_SEED } from '../../src/data/compliance-questionnaire.js';
import { askedQuestions as pageAsked } from '../../public/views/admin/compliance-tab.gaps.js';
import type { Storage } from '../../src/storage/interface.js';

const SET = COMPLIANCE_QUESTIONNAIRE_SEED;
const askedIds = (answers: Record<string, unknown>) =>
  [...askedQuestions(SET, answers)].filter(([, s]) => s === 'asked').map(([id]) => id);

const CASES: Array<Record<string, unknown>> = [
  {},
  { 'q-annex3-area': 'none' },
  { 'q-annex3-area': 'none', 'q-interacts-with-people': true, 'q-publishes-publicly': true },
  { 'q-annex3-area': 'employment' },
  { 'q-annex3-area': 'none', 'q-manipulative-technique': true },
];

describe('askedWhen in the shipped set', () => {
  it('asks a use outside the Annex III areas the area and the two transparency questions only', () => {
    expect(askedIds({ 'q-annex3-area': 'none' })).toEqual(['q-annex3-area', 'q-interacts-with-people', 'q-publishes-publicly']);
  });

  it('asks the full survey once an Annex III area is named', () => {
    expect(askedIds({ 'q-annex3-area': 'employment', 'q-publishes-publicly': true })).toHaveLength(SET.questions.length);
  });

  it('classifies a use outside the areas from its three answers, listing the rest as not asked', () => {
    const v = classifyUseCase({ id: 'u', title: 'u', answers: { 'q-annex3-area': 'none', 'q-interacts-with-people': true, 'q-publishes-publicly': false } }, SET);
    expect(v.class).toBe('limited');
    expect(v.unanswered).toEqual([]);
    expect(v.notAsked).toHaveLength(SET.questions.length - 3);
  });

  it('stays unclassified while the area is open, and lists only what is asked as unanswered', () => {
    const v = classifyUseCase({ id: 'u', title: 'u', answers: {} }, SET);
    expect(v.class).toBe('unclassified');
    expect(v.unanswered).toEqual(['q-annex3-area', 'q-interacts-with-people', 'q-publishes-publicly']);
  });

  it('still counts an answer given to a question that is not asked', () => {
    const v = classifyUseCase({ id: 'u', title: 'u', answers: { 'q-annex3-area': 'none', 'q-interacts-with-people': false, 'q-publishes-publicly': false, 'q-manipulative-technique': true } }, SET);
    expect(v.class).toBe('prohibited');
  });

  it('gives the page the same answer as the server on every case', () => {
    for (const answers of CASES) {
      expect(Object.fromEntries(pageAsked(SET.questions, answers))).toEqual(Object.fromEntries(askedQuestions(SET, answers)));
    }
  });
});

describe('a stored set', () => {
  const stored = (): ComplianceQuestionnaire => ({
    ...SET, version: 'operator-1',
    questions: SET.questions.map(({ askedWhen: _a, ...q }) => q),
  });
  const storageWith = (value: unknown) => ({ getMemory: async () => ({ value }) }) as unknown as Storage;

  it('takes the shipped conditions for the questions it still holds as shipped', async () => {
    const q = await effectiveQuestionnaire(storageWith(stored()), 'n');
    expect(q.version).toBe('operator-1');
    expect(q.questions.find(x => x.id === 'q-social-scoring')?.askedWhen).toEqual({ question: 'q-annex3-area', notIn: ['none'] });
  });

  it('leaves a reworded question without a condition, so it is asked of every use', async () => {
    const s = stored();
    s.questions = s.questions.map(x => (x.id === 'q-social-scoring' ? { ...x, text: 'Our own wording.' } : x));
    const q = await effectiveQuestionnaire(storageWith(s), 'n');
    expect(q.questions.find(x => x.id === 'q-social-scoring')?.askedWhen).toBeUndefined();
  });

  it('refuses a condition on a question the set does not have', () => {
    const bad = { ...SET, questions: [...SET.questions, { id: 'q-x', text: 'x', type: 'boolean', implies: {}, askedWhen: { question: 'q-missing', in: ['true'] } }] };
    expect(QuestionnaireSchema.safeParse(bad).success).toBe(false);
  });
});
