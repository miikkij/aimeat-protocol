/**
 * @file src/services/publish-requests/apply-portfolio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for the owner's welcome page: the page is switched on, as
 *   the owner, through services/portfolio-config.ts mergePortfolioConfig, the write
 *   PUT /v1/portfolio/config makes (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries when the stored page was written. A page
 *   replaced or removed since, or a switch moved since the request, makes the approval outdated.
 * @structure applyPortfolioPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.portfolio (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: portfolio).
 */
import { localAccountName } from '../../utils/gaii.js';
import { mergePortfolioConfig, portfolioSwitchState, portfolioWriteGaii } from '../portfolio-config.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyPortfolioPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const ownerName = localAccountName(ownerGhii);
  if (String(request.target.owner ?? '') !== ownerName) return { ok: false, reason: 'the page is not on this account' };
  const state = await portfolioSwitchState(ctx.storage, ownerName, ctx.config.nodeId);
  const url = `${ctx.config.baseUrl.replace(/\/+$/, '')}/v1/portfolio/${encodeURIComponent(ownerName)}`;
  if ((state.pageAt ?? 'no-page') !== String(request.target.version)) return { ok: false, reason: 'the page was replaced after the request was made' };
  if (state.enabled === true) return { ok: true, url };
  if (state.enabled !== (request.change.from ?? null)) return { ok: false, reason: 'the page was switched off after the request was made' };
  // The owner in person: they approved it.
  await mergePortfolioConfig(ctx.storage, await portfolioWriteGaii(ctx.storage, ownerName, ctx.config.nodeId), { enabled: true });
  return { ok: true, url };
}
