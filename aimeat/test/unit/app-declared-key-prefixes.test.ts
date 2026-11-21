/**
 * @file test/unit/app-declared-key-prefixes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The key prefixes an owner's apps keep in the owner's memory
 *   (services/app/declared-key-prefixes.ts), and the bound skill's owner_scope check built on them
 *   (services/skill/owner-scope-check.ts): which data map rows count, how a key family is read, and
 *   which paragraphs of a skill are named.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-declared-key-prefixes.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { rowKeyPrefix, keyUnderPrefix, prefixesOfMap } from '../../src/services/app/declared-key-prefixes.js';
import { ownerScopeIssuesIn } from '../../src/services/skill/owner-scope-check.js';
import { DATA_MAP_SPEC, type DataMap, type DataMapRow } from '../../src/services/data-map/data-map-types.js';

const row = (what: string, where: string, extra: Partial<DataMapRow> = {}): DataMapRow => ({
  what, holds: 'x', kind: 'user-written', usedFor: 'shown-as-a-list', where: where as DataMapRow['where'],
  owner: 'person', readers: 'owner-only', writers: ['an-agent'], shape: 'one-per-thing', keptFor: 'until-deleted',
  lossRisk: 'only-copy', personalData: 'no', why: '', ...extra,
});
const map = (held: DataMapRow[]): DataMap => ({
  spec: DATA_MAP_SPEC, what: '', usedFor: '', form: 'one-person', arrangement: '', machinery: [], leaves: [],
  held, elsewhere: [], source: 'declared', at: '2026-11-21T00:00:00Z',
});

describe('a data map row read as a key prefix', () => {
  it('takes the literal start of a key family', () => {
    expect(rowKeyPrefix('news.<date>.*')).toBe('news.');
    expect(rowKeyPrefix('scores.*')).toBe('scores.');
    expect(rowKeyPrefix('profile')).toBe('profile');
    expect(rowKeyPrefix('tasks.{id}')).toBe('tasks.');
  });
  it('gives nothing for a family that starts with a placeholder, a sentence or two letters', () => {
    expect(rowKeyPrefix('<owner>.notes')).toBeNull();
    expect(rowKeyPrefix('the notes the person writes')).toBeNull();
    expect(rowKeyPrefix('scores.<round> (one per round)')).toBe('scores.');
    expect(rowKeyPrefix('ab.*')).toBeNull();
    expect(rowKeyPrefix('')).toBeNull();
  });
  it('a key is under a dotted prefix by its start, and under a bare word only as that word or below it', () => {
    expect(keyUnderPrefix('scores.round1', 'scores.')).toBe(true);
    expect(keyUnderPrefix('scoresheet', 'scores.')).toBe(false);
    expect(keyUnderPrefix('profile', 'profile')).toBe(true);
    expect(keyUnderPrefix('profile.photo', 'profile')).toBe(true);
    expect(keyUnderPrefix('profiles', 'profile')).toBe(false);
  });
});

describe('one app\'s prefixes', () => {
  it('always holds apps.<id>., and the rows kept in the owner\'s memory', () => {
    const m = map([row('scores.*', 'owner-memory-private'), row('board.public.*', 'owner-memory-public')]);
    expect(prefixesOfMap('quiz', m).sort()).toEqual(['apps.quiz.', 'board.public.', 'scores.']);
  });
  it('leaves out a row kept anywhere else, and a row that names the agent whose work the app shows', () => {
    const m = map([
      row('drafts.*', 'browser-only'), row('shared.*', 'organism-workspace'),
      row('news.<date>.*', 'owner-memory-private', { agent: 'morning-news' }),
    ]);
    expect(prefixesOfMap('quiz', m)).toEqual(['apps.quiz.']);
  });
  it('an app with no map has its own apps.<id>. prefix only', () => {
    expect(prefixesOfMap('quiz', null)).toEqual(['apps.quiz.']);
  });
});

describe('a bound skill that writes the app\'s keys', () => {
  const prefixes = ['apps.quiz.', 'scores.'];
  it('names a paragraph that writes the app\'s keys with aimeat_memory_write and no owner_scope', () => {
    const issues = ownerScopeIssuesIn({ 'SKILL.md': '# Quiz\n\nSave a result with `aimeat_memory_write { key: "scores.<round>", value }`.\n' }, prefixes, 'quiz.html');
    expect(issues).toHaveLength(1);
    expect(issues[0].prefix).toBe('scores.');
    expect(issues[0].message).toContain('owner_scope: true');
    expect(issues[0].message).toContain('quiz.html');
  });
  it('stays quiet when the call says owner_scope, or when the file states it once in a paragraph of its own', () => {
    expect(ownerScopeIssuesIn({ 'SKILL.md': 'Save with `aimeat_memory_write { key: "scores.r1", value, owner_scope: true }`.' }, prefixes, 'quiz.html')).toEqual([]);
    expect(ownerScopeIssuesIn({ 'SKILL.md': 'Every write passes owner_scope: true.\n\nSave with `aimeat_memory_write { key: "scores.r1" }`.' }, prefixes, 'quiz.html')).toEqual([]);
  });
  it('stays quiet about keys of no prefix of the app, a word that only starts like one, and a file that is not Markdown', () => {
    expect(ownerScopeIssuesIn({ 'SKILL.md': 'Keep a note with `aimeat_memory_write { key: "notes.today" }`.' }, prefixes, 'quiz.html')).toEqual([]);
    expect(ownerScopeIssuesIn({ 'SKILL.md': 'Use aimeat_memory_write for highscores.today.' }, prefixes, 'quiz.html')).toEqual([]);
    expect(ownerScopeIssuesIn({ 'scripts/run.py': 'aimeat_memory_write(key="scores.r1")' }, prefixes, 'quiz.html')).toEqual([]);
  });
});
