/**
 * @file src/storage/providers/postgres-kysely/methods/finance.ts
 * @description Postgres+Kysely implementation of the finance domain (invoices, vouchers,
 *   VAT codes, fiscal years, counters). Schema: migrations/0026_finance.sql.
 *
 *   nextFinanceCounter() is a single INSERT ... ON CONFLICT DO UPDATE ... RETURNING —
 *   Postgres serialises the row, so two concurrent invoice sends can never claim the same
 *   number. A read-then-write here would eventually produce a duplicate invoice number,
 *   which Finnish bookkeeping treats as a broken audit trail.
 *
 *   BIGINT money columns come back from pg as strings; every mapper funnels them through
 *   Number() so the record type stays `number` (integer cents are far below 2^53).
 *
 * @structure financeMethods — invoices · vouchers · vat codes · fiscal years · counters
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { sql, type Selectable } from 'kysely';
import type { FinanceRepository, InvoiceStatusPatch } from '../../../repositories/finance.repository.js';
import type {
  InvoiceRecord, InvoiceQuery, InvoiceStatus, InvoiceType, InvoiceParty, InvoiceLine,
  InvoiceDeliveryMethod, InvoiceDeliveryStatus, VatBreakdownEntry,
  VoucherRecord, VoucherQuery, VoucherSource, VoucherDirection,
  VatCodeRecord, VatCategory, FiscalYearRecord,
} from '../../../../models/finance-schemas.js';
import type {
  FinanceInvoice as InvoiceRow,
  FinanceVoucher as VoucherRow,
  FinanceVatCode as VatCodeRow,
  FinanceFiscalYear as FiscalYearRow,
  Json,
} from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

function toInvoice(r: Selectable<InvoiceRow>): InvoiceRecord {
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    organismId: r.organismId ?? null,
    type: r.type as InvoiceType,
    creditsInvoiceId: r.creditsInvoiceId ?? null,
    status: r.status as InvoiceStatus,
    numberSeq: r.numberSeq ?? null,
    invoiceNumber: r.invoiceNumber ?? null,
    seller: r.seller as unknown as InvoiceParty,
    buyer: r.buyer as unknown as InvoiceParty,
    lines: (r.lines as unknown as InvoiceLine[] | null) ?? [],
    currency: r.currency,
    totalNetMinor: Number(r.totalNetMinor),
    totalVatMinor: Number(r.totalVatMinor),
    totalGrossMinor: Number(r.totalGrossMinor),
    vatBreakdown: (r.vatBreakdown as unknown as VatBreakdownEntry[] | null) ?? [],
    referenceNumber: r.referenceNumber ?? null,
    paymentTermsDays: r.paymentTermsDays,
    invoiceDate: r.invoiceDate ?? null,
    dueDate: r.dueDate ?? null,
    deliveryMethod: (r.deliveryMethod as InvoiceDeliveryMethod | null) ?? null,
    sentAt: r.sentAt ?? null,
    deliveryStatus: (r.deliveryStatus as InvoiceDeliveryStatus | null) ?? null,
    operatorMessageId: r.operatorMessageId ?? null,
    finvoiceXmlKey: r.finvoiceXmlKey ?? null,
    paidAt: r.paidAt ?? null,
    paidTrackingCode: r.paidTrackingCode ?? null,
    externalRef: r.externalRef ?? null,
    fiscalYearId: r.fiscalYearId ?? null,
    notes: r.notes ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toVoucher(r: Selectable<VoucherRow>): VoucherRecord {
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    organismId: r.organismId ?? null,
    fiscalYearId: r.fiscalYearId,
    voucherNumber: r.voucherNumber,
    date: r.date,
    description: r.description,
    direction: r.direction as VoucherDirection,
    source: r.source as VoucherSource,
    amountMinor: Number(r.amountMinor),
    currency: r.currency,
    vatBreakdown: (r.vatBreakdown as unknown as VatBreakdownEntry[] | null) ?? [],
    counterparty: r.counterparty ?? null,
    invoiceId: r.invoiceId ?? null,
    trackingCode: r.trackingCode ?? null,
    externalRef: r.externalRef ?? null,
    attachments: (r.attachments as unknown as string[] | null) ?? [],
    reversesVoucherId: r.reversesVoucherId ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toVatCode(r: Selectable<VatCodeRow>): VatCodeRecord {
  return {
    id: r.id,
    countryCode: r.countryCode,
    category: r.category as VatCategory,
    rateBp: r.rateBp,
    label: r.label as unknown as { en: string; fi: string },
    validFrom: r.validFrom,
    validTo: r.validTo ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toFiscalYear(r: Selectable<FiscalYearRow>): FiscalYearRecord {
  return {
    id: r.id,
    ownerGhii: r.ownerGhii,
    organismId: r.organismId ?? null,
    label: r.label,
    startDate: r.startDate,
    endDate: r.endDate,
    locked: r.locked,
    lockedAt: r.lockedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const financeMethods: FinanceRepository & ThisType<PostgresKyselyStorage> = {
  // ── Invoices ──────────────────────────────────────────────────────────────
  async createInvoice(this: PostgresKyselyStorage, row: InvoiceRecord): Promise<void> {
    await this.db.insertInto('FinanceInvoice').values({
      id: row.id,
      ownerGhii: row.ownerGhii,
      organismId: row.organismId,
      type: row.type,
      creditsInvoiceId: row.creditsInvoiceId,
      status: row.status,
      numberSeq: row.numberSeq,
      invoiceNumber: row.invoiceNumber,
      seller: jsonb(row.seller) as unknown as Json,
      buyer: jsonb(row.buyer) as unknown as Json,
      lines: jsonb(row.lines) as unknown as Json,
      currency: row.currency,
      totalNetMinor: row.totalNetMinor,
      totalVatMinor: row.totalVatMinor,
      totalGrossMinor: row.totalGrossMinor,
      vatBreakdown: jsonb(row.vatBreakdown) as unknown as Json,
      referenceNumber: row.referenceNumber,
      paymentTermsDays: row.paymentTermsDays,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      deliveryMethod: row.deliveryMethod,
      sentAt: row.sentAt,
      deliveryStatus: row.deliveryStatus,
      operatorMessageId: row.operatorMessageId,
      finvoiceXmlKey: row.finvoiceXmlKey,
      paidAt: row.paidAt,
      paidTrackingCode: row.paidTrackingCode,
      externalRef: row.externalRef,
      fiscalYearId: row.fiscalYearId,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).execute();
  },

  async getInvoice(this: PostgresKyselyStorage, id: string): Promise<InvoiceRecord | undefined> {
    const r = await this.db.selectFrom('FinanceInvoice').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toInvoice(r) : undefined;
  },

  async listInvoices(this: PostgresKyselyStorage, query: InvoiceQuery): Promise<InvoiceRecord[]> {
    let q = this.db.selectFrom('FinanceInvoice').selectAll().where('ownerGhii', '=', query.ownerGhii);
    if (query.organismId) q = q.where('organismId', '=', query.organismId);
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      q = statuses.length > 0 ? q.where('status', 'in', statuses) : q.where(sql<boolean>`1 = 0`);
    }
    if (query.type) q = q.where('type', '=', query.type);
    if (query.buyerContactId) q = q.where(sql<boolean>`"buyer"->>'contactId' = ${query.buyerContactId}`);
    if (query.from) q = q.where('invoiceDate', '>=', query.from);
    if (query.to) q = q.where('invoiceDate', '<=', query.to);
    q = q.orderBy('createdAt', 'desc');
    if (query.limit !== undefined) q = q.limit(query.limit);
    if (query.offset !== undefined) q = q.offset(query.offset);
    const rows = await q.execute();
    return rows.map(toInvoice);
  },

  async countInvoices(this: PostgresKyselyStorage, query: InvoiceQuery): Promise<number> {
    let q = this.db.selectFrom('FinanceInvoice')
      .select(sql<number>`count(*)`.as('n'))
      .where('ownerGhii', '=', query.ownerGhii);
    if (query.organismId) q = q.where('organismId', '=', query.organismId);
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      q = statuses.length > 0 ? q.where('status', 'in', statuses) : q.where(sql<boolean>`1 = 0`);
    }
    if (query.type) q = q.where('type', '=', query.type);
    if (query.buyerContactId) q = q.where(sql<boolean>`"buyer"->>'contactId' = ${query.buyerContactId}`);
    if (query.from) q = q.where('invoiceDate', '>=', query.from);
    if (query.to) q = q.where('invoiceDate', '<=', query.to);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  async updateInvoiceDraft(this: PostgresKyselyStorage, row: InvoiceRecord): Promise<void> {
    await this.db.updateTable('FinanceInvoice').set({
      organismId: row.organismId,
      creditsInvoiceId: row.creditsInvoiceId,
      seller: jsonb(row.seller) as unknown as Json,
      buyer: jsonb(row.buyer) as unknown as Json,
      lines: jsonb(row.lines) as unknown as Json,
      currency: row.currency,
      totalNetMinor: row.totalNetMinor,
      totalVatMinor: row.totalVatMinor,
      totalGrossMinor: row.totalGrossMinor,
      vatBreakdown: jsonb(row.vatBreakdown) as unknown as Json,
      paymentTermsDays: row.paymentTermsDays,
      fiscalYearId: row.fiscalYearId,
      notes: row.notes,
      updatedAt: row.updatedAt,
    }).where('id', '=', row.id).execute();
  },

  async setInvoiceStatus(this: PostgresKyselyStorage, id: string, status: InvoiceStatus, patch?: InvoiceStatusPatch): Promise<void> {
    await this.db.updateTable('FinanceInvoice').set({
      status,
      ...(patch?.numberSeq !== undefined ? { numberSeq: patch.numberSeq } : {}),
      ...(patch?.invoiceNumber !== undefined ? { invoiceNumber: patch.invoiceNumber } : {}),
      ...(patch?.referenceNumber !== undefined ? { referenceNumber: patch.referenceNumber } : {}),
      ...(patch?.invoiceDate !== undefined ? { invoiceDate: patch.invoiceDate } : {}),
      ...(patch?.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch?.deliveryMethod !== undefined ? { deliveryMethod: patch.deliveryMethod } : {}),
      ...(patch?.sentAt !== undefined ? { sentAt: patch.sentAt } : {}),
      ...(patch?.deliveryStatus !== undefined ? { deliveryStatus: patch.deliveryStatus } : {}),
      ...(patch?.operatorMessageId !== undefined ? { operatorMessageId: patch.operatorMessageId } : {}),
      ...(patch?.finvoiceXmlKey !== undefined ? { finvoiceXmlKey: patch.finvoiceXmlKey } : {}),
      ...(patch?.paidAt !== undefined ? { paidAt: patch.paidAt } : {}),
      ...(patch?.paidTrackingCode !== undefined ? { paidTrackingCode: patch.paidTrackingCode } : {}),
      ...(patch?.externalRef !== undefined ? { externalRef: patch.externalRef } : {}),
      ...(patch?.fiscalYearId !== undefined ? { fiscalYearId: patch.fiscalYearId } : {}),
      updatedAt: new Date().toISOString(),
    }).where('id', '=', id).execute();
  },

  async deleteInvoice(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('FinanceInvoice').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async findInvoiceByReference(this: PostgresKyselyStorage, ownerGhii: string, referenceNumber: string): Promise<InvoiceRecord | undefined> {
    const r = await this.db.selectFrom('FinanceInvoice').selectAll()
      .where('ownerGhii', '=', ownerGhii)
      .where('referenceNumber', '=', referenceNumber)
      .executeTakeFirst();
    return r ? toInvoice(r) : undefined;
  },

  // ── Vouchers (append-only) ────────────────────────────────────────────────
  async createVoucher(this: PostgresKyselyStorage, row: VoucherRecord): Promise<void> {
    await this.db.insertInto('FinanceVoucher').values({
      id: row.id,
      ownerGhii: row.ownerGhii,
      organismId: row.organismId,
      fiscalYearId: row.fiscalYearId,
      voucherNumber: row.voucherNumber,
      date: row.date,
      description: row.description,
      direction: row.direction,
      source: row.source,
      amountMinor: row.amountMinor,
      currency: row.currency,
      vatBreakdown: jsonb(row.vatBreakdown) as unknown as Json,
      counterparty: row.counterparty,
      invoiceId: row.invoiceId,
      trackingCode: row.trackingCode,
      externalRef: row.externalRef,
      attachments: jsonb(row.attachments) as unknown as Json,
      reversesVoucherId: row.reversesVoucherId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).execute();
  },

  async getVoucher(this: PostgresKyselyStorage, id: string): Promise<VoucherRecord | undefined> {
    const r = await this.db.selectFrom('FinanceVoucher').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toVoucher(r) : undefined;
  },

  async listVouchers(this: PostgresKyselyStorage, query: VoucherQuery): Promise<VoucherRecord[]> {
    let q = this.db.selectFrom('FinanceVoucher').selectAll().where('ownerGhii', '=', query.ownerGhii);
    if (query.organismId) q = q.where('organismId', '=', query.organismId);
    if (query.fiscalYearId) q = q.where('fiscalYearId', '=', query.fiscalYearId);
    if (query.source) q = q.where('source', '=', query.source);
    if (query.direction) q = q.where('direction', '=', query.direction);
    if (query.from) q = q.where('date', '>=', query.from);
    if (query.to) q = q.where('date', '<=', query.to);
    q = q.orderBy('voucherNumber', 'desc');
    if (query.limit !== undefined) q = q.limit(query.limit);
    if (query.offset !== undefined) q = q.offset(query.offset);
    const rows = await q.execute();
    return rows.map(toVoucher);
  },

  async countVouchers(this: PostgresKyselyStorage, query: VoucherQuery): Promise<number> {
    let q = this.db.selectFrom('FinanceVoucher')
      .select(sql<number>`count(*)`.as('n'))
      .where('ownerGhii', '=', query.ownerGhii);
    if (query.organismId) q = q.where('organismId', '=', query.organismId);
    if (query.fiscalYearId) q = q.where('fiscalYearId', '=', query.fiscalYearId);
    if (query.source) q = q.where('source', '=', query.source);
    if (query.direction) q = q.where('direction', '=', query.direction);
    if (query.from) q = q.where('date', '>=', query.from);
    if (query.to) q = q.where('date', '<=', query.to);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  async setVoucherAttachments(this: PostgresKyselyStorage, id: string, attachments: string[]): Promise<void> {
    await this.db.updateTable('FinanceVoucher').set({
      attachments: jsonb(attachments) as unknown as Json,
      updatedAt: new Date().toISOString(),
    }).where('id', '=', id).execute();
  },

  async findVoucherByExternalRef(this: PostgresKyselyStorage, ownerGhii: string, externalRef: string): Promise<VoucherRecord | undefined> {
    const r = await this.db.selectFrom('FinanceVoucher').selectAll()
      .where('ownerGhii', '=', ownerGhii)
      .where('externalRef', '=', externalRef)
      .executeTakeFirst();
    return r ? toVoucher(r) : undefined;
  },

  // ── VAT codes ─────────────────────────────────────────────────────────────
  async upsertVatCode(this: PostgresKyselyStorage, row: VatCodeRecord): Promise<void> {
    await this.db.insertInto('FinanceVatCode').values({
      id: row.id,
      countryCode: row.countryCode,
      category: row.category,
      rateBp: row.rateBp,
      label: jsonb(row.label) as unknown as Json,
      validFrom: row.validFrom,
      validTo: row.validTo,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).onConflict((oc) => oc.column('id').doUpdateSet({
      countryCode: row.countryCode,
      category: row.category,
      rateBp: row.rateBp,
      label: jsonb(row.label) as unknown as Json,
      validFrom: row.validFrom,
      validTo: row.validTo,
      updatedAt: row.updatedAt,
    })).execute();
  },

  async getVatCode(this: PostgresKyselyStorage, id: string): Promise<VatCodeRecord | undefined> {
    const r = await this.db.selectFrom('FinanceVatCode').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toVatCode(r) : undefined;
  },

  async listVatCodes(this: PostgresKyselyStorage): Promise<VatCodeRecord[]> {
    const rows = await this.db.selectFrom('FinanceVatCode').selectAll().orderBy('rateBp', 'desc').execute();
    return rows.map(toVatCode);
  },

  // ── Fiscal years ──────────────────────────────────────────────────────────
  async createFiscalYear(this: PostgresKyselyStorage, row: FiscalYearRecord): Promise<void> {
    await this.db.insertInto('FinanceFiscalYear').values({
      id: row.id,
      ownerGhii: row.ownerGhii,
      organismId: row.organismId,
      label: row.label,
      startDate: row.startDate,
      endDate: row.endDate,
      locked: row.locked,
      lockedAt: row.lockedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).execute();
  },

  async getFiscalYear(this: PostgresKyselyStorage, id: string): Promise<FiscalYearRecord | undefined> {
    const r = await this.db.selectFrom('FinanceFiscalYear').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toFiscalYear(r) : undefined;
  },

  async listFiscalYears(this: PostgresKyselyStorage, ownerGhii: string): Promise<FiscalYearRecord[]> {
    const rows = await this.db.selectFrom('FinanceFiscalYear').selectAll()
      .where('ownerGhii', '=', ownerGhii)
      .orderBy('startDate', 'desc')
      .execute();
    return rows.map(toFiscalYear);
  },

  async setFiscalYearLocked(this: PostgresKyselyStorage, id: string, locked: boolean, lockedAt: string | null): Promise<void> {
    await this.db.updateTable('FinanceFiscalYear').set({
      locked,
      lockedAt,
      updatedAt: new Date().toISOString(),
    }).where('id', '=', id).execute();
  },

  // ── Counters ──────────────────────────────────────────────────────────────
  async nextFinanceCounter(this: PostgresKyselyStorage, ownerGhii: string, kind: string): Promise<number> {
    const r = await this.db.insertInto('FinanceCounter')
      .values({ ownerGhii, kind, value: 1 })
      .onConflict((oc) => oc.columns(['ownerGhii', 'kind']).doUpdateSet({
        value: sql<number>`"FinanceCounter"."value" + 1`,
      }))
      .returning('value')
      .executeTakeFirstOrThrow();
    return Number(r.value);
  },
};
