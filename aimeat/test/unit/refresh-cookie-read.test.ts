/**
 * @file test/unit/refresh-cookie-read.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description readRefreshCookie (services/owner-session.ts) on the Cookie headers a browser can send.
 *   A malformed percent-encoding in an aimeat_rt value made decodeURIComponent throw inside every
 *   caller (POST /v1/auth/refresh, the app-grant silent bridge, sign-out), so a cookie written by a
 *   same-site page broke sign-in for that browser until it was cleared by hand (secaudit2026oct22,
 *   refresh-cookie-unprefixed-first-match, the decode half).
 * @version-history
 *   2026-10-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { readRefreshCookie } from '../../src/services/owner-session.js';

const withCookie = (cookie: string | undefined) => ({ headers: cookie === undefined ? {} : { cookie } }) as unknown as Request;

describe('readRefreshCookie', () => {
  it('reads the refresh token, decoded (the ordinary case keeps working)', () => {
    expect(readRefreshCookie(withCookie('other=1; aimeat_rt=abc%2Bdef'))).toBe('abc+def');
  });

  it('answers null when there is no cookie or no aimeat_rt', () => {
    expect(readRefreshCookie(withCookie(undefined))).toBeNull();
    expect(readRefreshCookie(withCookie('other=1'))).toBeNull();
  });

  it('answers null for a value that is not valid percent-encoding, instead of throwing', () => {
    expect(() => readRefreshCookie(withCookie('aimeat_rt=%E0%A4%A'))).not.toThrow();
    expect(readRefreshCookie(withCookie('aimeat_rt=%E0%A4%A'))).toBeNull();
  });
});
