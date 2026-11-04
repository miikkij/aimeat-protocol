/**
 * @file src/services/cache-invalidation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which read-cache entries (services/cache.ts) one change event drops. The node's
 *   change listener (server-bootstrap/process-buffers.ts) calls it for every `emitChange`.
 *
 *   THE RULE. A change drops the broad `domain:<d>` entries and, when it names an owner, that
 *   owner's `owner:<name>:<d>` entries. One exception, for memory: a change only its owner reads
 *   (ChangeEvent.ownerOnly, set by emitRecordChange when every record it touched was private or
 *   owner-visible before and after) keeps the `domain:memory` entries, which are computed from
 *   records other people read, and drops the owner's entries and every entry tagged
 *   MEMORY_ANY_LEVEL_TAG (an entry that reads records of any level across owners).
 *
 *   WHY. Every memory write on the node dropped every `domain:memory` entry, so on a busy node the
 *   landing counters, the ticker and the catalogue recomputed on nearly every visit (codebase
 *   analysis 2026-11-03, item C4; efficiency.md E6). A private write changes none of them.
 * @structure dropCachesForChange(evt)
 * @usage onChangeEvent((evt) => runAsNode(nodeId, () => dropCachesForChange(evt)));
 * @version-history
 *   v1.0.0 — 2026-11-04 — Moved out of server-bootstrap/process-buffers.ts with the owner-only
 *     exception added (codebase analysis 2026-11-03, item C4).
 */
import type { ChangeEvent } from './event-bus.js';
import { invalidateTag, MEMORY_ANY_LEVEL_TAG } from './cache.js';
import { localAccountName } from '../utils/gaii.js';

/** Drop the cache entries `evt` makes stale. Runs as the node the listener belongs to. */
export function dropCachesForChange(evt: ChangeEvent): void {
  if (evt.domain === 'memory') invalidateTag(MEMORY_ANY_LEVEL_TAG);
  if (!(evt.domain === 'memory' && evt.ownerOnly)) invalidateTag(`domain:${evt.domain}`);
  if (evt.ownerGaii) {
    const owner = localAccountName(evt.ownerGaii);
    if (owner) invalidateTag(`owner:${owner}:${evt.domain}`);
  }
}
