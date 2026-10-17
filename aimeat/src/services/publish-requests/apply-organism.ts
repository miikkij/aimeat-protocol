/**
 * @file src/services/publish-requests/apply-organism.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for an organism: it becomes public, as the owner, through
 *   updateOrganismRecord (services/organism-lifecycle.ts), the update PUT /v1/organisms/:id and
 *   aimeat_organism_update run (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the organism's updatedAt when it was asked;
 *   an organism deleted, edited or given another level since is not made public. Its discussion board
 *   keeps the level it has, as it does when the owner changes the organism's visibility themselves.
 * @structure applyOrganismPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.organism (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { updateOrganismRecord } from '../organism-lifecycle.js';
import { isOrganismOwner } from '../organism-ownership.js';
import { localAccountName } from '../../utils/gaii.js';

export async function applyOrganismPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const id = String(request.target.organism_id ?? '');
  const organism = id ? await ctx.storage.getOrganism(id) : null;
  if (!organism) return { ok: false, reason: 'the organism was deleted' };
  // The same right PUT /v1/organisms/:id asks: an owner or an admin of the organism.
  const account = localAccountName(ownerGhii);
  if (!isOrganismOwner(organism, account) && !organism.admins.includes(account)) return { ok: false, reason: 'the organism is not managed by this account' };
  if (organism.updatedAt !== String(request.target.updated_at)) return { ok: false, reason: 'the organism changed after the request was made' };
  if (organism.visibility === 'public') return { ok: true };
  if (organism.visibility !== request.change.from) return { ok: false, reason: 'who may see the organism changed after the request was made' };
  // The owner in person approved it: no publish gate, and the person's own rights.
  const out = await updateOrganismRecord(ctx, organism, { visibility: 'public', callerIsPerson: true });
  return out.ok ? { ok: true } : { ok: false, reason: out.message };
}
