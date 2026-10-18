/**
 * @file src/services/company/company-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate at the doors that make a company's front page public (plan
 *   doc-mvcn6c7e4e5q, V4 and V3.10): PUT /v1/companies/:id/front-page, PUT /v1/companies/:id/portfolio
 *   and their MCP tools. The address is public when it serves something AND opens to anyone (its
 *   `frontPageAccess`, services/page-access.ts), as the exposure report counts it
 *   (services/exposure/sources-places.ts companySource). So pointing an address that serves nothing
 *   ('none') at a page open to anyone is a raise, and so is opening a served front page to anyone.
 *
 *   On an ask the door applies everything but the one change the request is about: the front page
 *   when the address serves nothing (the company's own page CONTENT is stored), else the access. The
 *   applier (publish-requests/apply-company.ts) makes that change as the owner through setFrontPage.
 *   The request carries when the company's page was written (a 'portfolio' front page) or when the
 *   company record last changed, so nothing the owner did not see goes out.
 * @structure CompanyChange · companyFrontPageAsk · fileCompanyAsk · GateCaller · setCompanyFrontPageGated ·
 *   publishCompanyPortfolioGated
 * @usage const { company, asked } = await setCompanyFrontPageGated(ctx, { caller, app }, ownerGhii, id, front, access);
 * @version-history
 *   v1.1.0 — 2026-10-18 — `frontPageAccess` is part of public (V3.10): opening a served front page to
 *     anyone is a raise, pointing an address at a page that opens for signed-in people only is not, and
 *     the request names the change it holds back.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: company front page).
 */
import type { CompanyRecord, CompanyFrontPage, CompanyFrontPageKind } from '../../models/company-schemas.js';
import { localAccountName } from '../../utils/gaii.js';
import type { CallerContext } from '../caller-context.js';
import { companyPortfolioKey, publishCompanyPortfolio, type CompanyPortfolioStatus } from './company-portfolio.js';
import { CompanyError, requireOwnCompany, resolveFrontPage, setFrontPage } from './company-service.js';
import { pageAccessOf } from '../page-access.js';
import { publishAskOf, fileAsk } from '../publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from '../publish-requests/store.js';
import { askedOf, type AppPublishAsked, type PageGate } from '../app-publish-gate.js';

/** The one change a request about a company's front page makes. */
export type CompanyChange =
  | { field: 'front_page'; from: 'none'; to: CompanyFrontPageKind }
  | { field: 'access'; from: string | null; to: 'anyone' };

type CompanyGate =
  | Exclude<PageGate, { kind: 'ask' }>
  | { kind: 'ask'; requester: PublishRequester; change: CompanyChange };

/** Served and open to anyone: the exposure report's `public` for a company's address. */
const addressIsPublic = (kind: CompanyFrontPageKind, access: string | null): boolean =>
  kind !== 'none' && pageAccessOf(access) === 'anyone';

/**
 * Does the change make the company's address public, and may this caller? `toKind` null keeps what the
 * address serves; `toAccess` undefined keeps who may open it.
 */
export function companyFrontPageAsk(
  ctx: PublishStoreCtx, caller: CallerContext, appGrant: string | undefined,
  company: CompanyRecord, toKind: CompanyFrontPageKind | null, toAccess?: string | null,
): CompanyGate {
  const kindAfter = toKind ?? company.frontPage.kind;
  const accessAfter = toAccess !== undefined ? toAccess : company.frontPageAccess;
  if (addressIsPublic(company.frontPage.kind, company.frontPageAccess) || !addressIsPublic(kindAfter, accessAfter)) return { kind: 'go' };
  const ask = publishAskOf(ctx, caller, appGrant);
  if (ask.kind === 'allowed') return { kind: 'go' };
  if (ask.kind === 'refused') return ask;
  const change: CompanyChange = company.frontPage.kind === 'none'
    ? { field: 'front_page', from: 'none', to: kindAfter }
    : { field: 'access', from: company.frontPageAccess, to: 'anyone' };
  return { kind: 'ask', requester: ask.requester, change };
}

/**
 * File the request about a company's front page, after the door stored what it was allowed to.
 * `version` is when the company's own page was written for a 'portfolio' front page, else the company
 * record's updatedAt; `front` names the front page a 'front_page' request points the address at.
 */
export async function fileCompanyAsk(
  ctx: PublishStoreCtx, ownerName: string, company: CompanyRecord,
  front: { kind: CompanyFrontPageKind; target: string }, requester: PublishRequester,
  change: CompanyChange = { field: 'front_page', from: 'none', to: front.kind },
): Promise<AppPublishAsked> {
  const pageKind = change.field === 'front_page' ? front.kind : company.frontPage.kind;
  const page = pageKind === 'portfolio'
    ? await ctx.storage.getStorageFileMeta(company.ownerGhii, companyPortfolioKey(company.id)) : null;
  return askedOf(ctx, await fileAsk(ctx, ownerName, requester, {
    kind: 'company',
    target: {
      company: company.id,
      ...(change.field === 'front_page' && front.target ? { front_target: front.target } : {}),
      version: page?.createdAt ?? company.updatedAt,
    },
    title: `the front page of ${company.name}`,
    name: company.slug,
    change,
  }), change.field === 'front_page' ? 'The address is left as it was' : 'The front page keeps who may open it');
}

/** Who asks, as a door hands it over: the session's caller and an app grant's `owner/filename`. */
export interface GateCaller { caller: CallerContext; app?: string }

/**
 * PUT /v1/companies/:id/front-page and aimeat_company_front_page, through the gate. Refusals throw
 * CompanyError, as setFrontPage's do. `front` null keeps what the address serves; `access` (the
 * stored value, checked by the caller) undefined keeps who may open it. On an ask everything but the
 * one change is applied (the front page is checked by resolveFrontPage when it is the one held back),
 * and the request is filed.
 */
export async function setCompanyFrontPageGated(
  ctx: PublishStoreCtx, who: GateCaller, ownerGhii: string, id: string, front: CompanyFrontPage | null, access?: string | null,
): Promise<{ company: CompanyRecord; asked?: AppPublishAsked }> {
  const company = await requireOwnCompany(ctx.storage, ownerGhii, id);
  const gate = companyFrontPageAsk(ctx, who.caller, who.app, company, front?.kind ?? null, access);
  if (gate.kind === 'refused') throw new CompanyError(gate.code, gate.status, gate.message);
  if (gate.kind === 'go') return { company: await setFrontPage(ctx.storage, ownerGhii, id, front, access) };
  const ownerName = localAccountName(ownerGhii);
  if (gate.change.field === 'front_page') {
    const resolved = await resolveFrontPage(ctx.storage, ownerGhii, company, front!);
    const after = access !== undefined ? await setFrontPage(ctx.storage, ownerGhii, id, null, access) : company;
    return { company: after, asked: await fileCompanyAsk(ctx, ownerName, after, resolved, gate.requester, gate.change) };
  }
  const after = front ? await setFrontPage(ctx.storage, ownerGhii, id, front) : company;
  return { company: after, asked: await fileCompanyAsk(ctx, ownerName, after, after.frontPage, gate.requester, gate.change) };
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
  const asked = await fileCompanyAsk(ctx, localAccountName(ownerGhii), out.company, { kind: 'portfolio', target: '' }, gate.requester, gate.change);
  return { ...out, asked };
}
