/**
 * @file test/unit/kyc-risk.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit tests for the AML customer risk rating (src/services/kyc/risk.ts). WHY: the
 *   rating decides due diligence depth, senior approval and onboarding blocks, so every rule is
 *   pinned with its reason code, points and legal reference.
 * @structure
 *   - rateRisk: each rule, forcing rules, blocking codes, due diligence selection, clamping.
 *   - reviewDue / retentionUntil: date arithmetic including Feb 29.
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
  rateRisk,
  reviewDue,
  retentionUntil,
  RISK_REASON_CODES,
  type RiskFacts,
  type RiskRules,
} from '../../src/services/kyc/risk.js';

const NOW = new Date('2026-11-19T10:00:00Z');
const RULES: RiskRules = { highRiskCountries: ['KP', 'IR'], reviewMonths: { low: 60, medium: 36, high: 12 } };

/** A clean person: low risk, simplified due diligence. */
function base(over: Partial<RiskFacts> = {}): RiskFacts {
  return {
    kind: 'person',
    pep: 'no',
    sanctions: 'clear',
    countries: ['FI'],
    identityLevel: 'high',
    faceToFace: false,
    beneficialOwnersKnown: true,
    purposeKnown: true,
    sourceOfFundsKnown: true,
    ...over,
  };
}

function reason(r: ReturnType<typeof rateRisk>, code: string) {
  return r.reasons.find((x) => x.code === code);
}

describe('rateRisk: rules', () => {
  it('clean person is low, simplified, review in 60 months', () => {
    const r = rateRisk(base(), RULES, NOW);
    expect(r).toMatchObject({ level: 'low', score: 0, dueDiligence: 'simplified', needsSeniorApproval: false });
    expect(r.blocking).toEqual([]);
    expect(r.nextReviewAt).toBe('2031-11-19');
  });

  const cases: Array<[string, Partial<RiskFacts>, string, number, string]> = [
    ['pep unknown', { pep: 'unknown' }, 'pep-unknown', 10, 'AMLR art. 20'],
    ['nominee shares', { kind: 'entity', nomineeOrBearerShares: true }, 'nominee-or-bearer-shares', 25, 'AMLR art. 34'],
    ['4 layers', { kind: 'entity', ownershipLayers: 4 }, 'ownership-layers', 20, 'AMLR art. 34'],
    ['9 layers capped', { kind: 'entity', ownershipLayers: 9 }, 'ownership-layers', 30, 'AMLR art. 34'],
    ['cash intensive', { cashIntensive: true }, 'cash-intensive', 20, 'AMLR art. 34'],
    ['remote low identity', { identityLevel: 'low' }, 'remote-low-identity', 25, 'AMLR art. 22'],
    ['purpose unknown', { purposeKnown: false }, 'purpose-unknown', 15, 'AMLR art. 20'],
    ['source unknown', { sourceOfFundsKnown: false }, 'source-of-funds-unknown', 15, 'AMLR art. 20'],
    ['product medium', { productRisk: 'medium' }, 'product-risk-medium', 10, 'AMLR art. 20'],
    ['product high', { productRisk: 'high' }, 'product-risk-high', 25, 'AMLR art. 34'],
    ['sanctions possible', { sanctions: 'possible' }, 'sanctions-possible', 30, 'AMLR art. 20'],
  ];
  for (const [name, over, code, points, ref] of cases) {
    it(`${name} -> ${code} ${points}`, () => {
      const r = rateRisk(base(over), RULES, NOW);
      expect(reason(r, code)).toMatchObject({ points, ref });
      expect(r.score).toBe(points);
      expect(RISK_REASON_CODES).toContain(code);
    });
  }

  it('2 layers adds nothing; face to face with low identity adds nothing', () => {
    expect(rateRisk(base({ kind: 'entity', ownershipLayers: 2 }), RULES, NOW).score).toBe(0);
    expect(rateRisk(base({ identityLevel: 'low', faceToFace: true }), RULES, NOW).score).toBe(0);
  });

  it('thresholds: 25 medium, 60 high', () => {
    expect(rateRisk(base({ identityLevel: 'low' }), RULES, NOW).level).toBe('medium');
    const r = rateRisk(base({ identityLevel: 'low', cashIntensive: true, purposeKnown: false }), RULES, NOW);
    expect(r.score).toBe(60);
    expect(r.level).toBe('high');
    expect(r.needsSeniorApproval).toBe(true);
  });

  it('weights override', () => {
    const r = rateRisk(base({ cashIntensive: true }), { ...RULES, weights: { 'cash-intensive': 70 } }, NOW);
    expect(r.score).toBe(70);
    expect(r.level).toBe('high');
  });
});

describe('rateRisk: PEP', () => {
  for (const pep of ['yes', 'family', 'close-associate', 'former'] as const) {
    it(`${pep} forces high, senior approval, enhanced`, () => {
      const r = rateRisk(base({ pep }), RULES, NOW);
      expect(reason(r, 'pep')).toMatchObject({ points: 40, ref: 'AMLR art. 42' });
      expect(r).toMatchObject({ level: 'high', needsSeniorApproval: true, dueDiligence: 'enhanced' });
      expect(r.nextReviewAt).toBe('2027-11-19');
    });
  }
  it('PEP with unknown source of funds takes 40 more', () => {
    const r = rateRisk(base({ pep: 'yes', sourceOfFundsKnown: false }), RULES, NOW);
    expect(reason(r, 'source-of-funds-unknown-pep')).toMatchObject({ points: 40, ref: 'AMLR art. 42' });
    expect(reason(r, 'source-of-funds-unknown')).toBeUndefined();
    expect(r.score).toBe(80);
  });
});

describe('rateRisk: forcing and blocking', () => {
  it('high-risk country forces high (case-insensitive)', () => {
    const r = rateRisk(base({ countries: ['FI', 'ir'] }), RULES, NOW);
    expect(reason(r, 'high-risk-country')).toMatchObject({ points: 40, ref: 'AMLR art. 29' });
    expect(r.level).toBe('high');
    expect(r.dueDiligence).toBe('enhanced');
  });

  it('confirmed sanctions: prohibited, blocking, null review', () => {
    const r = rateRisk(base({ sanctions: 'confirmed' }), RULES, NOW);
    expect(r.level).toBe('prohibited');
    expect(r.blocking).toContain('sanctions-confirmed');
    expect(r.nextReviewAt).toBeNull();
  });

  it('possible and not-screened sanctions block', () => {
    expect(rateRisk(base({ sanctions: 'possible' }), RULES, NOW).blocking).toEqual(['sanctions-possible']);
    const n = rateRisk(base({ sanctions: 'not-screened' }), RULES, NOW);
    expect(n.blocking).toEqual(['sanctions-not-screened']);
    expect(n.level).toBe('low');
  });

  it('entity without beneficial owners blocks; a person never does', () => {
    expect(rateRisk(base({ kind: 'entity', beneficialOwnersKnown: false }), RULES, NOW).blocking).toEqual([
      'beneficial-owners-unknown',
    ]);
    expect(rateRisk(base({ beneficialOwnersKnown: false }), RULES, NOW).blocking).toEqual([]);
  });

  it('identity level none blocks', () => {
    const r = rateRisk(base({ identityLevel: 'none', faceToFace: true }), RULES, NOW);
    expect(r.blocking).toEqual(['identity-none']);
  });
});

describe('rateRisk: due diligence', () => {
  it('simplified needs low, no PEP and substantial or high identity', () => {
    expect(rateRisk(base({ identityLevel: 'substantial' }), RULES, NOW).dueDiligence).toBe('simplified');
    expect(rateRisk(base({ identityLevel: 'low', faceToFace: true }), RULES, NOW).dueDiligence).toBe('standard');
    const u = rateRisk(base({ pep: 'unknown' }), RULES, NOW);
    expect(u.level).toBe('low');
    expect(u.dueDiligence).toBe('standard');
    expect(rateRisk(base({ identityLevel: 'low' }), RULES, NOW).dueDiligence).toBe('standard');
  });
});

describe('review months clamp', () => {
  it('high 24 -> 12 and 72 -> 60, with reasons', () => {
    const rules: RiskRules = { highRiskCountries: [], reviewMonths: { low: 72, medium: 36, high: 24 } };
    const r = rateRisk(base({ pep: 'yes' }), rules, NOW);
    const clamps = r.reasons.filter((x) => x.code === 'review-months-clamped');
    expect(clamps.map((c) => c.text)).toEqual([
      'low review 72 months clamped to 60',
      'high review 24 months clamped to 12',
    ]);
    expect(clamps[0]).toMatchObject({ points: 0, ref: 'AMLR art. 26' });
    expect(r.nextReviewAt).toBe('2027-11-19');
    expect(reviewDue('2026-01-01', 'low', rules)).toBe('2031-01-01');
  });
});

describe('dates', () => {
  it('reviewDue per level, prohibited null, month-end clamp', () => {
    expect(reviewDue('2026-03-15', 'medium', RULES)).toBe('2029-03-15');
    expect(reviewDue('2026-03-15', 'high', RULES)).toBe('2027-03-15');
    expect(reviewDue('2026-03-15', 'prohibited', RULES)).toBeNull();
    expect(reviewDue('2024-02-29', 'high', RULES)).toBe('2025-02-28');
  });
  it('retentionUntil adds 5 years; Feb 29 -> Feb 28', () => {
    expect(retentionUntil('2026-11-19')).toBe('2031-11-19');
    expect(retentionUntil('2024-02-29')).toBe('2029-02-28');
    expect(retentionUntil('2024-02-29', 4)).toBe('2028-02-29');
    expect(() => retentionUntil('nope')).toThrow(RangeError);
  });
});
