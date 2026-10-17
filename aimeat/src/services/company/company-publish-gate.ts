/**
 * @file src/services/company/company-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate at the doors that point a company's address at a front page (plan
 *   doc-mvcn6c7e4e5q, V4): PUT /v1/companies/:id/front-page, PUT /v1/companies/:id/portfolio and their
 *   MCP tools. An address that serves something is public, as the exposure report counts it
 *   (services/exposure/sources-places.ts companySource), so pointing an address that serves nothing
 *   ('none') at a page is the raise.
 *
 *   On an ask, the company's own page CONTENT is stored and the address keeps serving nothing; the
 *   request is to point it. The applier (publish-requests/apply-company.ts) points it as the owner
 *   through setFrontPage. The request carries when the company's page was written (a 'portfolio' front
 *   page) or when the company record last changed, so nothing the owner did not see goes out.
 * @structure companyFrontPageAsk · fileCompanyAsk · GateCaller · setCompanyFrontPageGated ·
 *   publishCompanyPortfolioGated
 * @usage const { company, asked } = await setCompanyFrontPageGated(ctx, { caller, app }, ownerGhii, id, front);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: company front page).
 */
import type { CompanyRecord, CompanyFrontPage, CompanyFrontPageKind } from '../../models/company-schemas.js';
import { localAccountName } from '../../utils/gaii.js';
import type { CallerContext } from '../caller-context.js';
import { companyPortfolioKey, publishCompanyPortfolio, type CompanyPortfolioStatus } from './company-portfolio.js';
import { CompanyError, requireOwnCompany, resolveFrontPage, setFrontPage } from './company-service.js';
import { publishAskOf, fileAsk } from '../publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from '../publish-requests/store.js';
import { askedOf, type AppPublishAsked, type PageGate } from '../app-publish-gate.js';

/** Does pointing the company's address at `toKind` make it public, and may this caller? */
export function companyFrontPageAsk(
  ctx: PublishStoreCtx, caller: CallerContext, appGrant: string | undefined,
  company: CompanyRecord, toKind: CompanyFrontPageKind,
): PageGate {
  if (company.frontPage.kind !== 'none' || toKind === 'none') return { kind: 'go' };
  const ask = publishAskOf(ctx, caller, appGrant);
  if (ask.kind === 'allowed') return { kind: 'go' };
  if (ask.kind === 'refused') return ask;
  return { kind: 'ask', requester: ask.requester };
}

/**
 * File the request to point the company's address at a front page. `version` is when the company's
 * own page was written for a 'portfolio' front page, else the company record's updatedAt.
 */
export async function fileCompanyAsk(
  ctx: PublishStoreCtx, ownerName: string, company: CompanyRecord,
  front: { kind: CompanyFrontPageKind; target: string }, requester: PublishRequester,
): Promise<AppPublishAsked> {
  const page = front.kind === 'portfolio'
    ? await ctx.storage.getStorageFileMeta(company.ownerGhii, companyPortfolioKey(company.id)) : null;
  return askedOf(ctx, await fileAsk(ctx, ownerName, requester, {
    kind: 'company',
    target: {
      company: company.id,
      ...(front.target ? { front_target: front.target } : {}),
      version: page?.createdAt ?? company.updatedAt,
    },
    title: `the front page of ${company.name}`,
    name: company.slug,
    change: { field: 'front_page', from: 'none', to: front.kind },
  }), 'The address is left as it was');
}

/** Who asks, as a door hands it over: the session's caller and an app grant's `owner/filename`. */
export interface GateCaller { caller: CallerContext; app?: string }

/**
 * PUT /v1/companies/:id/front-page and aimeat_company_front_page, through the gate. Refusals throw
 * CompanyError, as setFrontPage's do. On an ask the front page is checked (resolveFrontPage) and not
 * set, and the request is filed.
 */
export async function setCompanyFrontPageGated(
  ctx: PublishStoreCtx, who: GateCaller, ownerGhii: string, id: string, front: CompanyFrontPage,
): Promise<{ company: CompanyRecord; asked?: AppPublishAsked }> {
  const company = await requireOwnCompany(ctx.storage, ownerGhii, id);
  const gate = companyFrontPageAsk(ctx, who.caller, who.app, company, front.kind);
  if (gate.kind === 'refused') throw new CompanyError(gate.code, gate.status, gate.message);
  if (gate.kind === 'go') return { company: await setFrontPage(ctx.storage, ownerGhii, id, front) };
  const resolved = await resolveFrontPage(ctx.storage, ownerGhii, company, front);
  return { company, asked: await fileCompanyAsk(ctx, localAccountName(ownerGhii), company, resolved, gate.requester) };
}

/**
 * PUT /v1/companies/:id/portfolio and aimeat_company_portfolio_publish, through the gate: on an ask
 * the page is stored, the address is left serving nothing, and the request is to point it at the page.
 */
export async function publishCompanyPortfolioGated(
  ctx: PublishStoreCtx, who: GateCaller, ownerGhii: string, id: string, html: string,
  writer: { principal: string; pipeline: string },
): Promise<{ company: CompanyRecord; status: CompanyPortfolioStatus; asked?: AppPublishAsked }> {
  const company = await requireOwnCompany(ctx.storage, ownerGhii, id);
  const gate = companyFrontPageAsk(ctx, who.caller, who.app, company, 'portfolio');
  if (gate.kind === 'refused') throw new CompanyError(gate.code, gate.status, gate.message);
  const out = await publishCompanyPortfolio(ctx.config, ctx.storage, ownerGhii, id, html, writer, gate.kind === 'go');
  if (gate.kind === 'go') return out;
  const asked = await fileCompanyAsk(ctx, localAccountName(ownerGhii), out.company, { kind: 'portfolio', target: '' }, gate.requester);
  return { ...out, asked };
}
