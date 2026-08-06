/**
 * @file src/storage/providers/sqlite/methods/finance.ts
 * @description SQLite (better-sqlite3) implementation of the finance domain (invoices,
 *   vouchers, VAT codes, fiscal years, counters). Schema: schema-tables-3.ts.
 *
 *   nextFinanceCounter() is a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING —
 *   the guarantee comes from the statement, not from better-sqlite3 happening to be
 *   synchronous, so the postgres provider gives the identical promise.
 *
 * @structure financeMethods — invoices · vouchers · vat codes · fiscal years · counters
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import type { FinanceRepository, InvoiceStatusPatch } from '../../../repositories/finance.repository.js';
import type {
  InvoiceRecord, InvoiceQuery, InvoiceStatus, InvoiceType, InvoiceParty, InvoiceLine,
  InvoiceDeliveryMethod, InvoiceDeliveryStatus, VatBreakdownEntry,
  VoucherRecord, VoucherQuery, VoucherSource, VoucherDirection,
  VatCodeRecord, VatCategory, FiscalYearRecord,
} from '../../../../models/finance-schemas.js';
import type { SqliteStorage } from '../index.js';

type Row = Record<string, unknown>;

function toInvoice(r: Row): InvoiceRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    organismId: (r.organismId as string | null) ?? null,
    type: r.type as InvoiceType,
    creditsInvoiceId: (r.creditsInvoiceId as string | null) ?? null,
    status: r.status as InvoiceStatus,
    numberSeq: (r.numberSeq as number | null) ?? null,
    invoiceNumber: (r.invoiceNumber as string | null) ?? null,
    seller: JSON.parse(r.seller as string) as InvoiceParty,
    buyer: JSON.parse(r.buyer as string) as InvoiceParty,
    lines: JSON.parse((r.lines as string) || '[]') as InvoiceLine[],
    currency: r.currency as string,
    totalNetMinor: Number(r.totalNetMinor),
    totalVatMinor: Number(r.totalVatMinor),
    totalGrossMinor: Number(r.totalGrossMinor),
    vatBreakdown: JSON.parse((r.vatBreakdown as string) || '[]') as VatBreakdownEntry[],
    referenceNumber: (r.referenceNumber as string | null) ?? null,
    paymentTermsDays: Number(r.paymentTermsDays),
    invoiceDate: (r.invoiceDate as string | null) ?? null,
    dueDate: (r.dueDate as string | null) ?? null,
    deliveryMethod: (r.deliveryMethod as InvoiceDeliveryMethod | null) ?? null,
    sentAt: (r.sentAt as string | null) ?? null,
    deliveryStatus: (r.deliveryStatus as InvoiceDeliveryStatus | null) ?? null,
    operatorMessageId: (r.operatorMessageId as string | null) ?? null,
    finvoiceXmlKey: (r.finvoiceXmlKey as string | null) ?? null,
    paidAt: (r.paidAt as string | null) ?? null,
    paidTrackingCode: (r.paidTrackingCode as string | null) ?? null,
    externalRef: (r.externalRef as string | null) ?? null,
    fiscalYearId: (r.fiscalYearId as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toVoucher(r: Row): VoucherRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    organismId: (r.organismId as string | null) ?? null,
    fiscalYearId: r.fiscalYearId as string,
    voucherNumber: Number(r.voucherNumber),
    date: r.date as string,
    description: r.description as string,
    direction: r.direction as VoucherDirection,
    source: r.source as VoucherSource,
    amountMinor: Number(r.amountMinor),
    currency: r.currency as string,
    vatBreakdown: JSON.parse((r.vatBreakdown as string) || '[]') as VatBreakdownEntry[],
    counterparty: (r.counterparty as string | null) ?? null,
    invoiceId: (r.invoiceId as string | null) ?? null,
    trackingCode: (r.trackingCode as string | null) ?? null,
    externalRef: (r.externalRef as string | null) ?? null,
    attachments: JSON.parse((r.attachments as string) || '[]') as string[],
    reversesVoucherId: (r.reversesVoucherId as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toVatCode(r: Row): VatCodeRecord {
  return {
    id: r.id as string,
    countryCode: r.countryCode as string,
    category: r.category as VatCategory,
    rateBp: Number(r.rateBp),
    label: JSON.parse(r.label as string) as { en: string; fi: string },
    validFrom: r.validFrom as string,
    validTo: (r.validTo as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function toFiscalYear(r: Row): FiscalYearRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    organismId: (r.organismId as string | null) ?? null,
    label: r.label as string,
    startDate: r.startDate as string,
    endDate: r.endDate as string,
    locked: Number(r.locked) === 1,
    lockedAt: (r.lockedAt as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

/**
 * Shared WHERE builder used by both the invoice listing and its counter, so a gate and a
 * display cannot drift (same discipline as connections.ts attemptWhere).
 */
function invoiceWhere(query: InvoiceQuery): { sql: string; params: unknown[] } {
  const clauses = ['ownerGhii = ?'];
  const params: unknown[] = [query.ownerGhii];
  if (query.organismId) { clauses.push('organismId = ?'); params.push(query.organismId); }
  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    if (statuses.length === 0) clauses.push('1 = 0');
    else { clauses.push(`status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
  }
  if (query.type) { clauses.push('type = ?'); params.push(query.type); }
  if (query.buyerContactId) { clauses.push(`json_extract(buyer, '$.contactId') = ?`); params.push(query.buyerContactId); }
  if (query.from) { clauses.push('invoiceDate >= ?'); params.push(query.from); }
  if (query.to) { clauses.push('invoiceDate <= ?'); params.push(query.to); }
  return { sql: clauses.join(' AND '), params };
}

function voucherWhere(query: VoucherQuery): { sql: string; params: unknown[] } {
  const clauses = ['ownerGhii = ?'];
  const params: unknown[] = [query.ownerGhii];
  if (query.organismId) { clauses.push('organismId = ?'); params.push(query.organismId); }
  if (query.fiscalYearId) { clauses.push('fiscalYearId = ?'); params.push(query.fiscalYearId); }
  if (query.source) { clauses.push('source = ?'); params.push(query.source); }
  if (query.direction) { clauses.push('direction = ?'); params.push(query.direction); }
  if (query.from) { clauses.push('date >= ?'); params.push(query.from); }
  if (query.to) { clauses.push('date <= ?'); params.push(query.to); }
  return { sql: clauses.join(' AND '), params };
}

export const financeMethods: FinanceRepository & ThisType<SqliteStorage> = {
  // ── Invoices ──────────────────────────────────────────────────────────────
  async createInvoice(this: SqliteStorage, row: InvoiceRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO finance_invoices (
        id, ownerGhii, organismId, type, creditsInvoiceId, status, numberSeq, invoiceNumber,
        seller, buyer, lines, currency, totalNetMinor, totalVatMinor, totalGrossMinor,
        vatBreakdown, referenceNumber, paymentTermsDays, invoiceDate, dueDate, deliveryMethod,
        sentAt, deliveryStatus, operatorMessageId, finvoiceXmlKey, paidAt, paidTrackingCode,
        externalRef, fiscalYearId, notes, createdAt, updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.id, row.ownerGhii, row.organismId, row.type, row.creditsInvoiceId, row.status,
      row.numberSeq, row.invoiceNumber, JSON.stringify(row.seller), JSON.stringify(row.buyer),
      JSON.stringify(row.lines), row.currency, row.totalNetMinor, row.totalVatMinor,
      row.totalGrossMinor, JSON.stringify(row.vatBreakdown), row.referenceNumber,
      row.paymentTermsDays, row.invoiceDate, row.dueDate, row.deliveryMethod, row.sentAt,
      row.deliveryStatus, row.operatorMessageId, row.finvoiceXmlKey, row.paidAt,
      row.paidTrackingCode, row.externalRef, row.fiscalYearId, row.notes,
      row.createdAt, row.updatedAt,
    );
  },

  async getInvoice(this: SqliteStorage, id: string): Promise<InvoiceRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM finance_invoices WHERE id = ?').get(id) as Row | undefined;
    return r ? toInvoice(r) : undefined;
  },

  async listInvoices(this: SqliteStorage, query: InvoiceQuery): Promise<InvoiceRecord[]> {
    const { sql, params } = invoiceWhere(query);
    let stmt = `SELECT * FROM finance_invoices WHERE ${sql} ORDER BY createdAt DESC`;
    if (query.limit !== undefined) { stmt += ' LIMIT ?'; params.push(query.limit); }
    if (query.offset !== undefined) { stmt += ' OFFSET ?'; params.push(query.offset); }
    const rows = this.db.prepare(stmt).all(...params) as Row[];
    return rows.map(toInvoice);
  },

  async countInvoices(this: SqliteStorage, query: InvoiceQuery): Promise<number> {
    const { sql, params } = invoiceWhere(query);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM finance_invoices WHERE ${sql}`).get(...params) as { n: number };
    return Number(r.n);
  },

  async updateInvoiceDraft(this: SqliteStorage, row: InvoiceRecord): Promise<void> {
    this.db.prepare(`
      UPDATE finance_invoices SET
        organismId = ?, creditsInvoiceId = ?, seller = ?, buyer = ?, lines = ?, currency = ?,
        totalNetMinor = ?, totalVatMinor = ?, totalGrossMinor = ?, vatBreakdown = ?,
        paymentTermsDays = ?, fiscalYearId = ?, notes = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      row.organismId, row.creditsInvoiceId, JSON.stringify(row.seller), JSON.stringify(row.buyer),
      JSON.stringify(row.lines), row.currency, row.totalNetMinor, row.totalVatMinor,
      row.totalGrossMinor, JSON.stringify(row.vatBreakdown), row.paymentTermsDays,
      row.fiscalYearId, row.notes, row.updatedAt, row.id,
    );
  },

  async setInvoiceStatus(this: SqliteStorage, id: string, status: InvoiceStatus, patch?: InvoiceStatusPatch): Promise<void> {
    const sets = ['status = ?', 'updatedAt = ?'];
    const params: unknown[] = [status, new Date().toISOString()];
    const fields: [keyof InvoiceStatusPatch, string][] = [
      ['numberSeq', 'numberSeq'], ['invoiceNumber', 'invoiceNumber'],
      ['referenceNumber', 'referenceNumber'], ['invoiceDate', 'invoiceDate'],
      ['dueDate', 'dueDate'], ['deliveryMethod', 'deliveryMethod'], ['sentAt', 'sentAt'],
      ['deliveryStatus', 'deliveryStatus'], ['operatorMessageId', 'operatorMessageId'],
      ['finvoiceXmlKey', 'finvoiceXmlKey'], ['paidAt', 'paidAt'],
      ['paidTrackingCode', 'paidTrackingCode'], ['externalRef', 'externalRef'],
      ['fiscalYearId', 'fiscalYearId'],
    ];
    for (const [key, col] of fields) {
      if (patch && patch[key] !== undefined) { sets.push(`${col} = ?`); params.push(patch[key]); }
    }
    params.push(id);
    this.db.prepare(`UPDATE finance_invoices SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  },

  async deleteInvoice(this: SqliteStorage, id: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM finance_invoices WHERE id = ?').run(id);
    return r.changes > 0;
  },

  async findInvoiceByReference(this: SqliteStorage, ownerGhii: string, referenceNumber: string): Promise<InvoiceRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM finance_invoices WHERE ownerGhii = ? AND referenceNumber = ?')
      .get(ownerGhii, referenceNumber) as Row | undefined;
    return r ? toInvoice(r) : undefined;
  },

  // ── Vouchers (append-only) ────────────────────────────────────────────────
  async createVoucher(this: SqliteStorage, row: VoucherRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO finance_vouchers (
        id, ownerGhii, organismId, fiscalYearId, voucherNumber, date, description, direction,
        source, amountMinor, currency, vatBreakdown, counterparty, invoiceId, trackingCode,
        externalRef, attachments, reversesVoucherId, createdAt, updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.id, row.ownerGhii, row.organismId, row.fiscalYearId, row.voucherNumber, row.date,
      row.description, row.direction, row.source, row.amountMinor, row.currency,
      JSON.stringify(row.vatBreakdown), row.counterparty, row.invoiceId, row.trackingCode,
      row.externalRef, JSON.stringify(row.attachments), row.reversesVoucherId,
      row.createdAt, row.updatedAt,
    );
  },

  async getVoucher(this: SqliteStorage, id: string): Promise<VoucherRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM finance_vouchers WHERE id = ?').get(id) as Row | undefined;
    return r ? toVoucher(r) : undefined;
  },

  async listVouchers(this: SqliteStorage, query: VoucherQuery): Promise<VoucherRecord[]> {
    const { sql, params } = voucherWhere(query);
    let stmt = `SELECT * FROM finance_vouchers WHERE ${sql} ORDER BY voucherNumber DESC`;
    if (query.limit !== undefined) { stmt += ' LIMIT ?'; params.push(query.limit); }
    if (query.offset !== undefined) { stmt += ' OFFSET ?'; params.push(query.offset); }
    const rows = this.db.prepare(stmt).all(...params) as Row[];
    return rows.map(toVoucher);
  },

  async countVouchers(this: SqliteStorage, query: VoucherQuery): Promise<number> {
    const { sql, params } = voucherWhere(query);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM finance_vouchers WHERE ${sql}`).get(...params) as { n: number };
    return Number(r.n);
  },

  async setVoucherAttachments(this: SqliteStorage, id: string, attachments: string[]): Promise<void> {
    this.db.prepare('UPDATE finance_vouchers SET attachments = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(attachments), new Date().toISOString(), id);
  },

  async findVoucherByExternalRef(this: SqliteStorage, ownerGhii: string, externalRef: string): Promise<VoucherRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM finance_vouchers WHERE ownerGhii = ? AND externalRef = ?')
      .get(ownerGhii, externalRef) as Row | undefined;
    return r ? toVoucher(r) : undefined;
  },

  // ── VAT codes ─────────────────────────────────────────────────────────────
  async upsertVatCode(this: SqliteStorage, row: VatCodeRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO finance_vat_codes (id, countryCode, category, rateBp, label, validFrom, validTo, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        countryCode = excluded.countryCode, category = excluded.category, rateBp = excluded.rateBp,
        label = excluded.label, validFrom = excluded.validFrom, validTo = excluded.validTo,
        updatedAt = excluded.updatedAt
    `).run(
      row.id, row.countryCode, row.category, row.rateBp, JSON.stringify(row.label),
      row.validFrom, row.validTo, row.createdAt, row.updatedAt,
    );
  },

  async getVatCode(this: SqliteStorage, id: string): Promise<VatCodeRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM finance_vat_codes WHERE id = ?').get(id) as Row | undefined;
    return r ? toVatCode(r) : undefined;
  },

  async listVatCodes(this: SqliteStorage): Promise<VatCodeRecord[]> {
    const rows = this.db.prepare('SELECT * FROM finance_vat_codes ORDER BY rateBp DESC').all() as Row[];
    return rows.map(toVatCode);
  },

  // ── Fiscal years ──────────────────────────────────────────────────────────
  async createFiscalYear(this: SqliteStorage, row: FiscalYearRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO finance_fiscal_years (id, ownerGhii, organismId, label, startDate, endDate, locked, lockedAt, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.id, row.ownerGhii, row.organismId, row.label, row.startDate, row.endDate,
      row.locked ? 1 : 0, row.lockedAt, row.createdAt, row.updatedAt,
    );
  },

  async getFiscalYear(this: SqliteStorage, id: string): Promise<FiscalYearRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM finance_fiscal_years WHERE id = ?').get(id) as Row | undefined;
    return r ? toFiscalYear(r) : undefined;
  },

  async listFiscalYears(this: SqliteStorage, ownerGhii: string): Promise<FiscalYearRecord[]> {
    const rows = this.db.prepare('SELECT * FROM finance_fiscal_years WHERE ownerGhii = ? ORDER BY startDate DESC')
      .all(ownerGhii) as Row[];
    return rows.map(toFiscalYear);
  },

  async setFiscalYearLocked(this: SqliteStorage, id: string, locked: boolean, lockedAt: string | null): Promise<void> {
    this.db.prepare('UPDATE finance_fiscal_years SET locked = ?, lockedAt = ?, updatedAt = ? WHERE id = ?')
      .run(locked ? 1 : 0, lockedAt, new Date().toISOString(), id);
  },

  // ── Counters ──────────────────────────────────────────────────────────────
  async nextFinanceCounter(this: SqliteStorage, ownerGhii: string, kind: string): Promise<number> {
    const r = this.db.prepare(`
      INSERT INTO finance_counters (ownerGhii, kind, value) VALUES (?, ?, 1)
      ON CONFLICT(ownerGhii, kind) DO UPDATE SET value = value + 1
      RETURNING value
    `).get(ownerGhii, kind) as { value: number };
    return Number(r.value);
  },
};
