/**
 * @file test/unit/sdk-atelier-timeline-ts.test.ts
 * @description What the timeline does with the `ts` it is handed. The kit formatted ANY string it
 *   could get a date out of, and V8's legacy date reader gets one out of far too much: an app that
 *   handed over its own English wording `07/09, 04:10` saw 9 July 2001 on every event, while the
 *   Finnish `07.09. klo 01.30` failed to parse and was printed as written, which made the Finnish
 *   page look right by accident (appdev pitfall timeline-reparses-the-date-you-hand-it,
 *   2026-09-06). A string is formatted now only when it is a machine form with its year in it; any
 *   other wording is the app's and is printed as it came.
 *
 *   The second half is the `when` slot: an app that brings its own wording must not have the kit's
 *   formatter run on the item anyway, and an event with no moment at all must not be dated 1970 or
 *   read "undefined".
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-atelier-timeline-ts.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

type AnyEl = any;

let restore: any;
let timeline: (spec: any) => any;
let doc: AnyEl;

beforeAll(async () => {
  restore = installGlobals({ motion: 'auto' });
  doc = restore.document;
  ({ timeline } = await import(new URL('../../src/static/sdk-libs/atelier/timeline.js', import.meta.url).href));
});

afterAll(() => { if (restore) restore(); });

/** The text in the moment line of a one-event timeline, or null when it drew none. */
function whenOf(item: any, extra: any = {}): string | null {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const line = timeline(Object.assign({ target: host, items: [Object.assign({ id: 'a', title: 'x' }, item)] }, extra));
  const node = host.querySelector('.ak-timeline__when');
  const text = node ? node.textContent : null;
  line.destroy();
  return text;
}

describe('timeline: a wording the app wrote is printed as written', () => {
  it('prints an English day and month without a year exactly as given', () => {
    expect(whenOf({ ts: '07/09, 04:10' })).toBe('07/09, 04:10');
  });

  it('prints a Finnish wording exactly as given', () => {
    expect(whenOf({ ts: '07.09. klo 01.30' })).toBe('07.09. klo 01.30');
  });

  it('prints a slashed date with a year as given too, because day and month order is the writer\'s', () => {
    expect(whenOf({ ts: '07/09/2026 04:10' })).toBe('07/09/2026 04:10');
  });
});

describe('timeline: a machine moment is still formatted for the reader', () => {
  it('formats an ISO 8601 moment', () => {
    const text = whenOf({ ts: '2026-09-07T01:30:00Z' });
    expect(text).not.toBe('2026-09-07T01:30:00Z');
    expect(text).toContain('2026');
  });

  it('formats a date-only ISO string as a calendar day', () => {
    const text = whenOf({ ts: '2026-08-26' });
    expect(text).not.toBe('2026-08-26');
    expect(text).toContain('2026');
  });

  it('formats a Date and an epoch number', () => {
    const at = Date.UTC(2026, 8, 7, 12, 0, 0);
    expect(whenOf({ ts: new Date(at) })).toContain('2026');
    expect(whenOf({ ts: at })).toContain('2026');
  });

  it('formats the HTTP and RSS form, which names its month and carries its year', () => {
    const text = whenOf({ ts: 'Mon, 07 Sep 2026 01:30:00 GMT' });
    expect(text).not.toBe('Mon, 07 Sep 2026 01:30:00 GMT');
    expect(text).toContain('2026');
  });
});

describe('timeline: the when slot and an event with no moment', () => {
  it('does not run the formatter on an item whose moment the when slot draws', () => {
    const seen: any[] = [];
    const text = whenOf({ at: 'my words' }, {
      format: (ts: any) => { seen.push(ts); return 'kit words'; },
      parts: { when: (item: any) => item.at },
    });
    expect(text).toBe('my words');
    expect(seen).toEqual([]);
  });

  it('draws no moment line for an event without one, instead of a date in 1970 or "undefined"', () => {
    expect(whenOf({})).toBe(null);
    expect(whenOf({ ts: null })).toBe(null);
  });
});
