/**
 * @file src/services/finance/invoice-service.ts
 * @description Invoice lifecycle: draft → sent → paid/overdue, credit notes, and the
 *   voucher that a payment books. Routes stay thin; every legality rule lives here.
 *
 *   Rules encoded:
 *   - Only drafts are editable or deletable. numberSeq/reference/dates are assigned on
 *     the draft→sent transition (atomic counter → gapless sequence; a deleted draft
 *     never consumes a number).
 *   - VAT rates are snapshotted per line at SEND time from the code valid on the invoice
 *     date (maksuperusteinen bookkeeping still reports by the invoice's rate snapshot).
 *   - A sent invoice is immutable; corrections are credit notes (type 'credit_note',
 *     INV02 in Finvoice) which flip the original to 'credited' when sent.
 *   - Marking paid books an income voucher automatically (source 'invoice'), inside the
 *     fiscal year of the payment date; a locked year rejects it.
 *   - 'overdue' is a lazy transition applied on read, same discipline as checkout
 *     session expiry.
 *
 * @structure computeTotals · fiscal-year resolution · draft CRUD · send · markPaid ·
 *   credit notes · lazy overdue
 * @usage const svc = financeInvoiceService(storage); await svc.send(ownerGhii, id, ...);
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type {
  InvoiceRecord, InvoiceLine, InvoiceParty, VatBreakdownEntry, FiscalYearRecord,
} from '../../models/finance-schemas.js';
import { FinanceError } from './errors.js';
import { requireVatCode } from './vat-codes.js';
import { finnishReference, rfReference } from './reference-number.js';
import { bookVoucher } from './vouchers.js';

/** Line input from the API: amounts are computed here, never trusted from the caller. */
export interface LineInput {
  description: string;
  quantityMilli: number;
  unit: string;
  unitPriceMinor: number;
  vatCodeId: string;
}

export interface DraftInput {
  organismId?: string | null;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  lines: LineInput[];
  currency?: string;
  paymentTermsDays?: number;
  notes?: string | null;
}

function assertParty(party: InvoiceParty, which: 'seller' | 'buyer'): void {
  if (!party || typeof party.name !== 'string' || party.name.trim().length < 2) {
    throw new FinanceError('INVALID_PARTY', 400, `${which}.name is required (min 2 chars)`);
  }
}

function assertLines(lines: LineInput[]): void {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new FinanceError('INVALID_LINES', 400, 'At least one invoice line is required');
  }
  for (const l of lines) {
    if (!l.description || typeof l.description !== 'string') throw new FinanceError('INVALID_LINES', 400, 'Line description is required');
    if (!Number.isInteger(l.quantityMilli) || l.quantityMilli <= 0) throw new FinanceError('INVALID_LINES', 400, 'quantityMilli must be a positive integer (thousandths)');
    if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) throw new FinanceError('INVALID_LINES', 400, 'unitPriceMinor must be a non-negative integer (cents)');
    if (!l.vatCodeId || typeof l.vatCodeId !== 'string') throw new FinanceError('INVALID_LINES', 400, 'Line vatCodeId is required');
    if (typeof l.unit !== 'string' || l.unit.length === 0 || l.unit.length > 10) throw new FinanceError('INVALID_LINES', 400, 'Line unit is required (max 10 chars)');
  }
}

/** Computes line amounts + totals with the VAT rates valid on rateDate. Half-up rounding per line. */
async function computeLines(storage: Storage, lines: LineInput[], rateDate: string): Promise<{
  lines: InvoiceLine[]; totalNetMinor: number; totalVatMinor: number; totalGrossMinor: number; vatBreakdown: VatBreakdownEntry[];
}> {
  const out: InvoiceLine[] = [];
  const byCode = new Map<string, VatBreakdownEntry>();
  for (const l of lines) {
    const code = await requireVatCode(storage, l.vatCodeId, rateDate);
    const netMinor = Math.round((l.quantityMilli * l.unitPriceMinor) / 1000);
    const vatMinor = Math.round((netMinor * code.rateBp) / 10000);
    out.push({
      description: l.description, quantityMilli: l.quantityMilli, unit: l.unit,
      unitPriceMinor: l.unitPriceMinor, vatCodeId: code.id, vatRateBp: code.rateBp,
      netMinor, vatMinor, grossMinor: netMinor + vatMinor,
    });
    const entry = byCode.get(code.id) ?? { vatCodeId: code.id, vatRateBp: code.rateBp, netMinor: 0, vatMinor: 0 };
    entry.netMinor += netMinor;
    entry.vatMinor += vatMinor;
    byCode.set(code.id, entry);
  }
  const totalNetMinor = out.reduce((s, l) => s + l.netMinor, 0);
  const totalVatMinor = out.reduce((s, l) => s + l.vatMinor, 0);
  return { lines: out, totalNetMinor, totalVatMinor, totalGrossMinor: totalNetMinor + totalVatMinor, vatBreakdown: [...byCode.values()] };
}

/**
 * Finds the fiscal year containing the date, auto-creating a calendar year when none
 * exists (removing setup friction — the accountant can adjust boundaries later, before
 * anything is locked). A LOCKED year is returned as-is; the caller decides whether the
 * operation is one a locked year must reject.
 */
export async function fiscalYearForDate(storage: Storage, ownerGhii: string, isoDate: string, organismId: string | null): Promise<FiscalYearRecord> {
  const years = await storage.listFiscalYears(ownerGhii);
  const hit = years.find((y) => y.startDate <= isoDate && isoDate <= y.endDate);
  if (hit) return hit;
  const now = new Date().toISOString();
  const year = isoDate.slice(0, 4);
  const record: FiscalYearRecord = {
    id: randomUUID(), ownerGhii, organismId, label: year,
    startDate: `${year}-01-01`, endDate: `${year}-12-31`,
    locked: false, lockedAt: null, createdAt: now, updatedAt: now,
  };
  await storage.createFiscalYear(record);
  return record;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Fetches an invoice and asserts ownership; absent and not-yours answer identically (404). */
export async function requireOwnInvoice(storage: Storage, ownerGhii: string, id: string): Promise<InvoiceRecord> {
  const inv = await storage.getInvoice(id);
  if (!inv || inv.ownerGhii !== ownerGhii) throw new FinanceError('NOT_FOUND', 404, 'Invoice not found');
  return inv;
}

/** Creates an invoice draft (type 'invoice'). Amounts are computed, never taken from the caller. */
export async function createDraft(storage: Storage, ownerGhii: string, input: DraftInput): Promise<InvoiceRecord> {
  assertParty(input.seller, 'seller');
  assertParty(input.buyer, 'buyer');
  assertLines(input.lines);
  const currency = input.currency ?? 'EUR';
  if (currency !== 'EUR') throw new FinanceError('UNSUPPORTED_CURRENCY', 422, 'Only EUR invoices are supported in v1');
  const paymentTermsDays = input.paymentTermsDays ?? 14;
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 120) {
    throw new FinanceError('INVALID_PAYMENT_TERMS', 400, 'paymentTermsDays must be an integer 0-120');
  }
  const computed = await computeLines(storage, input.lines, todayIso());
  const now = new Date().toISOString();
  const record: InvoiceRecord = {
    id: randomUUID(), ownerGhii, organismId: input.organismId ?? null,
    type: 'invoice', creditsInvoiceId: null, status: 'draft',
    numberSeq: null, invoiceNumber: null,
    seller: input.seller, buyer: input.buyer,
    lines: computed.lines, currency,
    totalNetMinor: computed.totalNetMinor, totalVatMinor: computed.totalVatMinor,
    totalGrossMinor: computed.totalGrossMinor, vatBreakdown: computed.vatBreakdown,
    referenceNumber: null, paymentTermsDays,
    invoiceDate: null, dueDate: null, deliveryMethod: null, sentAt: null,
    deliveryStatus: null, operatorMessageId: null, finvoiceXmlKey: null,
    paidAt: null, paidTrackingCode: null, externalRef: null,
    fiscalYearId: null, notes: input.notes ?? null,
    createdAt: now, updatedAt: now,
  };
  await storage.createInvoice(record);
  return record;
}

/** Updates a draft in place. A non-draft invoice is immutable → 409. */
export async function updateDraft(storage: Storage, ownerGhii: string, id: string, input: DraftInput): Promise<InvoiceRecord> {
  const inv = await requireOwnInvoice(storage, ownerGhii, id);
  if (inv.status !== 'draft') throw new FinanceError('NOT_DRAFT', 409, 'Only a draft invoice can be edited; make corrections with a credit note');
  assertParty(input.seller, 'seller');
  assertParty(input.buyer, 'buyer');
  assertLines(input.lines);
  const computed = await computeLines(storage, input.lines, todayIso());
  const updated: InvoiceRecord = {
    ...inv,
    organismId: input.organismId ?? inv.organismId,
    seller: input.seller, buyer: input.buyer,
    lines: computed.lines,
    totalNetMinor: computed.totalNetMinor, totalVatMinor: computed.totalVatMinor,
    totalGrossMinor: computed.totalGrossMinor, vatBreakdown: computed.vatBreakdown,
    paymentTermsDays: input.paymentTermsDays ?? inv.paymentTermsDays,
    notes: input.notes !== undefined ? input.notes : inv.notes,
    updatedAt: new Date().toISOString(),
  };
  await storage.updateInvoiceDraft(updated);
  return updated;
}

/** Deletes a draft. A non-draft invoice is part of the audit trail → 409. */
export async function deleteDraft(storage: Storage, ownerGhii: string, id: string): Promise<void> {
  const inv = await requireOwnInvoice(storage, ownerGhii, id);
  if (inv.status !== 'draft') throw new FinanceError('NOT_DRAFT', 409, 'Only a draft invoice can be deleted');
  await storage.deleteInvoice(id);
}

/**
 * The draft→sent transition: recomputes amounts with rates valid on the invoice date,
 * claims the gapless number, derives the display number + payment reference, resolves
 * the fiscal year (locked → 409), and stamps the send. The caller performs the actual
 * delivery (Finvoice operator / email / manual) and passes which door was used.
 */
export async function send(storage: Storage, ownerGhii: string, id: string, deliveryMethod: 'finvoice' | 'email' | 'manual', referenceStyle: 'fi' | 'rf' = 'fi'): Promise<InvoiceRecord> {
  const inv = await requireOwnInvoice(storage, ownerGhii, id);
  if (inv.status !== 'draft') throw new FinanceError('NOT_DRAFT', 409, `Invoice is already ${inv.status}`);
  if (inv.type === 'credit_note' && !inv.creditsInvoiceId) {
    throw new FinanceError('INVALID_CREDIT_NOTE', 422, 'A credit note must reference the invoice it credits');
  }
  const invoiceDate = todayIso();
  const fiscalYear = await fiscalYearForDate(storage, ownerGhii, invoiceDate, inv.organismId);
  if (fiscalYear.locked) throw new FinanceError('FISCAL_YEAR_LOCKED', 409, `Fiscal year ${fiscalYear.label} is locked`);

  // Re-snapshot rates on the legally operative date.
  const computed = await computeLines(storage, inv.lines.map((l) => ({
    description: l.description, quantityMilli: l.quantityMilli, unit: l.unit,
    unitPriceMinor: l.unitPriceMinor, vatCodeId: l.vatCodeId,
  })), invoiceDate);
  await storage.updateInvoiceDraft({
    ...inv,
    lines: computed.lines,
    totalNetMinor: computed.totalNetMinor, totalVatMinor: computed.totalVatMinor,
    totalGrossMinor: computed.totalGrossMinor, vatBreakdown: computed.vatBreakdown,
    updatedAt: new Date().toISOString(),
  });

  const numberSeq = await storage.nextFinanceCounter(ownerGhii, 'invoice');
  const invoiceNumber = `${invoiceDate.slice(0, 4)}-${numberSeq}`;
  // Base '1' + zero-padded seq keeps the viite free of leading zeros and unique per seller.
  const base = `1${String(numberSeq).padStart(6, '0')}`;
  const referenceNumber = referenceStyle === 'rf' ? rfReference(base) : finnishReference(base);
  const dueDate = addDays(invoiceDate, inv.paymentTermsDays);
  await storage.setInvoiceStatus(id, 'sent', {
    numberSeq, invoiceNumber, referenceNumber, invoiceDate, dueDate,
    deliveryMethod, sentAt: new Date().toISOString(), deliveryStatus: 'pending',
    fiscalYearId: fiscalYear.id,
  });

  // Sending a credit note completes the correction: the original stops being collectible.
  if (inv.type === 'credit_note' && inv.creditsInvoiceId) {
    const original = await storage.getInvoice(inv.creditsInvoiceId);
    if (original && original.ownerGhii === ownerGhii && (original.status === 'sent' || original.status === 'overdue' || original.status === 'paid')) {
      await storage.setInvoiceStatus(original.id, 'credited', {});
    }
  }

  const sent = await storage.getInvoice(id);
  if (!sent) throw new FinanceError('NOT_FOUND', 404, 'Invoice disappeared during send');
  return sent;
}

/**
 * Marks a sent/overdue invoice paid and books the income voucher (source 'invoice').
 * Idempotent on repeat calls: an already-paid invoice returns as-is without a second voucher.
 */
export async function markPaid(storage: Storage, ownerGhii: string, id: string, opts?: { paidAt?: string; trackingCode?: string; externalRef?: string }): Promise<InvoiceRecord> {
  const inv = await requireOwnInvoice(storage, ownerGhii, id);
  if (inv.status === 'paid') return inv;
  if (inv.status !== 'sent' && inv.status !== 'overdue') {
    throw new FinanceError('NOT_PAYABLE', 409, `A ${inv.status} invoice cannot be marked paid`);
  }
  const paidAt = opts?.paidAt ?? new Date().toISOString();
  await bookVoucher(storage, ownerGhii, {
    organismId: inv.organismId,
    date: paidAt.slice(0, 10),
    description: `${inv.type === 'credit_note' ? 'Credit note' : 'Invoice'} ${inv.invoiceNumber} — ${inv.buyer.name}`,
    direction: inv.type === 'credit_note' ? 'expense' : 'income',
    source: 'invoice',
    amountMinor: inv.totalGrossMinor,
    currency: inv.currency,
    vatBreakdown: inv.vatBreakdown,
    counterparty: inv.buyer.name,
    invoiceId: inv.id,
    trackingCode: opts?.trackingCode ?? null,
    externalRef: opts?.externalRef ?? null,
  });
  await storage.setInvoiceStatus(id, 'paid', {
    paidAt,
    ...(opts?.trackingCode ? { paidTrackingCode: opts.trackingCode } : {}),
    ...(opts?.externalRef ? { externalRef: opts.externalRef } : {}),
  });
  const paid = await storage.getInvoice(id);
  if (!paid) throw new FinanceError('NOT_FOUND', 404, 'Invoice disappeared during payment');
  return paid;
}

/** Creates a credit-note DRAFT mirroring the original's lines; sending it credits the original. */
export async function createCreditNote(storage: Storage, ownerGhii: string, originalId: string): Promise<InvoiceRecord> {
  const original = await requireOwnInvoice(storage, ownerGhii, originalId);
  if (original.status === 'draft') throw new FinanceError('NOT_SENT', 409, 'A draft needs no credit note — edit or delete it');
  if (original.status === 'credited') throw new FinanceError('ALREADY_CREDITED', 409, 'Invoice is already credited');
  if (original.type === 'credit_note') throw new FinanceError('INVALID_CREDIT_NOTE', 422, 'A credit note cannot credit another credit note');
  const now = new Date().toISOString();
  const record: InvoiceRecord = {
    ...original,
    id: randomUUID(),
    type: 'credit_note', creditsInvoiceId: original.id, status: 'draft',
    numberSeq: null, invoiceNumber: null, referenceNumber: null,
    invoiceDate: null, dueDate: null, deliveryMethod: null, sentAt: null,
    deliveryStatus: null, operatorMessageId: null, finvoiceXmlKey: null,
    paidAt: null, paidTrackingCode: null, externalRef: null, fiscalYearId: null,
    notes: `Credit note for invoice ${original.invoiceNumber}`,
    createdAt: now, updatedAt: now,
  };
  await storage.createInvoice(record);
  return record;
}

/** Lazy sent→overdue transition applied on read (persisted, same idea as session expiry). */
export async function applyOverdue(storage: Storage, inv: InvoiceRecord): Promise<InvoiceRecord> {
  if (inv.status === 'sent' && inv.dueDate && inv.dueDate < todayIso()) {
    await storage.setInvoiceStatus(inv.id, 'overdue', {});
    return { ...inv, status: 'overdue' };
  }
  return inv;
}
