/**
 * @file finance-schemas.ts
 * @description Record types for the generic finance domain: sales invoices, accounting
 *   vouchers, the VAT-code registry and fiscal years. This is NOT a bookkeeping program —
 *   the goal is a complete, VAT-itemized audit trail (tositeketju) and clean export for an
 *   accountant. Corrections are made with credit notes and reversal vouchers, never by
 *   mutating a sent invoice or a booked voucher (KPL audit-trail requirement).
 *
 *   Naming note: the record type `InvoiceRecord` here is a Finnish sales invoice
 *   (myyntilasku, Finvoice 3.0). It is DISTINCT from the `io.aimeat.invoice` payment
 *   handler in src/commerce/, which is a "settle offline" payment RAIL. Tables are
 *   prefixed Finance* / finance_* to keep the two apart.
 *
 *   Money is integer minor units (cents) everywhere; quantities are integer thousandths;
 *   VAT rates are basis points (2550 = 25.5 %). Rates live in the FinanceVatCode registry
 *   with validity windows — never hardcoded (the reduced rate changed 14 % → 13.5 % on
 *   2026-01-01, which is exactly why).
 *
 * @structure
 *   - InvoiceParty / InvoiceLine / VatBreakdownEntry — jsonb value shapes
 *   - InvoiceRecord — myyntilasku, immutable after leaving 'draft'
 *   - VoucherRecord — tosite, append-only, sequential number per owner+fiscal year
 *   - VatCodeRecord — node-global VAT registry with validity windows
 *   - FiscalYearRecord — tilikausi with a lock that rejects new bookings
 *   - Query types for the repository layer
 *
 * @usage import type { InvoiceRecord, ... } from '../models/finance-schemas.js';
 *
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1: initial finance domain.
 */

/** How an invoice may be delivered to the buyer. */
export type InvoiceDeliveryMethod = 'finvoice' | 'email' | 'manual';

/**
 * Invoice lifecycle. Numbers and dates are assigned on the draft→sent transition so the
 * invoice-number sequence stays gapless (deleted drafts never consume a number). After
 * 'sent' the document is immutable; money-state moves sent→paid/overdue and corrections
 * go through a credit note (type 'credit_note', creditsInvoiceId set), which flips the
 * original to 'credited'.
 */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'credited' | 'cancelled';

export type InvoiceType = 'invoice' | 'credit_note';

/** Delivery outcome reported by the e-invoice operator (or the email door). */
export type InvoiceDeliveryStatus = 'pending' | 'delivered' | 'rejected';

/**
 * Party snapshot embedded in the invoice. A snapshot, not a contact reference: the
 * bookkeeping record must show the party as it was at invoice time even if the contact
 * is edited or deleted later.
 */
export interface InvoiceParty {
  /** Display / legal name. */
  name: string;
  /** Finnish business id (Y-tunnus), e.g. "3323553-5". */
  businessId?: string;
  /** EU VAT id, e.g. "FI33235535". */
  vatId?: string;
  /** Contact id in the owner's contact book (buyer only; sellers have no contact). */
  contactId?: string;
  email?: string;
  streetAddress?: string;
  postalCode?: string;
  city?: string;
  /** ISO 3166-1 alpha-2, default FI. */
  country?: string;
  /** E-invoicing address (verkkolaskuosoite / OVT), e.g. "003733235535". */
  einvoiceAddress?: string;
  /** E-invoice operator id (välittäjätunnus), e.g. "003721291126" (Maventa). */
  einvoiceOperator?: string;
  /** Seller bank account for payment (IBAN) — seller side only. */
  iban?: string;
  bic?: string;
}

/** One invoice line. All derived amounts are precomputed and stored (audit trail). */
export interface InvoiceLine {
  description: string;
  /** Quantity in thousandths: 1500 = 1.5 units. */
  quantityMilli: number;
  /** Unit label shown on the invoice, e.g. "h", "kpl", "pcs". */
  unit: string;
  /** Net unit price in minor units (cents). */
  unitPriceMinor: number;
  /** FinanceVatCode id applied to this line. */
  vatCodeId: string;
  /** VAT rate snapshot in basis points (2550 = 25.5 %) at invoice time. */
  vatRateBp: number;
  /** Line net = round(quantityMilli * unitPriceMinor / 1000), cents. */
  netMinor: number;
  /** Line VAT = round(netMinor * vatRateBp / 10000), cents. */
  vatMinor: number;
  /** netMinor + vatMinor, cents. */
  grossMinor: number;
}

/** Per-VAT-code totals, used on both invoices and vouchers. */
export interface VatBreakdownEntry {
  vatCodeId: string;
  vatRateBp: number;
  netMinor: number;
  vatMinor: number;
}

/**
 * A sales invoice (myyntilasku). Owned by the seller GHII; optionally grouped under an
 * organism so an accountant role scoped to the organism can read it.
 */
export interface InvoiceRecord {
  id: string;
  /** Seller owner GHII (resolveIdentity output). Authorization happens in the route. */
  ownerGhii: string;
  /** Optional grouping to the company organism. Plain column, no FK. */
  organismId: string | null;
  type: InvoiceType;
  /** For credit notes: the invoice this credits. */
  creditsInvoiceId: string | null;
  status: InvoiceStatus;
  /** Sequential number per owner, assigned at send. Null while draft. */
  numberSeq: number | null;
  /** Display number, e.g. "2026-14". Null while draft. */
  invoiceNumber: string | null;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: InvoiceLine[];
  /** ISO 4217; v1 always EUR. */
  currency: string;
  totalNetMinor: number;
  totalVatMinor: number;
  totalGrossMinor: number;
  vatBreakdown: VatBreakdownEntry[];
  /** Finnish reference (viitenumero) or RF creditor reference. Assigned at send. */
  referenceNumber: string | null;
  paymentTermsDays: number;
  /** Invoice date (ISO date), set at send. */
  invoiceDate: string | null;
  dueDate: string | null;
  deliveryMethod: InvoiceDeliveryMethod | null;
  sentAt: string | null;
  deliveryStatus: InvoiceDeliveryStatus | null;
  /** Operator-side message id for delivery status callbacks. */
  operatorMessageId: string | null;
  /** Storage key of the generated Finvoice 3.0 XML. */
  finvoiceXmlKey: string | null;
  paidAt: string | null;
  /** Commerce trackingCode when payment arrived through the checkout/wallet rails. */
  paidTrackingCode: string | null;
  /** External payment reference (e.g. a bank archive id or Stripe id). */
  externalRef: string | null;
  fiscalYearId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Where a voucher came from. */
export type VoucherSource = 'stripe' | 'checkout' | 'invoice' | 'receipt' | 'manual' | 'morsel';

/**
 * 'transfer' is money moving between the company's own balances (e.g. a Stripe payout to
 * the bank account): it needs a voucher for the audit trail but is neither revenue nor
 * cost — the VAT report and P&L skip it, which is what prevents double counting.
 */
export type VoucherDirection = 'income' | 'expense' | 'transfer';

/**
 * An accounting voucher (tosite). Append-only: once created it is never edited or
 * deleted; a mistake is corrected with a new voucher whose reversesVoucherId points
 * back. Attachments (receipt images) may be added after creation — that augments the
 * evidence, it does not change the booking.
 */
export interface VoucherRecord {
  id: string;
  ownerGhii: string;
  organismId: string | null;
  fiscalYearId: string;
  /** Sequential per owner + fiscal year, claimed atomically at create. */
  voucherNumber: number;
  /** Booking date (ISO date). Must fall inside the fiscal year. */
  date: string;
  description: string;
  direction: VoucherDirection;
  source: VoucherSource;
  /** Gross amount in minor units (cents), always positive; direction carries the sign. */
  amountMinor: number;
  currency: string;
  vatBreakdown: VatBreakdownEntry[];
  /** Free-text counterparty (payer/payee) when there is no contact. */
  counterparty: string | null;
  invoiceId: string | null;
  /** Commerce trackingCode — the universal join key to checkout/wallet/payables. */
  trackingCode: string | null;
  /** External system reference (Stripe charge/payout id, bank archive id). Used for webhook idempotency. */
  externalRef: string | null;
  /** Storage keys of attached evidence (receipt images, PDFs). */
  attachments: string[];
  /** Set when this voucher reverses an earlier one. */
  reversesVoucherId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VatCategory = 'standard' | 'reduced' | 'zero' | 'exempt' | 'reverse_charge';

/**
 * Node-global VAT code. Seeded with the Finnish registry (see services/finance/vat-codes.ts)
 * and extensible by the operator. Validity windows make rate changes data, not code.
 */
export interface VatCodeRecord {
  /** Stable id, e.g. "fi-std-2550". */
  id: string;
  countryCode: string;
  category: VatCategory;
  /** Rate in basis points: 2550 = 25.5 %. */
  rateBp: number;
  label: { en: string; fi: string };
  /** ISO date this code becomes valid. */
  validFrom: string;
  /** ISO date after which the code no longer applies; null = open-ended. */
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A fiscal year (tilikausi). Locking is the accountant's period close: a locked year
 * rejects new vouchers and any invoice send dated inside it.
 */
export interface FiscalYearRecord {
  id: string;
  ownerGhii: string;
  organismId: string | null;
  /** Display label, e.g. "2026". */
  label: string;
  /** ISO date, inclusive. */
  startDate: string;
  /** ISO date, inclusive. */
  endDate: string;
  locked: boolean;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Repository query narrowing for invoices. */
export interface InvoiceQuery {
  ownerGhii: string;
  organismId?: string;
  status?: InvoiceStatus | InvoiceStatus[];
  type?: InvoiceType;
  buyerContactId?: string;
  /** invoiceDate >= from (ISO date). */
  from?: string;
  /** invoiceDate <= to (ISO date). */
  to?: string;
  limit?: number;
  offset?: number;
}

/** Repository query narrowing for vouchers. */
export interface VoucherQuery {
  ownerGhii: string;
  organismId?: string;
  fiscalYearId?: string;
  source?: VoucherSource;
  direction?: VoucherDirection;
  /** date >= from (ISO date). */
  from?: string;
  /** date <= to (ISO date). */
  to?: string;
  limit?: number;
  offset?: number;
}

/** Fields a caller may set when creating an invoice draft (the rest is computed/assigned). */
export type NewInvoiceDraft = Pick<
  InvoiceRecord,
  'ownerGhii' | 'organismId' | 'type' | 'creditsInvoiceId' | 'seller' | 'buyer' | 'currency' | 'paymentTermsDays' | 'notes'
> & { lines: Omit<InvoiceLine, 'netMinor' | 'vatMinor' | 'grossMinor' | 'vatRateBp'>[] };
