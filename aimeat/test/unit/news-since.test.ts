/**
 * @file news-since.test.ts
 * @description What the home's news band counts as new for one person (public/js/services/news.js):
 *   the entries above the one they last confirmed, only the audiences they read, the highlights of
 *   the last 30 days when they have not confirmed lately, and nothing once they have read it. Also
 *   that the real change log carries the fields the band reads.
 * @usage pnpm exec vitest run test/unit/news-since.test.ts
 * @version-history
 *   2026-10-18 — Initial (wish-uutta-aimeatissa-mit-on-tullut-sitten-viime-katselun-kenelle).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newsFor, audiencesOf, audienceOf, entryAddress, WINDOW_DAYS } from '../../public/js/services/news.js';

const NOW = new Date('2026-10-18T12:00:00Z');
const entry = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, date, kind: 'feature', title: id, ...extra });

// Newest first, as the file is.
const LOG = [
  entry('2026-10-18-e', '2026-10-18', { audience: ['user'], highlight: true }),
  entry('2026-10-18-d', '2026-10-18', { audience: ['operator'] }),
  entry('2026-10-15-c', '2026-10-15', { audience: ['developer'], highlight: true }),
  entry('2026-10-10-b', '2026-10-10', { audience: ['agent'] }),
  entry('2026-08-01-a', '2026-08-01', { audience: ['user'], highlight: true }),
];
const ids = (items: Array<{ entry: { id: string } }>) => items.map((i) => i.entry.id);

describe('what is new since the person last looked', () => {
  it('lists the entries above the one they confirmed, highlights apart, in their audiences only', () => {
    const r = newsFor(LOG, { at: '2026-10-12T08:00:00Z', lastId: '2026-10-10-b' }, audiencesOf(), NOW);
    expect(r.mode).toBe('since');
    expect(ids(r.highlights)).toEqual(['2026-10-18-e']);
    // The operator entry and the developer entry are not for a plain user.
    expect(ids(r.others)).toEqual([]);
  });

  it('an operator who builds apps also reads the operator and developer entries', () => {
    const r = newsFor(LOG, { at: '2026-10-12T08:00:00Z', lastId: '2026-10-10-b' }, audiencesOf({ operator: true, developer: true }), NOW);
    expect(ids(r.highlights)).toEqual(['2026-10-18-e', '2026-10-15-c']);
    expect(ids(r.others)).toEqual(['2026-10-18-d']);
  });

  it('nothing is new right after they pressed Read', () => {
    const r = newsFor(LOG, { at: NOW.toISOString(), lastId: LOG[0].id }, audiencesOf({ operator: true, developer: true }), NOW);
    expect(r.mode).toBe('none');
    expect(r.highlights.length + r.others.length).toBe(0);
  });

  it('falls back to the date when the confirmed entry is gone from the log', () => {
    const r = newsFor(LOG, { at: '2026-10-16T08:00:00Z', lastId: 'renamed-or-removed' }, audiencesOf({ operator: true }), NOW);
    expect(ids([...r.highlights, ...r.others])).toEqual(['2026-10-18-e', '2026-10-18-d']);
  });

  it('a person who never confirmed sees only the highlights of the last 30 days, and how many others there are', () => {
    const r = newsFor(LOG, null, audiencesOf({ operator: true, developer: true }), NOW);
    expect(r.mode).toBe('window');
    expect(ids(r.highlights)).toEqual(['2026-10-18-e', '2026-10-15-c']);
    expect(r.others).toEqual([]);
    expect(r.hidden).toBe(2);
    // The August highlight is older than the window.
    expect(WINDOW_DAYS).toBe(30);
  });

  it('a confirmation older than the window counts as never', () => {
    const r = newsFor(LOG, { at: '2026-08-02T00:00:00Z', lastId: '2026-08-01-a' }, audiencesOf(), NOW);
    expect(r.mode).toBe('window');
    expect(ids(r.highlights)).toEqual(['2026-10-18-e']);
  });

  it('an entry without an audience is a user entry, and the address matches the history page', () => {
    expect(audienceOf({})).toEqual(['user']);
    expect(audienceOf({ audience: ['nobody'] })).toEqual(['user']);
    expect(entryAddress(LOG, 0)).toBe('2026-10-18');
    expect(entryAddress(LOG, 1)).toBe('2026-10-18-2');
  });
});

describe('the change log carries what the band reads', () => {
  const log = JSON.parse(readFileSync(new URL('../../public/changelog.json', import.meta.url), 'utf8')) as { entries: Array<Record<string, unknown>> };

  it('every entry has an id, an audience, a highlight flag and a summary; a fix says what it changes for the person', () => {
    const seen = new Set<string>();
    for (const e of log.entries) {
      expect(typeof e.id).toBe('string');
      expect(seen.has(e.id as string)).toBe(false);
      seen.add(e.id as string);
      expect(Array.isArray(e.audience) && (e.audience as unknown[]).length > 0).toBe(true);
      expect(typeof e.highlight).toBe('boolean');
      expect(typeof (e.summary as Record<string, string>)?.en).toBe('string');
      expect(typeof (e.summary as Record<string, string>)?.fi).toBe('string');
      if (e.kind === 'fix' || e.kind === 'security') expect(typeof (e.impact as Record<string, string>)?.fi).toBe('string');
    }
  });
});
