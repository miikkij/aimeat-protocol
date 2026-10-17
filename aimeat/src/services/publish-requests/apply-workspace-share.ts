/**
 * @file src/services/publish-requests/apply-workspace-share.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a workspace share: the part of the change that was
 *   held back (the access set to `open`, or the targets shared under it) is applied, as the owner,
 *   through setWorkspaceShareOp (services/workspace-share.ts), the operation PUT
 *   /v1/organisms/:id/workspace/share and aimeat_workspace_share run (plan doc-mvcn6c7e4e5q, V4).
 *   The owner must still be the workspace's creator or an organism admin; the operation asks that.
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the share record's version; a share changed
 *   since, or one whose access is no longer what it was, is not opened.
 * @structure applyWorkspaceSharePublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS['workspace-share'] (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { readShareMetaOf, setWorkspaceShareOp, type SetShareBody } from '../workspace-share.js';
import { readWorkspaceMetaRecord } from '../workspace-meta-read.js';
import { localAccountName } from '../../utils/gaii.js';

export async function applyWorkspaceSharePublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const orgId = String(request.target.organism_id ?? '');
  const ws = String(request.target.ws ?? '');
  const body = request.change.to;
  if (!orgId || !ws || !body || typeof body !== 'object') return { ok: false, reason: 'the request names no workspace' };
  const record = await readWorkspaceMetaRecord(ctx.storage, orgId, ws, 'meta.share', ctx.config.nodeId);
  if ((record?.version ?? 0) !== Number(request.target.version)) return { ok: false, reason: 'the sharing changed after the request was made' };
  const share = await readShareMetaOf(ctx.storage, ctx.config, orgId, ws);
  if (share.access !== request.change.from) return { ok: false, reason: 'who may open the link changed after the request was made' };
  // As the owner in person; the operation asks that they still manage the workspace.
  const out = await setWorkspaceShareOp(ctx, { sub: ownerGhii, owner: localAccountName(ownerGhii) }, { orgId, ws, body: body as SetShareBody });
  if (!out.ok) return { ok: false, reason: out.message };
  const url = out.data.viewer_url;
  return typeof url === 'string' ? { ok: true, url } : { ok: true };
}
