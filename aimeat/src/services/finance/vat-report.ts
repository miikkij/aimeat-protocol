/**
 * @file src/services/finance/vat-report.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description VAT period summary (ALV-kausikooste) computed from booked vouchers —
 *   the basis for the owner's OmaVero self-assessment. Nothing is filed anywhere from
 *   here in v1; this is only the truth of the bookings, grouped by VAT code.
 *   Credit notes and reversals net out naturally because expense-direction vouchers
 *   subtract.
 * @usage const report = await vatPeriodReport(storage, ownerGhii, '2026-01', '2026-03');
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import type { Storage } from '../../storage/interface.js';
import { FinanceError } from './errors.js';
import { ensureVatCodesSeeded } from './vat-codes.js';

export interface VatReportRow {
  vatCodeId: string;
  vatRateBp: number;
  label: { en: string; fi: string } | null;
  /** Sales side (income vouchers): net and VAT collected. */
  salesNetMinor: number;
  salesVatMinor: number;
  /** Purchase side (expense vouchers with a VAT breakdown): net and deductible VAT. */
  purchasesNetMinor: number;
  purchasesVatMinor: number;
}

export interface VatPeriodReport {
  from: string;
  to: string;
  rows: VatReportRow[];
  totalSalesVatMinor: number;
  totalPurchasesVatMinor: number;
  /** VAT payable for the period: sales VAT − deductible purchase VAT. */
  vatPayableMinor: number;
  voucherCount: number;
  /** Vouchers with no VAT breakdown — listed so the accountant sees what is unclassified. */
  unclassifiedVouchers: number;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
}

/** Period summary; from/to are months (yyyy-mm), inclusive. */
export async function vatPeriodReport(storage: Storage, ownerGhii: string, fromMonth: string, toMonth: string, organismId?: string): Promise<VatPeriodReport> {
  if (!MONTH_RE.test(fromMonth) || !MONTH_RE.test(toMonth)) {
    throw new FinanceError('INVALID_PERIOD', 400, 'from and to must be months (yyyy-mm)');
  }
  if (fromMonth > toMonth) throw new FinanceError('INVALID_PERIOD', 400, 'from must not be after to');
  await ensureVatCodesSeeded(storage);
  const from = `${fromMonth}-01`;
  const to = monthEnd(toMonth);
  const vouchers = await storage.listVouchers({ ownerGhii, organismId, from, to, limit: 10000 });
  const codes = new Map((await storage.listVatCodes()).map((c) => [c.id, c]));

  const rows = new Map<string, VatReportRow>();
  let unclassified = 0;
  for (const v of vouchers) {
    if (v.direction === 'transfer') continue;   // internal money movement — no VAT effect
    if (v.vatBreakdown.length === 0) { unclassified++; continue; }
    for (const entry of v.vatBreakdown) {
      const key = `${entry.vatCodeId}:${entry.vatRateBp}`;
      const row = rows.get(key) ?? {
        vatCodeId: entry.vatCodeId, vatRateBp: entry.vatRateBp,
        label: codes.get(entry.vatCodeId)?.label ?? null,
        salesNetMinor: 0, salesVatMinor: 0, purchasesNetMinor: 0, purchasesVatMinor: 0,
      };
      if (v.direction === 'income') {
        row.salesNetMinor += entry.netMinor;
        row.salesVatMinor += entry.vatMinor;
      } else {
        row.purchasesNetMinor += entry.netMinor;
        row.purchasesVatMinor += entry.vatMinor;
      }
      rows.set(key, row);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.vatRateBp - a.vatRateBp);
  const totalSalesVatMinor = sorted.reduce((s, r) => s + r.salesVatMinor, 0);
  const totalPurchasesVatMinor = sorted.reduce((s, r) => s + r.purchasesVatMinor, 0);
  return {
    from, to, rows: sorted,
    totalSalesVatMinor, totalPurchasesVatMinor,
    vatPayableMinor: totalSalesVatMinor - totalPurchasesVatMinor,
    voucherCount: vouchers.length,
    unclassifiedVouchers: unclassified,
  };
}
