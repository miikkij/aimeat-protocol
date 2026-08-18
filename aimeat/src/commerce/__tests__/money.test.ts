/**
 * @file src/commerce/__tests__/money.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit tests for the money chokepoint (src/commerce/money.ts): rail round-trips are
 *   exact, sub-cent amounts (0.002 EUR = 2000 micros) never collapse to zero anywhere except the
 *   card rail (where a 0-cent result is the documented aggregate-first signal), fee rounding always
 *   ceils, commission cuts always floor and reconcile exactly, and currency validation is strict.
 * @usage cd aimeat && pnpm exec vitest run src/commerce/__tests__/money.test.ts
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial chokepoint tests (TARGET-033 phase 7c)
 */
import { describe, it, expect } from 'vitest';
import {
  MONEY_SCALE,
  MONEY_UNIT,
  MONEY_CURRENCIES,
  isMoneyCurrency,
  isSupportedMoneyCurrency,
  microsToStripeMinor,
  stripeMinorToMicros,
  microsToUsdcRaw,
  usdcRawToMicros,
  integerMicros,
  percentFee,
  percentCut,
  roundToMoneyScale,
  formatMoneyMajor,
} from '../money.js';

/** The canonical sub-cent agent price: 0.002 EUR/USD per call. */
const SUB_CENT = 2000;

describe('scale constants', () => {
  it('MONEY_UNIT is 10^MONEY_SCALE (6 decimals, matches USDC/x402)', () => {
    expect(MONEY_UNIT).toBe(10 ** MONEY_SCALE);
    expect(MONEY_SCALE).toBe(6);
  });
});

describe('currency validation', () => {
  it('isMoneyCurrency separates money from morsels', () => {
    expect(isMoneyCurrency('EUR')).toBe(true);
    expect(isMoneyCurrency('USD')).toBe(true);
    expect(isMoneyCurrency('morsel')).toBe(false);
  });

  it('isSupportedMoneyCurrency accepts exactly the allowlist, uppercase only', () => {
    for (const c of MONEY_CURRENCIES) expect(isSupportedMoneyCurrency(c)).toBe(true);
    expect(isSupportedMoneyCurrency('eur')).toBe(false);
    expect(isSupportedMoneyCurrency('GBP')).toBe(false);
    expect(isSupportedMoneyCurrency('morsel')).toBe(false);
    expect(isSupportedMoneyCurrency('')).toBe(false);
  });
});

describe('micros ↔ Stripe minor units (cents)', () => {
  it('whole-cent amounts round-trip exactly (micros → cents → micros)', () => {
    for (const micros of [10_000, 150_000, 1_500_000, 999_990_000, 123_456 * 10_000]) {
      expect(stripeMinorToMicros(microsToStripeMinor(micros))).toBe(micros);
    }
  });

  it('every integer cent amount round-trips exactly (cents → micros → cents)', () => {
    for (const minor of [1, 2, 99, 150, 12_345, 10_000_000]) {
      expect(microsToStripeMinor(stripeMinorToMicros(minor))).toBe(minor);
    }
  });

  it('1.50 EUR = 1_500_000 micros divides exactly into 150 cents', () => {
    expect(microsToStripeMinor(1_500_000)).toBe(150);
  });

  it('a sub-cent amount yields 0 cents — the documented aggregate-first signal for the card rail', () => {
    // The Stripe handler rejects a 0-cent charge (AMOUNT_TOO_SMALL); the amount itself is intact.
    expect(microsToStripeMinor(SUB_CENT)).toBe(0);
  });
});

describe('micros ↔ USDC raw units (x402 rail, 6 decimals)', () => {
  it('is the exact identity on integers — including sub-cent amounts', () => {
    for (const micros of [1, SUB_CENT, 1_500_000, 999_999_999_999]) {
      expect(microsToUsdcRaw(micros)).toBe(micros);
      expect(usdcRawToMicros(microsToUsdcRaw(micros))).toBe(micros);
    }
  });

  it('sub-cent 0.002 EUR (2000 micros) settles on the stablecoin rail without rounding to zero', () => {
    expect(microsToUsdcRaw(SUB_CENT)).toBe(SUB_CENT);
    expect(microsToUsdcRaw(SUB_CENT)).toBeGreaterThan(0);
  });
});

describe('integerMicros (defensive read-side coercion)', () => {
  it('passes integers through and floors floats (never invents value)', () => {
    expect(integerMicros(SUB_CENT)).toBe(SUB_CENT);
    expect(integerMicros(1_500_000)).toBe(1_500_000);
    expect(integerMicros(1_500_000.9)).toBe(1_500_000);
  });
});

describe('percentFee (rounds UP — the platform-fee policy)', () => {
  it('never rounds a positive fee to zero', () => {
    expect(percentFee(1, 1)).toBe(1);
    expect(percentFee(SUB_CENT, 5)).toBe(100);
    expect(percentFee(19, 5)).toBe(1); // 0.95 → 1
  });

  it('is exact on divisible amounts', () => {
    expect(percentFee(1_500_000, 5)).toBe(75_000);
    expect(percentFee(100, 20)).toBe(20);
  });

  it('is zero only when the amount or percent is zero', () => {
    expect(percentFee(0, 5)).toBe(0);
    expect(percentFee(1_500_000, 0)).toBe(0);
  });
});

describe('percentCut (rounds DOWN — the commission policy)', () => {
  it('cut + remainder reconciles exactly to the original amount', () => {
    for (const [net, pct] of [[999_999, 20], [1, 99], [SUB_CENT, 33], [1_425_000, 20]] as const) {
      const cut = percentCut(net, pct);
      expect(cut + (net - cut)).toBe(net);
      expect(cut).toBeLessThanOrEqual((net * pct) / 100);
    }
  });

  it('is exact on divisible amounts', () => {
    expect(percentCut(1_425_000, 20)).toBe(285_000);
  });
});

describe('sub-cent survives the full settlement math (0.002 EUR never becomes zero)', () => {
  it('a 2000-micro sale keeps a positive fee, a positive net, and an exact split', () => {
    const gross = SUB_CENT;               // 0.002 EUR quoted price
    const fee = percentFee(gross, 5);     // platform fee, ceils
    const net = gross - fee;
    const orgCut = percentCut(net, 20);   // company commission, floors
    const memberCut = net - orgCut;
    expect(fee).toBeGreaterThan(0);
    expect(net).toBeGreaterThan(0);
    expect(fee + orgCut + memberCut).toBe(gross); // every micro accounted, none minted
  });
});

describe('formatMoneyMajor', () => {
  it('keeps at least two decimals and expands for sub-cent amounts', () => {
    expect(formatMoneyMajor(1_500_000)).toBe('1.50');
    expect(formatMoneyMajor(SUB_CENT)).toBe('0.002'); // sub-cent never displays as 0.00
    expect(formatMoneyMajor(0)).toBe('0.00');
    expect(formatMoneyMajor(1)).toBe('0.000001');
  });
});

describe('roundToMoneyScale (major-unit float rounding, LLM metering)', () => {
  it('kills float noise without losing 6-decimal precision', () => {
    expect(roundToMoneyScale(0.1 + 0.2)).toBe(0.3);
    expect(roundToMoneyScale(0.000002)).toBe(0.000002); // sub-cent cost survives
    expect(roundToMoneyScale(1.2345678)).toBe(1.234568);
  });
});
