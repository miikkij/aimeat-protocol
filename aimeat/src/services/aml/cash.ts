/**
 * @file src/services/aml/cash.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The cash payment limit of Regulation (EU) 2024/1624 (AMLR) art. 80, read from the vouchers
 *   a person booked with payment method `cash`: a person trading in goods or providing services accepts
 *   or makes a cash payment only up to EUR 10 000, in one operation or in several that appear to be
 *   linked, so a payment of more than EUR 10 000 is over the limit and exactly EUR 10 000 is not. The
 *   article binds every business, not only an obliged entity.
 *
 *   WHAT COUNTS. A voucher with `paymentMethod` 'cash', direction income (a payment taken) or expense (a
 *   payment made), in EUR. A transfer voucher moves the company's own money and is no payment. A voucher
 *   that reverses another, and the voucher it reverses, are both left out: the booking was withdrawn.
 *   ONLY EUR COUNTS: the article also limits the equivalent in another currency, and this node keeps no
 *   exchange rate, so a cash voucher in another currency is not summed (the reason sentence says so).
 *
 *   WHAT IS LINKED. Vouchers of the same business (the organism when the voucher has one, otherwise the
 *   account), the same direction and the same counterparty (compared without case or outer spaces),
 *   whose dates lie within 30 days of the first one. The 30 days are this node's reading of "appear to be
 *   linked", not a number the regulation gives. A voucher with no counterparty links to nothing and is
 *   reported only when it is over the limit alone.
 * @structure CASH_LIMIT_MINOR · CASH_LINK_DAYS · CashOverLimitItem · cashOverLimit
 * @usage const items = cashOverLimit(await storage.listVouchersByPaymentMethod('cash', { since, limit: 5000 }));
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import type { VoucherRecord } from '../../models/finance-schemas.js';
import { localAccountName } from '../../utils/gaii.js';

/** EUR 10 000 in cents. Art. 80(1) allows cash "only up to" this amount, so a payment is over the limit when it is MORE. */
export const CASH_LIMIT_MINOR = 1_000_000;
/** Days from the first linked voucher within which the next one still links to it. */
export const CASH_LINK_DAYS = 30;

/** One payment, or one group of linked payments, over the limit. */
export interface CashOverLimitItem {
  /** The account the vouchers belong to, when they belong to no organism. */
  owner?: string;
  /** The organism the vouchers belong to. */
  organism_id?: string;
  direction: 'income' | 'expense';
  /** As booked on the first voucher; null when the voucher names nobody. */
  counterparty: string | null;
  /** Sum in cents, EUR. */
  total: number;
  currency: 'EUR';
  count: number;
  /** First and last booking date (ISO yyyy-mm-dd). */
  from: string;
  to: string;
  voucherIds: string[];
}

const dayOf = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/**
 * The cash payments of more than EUR 10 000, alone or linked. Pure: reads only the vouchers given, and
 * skips any that is not cash. Items come per business, oldest first.
 */
export function cashOverLimit(vouchers: VoucherRecord[]): CashOverLimitItem[] {
  const reversed = new Set(vouchers.map(v => v.reversesVoucherId).filter((id): id is string => !!id));
  const counted = vouchers.filter(v => v.paymentMethod === 'cash' && v.currency.toUpperCase() === 'EUR'
    && (v.direction === 'income' || v.direction === 'expense') && !v.reversesVoucherId && !reversed.has(v.id));

  const groups = new Map<string, VoucherRecord[]>();
  for (const v of counted) {
    const who = v.organismId ? `o:${v.organismId}` : `a:${v.ownerGhii}`;
    const party = (v.counterparty ?? '').trim().toLowerCase();
    // No counterparty: every voucher is its own group, so nothing links through a blank name.
    const key = `${who}|${v.direction}|${party ? `p:${party}` : `v:${v.id}`}`;
    const g = groups.get(key);
    if (g) g.push(v); else groups.set(key, [v]);
  }

  const out: CashOverLimitItem[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let i = 0;
    while (i < g.length) {
      let j = i;
      let total = 0;
      while (j < g.length && dayOf(g[j]!.date) - dayOf(g[i]!.date) <= CASH_LINK_DAYS) total += g[j++]!.amountMinor;
      if (total <= CASH_LIMIT_MINOR) { i += 1; continue; }
      const run = g.slice(i, j);
      const first = run[0]!;
      out.push({
        ...(first.organismId ? { organism_id: first.organismId } : { owner: localAccountName(first.ownerGhii) }),
        direction: first.direction as 'income' | 'expense',
        counterparty: first.counterparty?.trim() || null,
        total, currency: 'EUR', count: run.length,
        from: first.date, to: run[run.length - 1]!.date,
        voucherIds: run.map(v => v.id),
      });
      i = j;
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || (a.voucherIds[0] ?? '').localeCompare(b.voucherIds[0] ?? ''));
}
