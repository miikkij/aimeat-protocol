/**
 * @file test/unit/decide-rule-validate.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decision rule's validator and evaluator (services/decide/rule-validate.ts): what
 *   is refused and with which message, and how thresholds and bands turn answers into act, ask or
 *   stop. Pure functions, no storage.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { validateRule, evaluateRule, fieldsOutside } from '../../src/services/decide/rule-validate.js';
import { DEFAULT_DECIDE_LIMITS } from '../../src/services/decide/limits.js';

const GOOD = {
  id: 'send-reply',
  title: 'Send the reply without a person reading it',
  decides: 'whether the drafted reply goes out on its own',
  sends: ['draft', 'question'],
  questions: {
    good: { type: 'noul', instructions: 'The draft answers the question fully and politely.' },
    tone: { type: 'score', instructions: 'How polite is the draft?', criteria: ['Rude', 'Neutral', 'Polite'] },
  },
  thresholds: { good: 0.5, tone: 1 },
  bands: { act: 0.85, ask: 0.5 },
  use: 'both',
  gate: true,
  sample: { draft: 'Thank you, the invoice is attached.', question: 'Where is my invoice?' },
};
const codes = (raw: unknown) => validateRule(raw, DEFAULT_DECIDE_LIMITS).problems.map(p => p.code);

describe('validateRule', () => {
  it('accepts a complete rule and returns it normalised', () => {
    const v = validateRule(GOOD, DEFAULT_DECIDE_LIMITS);
    expect(v.problems).toEqual([]);
    expect(v.rule?.id).toBe('send-reply');
    expect(v.rule?.gate).toBe(true);
    expect(v.rule?.sends).toEqual(['draft', 'question']);
  });

  it('gate defaults to false and sends to any state', () => {
    const rest: Record<string, unknown> = { ...GOOD };
    for (const f of ['gate', 'sends', 'sample']) delete rest[f];
    const v = validateRule(rest, DEFAULT_DECIDE_LIMITS);
    expect(v.problems).toEqual([]);
    expect(v.rule?.gate).toBe(false);
    expect(v.rule?.sends).toEqual([]);
    expect(v.rule?.sample).toBeNull();
  });

  it('refuses a bad id, a missing title and a missing decides in one round', () => {
    expect(codes({ ...GOOD, id: 'Send Reply', title: '', decides: undefined })).toEqual(['BAD_ID', 'BAD_TITLE', 'BAD_DECIDES']);
  });

  it('refuses a question type the node does not have, and eleven score levels', () => {
    expect(codes({ ...GOOD, questions: { good: { type: 'essay', instructions: 'x' } }, thresholds: { good: 0.5 } })).toContain('BAD_TYPE');
    const eleven = { type: 'score', instructions: 'Rate it.', criteria: Array.from({ length: 11 }, (_, i) => `level ${i}`) };
    expect(codes({ ...GOOD, questions: { ...GOOD.questions, tone: eleven } })).toContain('TOO_MANY_LEVELS');
  });

  it('refuses a threshold that names no question, and one outside its question\'s units', () => {
    expect(codes({ ...GOOD, thresholds: { nosuch: 0.5 } })).toEqual(['UNKNOWN_QUESTION']);
    expect(codes({ ...GOOD, thresholds: { good: 1.5 } })).toEqual(['BAD_THRESHOLD']);
    // A score of three levels is counted 0, 1, 2.
    expect(codes({ ...GOOD, thresholds: { tone: 3 } })).toEqual(['BAD_THRESHOLD']);
    expect(codes({ ...GOOD, thresholds: { tone: 2 } })).toEqual([]);
    expect(codes({ ...GOOD, thresholds: {} })).toEqual(['NO_THRESHOLDS']);
  });

  it('refuses bands out of order or out of range', () => {
    expect(codes({ ...GOOD, bands: { act: 0.4, ask: 0.6 } })).toEqual(['BANDS_NOT_ORDERED']);
    expect(codes({ ...GOOD, bands: { act: 1.2, ask: 0.6 } })).toEqual(['BANDS_NOT_ORDERED']);
    expect(codes({ ...GOOD, bands: { act: '0.9', ask: 0.6 } })).toEqual(['BAD_BANDS']);
    expect(codes({ ...GOOD, bands: { act: 0.7, ask: 0.7 } })).toEqual([]);
  });

  it('refuses a use outside the three words and a sample with a field sends does not list', () => {
    expect(codes({ ...GOOD, use: 'everyone' })).toEqual(['BAD_USE']);
    expect(codes({ ...GOOD, sample: { draft: 'x', customerEmail: 'a@b.fi' } })).toEqual(['SAMPLE_OUTSIDE_SENDS']);
  });
});

describe('fieldsOutside', () => {
  it('allows anything when sends is empty, and only listed fields otherwise', () => {
    expect(fieldsOutside([], 'free text')).toEqual([]);
    expect(fieldsOutside(['a'], { a: 1 })).toEqual([]);
    expect(fieldsOutside(['a'], { a: 1, b: 2 })).toEqual(['b']);
    expect(fieldsOutside(['a'], 'free text')).toHaveLength(1);
  });
});

describe('evaluateRule', () => {
  const rule = { thresholds: { good: 0.5, tone: 1 }, bands: { act: 0.85, ask: 0.5 } };
  const answers = (good: number, tone: number, toneConf: number) => ({
    good: { type: 'noul' as const, value: good },
    tone: { type: 'score' as const, value: tone, confidence: toneConf },
  });

  it('acts when every floor is reached and the weakest certainty is in the act band', () => {
    const e = evaluateRule(rule, answers(0.91, 2, 0.9));
    expect(e).toEqual({ outcome: 'act', result: 0.9, passed: { good: true, tone: true } });
  });

  it('asks a person when the weakest certainty falls between the bands', () => {
    expect(evaluateRule(rule, answers(0.7, 2, 0.95)).outcome).toBe('ask');
    expect(evaluateRule(rule, answers(0.95, 2, 0.6)).outcome).toBe('ask');
  });

  it('stops when an answer is under its floor, however sure the rest is', () => {
    const e = evaluateRule(rule, answers(0.95, 0, 0.99));
    expect(e.outcome).toBe('stop');
    expect(e.passed).toEqual({ good: true, tone: false });
  });

  it('stops when the weakest certainty is under the ask band', () => {
    expect(evaluateRule({ thresholds: { good: 0.2 }, bands: { act: 0.85, ask: 0.5 } }, { good: { type: 'noul', value: 0.3 } }).outcome).toBe('stop');
  });

  it('a choice is compared by its confidence, and a question the model did not answer fails', () => {
    const r = { thresholds: { kind: 0.6 }, bands: { act: 0.8, ask: 0.6 } };
    expect(evaluateRule(r, { kind: { type: 'choice', value: 'bug', confidence: 0.88 } }).outcome).toBe('act');
    expect(evaluateRule(r, { kind: { type: 'choice', value: 'bug', confidence: 0.4 } }).outcome).toBe('stop');
    expect(evaluateRule(r, {})).toEqual({ outcome: 'stop', result: 0, passed: { kind: false } });
  });
});
