/**
 * @file src/storage/providers/postgres-kysely/methods/companies.ts
 * @description Postgres+Kysely implementation of the company registry.
 *   Schema: migrations/0028_companies.sql. Slug lookups compare lower-cased, matching the
 *   unique index — the column keeps the display casing, resolution is case-insensitive.
 * @structure companyMethods — CRUD + slug resolution
 * @usage merged onto PostgresKyselyStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */
import { sql, type Selectable } from 'kysely';
import type { CompanyRepository } from '../../../repositories/company.repository.js';
import type {
  CompanyRecord, CompanyQuery, CompanyStatus, CompanyFrontPageKind,
} from '../../../../models/company-schemas.js';
import type { Company as CompanyRow } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

function toCompany(r: Selectable<CompanyRow>): CompanyRecord {
  return {
    id: r.id,
    slug: r.slug,
    ownerGhii: r.ownerGhii,
    name: r.name,
    description: r.description ?? null,
    organismId: r.organismId ?? null,
    frontPage: { kind: r.frontPageKind as CompanyFrontPageKind, target: r.frontPageTarget },
    businessId: r.businessId ?? null,
    vatId: r.vatId ?? null,
    streetAddress: r.streetAddress ?? null,
    postalCode: r.postalCode ?? null,
    city: r.city ?? null,
    country: r.country ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    iban: r.iban ?? null,
    bic: r.bic ?? null,
    einvoiceAddress: r.einvoiceAddress ?? null,
    einvoiceOperator: r.einvoiceOperator ?? null,
    status: r.status as CompanyStatus,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function values(row: CompanyRecord) {
  return {
    slug: row.slug,
    ownerGhii: row.ownerGhii,
    name: row.name,
    description: row.description,
    organismId: row.organismId,
    frontPageKind: row.frontPage.kind,
    frontPageTarget: row.frontPage.target,
    businessId: row.businessId,
    vatId: row.vatId,
    streetAddress: row.streetAddress,
    postalCode: row.postalCode,
    city: row.city,
    country: row.country,
    email: row.email,
    phone: row.phone,
    iban: row.iban,
    bic: row.bic,
    einvoiceAddress: row.einvoiceAddress,
    einvoiceOperator: row.einvoiceOperator,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

export const companyMethods: CompanyRepository & ThisType<PostgresKyselyStorage> = {
  async createCompany(this: PostgresKyselyStorage, row: CompanyRecord): Promise<void> {
    await this.db.insertInto('Company')
      .values({ id: row.id, createdAt: row.createdAt, ...values(row) })
      .execute();
  },

  async getCompany(this: PostgresKyselyStorage, id: string): Promise<CompanyRecord | undefined> {
    const r = await this.db.selectFrom('Company').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toCompany(r) : undefined;
  },

  async getCompanyBySlug(this: PostgresKyselyStorage, slug: string): Promise<CompanyRecord | undefined> {
    const r = await this.db.selectFrom('Company').selectAll()
      .where(sql<boolean>`lower("slug") = ${slug.toLowerCase()}`)
      .executeTakeFirst();
    return r ? toCompany(r) : undefined;
  },

  async listCompanies(this: PostgresKyselyStorage, query: CompanyQuery): Promise<CompanyRecord[]> {
    let q = this.db.selectFrom('Company').selectAll();
    if (query.ownerGhii) q = q.where('ownerGhii', '=', query.ownerGhii);
    if (query.status) q = q.where('status', '=', query.status);
    q = q.orderBy('createdAt', 'desc');
    if (query.limit !== undefined) q = q.limit(query.limit);
    if (query.offset !== undefined) q = q.offset(query.offset);
    const rows = await q.execute();
    return rows.map(toCompany);
  },

  async countCompanies(this: PostgresKyselyStorage, query: CompanyQuery): Promise<number> {
    let q = this.db.selectFrom('Company').select(sql<number>`count(*)`.as('n'));
    if (query.ownerGhii) q = q.where('ownerGhii', '=', query.ownerGhii);
    if (query.status) q = q.where('status', '=', query.status);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  async updateCompany(this: PostgresKyselyStorage, row: CompanyRecord): Promise<void> {
    await this.db.updateTable('Company').set(values(row)).where('id', '=', row.id).execute();
  },

  async deleteCompany(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Company').where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
