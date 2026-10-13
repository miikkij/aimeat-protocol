/**
 * @file calendar-feed.test.ts
 * @description The ICS feed of a shared records space (services/calendar-feed.ts): which records
 *   become events, which fields of a record reach the feed, and what the feed key opens.
 * @version-history
 *   v1.0.0 — 2026-10-13 — Written with the service. The "series from 1970" case holds the service to
 *     naming the years itself: the library's writer otherwise spans from the earliest event to ten
 *     years past the latest and refuses a span over fifty.
 */
import { describe, expect, it } from 'vitest';
import { recordsToIcs, newIcsKey, icsKeyMatches, MAX_FEED_EVENTS } from '../../src/services/calendar-feed.js';

const count = (ics: string): number => (ics.match(/BEGIN:VEVENT/g) ?? []).length;

describe('recordsToIcs', () => {
  it('writes one VEVENT per record that is an event, and counts the rest as skipped', async () => {
    const feed = await recordsToIcs([
      { id: 'a', value: { id: 'a', title: 'Visit', start: '2026-11-03T09:00', end: '2026-11-03T10:00', timeZone: 'Europe/Helsinki' } },
      { id: 'b', value: { id: 'b', title: 'No times' } },
      { id: 'c', value: 'not an object' },
      { id: 'd', value: { id: 'd', title: 'Ends before it starts', start: '2026-11-03T10:00', end: '2026-11-03T09:00' } },
      { id: 'e', value: { id: 'e', title: 'A rule nobody can read', start: '2026-11-04T09:00', end: '2026-11-04T10:00', rrule: 'FREQ=SOMETIMES' } },
    ], 'Bookings');
    expect(feed.events).toBe(1);
    expect(feed.skipped).toBe(4);
    expect(count(feed.ics)).toBe(1);
    expect(feed.ics).toContain('UID:a');
    expect(feed.ics).toContain('X-WR-CALNAME:Bookings');
  });

  it('reads only an event\'s own fields from a record', async () => {
    const feed = await recordsToIcs([{ id: 'a', value: {
      id: 'a', title: 'Visit', start: '2026-11-03T09:00', end: '2026-11-03T10:00', location: 'Office',
      customerEmail: 'private.person@example.com', internalNote: 'do not show',
      overrides: { '2026-11-03T09:00': { title: 'Moved', secret: 'also not shown' } },
    } }]);
    expect(feed.ics).toContain('LOCATION:Office');
    expect(feed.ics).not.toContain('private.person@example.com');
    expect(feed.ics).not.toContain('do not show');
    expect(feed.ics).not.toContain('also not shown');
  });

  it('gives a record with no id of its own the record\'s id, and writes an id once', async () => {
    const feed = await recordsToIcs([
      { id: 'from-key', value: { title: 'First', start: '2026-11-03T09:00', end: '2026-11-03T10:00' } },
      { id: 'other-key', value: { id: 'from-key', title: 'Same id again', start: '2026-11-04T09:00', end: '2026-11-04T10:00' } },
    ]);
    expect(feed.events).toBe(1);
    expect(feed.skipped).toBe(1);
    expect(feed.ics).toContain('UID:from-key');
    expect(feed.ics).toContain('SUMMARY:First');
  });

  it('a series that began in 1970 does not end the feed for the other events', async () => {
    const feed = await recordsToIcs([
      { id: 'birthday', value: { id: 'birthday', title: 'Birthday', start: '1970-05-01', end: '1970-05-02', allDay: true, rrule: 'FREQ=YEARLY' } },
      { id: 'now', value: { id: 'now', title: 'Today', start: '2026-11-03T09:00', end: '2026-11-03T10:00', timeZone: 'Europe/Helsinki' } },
    ]);
    expect(feed.events).toBe(2);
    expect(feed.ics).toContain('RRULE:FREQ=YEARLY');
  });

  it('an empty space is an empty calendar, not an error', async () => {
    const feed = await recordsToIcs([]);
    expect(feed.events).toBe(0);
    expect(feed.ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(MAX_FEED_EVENTS).toBeGreaterThan(0);
  });
});

describe('the feed key', () => {
  it('a new key matches its own hash and no other', () => {
    const a = newIcsKey();
    const b = newIcsKey();
    expect(a.key).not.toBe(b.key);
    expect(a.key.length).toBeGreaterThanOrEqual(40);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(icsKeyMatches(a.hash, a.key)).toBe(true);
    expect(icsKeyMatches(a.hash, b.key)).toBe(false);
    expect(icsKeyMatches(b.hash, a.key)).toBe(false);
  });

  it('no hash, no key, a short key and a key that is not text open nothing', () => {
    const a = newIcsKey();
    expect(icsKeyMatches(null, a.key)).toBe(false);
    expect(icsKeyMatches(a.hash, undefined)).toBe(false);
    expect(icsKeyMatches(a.hash, '')).toBe(false);
    expect(icsKeyMatches(a.hash, 'short')).toBe(false);
    expect(icsKeyMatches(a.hash, [a.key])).toBe(false);
    expect(icsKeyMatches('not-hex', a.key)).toBe(false);
  });
});
