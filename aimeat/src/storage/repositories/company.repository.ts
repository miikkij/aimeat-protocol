/**
 * @file company.repository.ts
 * @description Repository contract for the company registry. Same discipline as the
 *   finance repository: no method applies authorization (routes compare ownerGhii against
 *   resolveIdentity), and the slug uniqueness is enforced by a unique index rather than a
 *   read-then-write check — two founders claiming the same name at the same moment must
 *   not both win.
 * @usage Storage interface composes this; providers implement in methods/companies.ts.
 * @version-history
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */
import type { CompanyRecord, CompanyQuery } from '../../models/company-schemas.js';

export interface CompanyRepository {
  /** Throws (unique violation) when the slug is taken — that IS the arbitration. */
  createCompany(row: CompanyRecord): Promise<void>;
  getCompany(id: string): Promise<CompanyRecord | undefined>;
  /** The co-origin resolution path: {slug}.co.<apex> → company. */
  getCompanyBySlug(slug: string): Promise<CompanyRecord | undefined>;
  listCompanies(query: CompanyQuery): Promise<CompanyRecord[]>;
  countCompanies(query: CompanyQuery): Promise<number>;
  updateCompany(row: CompanyRecord): Promise<void>;
  deleteCompany(id: string): Promise<boolean>;
}
