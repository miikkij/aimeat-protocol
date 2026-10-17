/**
 * @file src/services/publish-requests/apply-company.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a company's front page: the company's address is
 *   pointed at the front page the request names, as the owner, through
 *   services/company/company-service.ts setFrontPage, the function PUT /v1/companies/:id/front-page and
 *   aimeat_company_front_page call (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries when the company's own page was written (a
 *   'portfolio' front page) or when the company record last changed. A replaced page, a changed
 *   company, or an address that serves something already makes the approval outdated.
 * @structure applyCompanyPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.company (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: company front page).
 */
import type { CompanyFrontPageKind, CompanyRecord } from '../../models/company-schemas.js';
import { CompanyError, companyAddress, requireOwnCompany, setFrontPage } from '../company/company-service.js';
import { companyPortfolioKey } from '../company/company-portfolio.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

const KINDS: readonly CompanyFrontPageKind[] = ['app', 'portfolio', 'redirect'];

export async function applyCompanyPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const id = String(request.target.company ?? '');
  const kind = request.change.to as CompanyFrontPageKind;
  if (!id || !KINDS.includes(kind)) return { ok: false, reason: 'the company is not on this account' };
  let company: CompanyRecord;
  try {
    company = await requireOwnCompany(ctx.storage, ownerGhii, id);
  } catch (e) {
    if (e instanceof CompanyError) return { ok: false, reason: 'the company was deleted' };
    throw e;
  }
  const frontTarget = String(request.target.front_target ?? '');
  const url = companyAddress(ctx.config, company) ?? undefined;
  if (company.frontPage.kind === kind && (kind === 'portfolio' || company.frontPage.target === frontTarget)) {
    return url ? { ok: true, url } : { ok: true };
  }
  if (company.frontPage.kind !== 'none') return { ok: false, reason: 'the company\'s address was given a front page after the request was made' };
  const page = kind === 'portfolio' ? await ctx.storage.getStorageFileMeta(company.ownerGhii, companyPortfolioKey(company.id)) : null;
  if ((page?.createdAt ?? company.updatedAt) !== String(request.target.version)) {
    return { ok: false, reason: kind === 'portfolio' ? 'the company\'s page was replaced after the request was made' : 'the company changed after the request was made' };
  }
  try {
    // The owner in person: they approved it.
    await setFrontPage(ctx.storage, ownerGhii, id, { kind, target: frontTarget });
  } catch (e) {
    if (e instanceof CompanyError) return { ok: false, reason: e.message };
    throw e;
  }
  return url ? { ok: true, url } : { ok: true };
}
