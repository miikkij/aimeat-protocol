/**
 * @file test/unit/sdk-format-person-prefs.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Dates, times and numbers that the served app libraries write follow the signed-in
 *   person's own `region` (how a date and a number are written) and `timezone` (which clock), and
 *   the reader's browser when the person set neither or nobody is signed in. The settings come from
 *   the person's own profile (GET /v1/ghii/me), read once per session by aimeat-auth
 *   (auth/display-prefs.js) and handed to _core/format.js through AIMEAT.auth.displayPrefs().
 *   AIMEAT.fmt (cortex aimeat-i18n), when the app has it, keeps deciding as before.
 *
 *   Every expected string is built with Intl from the same inputs, so the test holds in any
 *   default locale and zone; the person's region and zone are chosen far from any test machine's
 *   defaults, and each case first asserts that the two outputs differ, so a pass is not a tie.
 * @structure the formatter: person's settings · none · AIMEAT.fmt first · a pinned zone stays ·
 *   a refused tag falls back · the auth read: one read per person, the cache, sign-out, refusals
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-format-person-prefs.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 10b of 2026-11-05).
 */
/* eslint-disable aimeat/no-raw-locale-format -- the expected strings are Intl's own answers, the oracle the formatter is compared with */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fmt from '../../src/static/sdk-libs/_core/format.js';
import { makeDisplayPrefs } from '../../src/static/sdk-libs/auth/display-prefs.js';

const g = globalThis as any;
const REGION = 'ar-EG';
const ZONE = 'Pacific/Kiritimati';
const AT = Date.UTC(2026, 2, 1, 10, 30, 0); // 2026-03-01 10:30 UTC, 2026-03-02 00:30 in Kiritimati

let events: Array<{ type: string; detail: any }>;

/** A page whose aimeat-auth answers these settings, and optionally an AIMEAT.fmt. */
function page(prefs: { region: string | null; timezone: string | null } | null, fmtPack?: any) {
  events = [];
  g.window = {
    AIMEAT: {
      ...(prefs !== undefined ? { auth: { displayPrefs: () => prefs } } : {}),
      ...(fmtPack ? { fmt: fmtPack } : {}),
    },
    dispatchEvent: (e: any) => { events.push({ type: e.type, detail: e.detail }); return true; },
  };
}

beforeEach(() => { delete g.window; });
afterEach(() => { delete g.window; vi.restoreAllMocks(); });

describe('_core/format.js: the person\'s own settings', () => {
  it('a date, a time and both follow the person\'s region and clock', () => {
    page({ region: REGION, timezone: ZONE });
    const own = { timeZone: ZONE };
    const wantDate = new Date(AT).toLocaleDateString(REGION, own);
    expect(wantDate).not.toBe(new Date(AT).toLocaleDateString());
    expect(fmt.date(AT)).toBe(wantDate);
    expect(fmt.time(AT)).toBe(new Date(AT).toLocaleTimeString(REGION, own));
    expect(fmt.dateTime(AT)).toBe(new Date(AT).toLocaleString(REGION, own));
    // The caller's options still apply on top of the person's settings.
    expect(fmt.date(AT, { weekday: 'long' })).toBe(new Date(AT).toLocaleDateString(REGION, { weekday: 'long', timeZone: ZONE }));
  });

  it('a number and an amount follow the person\'s region', () => {
    page({ region: REGION, timezone: null });
    const want = (1234567.5).toLocaleString(REGION);
    expect(want).not.toBe((1234567.5).toLocaleString());
    expect(fmt.num(1234567.5)).toBe(want);
    expect(fmt.money(12.5, 'EUR')).toBe((12.5).toLocaleString(REGION, {
      style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
    }));
  });

  it('a clock alone, with no region, keeps the browser\'s way of writing', () => {
    page({ region: null, timezone: ZONE });
    expect(fmt.time(AT)).toBe(new Date(AT).toLocaleTimeString(undefined, { timeZone: ZONE }));
    expect(fmt.num(1234.5)).toBe((1234.5).toLocaleString());
  });

  it('nothing set, signed out, or no aimeat-auth: the browser, exactly as before', () => {
    for (const p of [{ region: null, timezone: null }, null]) {
      page(p);
      expect(fmt.date(AT)).toBe(new Date(AT).toLocaleDateString());
      expect(fmt.dateTime(AT, { hour: '2-digit' })).toBe(new Date(AT).toLocaleString(undefined, { hour: '2-digit' }));
      expect(fmt.num(1234.5)).toBe((1234.5).toLocaleString());
    }
    g.window = { AIMEAT: {} };
    expect(fmt.time(AT)).toBe(new Date(AT).toLocaleTimeString());
  });

  it('AIMEAT.fmt, when the app has it, keeps deciding', () => {
    const pack = { date: () => 'from-fmt', num: () => 'n-from-fmt' };
    page({ region: REGION, timezone: ZONE }, pack);
    expect(fmt.date(AT)).toBe('from-fmt');
    expect(fmt.num(3)).toBe('n-from-fmt');
  });

  it('a calendar day stays pinned: the person\'s clock never moves it, their region writes it', () => {
    page({ region: REGION, timezone: ZONE });
    const noon = new Date(Date.UTC(2026, 2, 1, 12));
    const want = noon.toLocaleDateString(REGION, { timeZone: 'UTC' });
    expect(want).not.toBe(noon.toLocaleDateString(undefined, { timeZone: 'UTC' }));
    expect(fmt.calendar('2026-03-01')).toBe(want);
    // A caller that names its own clock keeps it.
    expect(fmt.dateTime(AT, { timeZone: 'UTC' })).toBe(new Date(AT).toLocaleString(REGION, { timeZone: 'UTC' }));
  });

  it('a setting the browser refuses falls back to the browser, never to an error or an empty string', () => {
    page({ region: 'en-GB', timezone: 'Not/AZone' });
    expect(fmt.dateTime(AT)).toBe(new Date(AT).toLocaleString());
  });

  it('words keep following the page language, not the region', () => {
    page({ region: REGION, timezone: ZONE });
    const before = fmt.duration(90061000);
    page(null);
    expect(fmt.duration(90061000)).toBe(before);
  });
});

describe('auth/display-prefs.js: the read of the person\'s own profile', () => {
  function store() {
    const m = new Map<string, any>();
    return {
      map: m,
      save: (k: string, v: any) => { m.set(k, JSON.parse(JSON.stringify(v))); },
      load: (k: string) => (m.has(k) ? m.get(k) : null),
      remove: (k: string) => { m.delete(k); },
    };
  }
  function session(ghii: string, answer: any, extra: Record<string, any> = {}) {
    const calls: string[] = [];
    return {
      calls,
      s: { ghii, owner: ghii.split('@')[0], ...extra, fetch: async (p: string) => { calls.push(p); return answer; } },
    };
  }
  const flush = () => new Promise(r => setTimeout(r, 0));

  it('reads GET /v1/ghii/me once for the signed-in person and announces what arrived', async () => {
    page(null);
    const st = store();
    const { s, calls } = session('alice@n1', { ok: true, data: { region: REGION, timezone: ZONE, bio: 'x' } });
    const prefs = makeDisplayPrefs(() => s, st);
    expect(prefs.current()).toEqual({ region: null, timezone: null });
    await flush();
    expect(calls).toEqual(['/v1/ghii/me']);
    expect(prefs.current()).toEqual({ region: REGION, timezone: ZONE });
    expect(events).toEqual([{ type: 'aimeat-prefs-change', detail: { region: REGION, timezone: ZONE } }]);
    await flush();
    expect(calls.length).toBe(1);
    // Only the two settings are kept, never the rest of the profile.
    expect(st.map.get('display-prefs')).toEqual({ who: 'alice@n1', region: REGION, timezone: ZONE });
  });

  it('the next page load starts from the person\'s kept settings, and says nothing when the read agrees', async () => {
    page(null);
    const st = store();
    st.save('display-prefs', { who: 'alice@n1', region: REGION, timezone: ZONE });
    const { s } = session('alice@n1', { ok: true, data: { region: REGION, timezone: ZONE } });
    const prefs = makeDisplayPrefs(() => s, st);
    expect(prefs.current()).toEqual({ region: REGION, timezone: ZONE });
    await flush();
    expect(events).toEqual([]);
  });

  it('another person\'s kept settings are never used', async () => {
    page(null);
    const st = store();
    st.save('display-prefs', { who: 'bob@n1', region: REGION, timezone: ZONE });
    const { s } = session('carol@n1', { ok: true, data: { region: null, timezone: null } });
    const prefs = makeDisplayPrefs(() => s, st);
    expect(prefs.current()).toEqual({ region: null, timezone: null });
  });

  it('a person who set nothing reads as the browser', async () => {
    page(null);
    const { s } = session('alice@n1', { ok: true, data: { region: null, timezone: null } });
    const prefs = makeDisplayPrefs(() => s, store());
    prefs.current();
    await flush();
    expect(prefs.current()).toEqual({ region: null, timezone: null });
    expect(events).toEqual([]);
  });

  it('signed out: the browser, and the settings of whoever was here before are dropped', async () => {
    page(null);
    const { s } = session('alice@n1', { ok: true, data: { region: REGION, timezone: ZONE } });
    let live: any = s;
    const prefs = makeDisplayPrefs(() => live, store());
    prefs.current();
    await flush();
    expect(prefs.current()).toEqual({ region: REGION, timezone: ZONE });
    live = null;
    expect(prefs.current()).toEqual({ region: null, timezone: null });
  });

  it('a visitor from another node: no read (their profile lives on their home node)', async () => {
    page(null);
    const { s, calls } = session('dave@other', { ok: true, data: { region: REGION } }, { federated: true });
    const prefs = makeDisplayPrefs(() => s, store());
    expect(prefs.current()).toEqual({ region: null, timezone: null });
    await flush();
    expect(calls).toEqual([]);
  });

  it('a refused read changes nothing', async () => {
    page(null);
    const { s } = session('alice@n1', { ok: false, error: { code: 'NOT_FOUND' } });
    const prefs = makeDisplayPrefs(() => s, store());
    prefs.current();
    await flush();
    expect(prefs.current()).toEqual({ region: null, timezone: null });
    expect(events).toEqual([]);
  });

  it('sign-out forgets the settings and the kept copy', async () => {
    page(null);
    const st = store();
    const { s } = session('alice@n1', { ok: true, data: { region: REGION, timezone: ZONE } });
    let live: any = s;
    const prefs = makeDisplayPrefs(() => live, st);
    prefs.current();
    await flush();
    prefs.forget();
    live = null;
    expect(prefs.current()).toEqual({ region: null, timezone: null });
    expect(st.map.has('display-prefs')).toBe(false);
  });

  it('a read that lands after the person signed out is dropped', async () => {
    page(null);
    let release: (v: any) => void = () => {};
    const s = { ghii: 'alice@n1', fetch: () => new Promise(r => { release = r; }) };
    let live: any = s;
    const st = store();
    const prefs = makeDisplayPrefs(() => live, st);
    prefs.current();
    prefs.forget();
    live = null;
    release({ ok: true, data: { region: REGION, timezone: ZONE } });
    await flush();
    expect(prefs.current()).toEqual({ region: null, timezone: null });
    expect(st.map.has('display-prefs')).toBe(false);
  });
});
