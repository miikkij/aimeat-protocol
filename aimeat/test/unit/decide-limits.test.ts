/**
 * @file test/unit/decide-limits.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The request limits of AIMEAT.decide: a good request passes, and each limit refuses
 *   with its own code and a message that names the question.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, expect, it } from 'vitest';
import {
  checkDecideRequest, DEFAULT_DECIDE_LIMITS, estimateTokens, type JevQuestion,
} from '../../src/services/decide/limits.js';

const L = DEFAULT_DECIDE_LIMITS;
const state = { from: '[PERSON_1]', subject: 'Invoice 4411 is wrong', body: 'The amount is twice what we agreed.' };
const good: Record<string, JevQuestion> = {
  urgent: { type: 'noul', instructions: 'Does the sender need an answer today?', criteria: { true: 'a deadline is named' } },
  topic: { type: 'choice', instructions: 'Which team handles this?', criteria: { billing: 'invoices and payments', support: null, sales: null } },
  tone: { type: 'score', instructions: 'How upset is the sender?', criteria: ['calm', 'annoyed', 'angry'] },
};
const codes = (q: Record<string, JevQuestion>, s: unknown = state) => checkDecideRequest(s, q, L).map(v => v.code);

describe('checkDecideRequest', () => {
  it('passes a good request', () => {
    expect(checkDecideRequest(state, good, L)).toEqual([]);
  });

  it('refuses a score question with 11 levels', () => {
    const v = checkDecideRequest(state, { tone: { type: 'score', instructions: 'x', criteria: Array.from({ length: 11 }, (_, i) => `level ${i}`) } }, L);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ question: 'tone', code: 'TOO_MANY_LEVELS' });
    expect(v[0].message).toContain('the limit is 10');
  });

  it('accepts 10 levels and refuses 1', () => {
    expect(codes({ t: { type: 'score', instructions: 'x', criteria: Array.from({ length: 10 }, String) } })).toEqual([]);
    expect(codes({ t: { type: 'score', instructions: 'x', criteria: ['only'] } })).toEqual(['TOO_FEW_LEVELS']);
  });

  it('refuses a choice question with 241 options and accepts 240', () => {
    const opts = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`opt${i}`, null]));
    const v = checkDecideRequest(state, { topic: { type: 'choice', instructions: 'x', criteria: opts(241) } }, L);
    expect(v.map(x => x.code)).toEqual(['TOO_MANY_OPTIONS']);
    expect(v[0].message).toBe("Choice question 'topic' has 241 options; the limit is 240. Walk a large taxonomy in stages.");
    expect(codes({ topic: { type: 'choice', instructions: 'x', criteria: opts(240) } })).toEqual([]);
    expect(codes({ topic: { type: 'choice', instructions: 'x', criteria: opts(1) } })).toEqual(['TOO_FEW_OPTIONS']);
  });

  it('refuses an oversize request', () => {
    const big = { text: 'x'.repeat(L.maxRequestTokens * 4 + 10) };
    expect(codes(good, big)).toEqual(['TOO_LARGE']);
    expect(estimateTokens(big)).toBeGreaterThan(L.maxRequestTokens);
  });

  it('refuses a state JSON cannot carry without throwing', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(codes(good, cyc)).toEqual(['TOO_LARGE']);
  });

  it('refuses empty, too many, bad ids, bad types, missing instructions and bad criteria', () => {
    expect(codes({})).toEqual(['NO_QUESTIONS']);
    expect(checkDecideRequest(state, null as unknown as Record<string, JevQuestion>, L)[0].code).toBe('NO_QUESTIONS');
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`q${i}`, { type: 'noul', instructions: 'x' } as JevQuestion]));
    expect(codes(many)).toEqual(['TOO_MANY_QUESTIONS']);
    expect(codes({ 'has space': { type: 'noul', instructions: 'x' } })).toEqual(['BAD_ID']);
    expect(codes({ q: { type: 'text' as 'noul', instructions: 'x' } })).toEqual(['BAD_TYPE']);
    expect(codes({ q: { type: 'noul', instructions: '  ' } })).toEqual(['NO_INSTRUCTIONS']);
    expect(codes({ q: { type: 'noul', instructions: { rule: 'r' } } })).toEqual([]);
    expect(codes({ q: { type: 'noul', instructions: 'x', criteria: { maybe: 'x' } } })).toEqual(['BAD_CRITERIA']);
    expect(codes({ q: { type: 'choice', instructions: 'x', criteria: ['a', 'b'] } })).toEqual(['BAD_CRITERIA']);
    expect(codes({ q: { type: 'score', instructions: 'x', criteria: { a: 1 } } })).toEqual(['BAD_CRITERIA']);
  });
});
