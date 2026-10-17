/**
 * @file src/services/publish-requests/apply-cortex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a cortex library: it becomes public, as the owner,
 *   through setCortexVisibility (services/cortex-visibility.ts), the write POST
 *   /v1/cortex/:name/visibility runs (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the cortex's version; a kept version never
 *   takes other bytes, so a cortex deleted, redeployed or given another level since is not made public.
 * @structure applyCortexPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.cortex (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { setCortexVisibility } from '../cortex-visibility.js';
import { localAccountName } from '../../utils/gaii.js';

export async function applyCortexPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const name = String(request.target.name ?? '');
  const ext = name ? await ctx.storage.getCortexExtension(name) : null;
  if (!ext) return { ok: false, reason: 'the cortex library was uninstalled' };
  // installedBy is the installing account's bare name, an agent's install included.
  if (ext.installedBy !== localAccountName(ownerGhii)) return { ok: false, reason: 'the cortex library is not on this account' };
  if (ext.version !== String(request.target.version)) return { ok: false, reason: 'the cortex library changed after the request was made' };
  if (ext.visibility === 'public') return { ok: true };
  if (ext.visibility !== request.change.from) return { ok: false, reason: 'who may see the cortex library changed after the request was made' };
  const updated = await setCortexVisibility(ctx, name, 'public');
  return updated ? { ok: true } : { ok: false, reason: 'the cortex library was uninstalled' };
}
