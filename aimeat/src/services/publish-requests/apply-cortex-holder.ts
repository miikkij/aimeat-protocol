/**
 * @file src/services/publish-requests/apply-cortex-holder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner of apps that loaded a cortex library allowed them to load it from its new
 *   holder (services/cortex-holder-change.ts filed the question when the new holder installed the name
 *   an account erasure or the held-name settlement freed). The apps load the new holder's library from
 *   then on. A cortex removed since, held by another account, or installed again since the question
 *   ends the request `outdated`.
 * @structure applyCortexHolder
 * @usage registered in appliers.ts under the kind 'cortex-holder'
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, memory-b-08).
 */
import { localAccountName } from '../../utils/gaii.js';
import { allowHolderChange } from '../cortex-holder-change.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';

export async function applyCortexHolder(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const name = String(request.target.cortex ?? '');
  const holder = String(request.target.holder ?? '');
  const cortex = name ? await ctx.storage.getCortexExtension(name) : null;
  if (!cortex) return { ok: false, reason: 'the library was removed' };
  if (cortex.installedBy !== holder) return { ok: false, reason: 'the library now belongs to another account' };
  // Compared as instants: a provider may write the timestamp back in another text form.
  if (Date.parse(cortex.installedAt) !== Date.parse(String(request.target.since ?? ''))) return { ok: false, reason: 'the library was installed again after the request was made' };
  const allowed = await allowHolderChange(ctx, name, holder, localAccountName(ownerGhii), request.id);
  return allowed ? { ok: true } : { ok: false, reason: 'the apps no longer wait for this answer' };
}
