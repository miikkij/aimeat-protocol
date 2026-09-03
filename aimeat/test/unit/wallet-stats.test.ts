/**
 * @file test/unit/wallet-stats.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The lifetime figures of a morsel ledger: every row kind counts, the pace and the
 *   welcome bonus are received rather than earned, and what the balance holds beyond the rows is
 *   reported as unrecorded. The shape of aimeat.io's own ledger on 2026-09-04 is the fixture:
 *   172 extension_earn rows (+190), 22 extension_pay (−55), 7 spent (−27), balance 633.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { lifetimeOf } from '../../src/services/wallet-stats.js';
import type { WalletTransaction } from '../../src/storage/interface.js';

const row = (type: string, amount: number): WalletTransaction => ({
  id: `tx-${type}-${amount}-${Math.random()}`, gaii: 'a@node', type, amount, timestamp: '2026-09-04T00:00:00.000Z',
} as WalletTransaction);

describe('lifetimeOf', () => {
  it('counts every row kind, not only the four legacy ones', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row('extension_earn', 1)),
      row('extension_earn', 2),
      row('extension_pay', -5),
      row('spent', -4),
      row('commerce_earn', 13),
      row('marketplace_fee', 1),
      row('org_offer_spend', -30),
    ];
    const l = lifetimeOf(rows, 100);
    expect(l.earned).toBe(3 + 2 + 13 + 1);
    expect(l.spent).toBe(5 + 4 + 30);
    expect(l.in).toBe(19);
    expect(l.out).toBe(39);
    expect(l.ledger_sum).toBe(-20);
    expect(l.total_rows).toBe(9);
    expect(l.by_type.extension_earn).toEqual({ count: 4, sum: 5 });
  });

  it('files the pace and the welcome bonus as received, not earned', () => {
    const l = lifetimeOf([row('welcome_bonus', 100), row('allowance', 50), row('mint', 20), row('extension_earn', 3)], 173);
    expect(l.welcome_bonus).toBe(100);
    expect(l.received_allowance).toBe(50);
    expect(l.earned).toBe(3);
    expect(l.in).toBe(173);
    expect(l.unrecorded).toBe(0);
  });

  it('reports what reached the balance without a row', () => {
    // aimeat.io 2026-09-04: rows sum to +108, the balance is 633, the daily pace wrote nothing.
    const rows = [
      ...Array.from({ length: 172 }, (_, i) => row('extension_earn', i < 18 ? 2 : 1)),
      ...Array.from({ length: 22 }, (_, i) => row('extension_pay', i === 0 ? -34 : -1)),
      ...Array.from({ length: 7 }, (_, i) => row('spent', i === 0 ? -3 : -4)),
    ];
    const l = lifetimeOf(rows, 633);
    expect(l.earned).toBe(190);
    expect(l.spent).toBe(82);
    expect(l.ledger_sum).toBe(108);
    expect(l.unrecorded).toBe(525);
    expect(l.received_allowance).toBe(0);
  });

  it('is all zeros for an empty ledger and tolerates a bad amount', () => {
    const l = lifetimeOf([], 0);
    expect(l).toMatchObject({ earned: 0, spent: 0, in: 0, out: 0, ledger_sum: 0, unrecorded: 0, total_rows: 0 });
    const odd = lifetimeOf([{ ...row('spent', 0), amount: Number.NaN }], 5);
    expect(odd.ledger_sum).toBe(0);
    expect(odd.unrecorded).toBe(5);
  });
});
