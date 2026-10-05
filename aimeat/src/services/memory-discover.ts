/**
 * @file memory-discover.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Public cross-owner memory discovery; keeps the page-count response contract.
 * @version-history
 *   1.1.0 2026-10-05 An organism's public record whose classification keeps it inside the organism is
 *     not listed to a reader outside it, the rule GET /v1/memory/:gaii/:key already applies to the
 *     record itself (organismKeysCarried). The listing named those keys (secaudit 2026-10, DATA-3).
 *   1.0.0 2026-09-27 Extract the discovery query for provider contract tests.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { organismKeysCarried } from './group-shares-classification.js';

export async function discoverMemory(storage: Storage, config: AimeatConfig, caller: string, opts: {
  prefix?: string; owner?: string; q?: string; limit: number; offset: number;
}) {
  // Keep JavaScript's Unicode substring semantics on both providers. SQL lower/LIKE differs
  // between SQLite and PostgreSQL. Project metadata once; page only the matching public rows.
  const result = await storage.listAllMemoryMeta({ prefix: opts.prefix, ownerPrefix: opts.owner,
    visibility: 'public' });
  const query = opts.q?.toLowerCase();
  const matching = result.items.filter(row => row.ownerGaii !== caller && (!query ||
    row.key.toLowerCase().includes(query) || row.ownerGaii.toLowerCase().includes(query) ||
    row.tags.some(tag => tag.toLowerCase().includes(query))));
  // Before paging, so a page never comes back short because of what it may not show.
  const { kept } = await organismKeysCarried({ storage, config }, matching, caller);
  return kept.slice(opts.offset, opts.offset + opts.limit);
}
