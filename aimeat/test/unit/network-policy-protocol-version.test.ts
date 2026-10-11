/**
 * @file test/unit/network-policy-protocol-version.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The federation auto-admit and promotion gates compare protocol versions as versions:
 *   'v1', '5.0', '2026-11', a missing value and garbage.
 *
 * @version-history
 *   v1.0.0 — 2026-10-11 — The gates compared strings, so "5.0" < "v1" and a newer node was refused.
 */
import { describe, expect, it } from 'vitest';
import {
  coercePolicy, evaluateAutoAdmit, evaluatePromotion, type PromotionMetrics,
} from '../../src/services/network-policy.js';

function policy(min: string) {
  return coercePolicy({
    auto_admit: { enabled: true, min_protocol_version: min },
    promotion_criteria: { min_protocol_version: min, min_availability_pct: 0, min_days_active: 0, min_successful_work: 0, require_signed_introduce: false },
  });
}

const admits = (min: string, pv?: string) => evaluateAutoAdmit({ node_url: 'https://peer.example', protocol_version: pv }, policy(min)).allowed;

function promotionFails(min: string, pv: string | undefined): boolean {
  const metrics = {
    availabilityPct: 100, daysActive: 30, successfulWork: 10, activeFlags: 0,
    signedIntroduce: true, protocolVersion: pv, nodeUrl: 'https://peer.example',
  } as PromotionMetrics;
  return evaluatePromotion(metrics, policy(min)).failing.includes('protocol_version');
}

describe('auto-admit: protocol version against the minimum', () => {
  it.each([
    // [minimum, stated, admitted]
    ['v1', 'v1', true],
    ['v1', undefined, true],
    ['v1', '5.0', true],
    ['v1', '2026-11', true],
    ['v2', 'v10', true],
    ['v2', 'v1', false],
    ['5.0', '4.0', false],
    ['5.0', '5.0', true],
    ['5.0', '10.0', true],
    ['5.0', '2026-11', true],
    ['5.0', 'v1', false],
    ['2026-11', '2026-10', false],
    ['2026-11', '2026-11', true],
    ['2026-11', '2027-01', true],
    ['2026-11', 'v1', false],
    ['2026-11', undefined, false],
  ])('minimum %s, stated %s → admitted %s', (min, pv, expected) => {
    expect(admits(min, pv)).toBe(expected);
  });

  it.each(['banana', '', 'v', '2026-13', '5.0-beta', 'AIMEAT Core 2026-11'])('a stated version in an unknown format (%j) is never ranked lower', pv => {
    for (const min of ['v1', '5.0', '2026-11']) expect(admits(min, pv), `min ${min}`).toBe(true);
  });

  it('a minimum in an unknown format refuses nobody for their version', () => {
    for (const pv of ['v1', '5.0', '2026-11', undefined]) expect(admits('latest', pv)).toBe(true);
  });
});

describe('promotion: protocol version against the minimum', () => {
  it('a newer numeric or dated version meets a v1 minimum, and a missing one reads as v1', () => {
    expect(promotionFails('v1', '5.0')).toBe(false);
    expect(promotionFails('v1', '2026-11')).toBe(false);
    expect(promotionFails('v1', undefined)).toBe(false);
    expect(promotionFails('v1', 'garbage')).toBe(false);
  });

  it('an older known version fails a dated minimum', () => {
    expect(promotionFails('2026-11', 'v1')).toBe(true);
    expect(promotionFails('2026-11', undefined)).toBe(true);
    expect(promotionFails('2026-11', '2026-12')).toBe(false);
  });
});
