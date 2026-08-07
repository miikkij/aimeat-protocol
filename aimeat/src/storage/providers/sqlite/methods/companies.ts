/**
 * @file src/storage/providers/sqlite/methods/companies.ts
 * @description SQLite (better-sqlite3) implementation of the company registry.
 *   Schema: schema-tables-4.ts. Slug lookups compare lower-cased, matching the unique index.
 * @structure companyMethods — CRUD + slug resolution
 * @usage merged onto SqliteStorage.prototype in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */
import type { CompanyRepository } from '../../../repositories/company.repository.js';
import type {
  CompanyRecord, CompanyQuery, CompanyStatus, CompanyFrontPageKind,
} from '../../../../models/company-schemas.js';
import type { SqliteStorage } from '../index.js';

type Row = Record<string, unknown>;

function toCompany(r: Row): CompanyRecord {
  const s = (k: string): string | null => (r[k] as string | null) ?? null;
  return {
    id: r.id as string,
    slug: r.slug as string,
    ownerGhii: r.ownerGhii as string,
    name: r.name as string,
    description: s('description'),
    organismId: s('organismId'),
    frontPage: { kind: r.frontPageKind as CompanyFrontPageKind, target: (r.frontPageTarget as string) ?? '' },
    businessId: s('businessId'),
    vatId: s('vatId'),
    streetAddress: s('streetAddress'),
    postalCode: s('postalCode'),
    city: s('city'),
    country: s('country'),
    email: s('email'),
    phone: s('phone'),
    iban: s('iban'),
    bic: s('bic'),
    einvoiceAddress: s('einvoiceAddress'),
    einvoiceOperator: s('einvoiceOperator'),
    status: r.status as CompanyStatus,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

function where(query: CompanyQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (query.ownerGhii) { clauses.push('ownerGhii = ?'); params.push(query.ownerGhii); }
  if (query.status) { clauses.push('status = ?'); params.push(query.status); }
  return { sql: clauses.join(' AND '), params };
}

export const companyMethods: CompanyRepository & ThisType<SqliteStorage> = {
  async createCompany(this: SqliteStorage, row: CompanyRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO companies (
        id, slug, ownerGhii, name, description, organismId, frontPageKind, frontPageTarget,
        businessId, vatId, streetAddress, postalCode, city, country, email, phone,
        iban, bic, einvoiceAddress, einvoiceOperator, status, createdAt, updatedAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      row.id, row.slug, row.ownerGhii, row.name, row.description, row.organismId,
      row.frontPage.kind, row.frontPage.target,
      row.businessId, row.vatId, row.streetAddress, row.postalCode, row.city, row.country,
      row.email, row.phone, row.iban, row.bic, row.einvoiceAddress, row.einvoiceOperator,
      row.status, row.createdAt, row.updatedAt,
    );
  },

  async getCompany(this: SqliteStorage, id: string): Promise<CompanyRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Row | undefined;
    return r ? toCompany(r) : undefined;
  },

  async getCompanyBySlug(this: SqliteStorage, slug: string): Promise<CompanyRecord | undefined> {
    const r = this.db.prepare('SELECT * FROM companies WHERE lower(slug) = ?').get(slug.toLowerCase()) as Row | undefined;
    return r ? toCompany(r) : undefined;
  },

  async listCompanies(this: SqliteStorage, query: CompanyQuery): Promise<CompanyRecord[]> {
    const w = where(query);
    let stmt = `SELECT * FROM companies WHERE ${w.sql} ORDER BY createdAt DESC`;
    if (query.limit !== undefined) { stmt += ' LIMIT ?'; w.params.push(query.limit); }
    if (query.offset !== undefined) { stmt += ' OFFSET ?'; w.params.push(query.offset); }
    const rows = this.db.prepare(stmt).all(...w.params) as Row[];
    return rows.map(toCompany);
  },

  async countCompanies(this: SqliteStorage, query: CompanyQuery): Promise<number> {
    const w = where(query);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE ${w.sql}`).get(...w.params) as { n: number };
    return Number(r.n);
  },

  async updateCompany(this: SqliteStorage, row: CompanyRecord): Promise<void> {
    this.db.prepare(`
      UPDATE companies SET
        slug = ?, name = ?, description = ?, organismId = ?, frontPageKind = ?, frontPageTarget = ?,
        businessId = ?, vatId = ?, streetAddress = ?, postalCode = ?, city = ?, country = ?,
        email = ?, phone = ?, iban = ?, bic = ?, einvoiceAddress = ?, einvoiceOperator = ?,
        status = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      row.slug, row.name, row.description, row.organismId, row.frontPage.kind, row.frontPage.target,
      row.businessId, row.vatId, row.streetAddress, row.postalCode, row.city, row.country,
      row.email, row.phone, row.iban, row.bic, row.einvoiceAddress, row.einvoiceOperator,
      row.status, row.updatedAt, row.id,
    );
  },

  async deleteCompany(this: SqliteStorage, id: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM companies WHERE id = ?').run(id);
    return r.changes > 0;
  },
};
