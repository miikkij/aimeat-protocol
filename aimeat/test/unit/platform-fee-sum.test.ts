/**
 * @file test/unit/platform-fee-sum.test.ts
 * @description The operator's money platform-fee total counts what the checkout writes and nothing
 *   else (commerce/platform-fee.ts sumPlatformFees; secaudit2026oct26,
 *   routes/admin.ts:dashboard:any-namespace-platform-fee-records): a record in a person's namespace
 *   with a currency and a positive finite fee. An agent's or an ecosystem app's own record, a negative
 *   fee and a fee given as text are left out; the real records count exactly as before.
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { sumPlatformFees } from '../../src/commerce/platform-fee.js';

const NODE = 'aimeat-local-001-dev';
const fee = (ownerGaii: string, value: unknown) => ({ ownerGaii, value });

describe('sumPlatformFees', () => {
  it('counts the checkout\'s records under the operator and under a seller, per currency', () => {
    const out = sumPlatformFees([
      fee(`operator@${NODE}`, { fee: 1_000, currency: 'EUR', mode: 'receivable' }),
      fee(`operator@${NODE}`, { fee: 250, currency: 'EUR', mode: 'receivable' }),
      fee(`seller@${NODE}`, { fee: 70, currency: 'USD', mode: 'receivable' }),
      fee(`system@${NODE}`, { fee: 5, currency: 'EUR' }),
    ]);
    expect(out).toEqual({ EUR: 1_255, USD: 70 });
  });

  it('leaves out a record an agent or an ecosystem app wrote into its own namespace', () => {
    const out = sumPlatformFees([
      fee(`operator@${NODE}`, { fee: 100, currency: 'EUR' }),
      fee(`bot#mallory@${NODE}`, { fee: 1_000_000, currency: 'EUR' }),
      fee(`eco:app#mallory@${NODE}`, { fee: 1_000_000, currency: 'EUR' }),
    ]);
    expect(out).toEqual({ EUR: 100 });
  });

  it('leaves out a negative, zero, text or missing fee and a missing currency', () => {
    const out = sumPlatformFees([
      fee(`operator@${NODE}`, { fee: 100, currency: 'EUR' }),
      fee(`mallory@${NODE}`, { fee: -500, currency: 'EUR' }),
      fee(`mallory@${NODE}`, { fee: 0, currency: 'EUR' }),
      fee(`mallory@${NODE}`, { fee: '999', currency: 'EUR' }),
      fee(`mallory@${NODE}`, { fee: Number.POSITIVE_INFINITY, currency: 'EUR' }),
      fee(`mallory@${NODE}`, { currency: 'EUR' }),
      fee(`mallory@${NODE}`, { fee: 10 }),
      fee(`mallory@${NODE}`, null),
    ]);
    expect(out).toEqual({ EUR: 100 });
    expect(typeof out.EUR).toBe('number');
  });
});
