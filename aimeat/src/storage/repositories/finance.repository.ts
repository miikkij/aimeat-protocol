/**
 * @file finance.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository contract for the finance domain: invoices, vouchers, the VAT-code
 *   registry, fiscal years and the atomic number counters behind gapless invoice/voucher
 *   numbering. Implemented by both storage providers (postgres-kysely + sqlite).
 *
 *   Contracts (same discipline as connection.repository.ts):
 *   1. No method here applies authorization — routes compare the record's ownerGhii against
 *      resolveIdentity() and answer 404 identically for "absent" and "not yours".
 *   2. Sequential-number claims are ATOMIC (single-statement upsert-increment), never
 *      read-then-write: two concurrent invoice sends must never share a number.
 *   3. Vouchers are append-only. There is deliberately no updateVoucher/deleteVoucher —
 *      corrections are new vouchers with reversesVoucherId set. Only the attachments
 *      list may grow after creation (added evidence, not a changed booking).
 *
 * @usage Storage interface composes this; providers implement in methods/finance*.ts.
 *
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1: initial finance repository.
 */

import type {
  InvoiceRecord,
  InvoiceQuery,
  InvoiceStatus,
  VoucherRecord,
  VoucherQuery,
  VatCodeRecord,
  FiscalYearRecord,
} from '../../models/finance-schemas.js';

/** Targeted mutation payload for the send/paid transitions (route/service enforces legality). */
export interface InvoiceStatusPatch {
  numberSeq?: number;
  invoiceNumber?: string;
  referenceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  deliveryMethod?: string;
  sentAt?: string;
  deliveryStatus?: string | null;
  operatorMessageId?: string | null;
  finvoiceXmlKey?: string;
  paidAt?: string;
  paidTrackingCode?: string;
  externalRef?: string;
  fiscalYearId?: string;
}

export interface FinanceRepository {
  // ── Invoices ──────────────────────────────────────────────────────────────
  createInvoice(row: InvoiceRecord): Promise<void>;
  getInvoice(id: string): Promise<InvoiceRecord | undefined>;
  listInvoices(query: InvoiceQuery): Promise<InvoiceRecord[]>;
  countInvoices(query: InvoiceQuery): Promise<number>;
  /** Full-document update; the service layer only calls this while status === 'draft'. */
  updateInvoiceDraft(row: InvoiceRecord): Promise<void>;
  /** Status transition + the fields that transition assigns. */
  setInvoiceStatus(id: string, status: InvoiceStatus, patch?: InvoiceStatusPatch): Promise<void>;
  /** Draft-only deletion is enforced by the service; providers just delete. */
  deleteInvoice(id: string): Promise<boolean>;
  /** Payment matching: find a sent invoice by its reference number for one owner. */
  findInvoiceByReference(ownerGhii: string, referenceNumber: string): Promise<InvoiceRecord | undefined>;

  // ── Vouchers (append-only) ────────────────────────────────────────────────
  createVoucher(row: VoucherRecord): Promise<void>;
  getVoucher(id: string): Promise<VoucherRecord | undefined>;
  listVouchers(query: VoucherQuery): Promise<VoucherRecord[]>;
  countVouchers(query: VoucherQuery): Promise<number>;
  /** Replaces the attachments list (evidence may be added after booking). */
  setVoucherAttachments(id: string, attachments: string[]): Promise<void>;
  /** Webhook idempotency: has this external event already been booked for this owner? */
  findVoucherByExternalRef(ownerGhii: string, externalRef: string): Promise<VoucherRecord | undefined>;

  // ── VAT codes (node-global registry) ──────────────────────────────────────
  upsertVatCode(row: VatCodeRecord): Promise<void>;
  getVatCode(id: string): Promise<VatCodeRecord | undefined>;
  listVatCodes(): Promise<VatCodeRecord[]>;

  // ── Fiscal years ──────────────────────────────────────────────────────────
  createFiscalYear(row: FiscalYearRecord): Promise<void>;
  getFiscalYear(id: string): Promise<FiscalYearRecord | undefined>;
  listFiscalYears(ownerGhii: string): Promise<FiscalYearRecord[]>;
  setFiscalYearLocked(id: string, locked: boolean, lockedAt: string | null): Promise<void>;

  // ── Counters ──────────────────────────────────────────────────────────────
  /**
   * Atomically increments and returns the next value (starting at 1) of a named counter.
   * kind examples: 'invoice' (per owner) or `voucher:${fiscalYearId}`.
   */
  nextFinanceCounter(ownerGhii: string, kind: string): Promise<number>;
}
