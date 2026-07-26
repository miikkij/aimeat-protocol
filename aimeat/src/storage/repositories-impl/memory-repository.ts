/**
 * @file src/storage/repositories-impl/memory-repository.ts
 * @description Backend-AGNOSTIC memory repository — composes the {@link ../adapter/memory-adapter.js}
 *   primitives into domain read/write operations. This is the layer the old `repositories/*.ts`
 *   interfaces never had: real, shared composition (owner-scope union + GHII-first key dedup, subtree
 *   enumeration, bulk write/delete) that runs identically on every backend because it touches ONLY the
 *   adapter — no SQL, no Prisma filters, no Mongo operators, and no business rules (quota, schema,
 *   auth). Those live above (service) or below (adapter). One instance wraps one adapter.
 *
 * @structure
 *   MemoryRepository — get / getAcrossOwners / listForOwner(s) / listMetaForOwners / countForOwners /
 *     sumBytesForOwners / search / listByKeyPrefix / write / writeMany / delete / deleteMany /
 *     subtreeRefs / deleteSubtree / history; dedupByKey composition helper
 * @usage
 *   const repo = new MemoryRepository(adapter);
 *   const rows = await repo.listForOwners(identities, opts);   // deduped GHII-first by the service
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: composition over the adapter, no behaviour change.
 */
import type { MemoryRecord } from '../interface.js';
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
} from '../adapter/memory-adapter.js';

/** A row addressable by (key, ownerGaii) — the minimum {@link dedupByKey} needs to rank + dedupe. */
interface KeyedRow {
  key: string;
  ownerGaii: string;
}

export class MemoryRepository {
  constructor(private readonly adapter: MemoryStorageAdapter) {}

  // ── Reads ──────────────────────────────────────────────────────────

  get(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    return this.adapter.getByKey(ownerGaii, key);
  }

  /** Many keys under one owner in one read (batched existing-row lookup for a bulk write). */
  getByKeys(ownerGaii: string, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return Promise.resolve([]);
    return this.adapter.getByKeys(ownerGaii, keys);
  }

  /** One key across many identities in one IN read (owner-scope point read), NOT deduped — the caller
   *  chooses the priority order via {@link dedupByKey} / {@link firstByPriority}. */
  getAcrossOwners(ownerGaiis: string[], key: string): Promise<MemoryRecord[]> {
    return this.adapter.getByOwners(ownerGaiis, key);
  }

  listForOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryRecord[]> {
    return this.adapter.findByOwner(ownerGaii, opts);
  }

  /** MANY identities' keyspaces in one IN read (owner-scope union, NOT deduped). */
  listForOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryRecord[]> {
    return this.adapter.findByOwners(ownerGaiis, opts);
  }

  listMetaForOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryMetaRow[]> {
    return this.adapter.findMetaByOwner(ownerGaii, opts);
  }

  listMetaForOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryMetaRow[]> {
    return this.adapter.findMetaByOwners(ownerGaiis, opts);
  }

  listByKeyPrefix(opts?: KeyPrefixOpts): Promise<{ items: MemoryRecord[]; total: number }> {
    return this.adapter.findByKeyPrefix(opts);
  }

  countForOwners(ownerGaiis: string[], opts?: CountOpts): Promise<number> {
    return this.adapter.countByOwners(ownerGaiis, opts);
  }

  sumBytesForOwner(ownerGaii: string): Promise<number> {
    return this.adapter.sumBytesByOwner(ownerGaii);
  }

  sumBytesForOwners(ownerGaiis: string[]): Promise<number> {
    return this.adapter.sumBytesByOwners(ownerGaiis);
  }

  search(query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
    return this.adapter.textSearch(query, opts);
  }

  history(ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
    return this.adapter.history(ownerGaii, key, opts);
  }

  // ── Writes ─────────────────────────────────────────────────────────

  write(record: MemoryRecord): Promise<MemoryRecord> {
    return this.adapter.upsert(record);
  }

  writeIfVersion(record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
    if (this.adapter.upsertIfVersion) return this.adapter.upsertIfVersion(record, expectedVersion);
    return this.adapter.upsert(record).then(r => r);
  }

  writeMany(records: MemoryRecord[]): Promise<MemoryRecord[]> {
    if (records.length === 0) return Promise.resolve([]);
    return this.adapter.bulkUpsert(records);
  }

  // ── Deletes ────────────────────────────────────────────────────────

  delete(ownerGaii: string, key: string): Promise<boolean> {
    return this.adapter.deleteByKey(ownerGaii, key);
  }

  deleteMany(refs: MemoryRef[]): Promise<number> {
    if (refs.length === 0) return Promise.resolve(0);
    return this.adapter.bulkDelete(refs);
  }

  /**
   * Enumerate the (ownerGaii, key) refs of a record's whole family — the base key itself plus its
   * `base.*` children (`.draft` / `.latest` / `.version.N`) — under one owner, via a single prefix
   * read. Backs the record-family delete (today done key-by-key). A dedicated subtree-delete primitive
   * replaces the enumerate-then-delete in Phase 2; this keeps the composition backend-agnostic now.
   */
  async subtreeRefs(ownerGaii: string, baseKey: string): Promise<MemoryRef[]> {
    const rows = await this.adapter.findByOwner(ownerGaii, { prefix: baseKey });
    return rows
      .filter(r => r.key === baseKey || r.key.startsWith(baseKey + '.'))
      .map(r => ({ ownerGaii: r.ownerGaii, key: r.key }));
  }

  /** Delete a record's whole family under one owner in one call. Uses the adapter's one-statement subtree
   *  primitive (which itself falls back to enumerate-then-delete on a backend that lacks it). */
  deleteSubtree(ownerGaii: string, baseKey: string): Promise<number> {
    return this.adapter.deleteSubtree(ownerGaii, baseKey);
  }

  // ── Composition helpers (backend-agnostic) ─────────────────────────

  /**
   * Dedupe rows by `key`, keeping the copy owned by the HIGHEST-priority identity (earliest in
   * `identities`). This is the owner-scope rule: a key present under both the GHII and an agent resolves
   * to the GHII copy. Pure — moved here from services/owner-memory.ts so every owner-scope read shares
   * one implementation.
   *
   * The losing copies are REMOVED, not reordered, so an agent's newer write can vanish from an
   * owner-scope read with nothing to show a collision occurred. The survivor therefore carries
   * `alsoUnder`: the other identities holding the same key. Additive and present only on an actual
   * collision, so every existing caller is unaffected.
   */
  static dedupByKey<T extends KeyedRow>(rows: T[], identities: string[]): (T & { alsoUnder?: string[] })[] {
    const priority = new Map(identities.map((id, i) => [id, i]));
    const rank = (r: T): number => priority.get(r.ownerGaii) ?? identities.length;
    const ranked = [...rows].sort((a, b) => rank(a) - rank(b));
    const winners = new Map<string, T & { alsoUnder?: string[] }>();
    const out: (T & { alsoUnder?: string[] })[] = [];
    for (const r of ranked) {
      const winner = winners.get(r.key);
      if (!winner) {
        // Shallow copy: never annotate a row the adapter handed us.
        const entry = { ...r } as T & { alsoUnder?: string[] };
        winners.set(r.key, entry);
        out.push(entry);
      } else if (winner.ownerGaii !== r.ownerGaii) {
        (winner.alsoUnder ??= []).push(r.ownerGaii);
      }
    }
    return out;
  }

  /** The highest-priority row for a single key across an identity list (owner-scope point read). */
  static firstByPriority<T extends KeyedRow>(rows: T[], identities: string[]): T | null {
    if (rows.length === 0) return null;
    const priority = new Map(identities.map((id, i) => [id, i]));
    return [...rows].sort(
      (a, b) => (priority.get(a.ownerGaii) ?? identities.length) - (priority.get(b.ownerGaii) ?? identities.length),
    )[0];
  }
}
