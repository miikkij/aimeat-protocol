/**
 * @file src/services/publish-requests/apply-delegation-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The channel owner allowed an app by another author to publish through a delegation
 *   whose label is only a file name (services/connections/delegation-caller.ts asked it). The
 *   delegation is bound to that author's app, so its users publish through it from now on and an app
 *   of the same name by anyone else is refused. A delegation removed or renamed since, or one bound to
 *   another app meanwhile, ends the request `outdated`.
 * @structure applyDelegationBinding
 * @usage registered in appliers.ts under the kind 'delegation-binding'
 * @version-history
 *   2026-10-29 — Initial (secaudit2026oct26 round 8c, delegated-publish/app-id-not-bound-to-caller).
 */
import { ownerGhiiOf } from '../../utils/gaii.js';
import { bindDelegationApp } from '../connections/delegation-binding.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyDelegationBinding(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const id = String(request.target.delegation ?? '');
  const app = String(request.target.app ?? '');
  const delegation = id ? await ctx.storage.getDelegation(id) : undefined;
  const connection = delegation ? await ctx.storage.getConnection(delegation.connectionId) : undefined;
  if (!delegation || !connection || ownerGhiiOf(connection.principal) !== ownerGhii) return { ok: false, reason: 'the delegation was removed' };
  if (delegation.appId !== String(request.target.label ?? '') || delegation.action !== String(request.target.action ?? '')) {
    return { ok: false, reason: 'the delegation was changed' };
  }
  if (!app.includes('/')) return { ok: false, reason: 'the asked app could not be read' };
  const bound = await bindDelegationApp(ctx.storage, ctx.config.nodeId, id, app, 'owner-allowed');
  if (bound.app !== app) return { ok: false, reason: `the delegation already takes the app ${bound.app}` };
  return { ok: true };
}
