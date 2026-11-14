/**
 * @file test/unit/workspace-share-gate-ended.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate of a workspace share reads a target's end date as the public viewer
 *   does (isDocPublicAt): a target whose end has passed is not open, so moving its end into the future
 *   or removing it opens it again, and withholdOpening holds that back and carries the new end (or its
 *   removal) to the owner's approval. A target whose end has not passed stays open, so extending it
 *   opens nothing.
 * @version-history
 *   2026-11-01 — Initial (secaudit2026oct31w2 round 12, workspace-share-gate.ts openTargets ended-until).
 */
import { describe, expect, it } from 'vitest';
import { newlyOpened, openTargets, withholdOpening } from '../../src/services/workspace/share-gate.js';
import { isDocPublicAt } from '../../src/services/workspace/share.js';
import type { ResolvedShare } from '../../src/routes/organisms/share-types.js';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const PAST = '2026-10-01T00:00:00.000Z';
const SOON = '2026-11-02T00:00:00.000Z';
const LATER = '2027-01-31T00:00:00.000Z';

function share(over: Partial<ResolvedShare> = {}): ResolvedShare {
  return { public: false, spaces: {}, docs: {}, access: 'open', passwordHash: null, icsKeyHash: null, until: {}, ...over };
}
const clone = (s: ResolvedShare): ResolvedShare => JSON.parse(JSON.stringify(s)) as ResolvedShare;

describe('workspace share gate: a target whose end has passed is not open', () => {
  it('openTargets leaves out a page, a space and the workspace whose end has passed', () => {
    const s = share({ public: true, spaces: { pages: true }, docs: { 'pages/a': true, 'pages/b': true }, until: { '*': PAST, 'space:pages': PAST, 'pages/a': PAST, 'pages/b': SOON } });
    expect([...openTargets(s, NOW)].sort()).toEqual(['pages/b']);
    // The viewer agrees: the ended page is not served, the live one is.
    expect(isDocPublicAt(s, 'pages', 'a', NOW)).toBe(false);
    expect(isDocPublicAt(s, 'pages', 'b', NOW)).toBe(true);
  });

  it('removing the end of an ended page opens it', () => {
    const prev = share({ docs: { 'pages/a': true }, until: { 'pages/a': PAST } });
    const next = share({ docs: { 'pages/a': true }, until: {} });
    expect(newlyOpened(prev, next, NOW)).toEqual(['pages/a']);
  });

  it('moving the end of an ended page into the future opens it', () => {
    const prev = share({ docs: { 'pages/a': true }, until: { 'pages/a': PAST } });
    const next = share({ docs: { 'pages/a': true }, until: { 'pages/a': LATER } });
    expect(newlyOpened(prev, next, NOW)).toEqual(['pages/a']);
  });

  it('an ended space or workspace given a new end opens it', () => {
    const prev = share({ public: true, spaces: { pages: true }, until: { '*': PAST, 'space:pages': PAST } });
    const next = share({ public: true, spaces: { pages: true }, until: { '*': LATER } });
    expect(newlyOpened(prev, next, NOW).sort()).toEqual(['*', 'space:pages']);
  });

  it('extending an end that has not passed opens nothing (unchanged)', () => {
    const prev = share({ docs: { 'pages/a': true }, until: { 'pages/a': SOON } });
    expect(newlyOpened(prev, share({ docs: { 'pages/a': true }, until: { 'pages/a': LATER } }), NOW)).toEqual([]);
    expect(newlyOpened(prev, share({ docs: { 'pages/a': true }, until: {} }), NOW)).toEqual([]);
  });

  it('a change that leaves an ended page ended opens nothing', () => {
    const prev = share({ docs: { 'pages/a': true, 'pages/b': false }, until: { 'pages/a': PAST } });
    const next = share({ docs: { 'pages/a': true, 'pages/b': false }, until: { 'pages/a': PAST }, passwordHash: 'h' });
    expect(newlyOpened(prev, next, NOW)).toEqual([]);
  });

  it('with null for the time, ends are not read (the public feed test, unchanged)', () => {
    const prev = share({ docs: { 'pages/a': true }, until: { 'pages/a': PAST } });
    const next = share({ docs: { 'pages/a': true }, until: {} });
    expect(newlyOpened(prev, next, null)).toEqual([]);
  });

  it('withholdOpening keeps the passed end, and the body removes it on approval', () => {
    const prev = share({ docs: { 'pages/a': true }, until: { 'pages/a': PAST } });
    const next = share({ docs: { 'pages/a': true }, until: {} });
    const opened = newlyOpened(prev, next, NOW);
    const body = withholdOpening(prev, next, opened, { 'pages/a': null });
    expect(next.docs['pages/a']).toBe(true);
    expect(next.until['pages/a']).toBe(PAST);
    expect(isDocPublicAt(next, 'pages', 'a', NOW)).toBe(false);
    expect(body).toEqual({ docs: { 'pages/a': true }, until: { 'pages/a': null } });
  });

  it('withholdOpening keeps the passed end, and the body sets the new end on approval', () => {
    const prev = share({ docs: { 'pages/a': true }, until: { 'pages/a': PAST } });
    const next = share({ docs: { 'pages/a': true }, until: { 'pages/a': LATER } });
    const body = withholdOpening(prev, next, newlyOpened(prev, next, NOW), { 'pages/a': LATER });
    expect(next.until['pages/a']).toBe(PAST);
    expect(body).toEqual({ docs: { 'pages/a': true }, until: { 'pages/a': LATER } });
  });

  it('withholdOpening of a page never shared is unchanged', () => {
    const prev = share();
    const next = clone(prev);
    next.docs['pages/a'] = true;
    const body = withholdOpening(prev, next, newlyOpened(prev, next, NOW), {});
    expect('pages/a' in next.docs).toBe(false);
    expect(body).toEqual({ docs: { 'pages/a': true } });
  });
});
