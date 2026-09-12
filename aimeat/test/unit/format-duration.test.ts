/**
 * @file test/unit/format-duration.test.ts
 * @description A LENGTH OF TIME, written in the reader's own language and their own shorthand.
 *
 *   WHY THIS EXISTS. Four surfaces built a duration by hand — `d + 'd ' + hr + 'h ' + m + 'm'` and
 *   three variants of it — so a fully Finnish scheduler page read `1d 23h 26min`. It is not the
 *   format-from-language defect the rest of this work removed; it is plain untranslated text, and
 *   it needs a different answer.
 *
 *   AND THE ANSWER IS NOT A TRANSLATION KEY. `{n} pv sitten` survives Finnish only because `pv`
 *   does not inflect. It cannot say `eilen`, and one `{n}` cannot carry a language where the noun
 *   changes with the number: Polish writes `1 dzień` but `2 dni` and `5 dni`, Russian `1 день`,
 *   `2 дня`, `5 дней`. CLDR already knows every one of those rules and `Intl.DurationFormat` reads
 *   them, so the right move is to ask the platform rather than to keep a table.
 *
 *   THE ASSERTIONS ARE DELIBERATELY ABOUT SHAPE, not about exact CLDR strings. A future ICU may
 *   respell an abbreviation, and a test that pins `1pv 23t` would then fail on a tree where nothing
 *   is wrong. What must hold is that the units are the reader's words, that the short form is the
 *   default, that a caller can ask for the long one, and that `max` decides how many units appear.
 * @usage cd aimeat && pnpm exec vitest run test/unit/format-duration.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Written with duration() itself.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* The browser modules read `window`, and format.js reaches display-prefs.js, which reaches api.js
   and through it auth.js — and auth.js subscribes to an event at module scope. Nothing is fetched
   at import time, so the stubs only have to exist and do nothing. */
const noop = () => {};
Object.assign(globalThis, {
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
});
(globalThis as unknown as { window: unknown }).window = globalThis;

let duration: (ms: unknown, opts?: Record<string, unknown>) => string;
let relative: (s: unknown) => string;
let ago: (s: unknown, opts?: { horizonDays?: number }) => string;

beforeAll(async () => {
    const mod = await import('../../public/js/format.js') as {
        duration: typeof duration; relative: typeof relative; ago: typeof ago;
    };
    duration = mod.duration;
    relative = mod.relative;
    ago = mod.ago;
});

describe('duration: a span in the reader\'s own words', () => {
    it('writes the short form by default, and the platform spells the units', () => {
        const out = duration(1 * DAY + 23 * HOUR + 26 * MINUTE);
        expect(out).toContain('1');
        expect(out).toContain('23');
        expect(out).toContain('26');
        // What must hold is that CLDR wrote this and no table did. Comparing against Intl itself
        // says exactly that, in any language, and stays true when ICU respells an abbreviation.
        //
        // The assertion here until 2026-09-13 was `not.toMatch(/\d\s*d\s+\d+\s*h\b/)`, meaning
        // "nothing reads as the hand-built 1d 23h 26min this replaced". It passed for whoever
        // wrote it and was red on every CI run for a day, because in English CLDR's own narrow
        // form IS `1d 23h 26m`. The regex could not tell the platform's English from the hand-built
        // English, so it only ever passed on a machine whose default locale was something else.
        // A test that encodes one machine's environment fails on every other one.
        expect(out).toBe(new Intl.DurationFormat(undefined, { style: 'narrow' })
            .format({ days: 1, hours: 23, minutes: 26 }));
    });

    it('a caller that wants the long form asks for it, and gets whole words', () => {
        const short = duration(2 * HOUR + 5 * MINUTE);
        const long = duration(2 * HOUR + 5 * MINUTE, { style: 'long' });
        expect(long).not.toBe(short);
        expect(long.length).toBeGreaterThan(short.length);
    });

    it('max decides how many units appear, biggest first', () => {
        const ms = 1 * DAY + 23 * HOUR + 26 * MINUTE;
        const two = duration(ms, { max: 2 });
        expect(two).toContain('1');
        expect(two).toContain('23');
        expect(two).not.toContain('26');
    });

    it('drops the units that are empty rather than printing a zero for them', () => {
        const out = duration(7 * MINUTE);
        expect(out).toContain('7');
        expect(out).not.toMatch(/\b0\b/);
    });

    it('a span under a minute still says something, because "" reads as broken', () => {
        expect(duration(8_000)).toContain('8');
        expect(duration(0)).toBeTruthy();
    });

    it('a value that is not a number comes back as a dash rather than as NaN', () => {
        expect(duration(null)).not.toMatch(/NaN/);
        expect(duration(undefined)).not.toMatch(/NaN/);
        expect(duration('nope')).not.toMatch(/NaN/);
    });

    it('a negative span is read as its length, not as a minus sign in the middle of the words', () => {
        expect(duration(-(2 * HOUR))).not.toContain('-');
    });
});

describe('relative: a point in the past, which is a different question', () => {
    it('says how long ago rather than how long, and does it in words', () => {
        const out = relative(new Date(Date.now() - 3 * DAY).toISOString());
        expect(out).toBeTruthy();
        expect(out).not.toMatch(/^\d+d$/);
        expect(out).not.toContain('NaN');
    });
});

describe('ago: the phrase until the phrase stops helping', () => {
    it('inside the horizon it reads as a phrase, outside it reads as a date', () => {
        const near = ago(new Date(Date.now() - 2 * DAY), { horizonDays: 7 });
        const far = ago(new Date(Date.now() - 40 * DAY), { horizonDays: 7 });
        expect(near).toBe(relative(new Date(Date.now() - 2 * DAY)));
        // A date carries its own separators; a phrase carries a word. They must not be the same.
        expect(far).not.toBe(near);
        expect(far).toMatch(/\d/);
    });

    it('a horizon of Infinity never stops counting, which is what a feed wants', () => {
        const out = ago(new Date(Date.now() - 400 * DAY), { horizonDays: Infinity });
        expect(out).toBe(relative(new Date(Date.now() - 400 * DAY)));
    });

    it('thirty days is the default, because that is where three of the four copies sat', () => {
        const inside = ago(new Date(Date.now() - 20 * DAY));
        expect(inside).toBe(relative(new Date(Date.now() - 20 * DAY)));
    });

    it('nothing in, nothing out — an empty stamp is not an error', () => {
        expect(ago('')).toBe('');
        expect(ago('not a date')).toBe('');
    });
});
