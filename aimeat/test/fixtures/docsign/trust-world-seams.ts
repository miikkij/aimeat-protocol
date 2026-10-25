/**
 * @file test/fixtures/docsign/trust-world-seams.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The trust world (trust-world.ts) wired to the validator's two fetch seams for a
 *   vitest file: every list and revocation fetch is answered from the world and recorded in
 *   `fetched`. The same wiring test/unit/docsign-trust-online.test.ts writes inline.
 * @structure useTrustWorld() · onlineConfig()
 * @usage const tw = useTrustWorld(); ... await validatePdf(onlineConfig(), tw.world.pdf.qualified)
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22 verdict-rule tests).
 */
import { beforeAll, afterAll } from 'vitest';
import { _setTrustListFetcher, clearTrustListCache } from '../../../src/services/docsign/trust-list.js';
import { _setRevocationFetcher } from '../../../src/services/docsign/revocation.js';
import { docsignDefaults } from '../../../src/config-docsign.js';
import type { AimeatConfig } from '../../../src/config.js';
import { buildTrustWorld, type TrustWorld } from './trust-world.js';

export const TRUST_BASE = 'http://trust.test';

/** A config with online checks on and the LOTL at the world's address. */
export const onlineConfig = (): AimeatConfig => ({
  ...docsignDefaults(), docsignOnlineChecks: true, docsignTrustAnchorsPath: '', docsignLotlSignerSha256: [],
  docsignLotlUrl: `${TRUST_BASE}/lotl.xml`,
}) as AimeatConfig;

/** Build the world before the file's tests and serve it through the seams; `world` is set in beforeAll. */
export function useTrustWorld(): { world: TrustWorld; fetched: string[] } {
  const state = { world: undefined as unknown as TrustWorld, fetched: [] as string[] };
  const served = (url: string): Buffer => {
    state.fetched.push(url);
    const f = state.world.files.get(url.slice(TRUST_BASE.length));
    if (!f) throw new Error(`HTTP 404 from ${url}`);
    return f.body;
  };
  beforeAll(() => {
    state.world = buildTrustWorld(TRUST_BASE);
    _setTrustListFetcher(async (url) => served(url).toString('utf8'));
    _setRevocationFetcher(async (url) => served(url));
    clearTrustListCache();
  }, 60_000);
  afterAll(() => {
    _setTrustListFetcher(async () => { throw new Error('offline in unit tests'); });
    clearTrustListCache();
  });
  return state;
}
