/**
 * @file src/services/wallet-stats.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The lifetime figures of one morsel ledger, computed once for every door that reports
 *   them (GET /v1/wallet and the Wallet tab's composite). Before this each route summed four legacy
 *   row types (earned, spent, allowance, welcome_bonus) and the ledger had eleven: on aimeat.io a
 *   wallet with +190 earned through extension_earn rows said "earned 0". The figures here read the
 *   sign and the kind of every row. `ledger_sum` and `unrecorded` exist because the daily pace
 *   credits the balance without writing a row: the difference between the balance and the rows is
 *   what accrued on its own, and a page can say so instead of showing "allowance received 0".
 * @structure lifetimeOf(transactions, balance) → WalletLifetime
 * @usage const lifetime = lifetimeOf(rows, ghii.morselBalance ?? 0);
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (design canvas "AIMEAT Lompakko-sivu", direction A).
 */
import type { WalletTransaction } from '../storage/interface.js';

/** Row kinds that are the pace or a gift rather than something earned from somebody. */
const GRANTED = new Set(['allowance', 'daily_allowance', 'welcome_bonus', 'mint']);

export interface WalletLifetime {
  /** Positive rows that came from somebody: work, tool calls, sales, offers, fees. */
  earned: number;
  /** The absolute sum of every negative row. */
  spent: number;
  received_allowance: number;
  welcome_bonus: number;
  /** Every positive row, the pace and gifts included. */
  in: number;
  /** Every negative row, as a positive figure. */
  out: number;
  /** The sum of every row, signed. */
  ledger_sum: number;
  /** balance − ledger_sum: what reached the balance without a row (the daily pace, mostly). */
  unrecorded: number;
  /** One entry per row kind: how many rows and their signed sum. */
  by_type: Record<string, { count: number; sum: number }>;
  total_rows: number;
}

export function lifetimeOf(transactions: readonly WalletTransaction[], balance: number): WalletLifetime {
  let earned = 0, spent = 0, receivedAllowance = 0, welcomeBonus = 0, inSum = 0, outSum = 0, ledgerSum = 0;
  const byType: Record<string, { count: number; sum: number }> = {};
  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    const type = String(tx.type || 'unknown');
    ledgerSum += amount;
    const slot = byType[type] || (byType[type] = { count: 0, sum: 0 });
    slot.count += 1;
    slot.sum += amount;
    if (amount > 0) {
      inSum += amount;
      if (type === 'allowance' || type === 'daily_allowance') receivedAllowance += amount;
      else if (type === 'welcome_bonus') welcomeBonus += amount;
      if (!GRANTED.has(type)) earned += amount;
    } else if (amount < 0) {
      outSum += -amount;
      spent += -amount;
    }
  }
  return {
    earned, spent, received_allowance: receivedAllowance, welcome_bonus: welcomeBonus,
    in: inSum, out: outSum, ledger_sum: ledgerSum, unrecorded: (Number(balance) || 0) - ledgerSum,
    by_type: byType, total_rows: transactions.length,
  };
}
