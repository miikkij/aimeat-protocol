/**
 * @file test/unit/interactive-answers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description checkInteractiveAnswers() holds an answer to its structured question: the options,
 *   single or multiple choice, the free-text answer and the required questions. Until 2026-10-15 the
 *   node stored any answer and only the inbox page restricted it (feature-list audit #123).
 * @usage cd aimeat && pnpm exec vitest run test/unit/interactive-answers.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #123).
 */
import { describe, it, expect } from 'vitest';
import { checkInteractiveAnswers } from '../../src/services/interactive-answers.js';
import type { InteractiveQuestion } from '../../src/storage/interface.js';

const QUESTIONS: InteractiveQuestion[] = [
  { id: 'auth', header: 'Auth', prompt: 'Which sign-in?', multiSelect: false, allowOther: true, required: true, options: [{ id: 'oauth', label: 'OAuth' }, { id: 'pw', label: 'Password' }] },
  { id: 'scopes', header: 'Scopes', prompt: 'Which scopes?', multiSelect: true, allowOther: false, required: false, options: [{ id: 'read', label: 'Read' }, { id: 'write', label: 'Write' }] },
];
const asked = (answers: Record<string, { selected: string[]; other?: string | null }>) => checkInteractiveAnswers(QUESTIONS, answers);

describe('checkInteractiveAnswers', () => {
  it('answers the page sends fit', () => {
    expect(asked({ auth: { selected: ['oauth'], other: null }, scopes: { selected: ['read', 'write'], other: null } })).toEqual([]);
    expect(asked({ auth: { selected: [], other: 'Passkey' }, scopes: { selected: [], other: null } })).toEqual([]);
  });

  it('an option the question did not offer is refused', () => {
    expect(asked({ auth: { selected: ['magic'] } })).toEqual([{ question: 'auth', problem: expect.stringContaining('magic') }]);
  });

  it('a single-choice question takes one answer', () => {
    expect(asked({ auth: { selected: ['oauth', 'pw'] } }).map((p) => p.question)).toEqual(['auth']);
    expect(asked({ auth: { selected: ['oauth'], other: 'and a passkey' } }).map((p) => p.question)).toEqual(['auth']);
  });

  it('a free-text answer is refused where the question allows none', () => {
    expect(asked({ auth: { selected: ['oauth'] }, scopes: { selected: [], other: 'all' } }).map((p) => p.question)).toEqual(['scopes']);
  });

  it('a required question without an answer is refused, an optional one is not', () => {
    expect(asked({ scopes: { selected: ['read'] } }).map((p) => p.question)).toEqual(['auth']);
    expect(asked({ auth: { selected: [], other: '   ' } }).map((p) => p.question)).toEqual(['auth']);
    expect(asked({ auth: { selected: ['pw'] } })).toEqual([]);
  });

  it('an unknown question id and a repeated choice are refused', () => {
    expect(asked({ auth: { selected: ['oauth'] }, nope: { selected: [] } }).map((p) => p.question)).toEqual(['nope']);
    expect(asked({ auth: { selected: ['oauth'] }, scopes: { selected: ['read', 'read'] } }).map((p) => p.question)).toEqual(['scopes']);
  });

  it('a question stored without the defaults reads allowOther as true and the rest as false', () => {
    const bare = [{ id: 'q', header: 'Q', prompt: 'Q?', options: [{ id: 'a', label: 'A' }] }] as InteractiveQuestion[];
    expect(checkInteractiveAnswers(bare, { q: { selected: [], other: 'free' } })).toEqual([]);
    expect(checkInteractiveAnswers(bare, {})).toEqual([]);
  });
});
