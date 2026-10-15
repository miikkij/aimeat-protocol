/**
 * @file test/unit/test-switches.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description QA audit D8-01. The test-only settings other than the test money handler had no start
 *   warning and no Security-page finding on a node other people reach. Each one, set on a node whose
 *   public URL is not a loopback address, is now one ACTIVE line in the start log and a critical
 *   `now.test_switches` on the Security page; on a loopback test node nothing warns.
 * @usage cd aimeat && pnpm exec vitest run test/unit/test-switches.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit D8-01).
 */
import { describe, expect, it } from 'vitest';
import { securityPostureWarnings } from '../../src/config-posture.js';
import { testSwitchesOnPublicNode } from '../../src/utils/test-switches.js';
import { buildSecurityOverview } from '../../src/services/security-overview.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import type { AimeatConfig } from '../../src/config-types.js';

const base = { testMoneyHandler: false, securityProfile: 'public', corsAllowedOrigins: [], encryptionKey: 'k', statsAccess: 'operator' };

const SWITCHES: Array<[string, Record<string, unknown>]> = [
  ['AIMEAT_X402_TEST_FACILITATOR', { x402Enabled: true, x402TestFacilitator: true }],
  ['AIMEAT_TEST_MODE', { testMode: true }],
  ['AIMEAT_DEV_MODE', { devMode: true }],
  ['AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR', { adminSetupOpenAfterFirstOperator: true }],
  ['AIMEAT_FINVOICE_OPERATOR', { finvoiceOperator: 'mock' }],
  ['AIMEAT_CONNECT_FAKE_BASE_URL', { connectFakeBaseUrl: 'http://127.0.0.1:9999' }],
];

describe('test-only settings on a node others reach (D8-01)', () => {
  it.each(SWITCHES)('%s is reported ACTIVE in the start log on a public node, whatever the profile', (env, fields) => {
    for (const profile of ['public', 'local']) {
      const w = securityPostureWarnings({ ...base, ...fields, securityProfile: profile, baseUrl: 'https://shop.example.org' } as unknown as AimeatConfig);
      expect(w.filter(l => l.startsWith(env)), `${env} ${profile}`).toHaveLength(1);
    }
  });

  it.each(SWITCHES)('%s says nothing on a loopback test node', (_env, fields) => {
    expect(testSwitchesOnPublicNode({ ...base, ...fields, baseUrl: 'http://localhost:40251' } as never)).toEqual([]);
  });

  it('the x402 test double alone, with x402 off, is not in force and is not reported', () => {
    expect(testSwitchesOnPublicNode({ x402Enabled: false, x402TestFacilitator: true, baseUrl: 'https://aimeat.io' } as never)).toEqual([]);
  });

  it('a real Finvoice operator is not reported', () => {
    expect(testSwitchesOnPublicNode({ finvoiceOperator: 'rest', baseUrl: 'https://aimeat.io' } as never)).toEqual([]);
  });

  it('the Security page marks them critical, named, and healthy when none is on', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const config = { ...loadConfig().config, baseUrl: 'https://shop.example.org', testMode: true, x402Enabled: true, x402TestFacilitator: true };
    const on = await buildSecurityOverview(config, storage);
    expect(on.now.test_switches.zone).toBe('critical');
    expect(on.now.test_switches.active).toEqual(expect.arrayContaining(['AIMEAT_TEST_MODE', 'AIMEAT_X402_TEST_FACILITATOR']));
    expect(on.now.status).not.toBe('quiet');
    const clean = { ...config, testMode: false, x402TestFacilitator: false, devMode: false, adminSetupOpenAfterFirstOperator: false, finvoiceOperator: '', connectFakeBaseUrl: '' };
    const off = await buildSecurityOverview(clean, storage);
    expect(off.now.test_switches).toEqual({ active: [], zone: 'healthy', messages: [] });
  });
});
