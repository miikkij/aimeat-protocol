/**
 * @file src/services/finance/vouchers.ts
 * @description Voucher booking: the single door through which every tosite is created.
 *   Resolves the fiscal year from the booking date (auto-creating a calendar year),
 *   rejects a locked year, claims the sequential voucher number atomically, and keeps
 *   the record append-only — corrections go through reverseVoucher(), never edits.
 * @structure bookVoucher · reverseVoucher · attachEvidence
 * @usage await bookVoucher(storage, ownerGhii, { date, description, direction, ... });
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { VoucherRecord, VoucherSource, VoucherDirection, VatBreakdownEntry } from '../../models/finance-schemas.js';
import { FinanceError } from './errors.js';
import { fiscalYearForDate } from './invoice-service.js';

export interface VoucherInput {
  organismId?: string | null;
  /** Booking date, ISO yyyy-mm-dd. */
  date: string;
  description: string;
  direction: VoucherDirection;
  source: VoucherSource;
  /** Gross amount in cents, always positive; direction carries the sign. */
  amountMinor: number;
  currency?: string;
  vatBreakdown?: VatBreakdownEntry[];
  counterparty?: string | null;
  invoiceId?: string | null;
  trackingCode?: string | null;
  externalRef?: string | null;
  attachments?: string[];
  reversesVoucherId?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Books a voucher. Locked fiscal year → 409. externalRef reuse (webhook retry) returns the existing voucher. */
export async function bookVoucher(storage: Storage, ownerGhii: string, input: VoucherInput): Promise<VoucherRecord> {
  if (!DATE_RE.test(input.date)) throw new FinanceError('INVALID_DATE', 400, 'date must be yyyy-mm-dd');
  if (!input.description || typeof input.description !== 'string' || !input.description.trim()) {
    throw new FinanceError('INVALID_VOUCHER', 400, 'description is required');
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new FinanceError('INVALID_VOUCHER', 400, 'amountMinor must be a positive integer (cents); direction carries the sign');
  }
  if (input.direction !== 'income' && input.direction !== 'expense' && input.direction !== 'transfer') {
    throw new FinanceError('INVALID_VOUCHER', 400, "direction must be 'income', 'expense' or 'transfer'");
  }
  if (input.direction === 'transfer' && (input.vatBreakdown?.length ?? 0) > 0) {
    throw new FinanceError('INVALID_VOUCHER', 400, 'A transfer voucher carries no VAT breakdown');
  }

  // Idempotency for external events: a Stripe webhook retry must not double-book.
  if (input.externalRef) {
    const existing = await storage.findVoucherByExternalRef(ownerGhii, input.externalRef);
    if (existing) return existing;
  }

  const fiscalYear = await fiscalYearForDate(storage, ownerGhii, input.date, input.organismId ?? null);
  if (fiscalYear.locked) throw new FinanceError('FISCAL_YEAR_LOCKED', 409, `Fiscal year ${fiscalYear.label} is locked; new vouchers are rejected`);

  const voucherNumber = await storage.nextFinanceCounter(ownerGhii, `voucher:${fiscalYear.id}`);
  const now = new Date().toISOString();
  const record: VoucherRecord = {
    id: randomUUID(), ownerGhii,
    organismId: input.organismId ?? null,
    fiscalYearId: fiscalYear.id, voucherNumber,
    date: input.date, description: input.description.trim(),
    direction: input.direction, source: input.source,
    amountMinor: input.amountMinor, currency: input.currency ?? 'EUR',
    vatBreakdown: input.vatBreakdown ?? [],
    counterparty: input.counterparty ?? null,
    invoiceId: input.invoiceId ?? null,
    trackingCode: input.trackingCode ?? null,
    externalRef: input.externalRef ?? null,
    attachments: input.attachments ?? [],
    reversesVoucherId: input.reversesVoucherId ?? null,
    createdAt: now, updatedAt: now,
  };
  await storage.createVoucher(record);
  return record;
}

/**
 * Books the counter-voucher that reverses an earlier booking (opposite direction, same
 * amount). This is THE correction mechanism — the original row is never touched.
 */
export async function reverseVoucher(storage: Storage, ownerGhii: string, voucherId: string, reason: string): Promise<VoucherRecord> {
  const original = await storage.getVoucher(voucherId);
  if (!original || original.ownerGhii !== ownerGhii) throw new FinanceError('NOT_FOUND', 404, 'Voucher not found');
  if (original.reversesVoucherId) throw new FinanceError('INVALID_REVERSAL', 422, 'A reversal voucher cannot itself be reversed');
  return bookVoucher(storage, ownerGhii, {
    organismId: original.organismId,
    date: new Date().toISOString().slice(0, 10),
    description: `Reversal of voucher #${original.voucherNumber}: ${reason}`,
    direction: original.direction === 'transfer' ? 'transfer' : (original.direction === 'income' ? 'expense' : 'income'),
    source: 'manual',
    amountMinor: original.amountMinor,
    currency: original.currency,
    vatBreakdown: original.vatBreakdown,
    counterparty: original.counterparty,
    invoiceId: original.invoiceId,
    trackingCode: original.trackingCode,
    reversesVoucherId: original.id,
  });
}

/** Adds evidence (storage keys) to a voucher — augments the record, never changes the booking. */
export async function attachEvidence(storage: Storage, ownerGhii: string, voucherId: string, keys: string[]): Promise<VoucherRecord> {
  const voucher = await storage.getVoucher(voucherId);
  if (!voucher || voucher.ownerGhii !== ownerGhii) throw new FinanceError('NOT_FOUND', 404, 'Voucher not found');
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string' || !k.trim())) {
    throw new FinanceError('INVALID_ATTACHMENTS', 400, 'attachments must be storage keys (non-empty strings)');
  }
  const merged = [...new Set([...voucher.attachments, ...keys])];
  if (merged.length > 20) throw new FinanceError('TOO_MANY_ATTACHMENTS', 422, 'A voucher holds at most 20 attachments');
  await storage.setVoucherAttachments(voucherId, merged);
  return { ...voucher, attachments: merged };
}
