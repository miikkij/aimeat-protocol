/**
 * @file src/services/publish-requests/apply-internet-opening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner approved their agent's or app's request to open one app to the internet on a
 *   closed node (services/internet-opening/opening-door.ts filed it). The opening then goes the way the
 *   owner's own would: it opens at once where the owner may open without asking, and otherwise it
 *   becomes the request an operator decides. The requester stays named as who asked.
 * @structure applyInternetOpening
 * @usage registered in appliers.ts under the kind 'internet-opening'
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { localAccountName } from '../../utils/gaii.js';
import { isOperatorAccount } from '../../utils/operator-account.js';
import { requestOpening } from '../internet-opening/opening-service.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyInternetOpening(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const owner = localAccountName(ownerGhii);
  const filename = String(request.target.filename ?? '');
  if (!filename || String(request.target.owner ?? '') !== owner) return { ok: false, reason: 'the app is not on this account' };
  const app = await ctx.storage.getApp(ownerGhii, filename);
  if (!app) return { ok: false, reason: 'the app was deleted' };
  if (app.versionNumber !== Number(request.target.version)) return { ok: false, reason: 'a new version of the app was published after the request was made' };
  const account = await ctx.storage.getOwner(owner);
  const r = await requestOpening(ctx, { principal: request.requested_by.principal, owner, operator: !!account && isOperatorAccount(account) }, {
    filename, reason: request.target.reason, days: request.target.days,
  });
  if (!r.ok) return { ok: false, reason: r.message };
  return { ok: true };
}
