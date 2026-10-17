/**
 * @file src/services/publish-requests/apply-datapackage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a data package: the version the request names gets
 *   the audience 'public', its files, its `latest.json` pointer and its catalogue entry, as the
 *   owner, through setVersionAudience (services/datapackage/version-audience.ts), the function a
 *   publish of the same bytes as public calls (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request names the content hash the pointer had when it was
 *   asked. A package that has a newer version since, or another audience, is not made public.
 * @structure applyDatapackagePublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.datapackage (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: data packages).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { readPointer, setVersionAudience } from '../datapackage/version-audience.js';
import { bare } from '../datapackage/contract.js';

export async function applyDatapackagePublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const name = String(request.target.name ?? '');
  if (!name || String(request.target.owner ?? '') !== ownerGhii) return { ok: false, reason: 'the data package is not on this account' };
  const pointer = await readPointer(ctx, ownerGhii, name);
  if (!pointer?.contentHash) return { ok: false, reason: 'the data package was deleted' };
  if (bare(pointer.contentHash) !== bare(String(request.target.version ?? ''))) {
    return { ok: false, reason: 'the data package got a new version after the request was made' };
  }
  const now = pointer.visibility ?? 'public';
  if (now === 'public') return { ok: true, url: pointer.descriptorUrl };
  if (now !== request.change.from) return { ok: false, reason: 'who may read the data package changed after the request was made' };
  // The owner in person: they approved it.
  const out = await setVersionAudience(ctx, ownerGhii, name, pointer.contentHash, 'public', { catalogue: true });
  if (!out.ok) return { ok: false, reason: out.message };
  return { ok: true, url: out.descriptorUrl };
}
