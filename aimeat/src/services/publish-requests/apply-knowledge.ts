/**
 * @file src/services/publish-requests/apply-knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a knowledge package: the entries it names become
 *   public, and, when `change.field` is 'audience', the package is listed public, as the owner,
 *   through services/knowledge-sharing.ts, the code PATCH /v1/knowledge/:id/sharing and the entry
 *   PATCH call (plan doc-mvcn6c7e4e5q, V4).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the manifest's version and each named
 *   entry's record version. A package or an entry deleted, written again or given another level
 *   since is not made public. Every check runs before the first write.
 * @structure applyKnowledgePublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.knowledge (appliers.ts)
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: knowledge packages).
 */
import type { KnowledgeManifest, MemoryRecord } from '../../storage/interface.js';
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { namespaceOfOwner } from './apply-memory.js';
import { packageAudienceOf } from '../knowledge-audience.js';
import { setKnowledgeSharing, setKnowledgeEntryVisibility, findKnowledgeEntry } from '../knowledge-sharing.js';
import { logger } from '../../utils/logger.js';

const manifestOf = (r: MemoryRecord): KnowledgeManifest =>
  (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as KnowledgeManifest;

/**
 * The entries the request names, full key to record version, or null when the list does not parse:
 * the request record is the node's own (a reserved prefix), so that is a damaged request, not a
 * request naming nothing.
 */
function namedEntries(raw: unknown): Record<string, number> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw ?? '{}'));
  } catch (err) {
    logger.warn('Publish request: the entry list of a knowledge request does not parse', { error: String(err) });
    return null;
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, number> : null;
}

export async function applyKnowledgePublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const ns = String(request.target.namespace ?? '');
  const packageId = String(request.target.package_id ?? '');
  if (!ns || !packageId || !namespaceOfOwner(ns, ownerGhii)) return { ok: false, reason: 'the package is not on this account' };
  const manifestKey = `packages/${packageId}/manifest`;
  const record = await ctx.storage.getMemory(ns, manifestKey);
  if (!record) return { ok: false, reason: 'the package was deleted' };
  if (record.version !== Number(request.target.version)) return { ok: false, reason: 'the package changed after the request was made' };
  const manifest = manifestOf(record);
  const listing = request.change.field === 'audience';
  // An entry kept back by a listing request was stored private; one kept back alone, at `from`.
  const entryFrom = listing ? 'private' : request.change.from;

  // Every check before the first write.
  const entries = namedEntries(request.target.entries);
  if (!entries) return { ok: false, reason: 'the request does not say which entries it names' };
  const toPublish: string[] = [];
  for (const [key, version] of Object.entries(entries)) {
    const entry = findKnowledgeEntry(manifest, key);
    if (!entry) return { ok: false, reason: 'an entry was removed after the request was made' };
    if (((await ctx.storage.getMemory(ns, key))?.version ?? 0) !== Number(version)) {
      return { ok: false, reason: 'an entry changed after the request was made' };
    }
    if (entry.visibility === 'public') continue;
    if (entry.visibility !== entryFrom) return { ok: false, reason: 'who may read an entry changed after the request was made' };
    toPublish.push(key);
  }
  const audienceNow = packageAudienceOf(manifest);
  if (listing && audienceNow !== 'public' && audienceNow !== request.change.from) {
    return { ok: false, reason: 'who may read the package changed after the request was made' };
  }

  // The owner in person: they approved it. Each write moves the manifest's version, so the row is
  // read again before the next.
  const row = { record, ownerGaii: ns };
  for (const key of toPublish) {
    await setKnowledgeEntryVisibility(ctx, row, packageId, key, 'public');
    row.record = (await ctx.storage.getMemory(ns, manifestKey)) ?? row.record;
  }
  if (listing && audienceNow !== 'public') await setKnowledgeSharing(ctx, row, packageId, { audience: 'public' });
  return { ok: true, url: `${ctx.config.baseUrl.replace(/\/+$/, '')}/v1/knowledge/${encodeURIComponent(packageId)}` };
}
