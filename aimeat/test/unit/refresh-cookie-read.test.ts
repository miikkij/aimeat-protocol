/**
 * @file test/unit/refresh-cookie-read.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description readRefreshCookie, setRefreshCookie, clearRefreshCookie and the migration window
 *   (services/owner-session.ts) on the Cookie headers a browser can send. A malformed percent-encoding
 *   in an aimeat_rt value made decodeURIComponent throw inside every caller; and the cookie was not
 *   host-locked, so a same-site app origin could write a Domain cookie of the same name that the apex
 *   read first (secaudit2026oct22, refresh-cookie-unprefixed-first-match).
 * @version-history
 *   2026-10-25 — https nodes: `__Host-aimeat_rt` with Path=/ and Secure; the old name inside the window
 *     only, never as a PAT, never as a duplicate; settleRefreshCookieWindowAtStart.
 *   2026-10-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import {
  readRefreshCookie, setRefreshCookie, clearRefreshCookie, legacyRefreshCookieAccepted,
  settleRefreshCookieWindowAtStart, REFRESH_COOKIE, LEGACY_REFRESH_COOKIE,
} from '../../src/services/owner-session.js';
import type { AimeatConfig } from '../../src/config.js';

const OPEN = { refreshCookieLegacyUntil: '2999-12-31' };
const CLOSED = { refreshCookieLegacyUntil: '2000-01-01' };

const withCookie = (cookie: string | undefined, https = false) => ({
  headers: { ...(cookie === undefined ? {} : { cookie }), ...(https ? { 'x-forwarded-proto': 'https' } : {}) },
  secure: false,
}) as unknown as Request;

function recorder() {
  const set: Array<{ name: string; value: string; opts: Record<string, unknown> }> = [];
  const cleared: Array<{ name: string; opts: Record<string, unknown> }> = [];
  const res = {
    cookie(name: string, value: string, opts: Record<string, unknown>) { set.push({ name, value, opts }); return res; },
    clearCookie(name: string, opts: Record<string, unknown>) { cleared.push({ name, opts }); return res; },
  };
  return { res: res as unknown as Response, set, cleared };
}

const cfg = { refreshAbsoluteDays: 90, refreshCookieLegacyUntil: '2999-12-31' } as unknown as AimeatConfig;

describe('readRefreshCookie', () => {
  it('reads the refresh token, decoded (the ordinary case keeps working)', () => {
    expect(readRefreshCookie(withCookie('other=1; aimeat_rt=abc%2Bdef'), OPEN)).toBe('abc+def');
  });

  it('answers null when there is no cookie or no aimeat_rt', () => {
    expect(readRefreshCookie(withCookie(undefined), OPEN)).toBeNull();
    expect(readRefreshCookie(withCookie('other=1'), OPEN)).toBeNull();
  });

  it('answers null for a value that is not valid percent-encoding, instead of throwing', () => {
    expect(() => readRefreshCookie(withCookie('aimeat_rt=%E0%A4%A'), OPEN)).not.toThrow();
    expect(readRefreshCookie(withCookie('aimeat_rt=%E0%A4%A'), OPEN)).toBeNull();
  });

  it('on https the __Host- cookie wins over an aimeat_rt listed before it', () => {
    expect(readRefreshCookie(withCookie('aimeat_rt=planted; __Host-aimeat_rt=mine', true), OPEN)).toBe('mine');
  });

  it('two aimeat_rt values are read as none', () => {
    expect(readRefreshCookie(withCookie('aimeat_rt=planted; aimeat_rt=mine'), OPEN)).toBeNull();
    expect(readRefreshCookie(withCookie('aimeat_rt=planted; aimeat_rt=mine', true), OPEN)).toBeNull();
  });

  it('on https the old name is read inside the window, and ignored after it', () => {
    expect(readRefreshCookie(withCookie('aimeat_rt=old', true), OPEN)).toBe('old');
    expect(readRefreshCookie(withCookie('aimeat_rt=old', true), CLOSED)).toBeNull();
    // Plain http keeps the old name whatever the window says.
    expect(readRefreshCookie(withCookie('aimeat_rt=old'), CLOSED)).toBe('old');
  });

  it('on https a personal access token under the old name is not read', () => {
    expect(readRefreshCookie(withCookie('aimeat_rt=aimeat_pat_xyz', true), OPEN)).toBeNull();
    expect(readRefreshCookie(withCookie('aimeat_rt=aimeat_pat_xyz'), OPEN)).toBe('aimeat_pat_xyz');
  });

  it('the window holds to the end of the named UTC day', () => {
    const day = { refreshCookieLegacyUntil: '2026-11-24' };
    expect(legacyRefreshCookieAccepted(day, Date.parse('2026-11-24T23:00:00Z'))).toBe(true);
    expect(legacyRefreshCookieAccepted(day, Date.parse('2026-11-25T00:00:01Z'))).toBe(false);
    expect(legacyRefreshCookieAccepted({ refreshCookieLegacyUntil: '' })).toBe(true);
  });
});

describe('setRefreshCookie / clearRefreshCookie', () => {
  it('on https sets __Host-aimeat_rt with Path=/ and Secure, and clears the old name the browser sent', () => {
    const r = recorder();
    setRefreshCookie(withCookie('aimeat_rt=old', true), r.res, cfg, 'tok');
    expect(r.set).toHaveLength(1);
    expect(r.set[0].name).toBe(REFRESH_COOKIE);
    expect(REFRESH_COOKIE).toBe('__Host-aimeat_rt');
    expect(r.set[0].opts).toMatchObject({ path: '/', secure: true, httpOnly: true, sameSite: 'strict' });
    expect(r.set[0].opts.domain).toBeUndefined();
    expect(r.cleared.map(c => [c.name, c.opts.path])).toEqual([[LEGACY_REFRESH_COOKIE, '/v1/auth']]);
  });

  it('on plain http keeps aimeat_rt with Path=/v1/auth', () => {
    const r = recorder();
    setRefreshCookie(withCookie(undefined), r.res, cfg, 'tok');
    expect(r.set.map(c => [c.name, c.opts.path, c.opts.secure])).toEqual([[LEGACY_REFRESH_COOKIE, '/v1/auth', false]]);
    expect(r.cleared).toHaveLength(0);
  });

  it('clear on https ends both names', () => {
    const r = recorder();
    clearRefreshCookie(withCookie(undefined, true), r.res);
    expect(r.cleared.map(c => c.name).sort()).toEqual([REFRESH_COOKIE, LEGACY_REFRESH_COOKIE].sort());
  });
});

describe('settleRefreshCookieWindowAtStart', () => {
  it('sets an empty window to 30 days after the start and stores it; a set window stays', async () => {
    const stored: Record<string, string> = {};
    const storage = { supportsConfigPersistence: () => true, async setConfigValue(k: string, v: string) { stored[k] = v; } };
    const c = { refreshCookieLegacyUntil: '' } as unknown as AimeatConfig;
    await settleRefreshCookieWindowAtStart(c, storage, Date.parse('2026-10-25T10:00:00Z'));
    expect(c.refreshCookieLegacyUntil).toBe('2026-11-24');
    expect(stored['auth.refresh_cookie_legacy_until']).toBe('2026-11-24');

    const kept = { refreshCookieLegacyUntil: '2026-12-01' } as unknown as AimeatConfig;
    await settleRefreshCookieWindowAtStart(kept, storage, Date.parse('2027-01-01T00:00:00Z'));
    expect(kept.refreshCookieLegacyUntil).toBe('2026-12-01');
  });
});
