/**
 * @file memory-discover.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public cross-owner memory discovery; keeps the page-count response contract.
 * @version-history 1.0.0 2026-09-27 Extract the discovery query for provider contract tests.
 */
import type { Storage } from '../storage/interface.js';

export async function discoverMemory(storage: Storage, caller: string, opts: {
  prefix?: string; owner?: string; q?: string; limit: number; offset: number;
}) {
  // Keep JavaScript's Unicode substring semantics on both providers. SQL lower/LIKE differs
  // between SQLite and PostgreSQL. Project metadata once; page only the matching public rows.
  const result = await storage.listAllMemoryMeta({ prefix: opts.prefix, ownerPrefix: opts.owner,
    visibility: 'public' });
  const query = opts.q?.toLowerCase();
  const items = result.items.filter(row => row.ownerGaii !== caller && (!query ||
    row.key.toLowerCase().includes(query) || row.ownerGaii.toLowerCase().includes(query) ||
    row.tags.some(tag => tag.toLowerCase().includes(query))));
  return items.slice(opts.offset, opts.offset + opts.limit);
}
