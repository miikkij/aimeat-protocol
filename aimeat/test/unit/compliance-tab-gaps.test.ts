/**
 * @file compliance-tab-gaps.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the admin Compliance page, held to the numbers the page
 *   prints: the gaps grouped by kind with their evidence, who answered what (a missing source is
 *   the operator's), the class counts in the strip's order, the register's reading order and its
 *   filter, and what a question's answers imply as chips. The report's own gap computation is
 *   compliance-gaps.test.ts; this is the page's fold over what that computation serves.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-tab-gaps.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (the Compliance page in the poster face).
 */
import { describe, it, expect } from 'vitest';
import {
  groupGaps, answersOf, answerStats, classCounts, orderUsecases, filterUsecases, impliesSummary, modelsShort,
} from '../../public/views/admin/compliance-tab.gaps.js';

const GAPS = [
  { kind: 'undocumented-ai-activity', detail: 'used, named nowhere', evidence: { model: 'z-ai/glm-5.3-flash' } },
  { kind: 'undocumented-ai-activity', detail: 'used, named nowhere', evidence: { model: 'grok-4.3' } },
  { kind: 'app-declares-generation-with-gap', detail: 'turbo.html', evidence: { app: 'turbo.html', gap: 'no-disclosure', in_register: true } },
  { kind: 'app-declares-generation-with-gap', detail: 'freepartylights.html', evidence: { app: 'freepartylights.html', gap: 'no-disclosure', in_register: false } },
  { kind: 'unclassified-usecase', detail: 'datapkg-analyst', evidence: { usecase_id: 'uc-datapkg-analyst', unanswered: ['q-publishes-public-interest'] } },
  { kind: 'unlabelled-public-content', detail: '3 items', evidence: { count: 3 } },
  { kind: 'something-newer', detail: 'a kind this page has no row for' },
];

const QS = [
  { id: 'q1', type: 'boolean', implies: { true: 'prohibited' } },
  { id: 'q2', type: 'boolean', implies: { true: 'limited' } },
  { id: 'q3', type: 'boolean', implies: {} },
];

const UC = [
  { id: 'a', title: 'news-writer', purpose: 'articles', models: ['deepseek/deepseek-v4-pro', 'free', 'grok-4.3'], apps: [], risk: { class: 'limited' },
    answers: { q1: false, q2: true, q3: false }, answerSources: { q1: 'ai', q2: 'evidence' } },
  { id: 'b', title: 'datapkg-analyst', purpose: 'notes', models: ['gpt-oss-120b'], apps: ['pkg.html'], risk: { class: 'unclassified' },
    answers: { q1: false }, answerSources: { q1: 'ai' } },
  { id: 'c', title: 'icon-painter', purpose: 'icons', models: ['bytedance-seed/seedream-4.5'], risk: { class: 'minimal' },
    answers: { q1: false, q2: false, q3: true } },
  { id: 'd', title: 'postman', models: [], risk: { class: 'limited' }, answers: { q1: false, q2: true, q3: '' }, answerSources: { q1: 'human', q2: 'human' } },
];

describe('groupGaps', () => {
  it('groups the node\'s one-gap-per-thing list by kind and keeps the evidence', () => {
    const g = groupGaps(GAPS);
    expect(g.total).toBe(7);
    expect(g.models).toEqual(['grok-4.3', 'z-ai/glm-5.3-flash']);
    expect(g.apps).toEqual([{ app: 'freepartylights.html', inRegister: false }, { app: 'turbo.html', inRegister: true }]);
    expect(g.usecases).toEqual([{ id: 'uc-datapkg-analyst', unanswered: ['q-publishes-public-interest'] }]);
    expect(g.unlabelled).toBe(3);
    expect(g.other).toHaveLength(1);
  });
  it('is empty and total 0 without gaps', () => {
    expect(groupGaps(undefined)).toEqual({ total: 0, models: [], apps: [], usecases: [], unlabelled: 0, other: [] });
  });
});

describe('answersOf and answerStats', () => {
  it('counts an answer with no recorded source as the operator\'s', () => {
    expect(answersOf(UC[2], QS)).toEqual({ total: 3, answered: 3, unanswered: 0, ai: 0, human: 3, evidence: 0 });
  });
  it('treats an empty string as unanswered', () => {
    expect(answersOf(UC[3], QS)).toEqual({ total: 3, answered: 2, unanswered: 1, ai: 0, human: 2, evidence: 0 });
  });
  it('sums across the register', () => {
    expect(answerStats(UC, QS)).toEqual({ entries: 4, questions: 3, answered: 9, unanswered: 3, ai: 2, human: 6, evidence: 1 });
  });
});

describe('classCounts', () => {
  it('orders by count, then worst class first on a tie', () => {
    expect(classCounts(UC)).toEqual([{ cls: 'limited', n: 2 }, { cls: 'unclassified', n: 1 }, { cls: 'minimal', n: 1 }]);
  });
  it('reads a missing risk as unclassified', () => {
    expect(classCounts([{ id: 'x' }])).toEqual([{ cls: 'unclassified', n: 1 }]);
  });
});

describe('orderUsecases and filterUsecases', () => {
  it('puts the unfinished entries first and keeps the stored order otherwise', () => {
    expect(orderUsecases(UC).map(u => u.id)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('filters by class and by a substring of a name, a model or an app', () => {
    expect(filterUsecases(UC, 'limited', '').map(u => u.id)).toEqual(['a', 'd']);
    expect(filterUsecases(UC, 'all', 'GROK').map(u => u.id)).toEqual(['a']);
    expect(filterUsecases(UC, 'all', 'pkg.html').map(u => u.id)).toEqual(['b']);
    expect(filterUsecases(UC, 'minimal', 'news')).toEqual([]);
  });
});

describe('impliesSummary and modelsShort', () => {
  it('reads a boolean question\'s implication as yes or no', () => {
    expect(impliesSummary({ type: 'boolean', implies: { true: 'high' } })).toEqual([{ answer: 'yes', cls: 'high' }]);
    expect(impliesSummary({ type: 'boolean', implies: {} })).toEqual([]);
  });
  it('folds a choice question\'s options into one chip per class', () => {
    expect(impliesSummary({ type: 'choice', implies: { education: 'high', migration: 'high' } })).toEqual([{ answer: 'choice', cls: 'high' }]);
  });
  it('shows two models and counts the rest', () => {
    expect(modelsShort(['a', 'b', 'c', 'd'])).toBe('a, b +2');
    expect(modelsShort(['a'])).toBe('a');
    expect(modelsShort([])).toBe('');
  });
});
