/**
 * @file src/storage/adapter/legacy-memory-adapter.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Phase 0 memory adapter: implements {@link MemoryStorageAdapter} by delegating to the
 *   existing fat `Storage` provider. This is the coexistence bridge — the new
 *   Service → Repository → Adapter stack runs on top of the SAME storage the routes use today, so the
 *   framework can land with ZERO behaviour change. Each primitive is a thin pass-through to the
 *   equivalent `Storage` method; the composite primitives that have no direct 1:1 (getByOwners,
 *   bulkUpsert, bulkDelete) are expressed in terms of existing methods.
 *
 * @structure LegacyMemoryAdapter — constructor(storage); one method per adapter primitive
 * @usage const adapter = new LegacyMemoryAdapter(storage);
 * @version-history
 *   2026-11-04 — getByKeys, upsertIfVersion, bulkUpsert and deleteSubtree call the storage method
 *     directly: it is required on Storage, so the per-key fallbacks and the plain upsert in place of
 *     a version-checked one are gone (codebase analysis 2026-11-03, item D-e).
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: wraps Storage, no behaviour change.
 *   v1.1.0 — 2026-08-11 — Dropped `withTransaction`. It was `return fn()`, nothing called it, and its
 *     presence implied an atomicity guarantee the adapter never provided.
 */
import type { MemoryRecord, Storage } from '../interface.js';
import type {
  CountOpts,
  KeyPrefixOpts,
  ListOpts,
  MemoryMetaRow,
  MemoryRef,
  MemoryStorageAdapter,
  MemoryTextHit,
  MemoryTextSearchOpts,
  MemoryVersionRecord,
} from './memory-adapter.js';

export class LegacyMemoryAdapter implements MemoryStorageAdapter {
  constructor(private readonly storage: Storage) {}

  // ── Point + cross-owner reads ──────────────────────────────────────

  getByKey(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    return this.storage.getMemory(ownerGaii, key);
  }

  /** One key across many identities in one IN read: `listMemoryForOwners({ prefix: key })` returns the
   *  key plus any siblings sharing the prefix, so filter to the exact key. Matches the single-query
   *  path the owner-scope helper already uses. */
  async getByOwners(ownerGaiis: string[], key: string): Promise<MemoryRecord[]> {
    if (ownerGaiis.length === 0) return [];
    const rows = await this.storage.listMemoryForOwners(ownerGaiis, { prefix: key });
    return rows.filter(r => r.key === key);
  }

  /** Many keys under one owner in one IN read. */
  async getByKeys(ownerGaii: string, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return [];
    return this.storage.getMemoryByKeys(ownerGaii, keys);
  }

  // ── Keyspace listings ──────────────────────────────────────────────

  findByOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryRecord[]> {
    return this.storage.listMemory(ownerGaii, opts);
  }

  findByOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryRecord[]> {
    if (ownerGaiis.length === 0) return Promise.resolve([]);
    return this.storage.listMemoryForOwners(ownerGaiis, opts);
  }

  findMetaByOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryMetaRow[]> {
    return this.storage.listMemoryMeta(ownerGaii, opts);
  }

  findMetaByOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryMetaRow[]> {
    if (ownerGaiis.length === 0) return Promise.resolve([]);
    return this.storage.listMemoryMetaForOwners(ownerGaiis, opts);
  }

  findByKeyPrefix(opts?: KeyPrefixOpts): Promise<{ items: MemoryRecord[]; total: number }> {
    return this.storage.listAllMemory(opts);
  }

  // ── DB-side aggregates ─────────────────────────────────────────────

  countByOwners(ownerGaiis: string[], opts?: CountOpts): Promise<number> {
    if (ownerGaiis.length === 0) return Promise.resolve(0);
    return this.storage.countMemory(ownerGaiis, opts);
  }

  sumBytesByOwner(ownerGaii: string): Promise<number> {
    return this.storage.sumMemoryBytes(ownerGaii);
  }

  sumBytesByOwners(ownerGaiis: string[]): Promise<number> {
    if (ownerGaiis.length === 0) return Promise.resolve(0);
    return this.storage.sumMemoryBytesForOwners(ownerGaiis);
  }

  // ── Full-text search ───────────────────────────────────────────────

  textSearch(query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
    return this.storage.searchText(query, opts);
  }

  // ── Writes ─────────────────────────────────────────────────────────

  upsert(record: MemoryRecord): Promise<MemoryRecord> {
    return this.storage.setMemory(record);
  }

  upsertIfVersion(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
    return this.storage.setMemoryIfVersion(record, expectedVersion);
  }

  /** Bulk upsert via the backend's one-transaction primitive (SQLite: one commit). */
  async bulkUpsert(records: MemoryRecord[]): Promise<MemoryRecord[]> {
    if (records.length === 0) return [];
    return this.storage.bulkSetMemory(records);
  }

  // ── Deletes ────────────────────────────────────────────────────────

  deleteByKey(ownerGaii: string, key: string): Promise<boolean> {
    return this.storage.deleteMemory(ownerGaii, key);
  }

  /** Sequential delete by explicit ref list. (Refs may span owners, so this stays a loop; the
   *  single-owner record-family case uses {@link deleteSubtree}'s one-statement primitive.) */
  async bulkDelete(refs: MemoryRef[]): Promise<number> {
    let deleted = 0;
    for (const { ownerGaii, key } of refs) {
      if (await this.storage.deleteMemory(ownerGaii, key)) deleted++;
    }
    return deleted;
  }

  /** Delete a record's whole family under one owner, by the backend's one-statement subtree primitive. */
  async deleteSubtree(ownerGaii: string, baseKey: string): Promise<number> {
    return this.storage.deleteMemorySubtree(ownerGaii, baseKey);
  }

  // ── History ────────────────────────────────────────────────────────

  history(ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
    return this.storage.listMemoryHistory(ownerGaii, key, opts);
  }
}
