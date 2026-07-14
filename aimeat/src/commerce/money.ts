/**
 * @file src/commerce/money.ts
 * @description THE money chokepoint for the commerce core (TARGET-033). Money currencies (EUR/USD)
 *   are stored as INTEGER MICRO-UNITS — 6 decimal places, 1 unit = 1_000_000 micros — never cents
 *   and never floats. Six decimals matches USDC/x402 exactly and covers sub-cent agent
 *   micropayments (a $0.002 per-call price = 2000 micros, no rounding). Morsels are integers
 *   (scale 0) and are NOT money — the session `currency` field decides which representation an
 *   amount uses, and morsel balances and money amounts never mix. Conversion to a payment rail's
 *   own precision (Stripe cents, USDC raw) happens ONLY at settlement, never at storage. Every
 *   money operation in core AND the EE module (via `EnterpriseContext.money`) goes through this
 *   file — no inline ÷10000 / ×1e6 anywhere else. The percent-fee/cut helpers are the single
 *   ROUNDING POLICY for both ledgers (fee always ceils, cut always floors) — they operate on one
 *   integer amount of either unit at a time, which is policy sharing, not unit mixing.
 * @structure MONEY_SCALE · MONEY_UNIT · MONEY_CURRENCIES · isMoneyCurrency ·
 *   isSupportedMoneyCurrency · microsToStripeMinor · stripeMinorToMicros · microsToUsdcRaw ·
 *   usdcRawToMicros · integerMicros · percentFee · percentCut · roundToMoneyScale ·
 *   formatMoneyMajor
 * @usage
 *   import { isMoneyCurrency, microsToStripeMinor, percentFee } from './money.js';
 *   if (isMoneyCurrency(session.currency)) stripeAmount = microsToStripeMinor(micros); // → cents
 *   const fee = percentFee(gross, commerceFeePercent(config));
 * @version-history
 *   v1.1.0 — 2026-07-14 — Chokepoint completion: currency allowlist, Stripe-minor + USDC-raw
 *     round-trips, percent fee/cut rounding policy, major-unit scale rounding (TARGET-033 phase 7c)
 *   v1.0.0 — 2026-07-14 — Initial 6-decimal micro-unit money representation (TARGET-033 phase 7b)
 */

/** Decimal places money amounts carry (matches USDC/x402). */
export const MONEY_SCALE = 6;
/** Micros per whole currency unit (10 ** MONEY_SCALE). */
export const MONEY_UNIT = 1_000_000;

/** The money currencies this node's commerce accepts (offer prices, payment handlers, EE). */
export const MONEY_CURRENCIES = ['EUR', 'USD'] as const;
export type MoneyCurrency = (typeof MONEY_CURRENCIES)[number];

/** A session/currency is money (not morsels) when it is anything other than 'morsel'. */
export function isMoneyCurrency(currency: string): boolean {
  return currency !== 'morsel';
}

/** True when `code` is a money currency commerce can actually price (exact uppercase ISO match). */
export function isSupportedMoneyCurrency(code: string): code is MoneyCurrency {
  return (MONEY_CURRENCIES as readonly string[]).includes(code);
}

/** Micros per minor unit of a 2-decimal fiat currency (10^6 / 10^2 = 10^4 micros per cent). */
const MICROS_PER_STRIPE_MINOR = MONEY_UNIT / 100;

/**
 * Convert micro-units to a payment rail's minor unit for a 2-decimal fiat currency (Stripe cents).
 * Rounds to the nearest cent — a genuinely sub-cent single charge cannot be card-settled alone
 * (aggregate first, MPP-style; handlers reject a 0-cent result); a whole-service price divides
 * exactly (1.50 EUR = 1_500_000 micros → 150 cents).
 */
export function microsToStripeMinor(micros: number): number {
  return Math.round(micros / MICROS_PER_STRIPE_MINOR);
}

/** Convert a Stripe minor-unit (cent) amount back to micro-units. Exact for integer cents. */
export function stripeMinorToMicros(minor: number): number {
  return minor * MICROS_PER_STRIPE_MINOR;
}

/**
 * Convert micro-units to USDC raw units (the x402 stablecoin rail). USDC also carries 6 decimals,
 * so the conversion is the identity on integers — the function exists so the settlement rail still
 * crosses the chokepoint (and keeps working if MONEY_SCALE ever diverges from the rail's).
 */
export function microsToUsdcRaw(micros: number): number {
  return Math.trunc(micros);
}

/** Convert USDC raw units (6 decimals) back to micro-units. Identity on integers. */
export function usdcRawToMicros(raw: number): number {
  return Math.trunc(raw);
}

/**
 * Coerce a stored/user-supplied money amount to integer micros (floor — never invent value).
 * Schemas already enforce positive integers at the write path; this is the defensive read-side
 * coercion every resolver applies before pricing a line.
 */
export function integerMicros(value: number): number {
  return Math.floor(value);
}

/**
 * The platform-fee rounding policy: percent of an integer amount, rounded UP — a positive fee on a
 * positive amount never rounds to zero, so even a 2000-micro (0.002 EUR) sale carries its fee.
 * Unit-agnostic integer math: applied to morsel prices and money micros alike (one policy).
 */
export function percentFee(amount: number, percent: number): number {
  return Math.ceil(amount * percent / 100);
}

/**
 * The commission/cut rounding policy: percent of an integer amount, rounded DOWN — the remainder
 * (`amount - percentCut(amount, pct)`) always reconciles exactly, and the split party never
 * receives more than their share. Unit-agnostic integer math, like {@link percentFee}.
 */
export function percentCut(amount: number, percent: number): number {
  return Math.floor(amount * percent / 100);
}

/**
 * Round a MAJOR-unit float amount to MONEY_SCALE decimals (kill float noise in aggregates).
 * For float-denominated money records only (e.g. the LLM metering ledger's USD costs) — commerce
 * amounts are integer micros and never need this.
 */
export function roundToMoneyScale(major: number): number {
  return Math.round(major * MONEY_UNIT) / MONEY_UNIT;
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
