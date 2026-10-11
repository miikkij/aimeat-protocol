/**
 * @file test/unit/test-money-guard.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The test-only money handler runs only on a loopback test node, no settings route can
 *   switch it on, and the start log names it when it is refused.
 *
 * @version-history
 *   v1.0.0 — 2026-10-11 — aimeat.io ran with AIMEAT_TEST_MONEY_HANDLER=true
 *     (wish-testiraha-ei-voi-olla-p-ll-tuotantonodessa-test-money).
 */
import { describe, expect, it } from 'vitest';
import { isLoopbackBaseUrl, testMoneyHandlerActive, testMoneyHandlerRefused } from '../../src/utils/test-money-guard.js';
import { ALL_CONFIG_MAP, CONFIG_FIELDS, MUTABLE_CONFIG_MAP } from '../../src/services/config-schema.js';
import { securityPostureWarnings } from '../../src/config-posture.js';
import type { AimeatConfig } from '../../src/config-types.js';

describe('the test money guard', () => {
  it.each([
    ['http://localhost:40251', true],
    ['http://127.0.0.1:40600', true],
    ['http://sandbox.localhost:40601', true],
    ['http://[::1]:40050', true],
    ['https://aimeat.io', false],
    ['https://shop.example.org', false],
    ['http://192.168.1.20:40050', false],
    ['http://10.0.0.5', false],
    ['not a url', false],
  ])('%s is loopback: %s', (url, loopback) => {
    expect(isLoopbackBaseUrl(url)).toBe(loopback);
  });

  it('the flag is in force only on a loopback node, and refused anywhere else', () => {
    expect(testMoneyHandlerActive({ testMoneyHandler: true, baseUrl: 'http://localhost:40251' })).toBe(true);
    expect(testMoneyHandlerActive({ testMoneyHandler: true, baseUrl: 'https://aimeat.io' })).toBe(false);
    expect(testMoneyHandlerRefused({ testMoneyHandler: true, baseUrl: 'https://aimeat.io' })).toBe(true);
    expect(testMoneyHandlerRefused({ testMoneyHandler: false, baseUrl: 'https://aimeat.io' })).toBe(false);
    expect(testMoneyHandlerActive({ testMoneyHandler: false, baseUrl: 'http://localhost:40251' })).toBe(false);
  });

  it('no settings route can switch it on: it has no row in the config schema', () => {
    const rows = CONFIG_FIELDS.filter(f => f.envVar === 'AIMEAT_TEST_MONEY_HANDLER' || f.key === 'testMoneyHandler');
    expect(rows).toEqual([]);
    expect(Object.values(MUTABLE_CONFIG_MAP).some(f => f.key === 'testMoneyHandler')).toBe(false);
    expect(Object.values(ALL_CONFIG_MAP).some(f => f.key === 'testMoneyHandler')).toBe(false);
  });

  it('the start log names the variable when a node others reach has it set, whatever its profile', () => {
    for (const profile of ['public', 'local'] as const) {
      const w = securityPostureWarnings({ testMoneyHandler: true, baseUrl: 'http://192.168.1.20:40050', securityProfile: profile, corsAllowedOrigins: [] } as unknown as AimeatConfig);
      expect(w.some(line => line.startsWith('AIMEAT_TEST_MONEY_HANDLER=true was REFUSED')), profile).toBe(true);
    }
    const quiet = securityPostureWarnings({ testMoneyHandler: true, baseUrl: 'http://localhost:40251', securityProfile: 'local', corsAllowedOrigins: [] } as unknown as AimeatConfig);
    expect(quiet).toEqual([]);
  });
});
