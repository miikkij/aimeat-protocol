/**
 * @file src/services/company/company-portfolio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A company's own HTML page: publish it, read what is published, remove it.
 *   This is the company-scale twin of the personal portfolio — same idea (a standalone
 *   document the owner wrote, served on an isolated origin), different address family:
 *   a personal portfolio answers on {user}.portfolio.<apex>, a company's on {slug}.co.<apex>.
 *
 *   Stored as a PUBLIC storage file under the OWNER's GHII, keyed by company id
 *   (`company/{id}/index.html`). Keying on the id rather than the slug means the page
 *   survives anything that ever renames an address, and keeping it under the owner means
 *   the owner's storage quota is the one that applies — a company is not a separate tenant.
 *
 *   Publishing IS the act of choosing the front page: a founder who uploads a page means
 *   for it to be served, and making them then find a dropdown would be a second step that
 *   exists only because the data model has two fields.
 *
 * @structure companyPortfolioKey · publishCompanyPortfolio · getCompanyPortfolio ·
 *   readCompanyPortfolioPage · deleteCompanyPortfolio
 * @usage await publishCompanyPortfolio(config, storage, ownerGhii, companyId, html);
 * @version-history
 *   v1.1.0 — 2026-10-08 — The page carries an AI-provenance record decided from its writer
 *     (provenanceForWrite); readCompanyPortfolioPage replaces readCompanyPortfolioHtml and gives the
 *     serving path the page and its record.
 *   v1.0.0 — 2026-08-08 — A company's own front page as raw HTML.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AiProvenanceRecordRow } from '../../storage/interface.js';
import { provenanceForWrite, storeHeldProvenance } from '../ai-provenance.js';
import type { CompanyRecord } from '../../models/company-schemas.js';
import { CompanyError, requireOwnCompany } from './company-service.js';

/** Where a company's page lives in the owner's storage namespace. */
export function companyPortfolioKey(companyId: string): string {
  return `company/${companyId}/index.html`;
}

export interface CompanyPortfolioStatus {
  published: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

/** The size ceiling, shared with the personal portfolio so one page cannot outgrow the other. */
function maxBytes(config: AimeatConfig): number {
  return (config.portfolioMaxSizeKb ?? 512) * 1024;
}

/**
 * Replaces the company's page and points the address at it. Returns the updated company so
 * the caller can report the front page without a second read.
 */
export async function publishCompanyPortfolio(
  config: AimeatConfig, storage: Storage, ownerGhii: string, companyId: string, html: string,
  /** Who wrote the page (GHII, GAII or GEAI), for its AI-provenance record. An agent that says
   *  nothing is stamped model-written (Mint-3); a person writing in person is not. */
  writer?: { principal: string; pipeline: string },
): Promise<{ company: CompanyRecord; status: CompanyPortfolioStatus }> {
  const company = await requireOwnCompany(storage, ownerGhii, companyId);

  const trimmed = (html ?? '').trim();
  if (!trimmed) throw new CompanyError('INVALID_PORTFOLIO', 400, 'The page is empty');
  const data = Buffer.from(trimmed, 'utf-8');
  if (data.length > maxBytes(config)) {
    throw new CompanyError('QUOTA_EXCEEDED', 413,
      `The page exceeds the ${config.portfolioMaxSizeKb ?? 512}KB limit`);
  }
  // Anything that is not a document would be served as text/html anyway, so refusing here is
  // the difference between a clear error now and a blank white address later.
  if (!/<[a-z!][\s\S]*>/i.test(trimmed)) {
    throw new CompanyError('INVALID_PORTFOLIO', 400, 'The page does not look like HTML');
  }

  const key = companyPortfolioKey(company.id);
  // The record is held until the page has landed: a public page makes it resolvable by anyone.
  const held: AiProvenanceRecordRow[] = [];
  const aiProvenanceId = writer ? await provenanceForWrite(storage, {
    principal: writer.principal, content: data, pipeline: writer.pipeline,
    surface: { visibility: 'public', humanAudience: true },
    labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl,
    enabled: config.aiProvenance, held,
  }) : undefined;
  await storage.deleteStorageFile(ownerGhii, key);
  const now = new Date().toISOString();
  await storage.createStorageFile({
    key,
    ownerGaii: ownerGhii,
    visibility: 'public',
    mimeType: 'text/html',
    size: data.length,
    data,
    createdAt: now,
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
  });
  await storeHeldProvenance(storage, held);

  let updated = company;
  if (company.frontPage.kind !== 'portfolio') {
    updated = { ...company, frontPage: { kind: 'portfolio', target: '' }, updatedAt: now };
    await storage.updateCompany(updated);
  }
  return { company: updated, status: { published: true, sizeBytes: data.length, updatedAt: now } };
}

/** What is published, without moving the bytes — the shape the settings UI reads. */
export async function getCompanyPortfolio(
  storage: Storage, ownerGhii: string, companyId: string,
): Promise<CompanyPortfolioStatus> {
  const company = await requireOwnCompany(storage, ownerGhii, companyId);
  const file = await storage.getStorageFile(ownerGhii, companyPortfolioKey(company.id));
  if (!file) return { published: false, sizeBytes: 0, updatedAt: null };
  return { published: true, sizeBytes: file.size, updatedAt: file.createdAt };
}

/**
 * The page and its AI-provenance record, for the serving path, which sends the record's marks.
 * Takes the company record (the co origin already resolved it from the slug) so serving never
 * needs a second ownership check.
 */
export async function readCompanyPortfolioPage(
  storage: Storage, company: CompanyRecord,
): Promise<{ html: string; aiProvenanceId?: string } | null> {
  const file = await storage.getStorageFile(company.ownerGhii, companyPortfolioKey(company.id));
  return file ? { html: file.data.toString('utf-8'), ...(file.aiProvenanceId ? { aiProvenanceId: file.aiProvenanceId } : {}) } : null;
}

/**
 * Removes the page. The address falls back to serving nothing rather than silently keeping a
 * front-page setting that points at a document which no longer exists.
 */
export async function deleteCompanyPortfolio(
  storage: Storage, ownerGhii: string, companyId: string,
): Promise<CompanyRecord> {
  const company = await requireOwnCompany(storage, ownerGhii, companyId);
  await storage.deleteStorageFile(ownerGhii, companyPortfolioKey(company.id));
  if (company.frontPage.kind !== 'portfolio') return company;
  const next: CompanyRecord = {
    ...company, frontPage: { kind: 'none', target: '' }, updatedAt: new Date().toISOString(),
  };
  await storage.updateCompany(next);
  return next;
}
