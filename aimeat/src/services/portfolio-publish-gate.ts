/**
 * @file src/services/portfolio-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate at the doors that switch the owner's welcome page (the portfolio) on
 *   (plan doc-mvcn6c7e4e5q, V4). Switching the page on IS making it public, as the exposure report
 *   counts it (services/exposure/sources-places.ts portfolioSource).
 *
 *   On an ask, the page CONTENT is stored and the page stays off; the request is to switch it on. The
 *   applier (publish-requests/apply-portfolio.ts) switches it on as the owner through the write
 *   PUT /v1/portfolio/config makes. The request carries when the stored page was written, so a page
 *   replaced after the request is not switched on by its approval.
 * @structure portfolioRaiseAsk · filePortfolioAsk
 * @usage
 *   const gate = await portfolioRaiseAsk(ctx, callerOf(req, ...), req.auth?.app, ownerName, { overridesOff: true });
 *   if (gate.kind === 'refused') → 403; if (gate.kind === 'ask') → store without the switch, then filePortfolioAsk(...)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: portfolio).
 */
import type { CallerContext } from './caller-context.js';
import { portfolioSwitchState } from './portfolio-config.js';
import { publishAskOf, fileAsk } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { askedOf, type AppPublishAsked, type PageGate } from './app-publish-gate.js';

/**
 * Does switching the welcome page on make it public, and may this caller? `overridesOff`: the door
 * switches on a page the owner switched off (PUT /v1/portfolio/config); the upload doors keep such a
 * page off whatever the caller says, so for them that is no raise.
 */
export async function portfolioRaiseAsk(
  ctx: PublishStoreCtx, caller: CallerContext, appGrant: string | undefined, ownerName: string,
  opts: { overridesOff: boolean },
): Promise<PageGate & { from?: boolean | null }> {
  const state = await portfolioSwitchState(ctx.storage, ownerName, ctx.config.nodeId);
  if (state.enabled === true || (state.enabled === false && !opts.overridesOff)) return { kind: 'go' };
  const ask = publishAskOf(ctx, caller, appGrant);
  if (ask.kind === 'allowed') return { kind: 'go' };
  if (ask.kind === 'refused') return ask;
  return { kind: 'ask', requester: ask.requester, from: state.enabled };
}

/** File the request to switch the welcome page on, after the door stored what it was allowed to. */
export async function filePortfolioAsk(
  ctx: PublishStoreCtx, ownerName: string, asked: { requester: PublishRequester; from?: boolean | null },
): Promise<AppPublishAsked> {
  const { pageAt } = await portfolioSwitchState(ctx.storage, ownerName, ctx.config.nodeId);
  return askedOf(ctx, await fileAsk(ctx, ownerName, asked.requester, {
    kind: 'portfolio',
    target: { owner: ownerName, version: pageAt ?? 'no-page' },
    title: 'the welcome page',
    name: ownerName,
    change: { field: 'enabled', from: asked.from ?? null, to: true },
  }), 'The page is stored and not switched on');
}
