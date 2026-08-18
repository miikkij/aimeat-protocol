/**
 * @file memory-sharing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one decision about which sharing group a memory record belongs to after a write.
 *   Both storage providers call it, so the rule cannot drift between them.
 * @structure
 *   - resolveGroupId() — the group a record is bound to after this write, given the incoming
 *     record and the row it replaces (null when the record is not group-visible)
 * @usage
 *   import { resolveGroupId } from '../../../memory-sharing.js';
 *   const groupId = resolveGroupId(record, existing);
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Extracted so the two providers share one rule. Before this neither of
 *     them wrote the column on an UPDATE and SQLite never wrote it at all, so a record could not be
 *     shared after creation and moving one between groups left the old audience reading it.
 */
import type { MemoryRecord } from './interface.js';

/**
 * Which group this record is bound to once the write lands.
 *
 * Three rules, in order:
 *
 * 1. **Not group-visible → no group.** Changing a record to `private` (or any other tier) drops the
 *    binding rather than leaving it behind. A stale id is not merely untidy: the tier is what the
 *    read path checks, so a record turned private and later turned back to `group` without naming
 *    one would silently restore an audience the owner thought they had dismissed.
 * 2. **A named group wins.** This is what makes both sharing after creation and moving between
 *    groups work at all.
 * 3. **Otherwise inherit.** A writer that says `group` without naming one keeps the group the
 *    record already had. The same reasoning as `trackable` a few lines away in each provider: the
 *    binding is a property of the KEY, and a generic rewrite of the value must not silently
 *    unshare it. An agent appending today's output to a key it shares with a subscriber does not
 *    resend the group id, and before this rule that write would have ended the subscription.
 */
export function resolveGroupId(record: MemoryRecord, existing?: MemoryRecord | { groupId?: string | null } | null): string | null {
  if (record.visibility !== 'group') return null;
  return record.groupId ?? existing?.groupId ?? null;
}
