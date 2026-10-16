/**
 * @file src/storage/memory-pages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read EVERY memory record under a cross-owner prefix, one page at a time.
 *
 *   A sum or a backup that reads `listAllMemory({ prefix, limit: N })` is true only while the prefix
 *   holds fewer than N rows, and nothing says so when it holds more: the window is cut in key order,
 *   so which rows fall out depends on their keys. The operator's platform-fee total, the money volume,
 *   a provider's obligations and a workspace export all read that way (QA audit S8-10, F06c-01). This
 *   helper pages with limit and offset until a page comes back short, which both providers can do in
 *   SQL now that the order has a tie-breaker (key, then owner) and expired rows are filtered before
 *   the window (QA audit D4-05).
 * @structure listAllMemoryPages · MEMORY_PAGE_SIZE
 * @usage const fees = await listAllMemoryPages(storage, { prefix: 'commerce.platform-fee.' });
 * @version-history
 *   2026-10-16 — Initial (QA audit S8-10, F06c-01).
 */
import type { MemoryRecord, Storage } from './interface.js';

/** Rows per page. Large enough that a page costs one round trip, small enough to bound one answer. */
export const MEMORY_PAGE_SIZE = 1000;

type PagedOpts = Omit<NonNullable<Parameters<Storage['listAllMemory']>[0]>, 'limit' | 'offset' | 'newestFirst'>;

/**
 * Every record matching `opts`, in key order, read in pages of `pageSize`. `ceiling` stops the read
 * after that many rows and reports it, for a caller that must not hold an unbounded set in memory;
 * without it the read goes to the end.
 */
export async function listAllMemoryPages(
  storage: Storage, opts: PagedOpts, pageSize = MEMORY_PAGE_SIZE, ceiling = Infinity,
): Promise<{ items: MemoryRecord[]; total: number; complete: boolean }> {
  const items: MemoryRecord[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await storage.listAllMemory({ ...opts, limit: pageSize, offset });
    items.push(...page.items);
    if (page.items.length < pageSize) return { items, total: page.total, complete: true };
    if (items.length >= ceiling) return { items, total: page.total, complete: items.length >= page.total };
  }
}
