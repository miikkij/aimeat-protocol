/**
 * @file src/services/portfolio-publish-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate at the doors that make the owner's welcome page (the portfolio) public
 *   (plan doc-mvcn6c7e4e5q, V4 and V3.10). Public, for the page, is switched on AND open to anyone
 *   (`access`, services/page-access.ts), as the exposure report counts it
 *   (services/exposure/sources-places.ts portfolioSource). A change is a raise when the page was not
 *   public before it and is public after it: switching on a page open to anyone, or opening a page that
 *   is on to anyone. Switching on a page that opens for signed-in people only is no raise.
 *
 *   On an ask the door applies everything but the one change the request is about: the switch when the
 *   page is off (the page CONTENT is stored, the page stays off), else `access`. The applier
 *   (publish-requests/apply-portfolio.ts) makes that change as the owner through the write
 *   PUT /v1/portfolio/config makes. The request carries when the stored page was written, so a page
 *   replaced after the request is not made public by its approval.
 * @structure PortfolioChange · portfolioRaiseAsk · filePortfolioAsk
 * @usage
 *   const gate = await portfolioRaiseAsk(ctx, callerOf(req, ...), req.auth?.app, ownerName, { overridesOff: true, enabled: true });
 *   if (gate.kind === 'refused') → 403; if (gate.kind === 'ask') → apply all but gate.change.field, then filePortfolioAsk(...)
 * @version-history
 *   v1.1.0 — 2026-10-18 — `access` is part of public (V3.10): the ask names the change it holds back,
 *     the switch or the access, and switching on a page that is not open to anyone asks nothing.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: portfolio).
 */
import type { CallerContext } from './caller-context.js';
import { portfolioSwitchState } from './portfolio-config.js';
import { pageAccessOf } from './page-access.js';
import { publishAskOf, fileAsk } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { askedOf, type AppPublishAsked, type PageGate } from './app-publish-gate.js';

/** The one change a request about the welcome page makes. */
export type PortfolioChange =
  | { field: 'enabled'; from: boolean | null; to: true }
  | { field: 'access'; from: string | null; to: 'anyone' };

type PortfolioGate =
  | Exclude<PageGate, { kind: 'ask' }>
  | { kind: 'ask'; requester: PublishRequester; change: PortfolioChange };

/**
 * Does the door's change make the welcome page public, and may this caller? `enabled` is the switch the
 * door asks for (undefined: unchanged); `access` the stored value it writes (undefined: unchanged).
 * `overridesOff`: the door switches on a page the owner switched off (PUT /v1/portfolio/config); the
 * upload doors keep such a page off whatever the caller says.
 */
export async function portfolioRaiseAsk(
  ctx: PublishStoreCtx, caller: CallerContext, appGrant: string | undefined, ownerName: string,
  opts: { overridesOff: boolean; enabled?: boolean; access?: string | null },
): Promise<PortfolioGate> {
  const state = await portfolioSwitchState(ctx.storage, ownerName, ctx.config.nodeId);
  const onAfter = opts.enabled === false ? false
    : opts.enabled === true ? (state.enabled !== false || opts.overridesOff)
      : state.enabled === true;
  const accessAfter = opts.access !== undefined ? opts.access : state.access;
  const publicBefore = state.enabled === true && pageAccessOf(state.access) === 'anyone';
  const publicAfter = onAfter && pageAccessOf(accessAfter) === 'anyone';
  if (publicBefore || !publicAfter) return { kind: 'go' };
  const ask = publishAskOf(ctx, caller, appGrant);
  if (ask.kind === 'allowed') return { kind: 'go' };
  if (ask.kind === 'refused') return ask;
  const change: PortfolioChange = state.enabled !== true
    ? { field: 'enabled', from: state.enabled, to: true }
    : { field: 'access', from: state.access, to: 'anyone' };
  return { kind: 'ask', requester: ask.requester, change };
}

/** File the request about the welcome page, after the door stored what it was allowed to. */
export async function filePortfolioAsk(
  ctx: PublishStoreCtx, ownerName: string, asked: { requester: PublishRequester; change: PortfolioChange },
): Promise<AppPublishAsked> {
  const { pageAt } = await portfolioSwitchState(ctx.storage, ownerName, ctx.config.nodeId);
  return askedOf(ctx, await fileAsk(ctx, ownerName, asked.requester, {
    kind: 'portfolio',
    target: { owner: ownerName, version: pageAt ?? 'no-page' },
    title: 'the welcome page',
    name: ownerName,
    change: asked.change,
  }), asked.change.field === 'enabled' ? 'The page is stored and not switched on' : 'The page keeps who may open it');
}
