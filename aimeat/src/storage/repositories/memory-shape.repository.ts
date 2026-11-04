/**
 * @file src/storage/repositories/memory-shape.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Backend-agnostic contract for memory reads that select rows by the SHAPE of their key
 *   or of their value, with the filter, the order and the window taken in SQL. Each method answers
 *   what an existing read answered after it had loaded every row with its value and filtered in
 *   JavaScript; the reads differ only in what leaves the database.
 *
 *   INBOX ROWS. A per-owner set of small records under one prefix, each an object with an `id` and a
 *   `read` flag: the notification inbox (services/notify.ts, keys `notif.<ISO>.<id8>`). A row counts
 *   when its value is an object whose `id` is truthy in JavaScript; it is unread when its `read` is
 *   falsy in JavaScript. Both tests are made in SQL with JavaScript's truthiness rules for every JSON
 *   type, so the counts equal what `rows.filter(r => r.value?.id)` and `.filter(v => !v.read)` gave.
 *   The order is the key's: an inbox key is `<prefix><time>.<id>`, so the key without its last segment
 *   descending, ties in key order. For the notification inbox that is `value.createdAt` newest first,
 *   the order the bell has always shown (storage/inbox-order.ts says why the two are the same).
 *
 *   KEY SHAPE. Every owner's rows whose key starts with `prefix` and ends with `suffix`, in the order
 *   and with the filters of listAllMemory (key, then owner; live, not archived, not in the bin).
 * @structure InboxCounts · InboxRowOpts · KeyShapeOpts · MemoryShapeRepository
 * @usage implemented by both storage providers (methods/memory-shape.ts); called through Storage.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item C7): the notification bell and
 *     the app-tool scan read only the rows they answer with.
 */
import type { MemoryRecord } from '../interface.js';
import type { MemoryMetaRow } from './memory.repository.js';

/** How many inbox rows an owner has, and how many of them are unread. */
export interface InboxCounts {
  total: number;
  unread: number;
}

export interface InboxRowOpts {
  /** At most this many rows. Omitted: every row. */
  limit?: number;
  /** Only the rows whose `read` is falsy. */
  unreadOnly?: boolean;
  /**
   * Only the rows whose key ends with `.<suffix>` for one of these. Matched literally (no wildcard).
   * An empty list selects nothing.
   */
  keySuffixes?: string[];
}

export interface KeyShapeOpts {
  /** Only rows with this visibility. */
  visibility?: string;
  /** At most this many rows, taken after every filter. Omitted: every row. */
  limit?: number;
}

export interface MemoryShapeRepository {
  /**
   * One owner's inbox rows under `prefix`: value an object with a truthy `id`, newest time first,
   * ties in key order (see the header). Live rows only, not archived, not in the bin.
   */
  listInboxRows(ownerGaii: string, prefix: string, opts?: InboxRowOpts): Promise<MemoryRecord[]>;
  /** The number of rows listInboxRows(ownerGaii, prefix) returns, and how many of them are unread. */
  countInboxRows(ownerGaii: string, prefix: string): Promise<InboxCounts>;
  /** Every owner's rows whose key starts with `prefix` and ends with `suffix`, as listAllMemory orders them. */
  listAllMemoryByKeyShape(prefix: string, suffix: string, opts?: KeyShapeOpts): Promise<MemoryRecord[]>;
  /** listAllMemoryByKeyShape without the value: the META projection of listAllMemoryMeta. */
  listAllMemoryMetaByKeyShape(prefix: string, suffix: string, opts?: KeyShapeOpts): Promise<MemoryMetaRow[]>;
}
