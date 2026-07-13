/**
 * @file src/commerce/money.ts
 * @description Money representation for the commerce core (TARGET-033). Money currencies (EUR/USD)
 *   are stored as INTEGER MICRO-UNITS — 6 decimal places, 1 unit = 1_000_000 micros — never cents
 *   and never floats. Six decimals matches USDC/x402 exactly and covers sub-cent agent
 *   micropayments (a $0.002 per-call price = 2000 micros, no rounding). Morsels are integers
 *   (scale 0) and are NOT money — the session `currency` field decides which representation an
 *   amount uses. Conversion to a payment rail's own precision (Stripe cents, USDC raw) happens ONLY
 *   at settlement, never at storage.
 * @structure MONEY_SCALE · MONEY_UNIT · isMoneyCurrency · microsToStripeMinor · formatMoneyMajor
 * @usage
 *   import { isMoneyCurrency, microsToStripeMinor } from './money.js';
 *   if (isMoneyCurrency(session.currency)) stripeAmount = microsToStripeMinor(micros); // → cents
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial 6-decimal micro-unit money representation (TARGET-033 phase 7b)
 */

/** Decimal places money amounts carry (matches USDC/x402). */
export const MONEY_SCALE = 6;
/** Micros per whole currency unit (10 ** MONEY_SCALE). */
export const MONEY_UNIT = 1_000_000;

/** A session/currency is money (not morsels) when it is anything other than 'morsel'. */
export function isMoneyCurrency(currency: string): boolean {
  return currency !== 'morsel';
}

/**
 * Convert micro-units to a payment rail's minor unit for a 2-decimal fiat currency (Stripe cents).
 * 10^6 micros / 10^2 cents = 10^4 micros per cent. Rounds to the nearest cent — a genuinely
 * sub-cent single charge cannot be card-settled alone (aggregate first, MPP-style); a whole-service
 * price divides exactly (1.50 EUR = 1_500_000 micros → 150 cents).
 */
export function microsToStripeMinor(micros: number): number {
  return Math.round(micros / (MONEY_UNIT / 100));
}

/**
 * Format micro-units as a major-unit decimal string. Always ≥2 decimals; up to MONEY_SCALE when the
 * amount is sub-cent (so 1_500_000 → "1.50", 2000 → "0.002"). Server-side use (logs/receipts); the
 * frontend has its own locale-aware formatter.
 */
export function formatMoneyMajor(micros: number): string {
  const s = (micros / MONEY_UNIT).toFixed(MONEY_SCALE);
  // Trim trailing zeros but keep at least two decimals.
  return s.replace(/(\.\d{2}\d*?)0+$/, '$1');
}
