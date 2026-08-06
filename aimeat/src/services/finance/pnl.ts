/**
 * @file src/services/finance/pnl.ts
 * @description The P&L period summary (tuloslaskelma-kooste): income and expenses from
 *   booked vouchers grouped by source, the result before taxes, the period's VAT payable,
 *   and the owner's AI spend from the LEDGER. No forecasts — only the truth of the
 *   bookings. AI cost stays in USD as its own line (LEDGER meters in USD; mixing
 *   currencies into one total would fabricate a number).
 * @usage const report = await pnlReport(storage, ownerGhii, '2026-01', '2026-08');
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 7.
 */
import type { Storage } from '../../storage/interface.js';
import type { VoucherSource } from '../../models/finance-schemas.js';
import { FinanceError } from './errors.js';
import { vatPeriodReport } from './vat-report.js';

export interface PnlLine {
  source: VoucherSource;
  amountMinor: number;
  count: number;
}

export interface PnlReport {
  from: string;
  to: string;
  income: PnlLine[];
  expenses: PnlLine[];
  totalIncomeMinor: number;
  totalExpenseMinor: number;
  /** Income − expenses, before taxes. */
  resultMinor: number;
  vatPayableMinor: number;
  /** Internal money movements (Stripe payout → bank etc): shown, never summed into the result. */
  transferCount: number;
  transferMinor: number;
  /** LEDGER: priced AI calls in the period. USD — its own line, never mixed into EUR. */
  aiCostUsd: number;
  voucherCount: number;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

export async function pnlReport(storage: Storage, ownerGhii: string, fromMonth: string, toMonth: string): Promise<PnlReport> {
  if (!MONTH_RE.test(fromMonth) || !MONTH_RE.test(toMonth)) {
    throw new FinanceError('INVALID_PERIOD', 400, 'from and to must be months (yyyy-mm)');
  }
  if (fromMonth > toMonth) throw new FinanceError('INVALID_PERIOD', 400, 'from must not be after to');
  const from = `${fromMonth}-01`;
  const to = monthEnd(toMonth);

  const vouchers = await storage.listVouchers({ ownerGhii, from, to, limit: 10000 });
  const income = new Map<VoucherSource, PnlLine>();
  const expenses = new Map<VoucherSource, PnlLine>();
  let transferCount = 0;
  let transferMinor = 0;
  for (const v of vouchers) {
    if (v.direction === 'transfer') { transferCount++; transferMinor += v.amountMinor; continue; }
    const bucket = v.direction === 'income' ? income : expenses;
    const line = bucket.get(v.source) ?? { source: v.source, amountMinor: 0, count: 0 };
    line.amountMinor += v.amountMinor;
    line.count += 1;
    bucket.set(v.source, line);
  }
  const incomeLines = [...income.values()].sort((a, b) => b.amountMinor - a.amountMinor);
  const expenseLines = [...expenses.values()].sort((a, b) => b.amountMinor - a.amountMinor);
  const totalIncomeMinor = incomeLines.reduce((s, l) => s + l.amountMinor, 0);
  const totalExpenseMinor = expenseLines.reduce((s, l) => s + l.amountMinor, 0);

  const vat = await vatPeriodReport(storage, ownerGhii, fromMonth, toMonth);

  const usage = await storage.queryUsageDaily({ ownerGhii, from, to });
  const aiCostUsd = usage.reduce((s, u) => s + (u.costUsd || 0), 0);

  return {
    from, to,
    income: incomeLines, expenses: expenseLines,
    totalIncomeMinor, totalExpenseMinor,
    resultMinor: totalIncomeMinor - totalExpenseMinor,
    vatPayableMinor: vat.vatPayableMinor,
    transferCount, transferMinor,
    aiCostUsd: Math.round(aiCostUsd * 10000) / 10000,
    voucherCount: vouchers.length,
  };
}
