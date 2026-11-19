/**
 * @file risk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure customer risk rating and review calendar for anti-money-laundering customer
 *   due diligence under EU AMLR 2024/1624 (art. 20 CDD, art. 26 updating of customer
 *   information, art. 28-29 high-risk third countries, art. 33-34 enhanced due diligence,
 *   art. 42-46 politically exposed persons, art. 77 retention). WHY: a rating that a supervisor
 *   can audit must be reproducible from its inputs, so the score is additive, every point carries
 *   a reason code and a legal reference, and the function reads no storage, no network and no
 *   clock (the caller passes `now`).
 * @structure
 *   - RiskLevel, DueDiligence, RiskFacts, RiskRules, RiskResult: the input and output types.
 *   - RISK_REASON_CODES: every reason code, for locale keys.
 *   - DEFAULT_WEIGHTS: the points per reason code; RiskRules.weights overrides them.
 *   - rateRisk(): facts + rules + now -> level, score, reasons, blocking codes, next review date.
 *   - reviewDue(): next review date from the last review date and the level.
 *   - retentionUntil(): end of the record retention period (default 5 years, art. 77).
 *   - addMonthsIso(): UTC month arithmetic that clamps to the last day of the target month.
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */

/** Customer risk level. `prohibited` means the relationship may not be started or continued. */
export type RiskLevel = 'low' | 'medium' | 'high' | 'prohibited';

/** Due diligence measure applied to the customer. */
export type DueDiligence = 'simplified' | 'standard' | 'enhanced';

/** PEP status. `former` means the person left office less than 12 months ago and counts as `yes`. */
export type PepStatus = 'no' | 'yes' | 'family' | 'close-associate' | 'former' | 'unknown';

/** Facts collected about the customer. */
export interface RiskFacts {
  kind: 'person' | 'entity';
  pep: PepStatus;
  sanctions: 'clear' | 'possible' | 'confirmed' | 'not-screened';
  /** ISO 3166-1 alpha-2 codes of residence, nationality, registration and every beneficial owner. */
  countries: string[];
  /** eIDAS assurance level of the identity verification. */
  identityLevel: 'none' | 'low' | 'substantial' | 'high';
  faceToFace: boolean;
  /** Entity only; a person is its own beneficial owner. */
  beneficialOwnersKnown: boolean;
  ownershipLayers?: number;
  nomineeOrBearerShares?: boolean;
  cashIntensive?: boolean;
  purposeKnown: boolean;
  sourceOfFundsKnown: boolean;
  productRisk?: 'low' | 'medium' | 'high';
}

/** Firm-level rules for the rating. */
export interface RiskRules {
  /** ISO2 codes; the firm sets it from the EU list of high-risk third countries. */
  highRiskCountries: string[];
  /** Overrides of DEFAULT_WEIGHTS, per reason code. */
  weights?: Partial<Record<RiskReasonCode, number>>;
  /** Review interval in months per level. High is clamped to 12, every level to 60. */
  reviewMonths: { low: number; medium: number; high: number };
}

/** One line of the rating's explanation. */
export interface RiskReason {
  code: RiskReasonCode;
  text: string;
  points: number;
  ref: string;
}

/** Result of rateRisk(). */
export interface RiskResult {
  level: RiskLevel;
  score: number;
  dueDiligence: DueDiligence;
  reasons: RiskReason[];
  needsSeniorApproval: boolean;
  /** Reason codes that stop onboarding until resolved. */
  blocking: RiskReasonCode[];
  /** ISO date (YYYY-MM-DD) of the next review; null when the level is prohibited. */
  nextReviewAt: string | null;
}

/** Every reason code rateRisk() can emit, for locale keys. */
export const RISK_REASON_CODES = [
  'pep',
  'pep-unknown',
  'high-risk-country',
  'nominee-or-bearer-shares',
  'ownership-layers',
  'cash-intensive',
  'remote-low-identity',
  'purpose-unknown',
  'source-of-funds-unknown',
  'source-of-funds-unknown-pep',
  'product-risk-medium',
  'product-risk-high',
  'sanctions-possible',
  'sanctions-confirmed',
  'sanctions-not-screened',
  'beneficial-owners-unknown',
  'identity-none',
  'review-months-clamped',
] as const;

/** One reason code. */
export type RiskReasonCode = (typeof RISK_REASON_CODES)[number];

/** Default points per reason code. `ownership-layers` is per layer above 2. */
export const DEFAULT_WEIGHTS: Readonly<Record<RiskReasonCode, number>> = {
  pep: 40,
  'pep-unknown': 10,
  'high-risk-country': 40,
  'nominee-or-bearer-shares': 25,
  'ownership-layers': 10,
  'cash-intensive': 20,
  'remote-low-identity': 25,
  'purpose-unknown': 15,
  'source-of-funds-unknown': 15,
  'source-of-funds-unknown-pep': 40,
  'product-risk-medium': 10,
  'product-risk-high': 25,
  'sanctions-possible': 30,
  'sanctions-confirmed': 0,
  'sanctions-not-screened': 0,
  'beneficial-owners-unknown': 0,
  'identity-none': 0,
  'review-months-clamped': 0,
};

/** Score thresholds. */
const HIGH_THRESHOLD = 60;
const MEDIUM_THRESHOLD = 25;
/** Cap for the ownership-layers points. */
const OWNERSHIP_LAYERS_CAP = 30;
/** Legal ceilings for the review interval. */
const MAX_REVIEW_MONTHS = 60;
const MAX_HIGH_REVIEW_MONTHS = 12;
/** Default review months when a rule value is missing or not a finite positive number. */
const DEFAULT_REVIEW_MONTHS = { low: 60, medium: 36, high: 12 } as const;

const PEP_POSITIVE: ReadonlySet<PepStatus> = new Set(['yes', 'family', 'close-associate', 'former']);

/**
 * Add months to an ISO date in UTC. When the target month is shorter, the day is clamped to the
 * last day of that month (2024-02-29 + 12 months = 2025-02-28).
 * @param {string} iso ISO date or date-time; only the UTC calendar date is used.
 * @param {number} months Whole months to add.
 * @returns {string} YYYY-MM-DD.
 */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${iso}`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return out.toISOString().slice(0, 10);
}

/**
 * Resolve the review interval per level with the legal ceilings applied.
 * @param {RiskRules} rules Firm rules.
 * @returns {{ months: { low: number; medium: number; high: number }; clamped: string[] }} The
 *   effective months and one text line per clamped level.
 */
function effectiveReviewMonths(rules: RiskRules): {
  months: { low: number; medium: number; high: number };
  clamped: string[];
} {
  const clamped: string[] = [];
  const pick = (lvl: 'low' | 'medium' | 'high'): number => {
    const raw = rules.reviewMonths?.[lvl];
    const v = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_REVIEW_MONTHS[lvl];
    const ceiling = lvl === 'high' ? MAX_HIGH_REVIEW_MONTHS : MAX_REVIEW_MONTHS;
    if (v > ceiling) {
      clamped.push(`${lvl} review ${v} months clamped to ${ceiling}`);
      return ceiling;
    }
    return v;
  };
  return { months: { low: pick('low'), medium: pick('medium'), high: pick('high') }, clamped };
}

/**
 * Next review date for a level.
 * @param {string} lastReviewedAt ISO date of the last review (or of onboarding).
 * @param {RiskLevel} level Current risk level.
 * @param {RiskRules} rules Firm rules; the review months are clamped as in rateRisk().
 * @returns {string | null} YYYY-MM-DD, or null when the level is prohibited.
 */
export function reviewDue(lastReviewedAt: string, level: RiskLevel, rules: RiskRules): string | null {
  if (level === 'prohibited') return null;
  return addMonthsIso(lastReviewedAt, effectiveReviewMonths(rules).months[level]);
}

/**
 * End of the retention period for CDD records (AMLR art. 77: five years after the business
 * relationship ended).
 * @param {string} relationshipEndedAt ISO date the relationship ended.
 * @param {number} [years=5] Retention in years.
 * @returns {string} YYYY-MM-DD.
 */
export function retentionUntil(relationshipEndedAt: string, years = 5): string {
  return addMonthsIso(relationshipEndedAt, Math.floor(years) * 12);
}

/**
 * Rate a customer's money-laundering risk with additive, listed points.
 * @param {RiskFacts} facts Facts about the customer.
 * @param {RiskRules} rules Firm rules.
 * @param {Date} now Rating time; the only time source.
 * @returns {RiskResult} Level, score, reasons, blocking codes and the next review date.
 */
export function rateRisk(facts: RiskFacts, rules: RiskRules, now: Date): RiskResult {
  const w = { ...DEFAULT_WEIGHTS, ...(rules.weights ?? {}) };
  const reasons: RiskReason[] = [];
  const blocking: RiskReasonCode[] = [];
  let forceHigh = false;
  const add = (code: RiskReasonCode, text: string, ref: string, points: number = w[code]): void => {
    reasons.push({ code, text, points, ref });
  };

  const pepPositive = PEP_POSITIVE.has(facts.pep);

  // PEP (art. 42-46). `former` is within 12 months of leaving office by definition of the input.
  if (pepPositive) {
    add('pep', `Politically exposed person (${facts.pep})`, 'AMLR art. 42');
    forceHigh = true;
  } else if (facts.pep === 'unknown') {
    add('pep-unknown', 'PEP status not established', 'AMLR art. 20');
  }

  // High-risk third countries (art. 29).
  const hrc = new Set(rules.highRiskCountries.map((c) => c.trim().toUpperCase()));
  const hits = [...new Set(facts.countries.map((c) => c.trim().toUpperCase()))].filter((c) => hrc.has(c));
  if (hits.length > 0) {
    add('high-risk-country', `Link to high-risk third country: ${hits.join(', ')}`, 'AMLR art. 29');
    forceHigh = true;
  }

  // Ownership structure (entity only).
  if (facts.kind === 'entity') {
    if (facts.nomineeOrBearerShares) {
      add('nominee-or-bearer-shares', 'Nominee shareholders or bearer shares', 'AMLR art. 34');
    }
    const layers = facts.ownershipLayers ?? 0;
    if (layers > 2) {
      const pts = Math.min((Math.floor(layers) - 2) * w['ownership-layers'], OWNERSHIP_LAYERS_CAP);
      add('ownership-layers', `${Math.floor(layers)} ownership layers`, 'AMLR art. 34', pts);
    }
    if (!facts.beneficialOwnersKnown) {
      add('beneficial-owners-unknown', 'Beneficial owners not identified', 'AMLR art. 20');
      blocking.push('beneficial-owners-unknown');
    }
  }

  if (facts.cashIntensive) add('cash-intensive', 'Cash-intensive business', 'AMLR art. 34');

  // Identity verification.
  const weakIdentity = facts.identityLevel === 'none' || facts.identityLevel === 'low';
  if (!facts.faceToFace && weakIdentity) {
    add('remote-low-identity', `Not face to face, identity level ${facts.identityLevel}`, 'AMLR art. 22');
  }
  if (facts.identityLevel === 'none') {
    add('identity-none', 'Identity not verified', 'AMLR art. 22');
    blocking.push('identity-none');
  }

  if (!facts.purposeKnown) add('purpose-unknown', 'Purpose and intended nature not known', 'AMLR art. 20');

  if (!facts.sourceOfFundsKnown) {
    if (pepPositive) {
      add('source-of-funds-unknown-pep', 'Source of funds and wealth of a PEP not established', 'AMLR art. 42');
      forceHigh = true;
    } else {
      add('source-of-funds-unknown', 'Source of funds not established', 'AMLR art. 20');
    }
  }

  if (facts.productRisk === 'medium') add('product-risk-medium', 'Medium-risk product', 'AMLR art. 20');
  if (facts.productRisk === 'high') add('product-risk-high', 'High-risk product', 'AMLR art. 34');

  // Sanctions screening.
  if (facts.sanctions === 'confirmed') {
    add('sanctions-confirmed', 'Confirmed targeted financial sanctions match', 'AMLR art. 20');
    blocking.push('sanctions-confirmed');
  } else if (facts.sanctions === 'possible') {
    add('sanctions-possible', 'Possible sanctions match, unresolved', 'AMLR art. 20');
    blocking.push('sanctions-possible');
  } else if (facts.sanctions === 'not-screened') {
    add('sanctions-not-screened', 'Sanctions screening not done', 'AMLR art. 20');
    blocking.push('sanctions-not-screened');
  }

  const score = reasons.reduce((s, r) => s + r.points, 0);
  let level: RiskLevel = score >= HIGH_THRESHOLD ? 'high' : score >= MEDIUM_THRESHOLD ? 'medium' : 'low';
  if (forceHigh) level = 'high';
  if (facts.sanctions === 'confirmed') level = 'prohibited';

  const { months, clamped } = effectiveReviewMonths(rules);
  for (const text of clamped) add('review-months-clamped', text, 'AMLR art. 26', 0);

  const simplifiedOk =
    level === 'low' && facts.pep === 'no' && (facts.identityLevel === 'substantial' || facts.identityLevel === 'high');
  const dueDiligence: DueDiligence =
    level === 'high' || level === 'prohibited' ? 'enhanced' : simplifiedOk ? 'simplified' : 'standard';

  return {
    level,
    score,
    dueDiligence,
    reasons,
    needsSeniorApproval: pepPositive || level === 'high',
    blocking,
    nextReviewAt: level === 'prohibited' ? null : addMonthsIso(now.toISOString(), months[level]),
  };
}
