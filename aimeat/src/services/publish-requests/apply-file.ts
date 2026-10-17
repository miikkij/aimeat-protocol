/**
 * @file src/services/publish-requests/apply-file.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a stored file: the file becomes public, as the owner,
 *   through changeStorageFileVisibility (services/storage-file-write.ts), the change both PATCH
 *   visibility routes make (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the file's `created_at` and `size` when it
 *   was asked; every write to the key rewrites `created_at`. A file that was deleted, uploaded again or
 *   given another level since is not made public: the approval would otherwise publish bytes nobody
 *   looked at.
 * @structure applyFilePublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.file (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: stored files).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { namespaceOfOwner } from './apply-memory.js';
import { changeStorageFileVisibility } from '../storage-file-write.js';
import { pubEmbedUrl } from '../doc-images.js';

export async function applyFilePublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const owner = String(request.target.owner ?? '');
  const key = String(request.target.key ?? '');
  if (!owner || !key || !namespaceOfOwner(owner, ownerGhii)) return { ok: false, reason: 'the file is not on this account' };
  const file = await ctx.storage.getStorageFileMeta(owner, key);
  if (!file) return { ok: false, reason: 'the file was deleted' };
  if (file.createdAt !== String(request.target.created_at) || file.size !== Number(request.target.size)) {
    return { ok: false, reason: 'the file was uploaded again after the request was made' };
  }
  const url = `${ctx.config.baseUrl.replace(/\/+$/, '')}${pubEmbedUrl(owner, key)}`;
  if (file.visibility === 'public') return { ok: true, url };
  if (file.visibility !== request.change.from) return { ok: false, reason: 'who may read the file changed after the request was made' };
  // The owner in person: no publish gate is asked, because the owner approved it.
  const changed = await changeStorageFileVisibility({ storage: ctx.storage, config: ctx.config }, owner, key, 'public');
  if (!changed.ok) return { ok: false, reason: changed.code === 'NOT_FOUND' ? 'the file was deleted' : changed.message };
  return { ok: true, url };
}
