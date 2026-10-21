/**
 * @file src/services/publish-requests/apply-memory.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a memory record: the record becomes public, as the
 *   owner, through services/memory-write.ts like any visibility change (plan doc-mvcn6c7e4e5q, V4.3).
 *
 *   THE OWNER APPROVED WHAT THEY SAW. The request carries the record's version when it was asked.
 *   A record that was deleted, written again or given another level since is not made public: the
 *   approval would otherwise publish content nobody looked at. The write is a compare-and-swap on
 *   that version, so a write landing between the check and the change loses nothing either. The
 *   version alone is not enough: a binned key written again starts at version 1, so the request
 *   also carries the content's digest, and a different value is refused the same way.
 * @structure applyMemoryPublish(ctx, ownerGhii, request) · namespaceOfOwner(ns, ownerGhii)
 * @usage PUBLISH_APPLIERS.memory (appliers.ts)
 * @version-history
 *   2026-10-20 — The applier compares the request's content digest (`target.digest`) with the
 *     record's value as well as the version: an agent binned its record, wrote it again at version 1
 *     with other content, and the owner's approval of the old request published the new content
 *     (secaudit 2026-10, apply-memory.ts:applyMemoryPublish:version-restarts-on-bin-takeover).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4.3).
 */
import { memoryValueDigest, type PublishApplyResult, type PublishRequest, type PublishStoreCtx } from './store.js';
import { writeMemoryRecord } from '../memory-write.js';

/** The owner's own namespace, or one of their agents' (`name#owner@node`). */
export function namespaceOfOwner(ns: string, ownerGhii: string): boolean {
  if (ns === ownerGhii) return true;
  const hash = ns.indexOf('#');
  return hash > 0 && !ns.startsWith('eco:') && ns.slice(hash + 1) === ownerGhii;
}

export async function applyMemoryPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const ns = String(request.target.namespace ?? '');
  const key = String(request.target.key ?? '');
  if (!ns || !key || !namespaceOfOwner(ns, ownerGhii)) return { ok: false, reason: 'the record is not on this account' };
  const record = await ctx.storage.getMemory(ns, key);
  if (!record) return { ok: false, reason: 'the record was deleted' };
  if (record.version !== Number(request.target.version)) return { ok: false, reason: 'the record changed after the request was made' };
  // The version restarts when a binned key is written again, so the content digest the request was
  // filed with is compared too. A request filed before the digest existed carries none and is held
  // to its version alone, as it was; the bin settles those (settleRequestsForBinnedRecord).
  if (typeof request.target.digest === 'string' && memoryValueDigest(record.value) !== request.target.digest) {
    return { ok: false, reason: 'the record changed after the request was made' };
  }
  if (record.visibility === 'public') return { ok: true };
  if (record.visibility !== request.change.from) return { ok: false, reason: 'who may read the record changed after the request was made' };
  const written = await writeMemoryRecord({ storage: ctx.storage, config: ctx.config }, {
    // The owner in person: they approved it.
    principal: ownerGhii, targetGaii: ns, scopes: [], roles: ['owner'],
  }, {
    key, value: record.value, visibility: 'public',
    tags: record.tags, ttlHours: record.ttlHours ?? null,
    expectedVersion: record.version,
    // Only the level changes: the bytes keep the provenance record they carry.
    valueUnchanged: true,
    ...(record.aiProvenanceId ? { keptProvenanceId: record.aiProvenanceId } : {}),
    pipeline: 'rest.publish_request',
  });
  if (!written.ok) {
    return { ok: false, reason: written.code === 'VERSION_CONFLICT' ? 'the record changed after the request was made' : written.message };
  }
  return { ok: true };
}
