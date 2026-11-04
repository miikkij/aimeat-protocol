/**
 * @file src/storage/inbox-order.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The order of inbox rows (repositories/memory-shape.repository.ts), shared by both
 *   providers' listInboxRows. An inbox key is `<prefix><time>.<id>`: notify() writes
 *   `notif.<createdAt ISO>.<first eight characters of the id>`, from one clock reading for the key and
 *   the value's createdAt, and nothing else writes the prefix (utils/reserved-keys.ts
 *   SERVER_WRITTEN_KEY_PREFIXES). So "newest createdAt first, ties in key order", the order the bell
 *   has always shown, is "the key without its last segment descending, then the key ascending".
 *
 *   The SQL takes the rows by key descending, which the (ownerGaii, key) index serves with a LIMIT,
 *   and the provider then reads the rest of the boundary row's time (a few rows at most, written in the
 *   same millisecond) so that a tie split by the LIMIT is completed before the order is applied.
 * @structure keyStem · inboxOrder · completeInboxPage
 * @usage return completeInboxPage(rows, limit, stem => this.readStem(stem));
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C7).
 */
import type { MemoryRecord } from './interface.js';

/** The key without its last `.segment`: the time part of an inbox key. */
export function keyStem(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot < 0 ? key : key.slice(0, dot);
}

/** Newest time first, ties in key order. Byte order, as the stored keys are compared. */
export function inboxOrder(a: MemoryRecord, b: MemoryRecord): number {
  const sa = keyStem(a.key), sb = keyStem(b.key);
  if (sa !== sb) return sa < sb ? 1 : -1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * The page in inbox order. `rows` are the first `limit` rows by key descending (or every row when
 * `limit` is undefined). When the page is full, the rows sharing the last row's time are read with
 * `readStem` (every row whose key starts with `<stem>.`, filtered as the page was) and merged, so the
 * tie is ordered as a whole and cut at `limit` in that order.
 */
export async function completeInboxPage(
  rows: MemoryRecord[], limit: number | undefined, readStem: (stem: string) => Promise<MemoryRecord[]>,
): Promise<MemoryRecord[]> {
  let all = rows;
  if (limit !== undefined && rows.length >= limit && rows.length > 0) {
    const stem = keyStem(rows[rows.length - 1]!.key);
    const seen = new Set(rows.map(r => `${r.ownerGaii}\u0000${r.key}`));
    const tie = (await readStem(stem)).filter(r => keyStem(r.key) === stem && !seen.has(`${r.ownerGaii}\u0000${r.key}`));
    all = rows.concat(tie);
  }
  const ordered = [...all].sort(inboxOrder);
  return limit === undefined ? ordered : ordered.slice(0, limit);
}
