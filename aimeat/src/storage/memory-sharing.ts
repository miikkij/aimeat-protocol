/**
 * @file memory-sharing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one decision about which sharing group a memory record belongs to after a write.
 *   Both storage providers call it, so the rule cannot drift between them.
 * @structure
 *   - resolveGroupId() — the group a record is bound to after this write, given the incoming
 *     record and the row it replaces (null when the record is not group-visible)
 *   - isNamedGroup() — does a value from a request name a group at all
 *   - memoryGroupRefusal() — the refusal for a write that would leave a new group record with no group
 *   - unknownGroupRefusal() — the refusal for a group id that names no group, for records and files
 * @usage
 *   import { resolveGroupId } from '../../../memory-sharing.js';
 *   const groupId = resolveGroupId(record, existing);
 * @version-history
 *   v1.2.0 -- 2026-11-05 -- unknownGroupRefusal: a group id naming no group is refused, on memory and files.
 *   v1.1.0 -- 2026-11-05 -- isNamedGroup and memoryGroupRefusal: every route that writes a memory record
 *     asks the same question resolveGroupId answers, before anything is stored.
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

/** A value from a request names a group only as a non-blank string. */
export function isNamedGroup(groupId: unknown): groupId is string {
  return typeof groupId === 'string' && groupId.trim() !== '';
}

/**
 * The refusal for a write that binds a record or a file to a group id naming no group, or null. Such a
 * binding opens to nobody but its owner (consent.ts answers group_not_found). `stored` is the id the
 * record already has: a rewrite that repeats it asks nothing, so a record whose group was deleted later
 * stays editable. Used by both the memory and the file write, so a blank id or another type asks nothing
 * here: memoryGroupRefusal and groupBindingRefusal decide those.
 */
export async function unknownGroupRefusal(
  groups: { getSharingGroup(id: string): Promise<unknown> }, visibility: unknown, groupId: unknown, stored?: string | null,
): Promise<{ status: 400; code: 'INVALID_INPUT'; message: string } | null> {
  if (visibility !== 'group' || !isNamedGroup(groupId) || groupId === stored) return null;
  if (await groups.getSharingGroup(groupId)) return null;
  return {
    status: 400, code: 'INVALID_INPUT',
    message: `group_id "${groupId}" names no sharing group on this node, so nobody could read what you store with it. `
      + 'aimeat_group_list or GET /v1/groups lists yours, and aimeat_group_create or POST /v1/groups makes one.',
  };
}

/**
 * The refusal for a write that would leave a record at `group` with no group, or null. Such a record
 * opens to nobody but its owner (consent.ts answers missing_group_id), and the writer learned nothing.
 * Asked with the same inputs resolveGroupId reads, so a rewrite of a record that has a group passes.
 *
 * A row that is already `group` with no group, which an older node stored, passes too: the rewrite
 * takes no reader away, and a refusal would stop a running writer. services/memory-write.ts warns it.
 */
export function memoryGroupRefusal(
  visibility: unknown, groupId: unknown, existing?: { visibility?: unknown; groupId?: string | null } | null,
): { status: 400; code: 'INVALID_INPUT'; message: string } | null {
  if (visibility !== 'group' || isNamedGroup(groupId) || existing?.groupId || existing?.visibility === 'group') return null;
  return {
    status: 400, code: 'INVALID_INPUT',
    message: 'visibility "group" requires group_id, the id of a sharing group whose members will read the record '
      + '(aimeat_group_list or GET /v1/groups lists yours). Without a group the record opens to nobody. '
      + 'Send it with POST /v1/memory, PUT /v1/memory/{key} or aimeat_memory_write; a write that takes no group_id '
      + 'keeps the group the record already has. To keep the record to yourself, send "private".',
  };
}
