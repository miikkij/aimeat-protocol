/**
 * @file test/unit/chart-colors-and-percent.test.ts
 * @description Two page formats that used to be wrong without anything erroring.
 *
 *   A chart series colour (public/js/series-colors.js, re-exported by components/UsageChart.js as
 *   colorForIndex): it cycled with `i % 12`, so the thirteenth series wore the first one's colour,
 *   and in a stacked bar the two could not be told apart. The first twelve
 *   stay the palette; from there on no two indexes share a colour.
 *
 *   A percentage on the economy page (public/js/format.js percent()): the decimal comma was picked
 *   by the page's language, so a reader whose region is not their language's got the other format
 *   (docs/pitfalls.md §81). It follows the reader's region now, and so does the home overview's short
 *   count (compact()), which wrote the Finnish "1,2 t." for every reader.
 *
 *   Seen red first: against the cycling colorForIndex the distinctness case fails at index 12, and
 *   percent() did not exist.
 * @usage cd aimeat && pnpm exec vitest run test/unit/chart-colors-and-percent.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// format.js reaches display-prefs.js and through it api.js and auth.js, which read `window` at module
// scope; nothing is fetched at import time (the same stubs as format-duration.test.ts).
const noop = () => {};
const htmlEl = { lang: '' as string, getAttribute(key: string) { return key === 'lang' ? (this.lang || null) : null; } };
Object.assign(globalThis, {
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  document: { documentElement: htmlEl, querySelector: () => null },
});
(globalThis as unknown as { window: unknown }).window = globalThis;

let seriesColor: (i: number) => string;
let SERIES_PALETTE: string[];
let percent: (n: unknown) => string;
let compact: (n: unknown) => string;
let setDisplayPrefs: (p: { region?: string | null; timezone?: string | null } | null) => void;

beforeAll(async () => {
  ({ seriesColor, SERIES_PALETTE } = await import('../../public/js/series-colors.js') as { seriesColor: typeof seriesColor; SERIES_PALETTE: string[] });
  ({ percent, compact } = await import('../../public/js/format.js') as { percent: typeof percent; compact: typeof compact });
  ({ setDisplayPrefs } = await import('../../public/js/display-prefs.js') as { setDisplayPrefs: typeof setDisplayPrefs });
});
afterEach(() => { setDisplayPrefs(null); htmlEl.lang = ''; });

describe('a chart series colour', () => {
  it('keeps the twelve palette colours for the first twelve series', () => {
    expect(Array.from({ length: 12 }, (_, i) => seriesColor(i))).toEqual(SERIES_PALETTE);
  });

  it('gives eighty series eighty different colours', () => {
    const colours = Array.from({ length: 80 }, (_, i) => seriesColor(i));
    expect(new Set(colours).size).toBe(80);
    expect(seriesColor(12)).not.toBe(seriesColor(0));
  });

  it('gives an index that found nothing the palette\'s last colour, as before', () => {
    expect(seriesColor(-1)).toBe(SERIES_PALETTE[11]);
    expect(seriesColor(Number.NaN)).toBe(SERIES_PALETTE[11]);
  });
});

describe('a percentage in the reader\'s own format', () => {
  it('writes the decimal comma for a Finnish region, also on an English page', () => {
    htmlEl.lang = 'en';
    setDisplayPrefs({ region: 'fi-FI' });
    expect(percent(3.25).replace(/\s/g, ' ')).toBe('3,25 %');
  });

  it('writes the decimal point for a British region, also on a Finnish page, and reads a string', () => {
    htmlEl.lang = 'fi';
    setDisplayPrefs({ region: 'en-GB' });
    expect(percent('3.25')).toBe('3.25%');
  });

  it('writes an em dash for something that is not a number', () => {
    expect(percent('n/a')).toBe('—');
    expect(percent(undefined)).toBe('—');
  });
});

describe('a short count in the reader\'s own format (the home overview)', () => {
  it('gives a Finnish reader what the page wrote by hand before', () => {
    setDisplayPrefs({ region: 'fi-FI' });
    const norm = (s: string) => s.replace(/\s/g, ' ');
    expect(norm(compact(1234))).toBe('1,2 t.');
    expect(norm(compact(12345))).toBe('12 t.');
  });

  it('gives a British reader the English short form, not the Finnish one', () => {
    setDisplayPrefs({ region: 'en-GB' });
    expect(compact(1234)).toBe('1.2K');
  });

  it('leaves a count under a thousand as it is', () => {
    setDisplayPrefs({ region: 'fi-FI' });
    expect(compact(999)).toBe('999');
    expect(compact(0)).toBe('0');
  });
});
