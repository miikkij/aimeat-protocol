/**
 * @file test/unit/ai-app-id.test.ts
 * @description One name per app in the AI budget (services/ai-app-id.ts), on the three forms the AI
 *   doors actually recorded on aimeat.io: `paatospaja`, `paatospaja.html` and
 *   `happydude500001/puhe.html`.
 * @version-history
 *   2026-10-25 — A cap or allowlist entry under an app's own bare name holds for its signed reference (secaudit2026oct22).
 *   2026-10-19 — namesSignedApp (wish-voice-routes-accept-the-app-s-own-file-name-as-app-id).
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalAiAppId, namesSignedApp, appSpentToday, appQuotaFor, appAllowlisted, mergePerApp,
} from '../../src/services/ai-app-id.js';

const OWNER = 'happydude500001@aimeat-finland-001-genesis';

describe('canonicalAiAppId', () => {
  it('folds the three recorded forms of one app into one name', () => {
    expect(canonicalAiAppId('paatospaja', OWNER)).toBe('paatospaja');
    expect(canonicalAiAppId('paatospaja.html', OWNER)).toBe('paatospaja');
    expect(canonicalAiAppId('happydude500001/puhe.html', OWNER)).toBe('puhe');
  });
  it('keeps another owner\'s prefix, so their app does not merge with one of the same name', () => {
    expect(canonicalAiAppId('someoneelse/puhe.html', OWNER)).toBe('someoneelse/puhe');
  });
  it('is undefined for no app', () => {
    expect(canonicalAiAppId(undefined, OWNER)).toBeUndefined();
    expect(canonicalAiAppId('  ', OWNER)).toBeUndefined();
    expect(canonicalAiAppId(42, OWNER)).toBeUndefined();
  });
});

describe('the budget reads every name an app was recorded under', () => {
  const perApp = { paatospaja: { cost_usd: 0.25 }, 'paatospaja.html': { cost_usd: 0.5 }, other: { cost_usd: 9 } };
  it('sums the day\'s spend across names', () => {
    expect(appSpentToday(perApp, 'paatospaja.html', OWNER)).toBe(0.75);
  });
  it('finds a cap saved under the full reference', () => {
    expect(appQuotaFor({ 'happydude500001/paatospaja.html': { daily_usd: 1 } }, 'paatospaja', OWNER, 5)).toBe(1);
    expect(appQuotaFor({}, 'paatospaja', OWNER, 5)).toBe(5);
  });
  it('allows an app listed under an older name', () => {
    expect(appAllowlisted(['paatospaja.html'], 'paatospaja', OWNER)).toBe(true);
    expect(appAllowlisted(['other'], 'paatospaja', OWNER)).toBe(false);
  });
  it('folds a day into one row per app', () => {
    const m = mergePerApp({ paatospaja: { cost_usd: 1, calls: 2 }, 'paatospaja.html': { cost_usd: 3, calls: 4 } }, OWNER);
    expect(m).toEqual({ paatospaja: { cost_usd: 4, calls: 6 } });
  });
});

describe('namesSignedApp: a body app_id against the app token\'s own app', () => {
  const SIGNED = 'happydude500001/puhe.html';
  it('accepts the bare file name, with or without .html, and the full reference', () => {
    expect(namesSignedApp('puhe.html', SIGNED)).toBe(true);
    expect(namesSignedApp('puhe', SIGNED)).toBe(true);
    expect(namesSignedApp('happydude500001/puhe.html', SIGNED)).toBe(true);
    expect(namesSignedApp('happydude500001/puhe', SIGNED)).toBe(true);
  });
  it('refuses another app of the same owner, and the same file name of another owner', () => {
    expect(namesSignedApp('other.html', SIGNED)).toBe(false);
    expect(namesSignedApp('happydude500001/other.html', SIGNED)).toBe(false);
    expect(namesSignedApp('someoneelse/puhe.html', SIGNED)).toBe(false);
    expect(namesSignedApp('', SIGNED)).toBe(false);
  });
});

describe('an app grant\'s call, attributed to its signed app (secaudit2026oct22)', () => {
  // Another author's app this owner uses: the owner saved its cap under the name it called itself.
  const SIGNED = 'someoneelse/puhe.html';
  it('a cap and an allowlist entry saved under the app\'s own bare name hold for its signed reference', () => {
    expect(appQuotaFor({ puhe: { daily_usd: 1 } }, SIGNED, OWNER, 5)).toBe(1);
    expect(appAllowlisted(['puhe.html'], SIGNED, OWNER)).toBe(true);
  });
  it('an entry of another app does not', () => {
    expect(appQuotaFor({ other: { daily_usd: 1 } }, SIGNED, OWNER, 5)).toBe(5);
    expect(appAllowlisted(['other'], SIGNED, OWNER)).toBe(false);
  });
});
