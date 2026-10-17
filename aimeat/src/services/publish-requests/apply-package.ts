/**
 * @file src/services/publish-requests/apply-package.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a package group: every version of the group becomes
 *   public, as the owner, through updatePackageGroup (services/packages/compose/package-create.ts),
 *   the function PATCH /v1/packages/:groupId calls (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request names the group's newest version when it was asked.
 *   A group archived, given a newer version or another visibility since is not made public.
 * @structure applyPackagePublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.package (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: packages).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { updatePackageGroup } from '../packages/compose/package-create.js';
import { localAccountName } from '../../utils/gaii.js';

export async function applyPackagePublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const groupId = String(request.target.group_id ?? '');
  const owner = localAccountName(ownerGhii);
  const newest = groupId ? (await ctx.storage.listVersions(groupId, 1, 0)).versions[0] : undefined;
  if (!newest || newest.status === 'archived') return { ok: false, reason: 'the package was deleted or archived' };
  if (newest.author !== owner) return { ok: false, reason: 'the package is not on this account' };
  if (newest.version !== String(request.target.version)) return { ok: false, reason: 'the package got a new version after the request was made' };
  if (newest.visibility === 'public') return { ok: true };
  if (newest.visibility !== request.change.from) return { ok: false, reason: 'who may see the package changed after the request was made' };
  // The owner in person: they approved it.
  const out = await updatePackageGroup(ctx, { owner }, { groupId, visibility: 'public' });
  if (!out.ok) return { ok: false, reason: out.message };
  return { ok: true, url: `${ctx.config.baseUrl.replace(/\/+$/, '')}/v1/packages/${encodeURIComponent(groupId)}` };
}
