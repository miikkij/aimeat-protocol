/**
 * @file test/unit/cortex-i18n-fmt-profile.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The cortex pack aimeat-i18n's AIMEAT.fmt (public/cortex-bundled/aimeat-i18n.js),
 *   two defects of decision 10b (dates and numbers follow the person's own setting):
 *   1. fmt.useProfile() reads GET /v1/ghii/me with the app's own aimeat-auth session. The plain
 *      same-origin fetch it made carried no credential and answered 401 on an app origin, so the
 *      person's settings never arrived. Signed out, or a visitor from another node: no read, the
 *      browser. A page without aimeat-auth keeps the plain fetch.
 *   2. A timeZone the caller names is kept; the person's zone is added only when the caller named
 *      none. Before, the person's zone replaced it, so the served libraries' calendar(), pinned to
 *      noon UTC, wrote the next day for a zone past UTC+12.
 *   The pack is a browser IIFE; it is run here with a stand-in window, the way a page runs it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/cortex-i18n-fmt-profile.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 10b of 2026-11-05).
 */
/* eslint-disable aimeat/no-raw-locale-format -- the expected strings are Intl's own answers, the oracle the pack is compared with */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(fileURLToPath(new URL('../../public/cortex-bundled/aimeat-i18n.js', import.meta.url)), 'utf8');
const REGION = 'ar-EG';
const ZONE = 'Pacific/Kiritimati';

/** Run the pack against a stand-in window; answers that window's AIMEAT and the plain fetches it made. */
function load(auth?: any) {
  const plain: Array<{ url: string; init: any }> = [];
  const win: any = { AIMEAT: auth ? { auth } : {} };
  const fetchStub = async (url: string, init: any) => {
    plain.push({ url, init });
    return { ok: false, json: async () => null };
  };
  // The pack is a classic script, so it runs as one, with the window and fetch handed in.
  new Function('window', 'fetch', SRC)(win, fetchStub);
  return { fmt: win.AIMEAT.fmt, plain };
}

function session(answer: any, extra: Record<string, any> = {}) {
  const calls: string[] = [];
  return { calls, s: { ghii: 'alice@n1', ...extra, fetch: async (p: string) => { calls.push(p); return answer; } } };
}

describe('aimeat-i18n fmt.useProfile(): the app\'s own session', () => {
  it('reads /v1/ghii/me through aimeat-auth\'s session and takes the person\'s settings', async () => {
    const { s, calls } = session({ ok: true, data: { region: REGION, timezone: ZONE } });
    const { fmt, plain } = load({ getSession: () => s });
    expect(await fmt.useProfile()).toEqual({ region: REGION, timezone: ZONE });
    expect(calls).toEqual(['/v1/ghii/me']);
    expect(plain).toEqual([]);
    const at = Date.UTC(2026, 2, 1, 10, 30);
    const want = new Date(at).toLocaleString(REGION, { timeZone: ZONE });
    expect(want).not.toBe(new Date(at).toLocaleString());
    expect(fmt.dateTime(at)).toBe(want);
  });

  it('signed out: no read, the browser', async () => {
    const { fmt, plain } = load({ getSession: () => null });
    expect(await fmt.useProfile()).toEqual({ region: null, timezone: null });
    expect(plain).toEqual([]);
  });

  it('a visitor from another node: no read, the browser', async () => {
    const { s, calls } = session({ ok: true, data: { region: REGION } }, { federated: true });
    const { fmt } = load({ getSession: () => s });
    expect(await fmt.useProfile()).toEqual({ region: null, timezone: null });
    expect(calls).toEqual([]);
  });

  it('a refused read: the browser', async () => {
    const { s } = session({ ok: false, error: { code: 'NOT_FOUND' } });
    const { fmt } = load({ getSession: () => s });
    expect(await fmt.useProfile()).toEqual({ region: null, timezone: null });
  });

  it('a page without aimeat-auth keeps the plain same-origin fetch it always made', async () => {
    const { fmt, plain } = load();
    expect(await fmt.useProfile()).toEqual({ region: null, timezone: null });
    expect(plain).toEqual([{ url: '/v1/ghii/me', init: { credentials: 'same-origin' } }]);
  });
});

describe('aimeat-i18n fmt: a timeZone the caller names is kept', () => {
  it('a UTC-pinned calendar day stays that day in a zone past UTC+12', () => {
    const { fmt } = load();
    fmt.use({ region: REGION, timezone: ZONE });
    const noon = new Date(Date.UTC(2026, 2, 1, 12));
    const want = noon.toLocaleDateString(REGION, { timeZone: 'UTC' });
    expect(want).not.toBe(noon.toLocaleDateString(REGION, { timeZone: ZONE }));
    expect(fmt.date(noon, { timeZone: 'UTC' })).toBe(want);
    expect(fmt.dateTime(noon, { timeZone: 'UTC' })).toBe(noon.toLocaleString(REGION, { timeZone: 'UTC' }));
  });

  it('with no zone named, the person\'s zone still applies', () => {
    const { fmt } = load();
    fmt.use({ region: REGION, timezone: ZONE });
    const at = Date.UTC(2026, 2, 1, 10, 30);
    expect(fmt.time(at)).toBe(new Date(at).toLocaleTimeString(REGION, { timeZone: ZONE }));
  });
});
