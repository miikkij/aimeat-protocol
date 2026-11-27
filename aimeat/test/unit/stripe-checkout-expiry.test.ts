/**
 * @file test/unit/stripe-checkout-expiry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The card page's expiry stays inside the window Stripe takes: at least 30 minutes and
 *   less than 24 hours after the page is made (commerce/stripe-checkout.ts stripeExpiresAt). Real Stripe
 *   test mode refused a page 24 hours out; a commerce session lifetime of a day or more sent every
 *   card page that far.
 * @version-history
 *   v1.0.0 — 2026-11-28 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { stripeExpiresAt } from '../../src/commerce/stripe-checkout.js';

const NOW = Date.parse('2026-11-28T00:00:00Z');
const sec = (ms: number) => Math.floor(ms / 1000);

describe('stripeExpiresAt', () => {
  it('keeps a session expiry that Stripe takes', () => {
    const at = new Date(NOW + 2 * 3_600_000).toISOString();
    expect(stripeExpiresAt(at, NOW)).toBe(sec(NOW + 2 * 3_600_000));
  });

  it('raises an expiry under 30 minutes to 30 minutes', () => {
    const at = new Date(NOW + 5 * 60_000).toISOString();
    expect(stripeExpiresAt(at, NOW)).toBe(sec(NOW) + 1800);
  });

  it('holds a session of a day or more under 24 hours', () => {
    for (const hours of [24, 48, 24 * 30]) {
      const at = new Date(NOW + hours * 3_600_000).toISOString();
      expect(stripeExpiresAt(at, NOW)).toBeLessThan(sec(NOW) + 24 * 3600);
    }
  });

  it('answers 30 minutes for an expiry it cannot read', () => {
    expect(stripeExpiresAt('not a date', NOW)).toBe(sec(NOW) + 1800);
  });
});
