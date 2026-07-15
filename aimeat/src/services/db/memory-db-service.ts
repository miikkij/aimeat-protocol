/**
 * @file src/services/db/memory-db-service.ts
 * @description Application DB Service for the memory domain — the layer the routes/MCP will call
 *   INSTEAD of touching storage directly (the missing kerros in doc-id925fp). It exposes WHOLE
 *   operations (owner-scope read as one unit, a keyspace listing, a write, a record-family delete),
 *   composing the backend-agnostic {@link ../../storage/repositories-impl/memory-repository.js
 *   MemoryRepository} on top of a {@link ../../storage/adapter/memory-adapter.js MemoryStorageAdapter}.
 *   Cross-domain identity resolution (an owner's agents + ecosystem apps) is INJECTED as
 *   `resolveOwnerIdentities`, so the memory service never reaches into the agent/eco domains itself.
 *
 *   Phase 0: this service re-homes the owner-scope aggregation (today in services/owner-memory.ts) and
 *   the core memory reads/writes onto the new stack, byte-for-byte equivalent (proven by the parity
 *   test). Routes are migrated onto it in Phase 1; until then it coexists unused by the request path.
 *
 * @structure
 *   MemoryDbService — get / write / delete / listForOwner + owner-scope: getOwnerScope /
 *     listOwnerScope / listOwnerScopeMeta / countOwnerScope / searchOwnerScope / deleteRecordFamily
 * @usage const svc = createMemoryDbService(storage, config); await svc.listOwnerScope(owner, opts);
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 0 scaffolding: owner-scope + core memory ops on the new stack.
 */
import type { MemoryRecord } from '../../storage/interface.js';
import type {
  CountOpts,
  ListOpts,
  MemoryMetaRow,
  MemoryTextHit,
  MemoryTextSearchOpts,
} from '../../storage/adapter/memory-adapter.js';
import { MemoryRepository } from '../../storage/repositories-impl/memory-repository.js';

/** One entry of a bulk write. Shape mirrors the single POST /v1/memory body (minus protocol fields the
 *  route handles: agent targeting, group visibility resolution). */
export interface BulkWriteItem {
  key: string;
  value: unknown;
  visibility?: MemoryRecord['visibility'];
  tags?: string[];
  ttlHours?: number | null;
  groupId?: string;
  workspaceRef?: string;
}

/** Hard quota numbers for a bulk write (same limits the single-write route enforces). Overage-morsel
 *  charging is NOT applied in bulk — an entry that would exceed the total quota is failed, not charged. */
export interface BulkWriteQuota {
  maxKeysPerOwner: number;
  maxValueSizeBytes: number;
  totalQuotaBytes: number;
}

export interface BulkWriteOptions {
  /** 'overwrite' (default): an existing key is updated (version bump). 'skip': an existing key is left
   *  untouched and reported skipped. */
  mode?: 'overwrite' | 'skip';
  quota: BulkWriteQuota;
  /** Per-item schema/write-guard validation (injected by the route so the memory service stays free of
   *  the schema domain). Returning `{valid:false}` fails just that item — the batch continues. */
  validate?: (key: string, value: unknown) => Promise<{ valid: boolean }>;
}

export interface BulkItemResult {
  key: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  reason?: string;
}

export interface BulkWriteResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  items: BulkItemResult[];
}

/** Injected cross-domain resolver: the ordered identity list for an owner-scope operation — the owner's
 *  GHII first, then each agent's GAII, then each ecosystem app's GEAI (the priority order the GHII-first
 *  dedup relies on). Backed by storage.getAgentsByOwner + getEcosystemAppsByOwner in the factory. */
export type OwnerIdentityResolver = (ownerName: string) => Promise<string[]>;

export interface MemoryDbServiceDeps {
  nodeId: string;
  resolveOwnerIdentities: OwnerIdentityResolver;
}

export class MemoryDbService {
  constructor(private readonly repo: MemoryRepository, private readonly deps: MemoryDbServiceDeps) {}

  private ghii(ownerName: string): string {
    return `${ownerName}@${this.deps.nodeId}`;
  }

  // ── Single-identity core ops ───────────────────────────────────────

  get(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    return this.repo.get(ownerGaii, key);
  }

  write(record: MemoryRecord): Promise<MemoryRecord> {
    return this.repo.write(record);
  }

  /**
   * Write MANY entries under one owner as ONE batched operation — the structural replacement for N
   * separate single-write requests. Reads are batched (one `key IN (…)` existing-lookup + one byte-sum
   * + one key-count, instead of per-entry round-trips) and the valid rows are committed together
   * (one transaction on a backend with the bulk primitive). Enforces the SAME hard limits as the single
   * write (per-value size, key count, total-bytes quota) and the injected schema validation; a failing
   * entry is recorded and skipped without aborting the batch. Overage-morsel charging is not applied in
   * bulk (an over-quota entry fails). Protocol guards (reserved-key, anonymous namespace, archive,
   * workspace access) are the route's responsibility and run before this is called.
   */
  async writeMany(ownerGaii: string, items: BulkWriteItem[], opts: BulkWriteOptions): Promise<BulkWriteResult> {
    const now = new Date().toISOString();
    const mode = opts.mode ?? 'overwrite';
    const results: BulkItemResult[] = [];
    const staged: MemoryRecord[] = [];

    // Batched reads: one IN-lookup of every incoming key + one byte-sum + one key-count.
    const keys = items.map(i => i.key).filter((k): k is string => typeof k === 'string' && k.length > 0);
    const existingRows = keys.length ? await this.repo.getByKeys(ownerGaii, keys) : [];
    const existingByKey = new Map(existingRows.map(r => [r.key, r]));
    let runningBytes = await this.repo.sumBytesForOwner(ownerGaii);
    let runningKeys = await this.repo.countForOwners([ownerGaii]);

    for (const item of items) {
      const key = item.key;
      if (typeof key !== 'string' || !key) { results.push({ key: String(key), status: 'failed', reason: 'missing key' }); continue; }
      const existing = existingByKey.get(key);
      if (existing && mode === 'skip') { results.push({ key, status: 'skipped' }); continue; }

      const valueBytes = Buffer.byteLength(JSON.stringify(item.value ?? null), 'utf8');
      if (valueBytes > opts.quota.maxValueSizeBytes) { results.push({ key, status: 'failed', reason: 'value too large' }); continue; }
      if (!existing && runningKeys >= opts.quota.maxKeysPerOwner) { results.push({ key, status: 'failed', reason: 'key quota reached' }); continue; }
      if (opts.validate) {
        const v = await opts.validate(key, item.value);
        if (!v.valid) { results.push({ key, status: 'failed', reason: 'schema validation failed' }); continue; }
      }
      const existingBytes = existing ? Buffer.byteLength(JSON.stringify(existing.value ?? null), 'utf8') : 0;
      const projected = runningBytes - existingBytes + valueBytes;
      if (projected > opts.quota.totalQuotaBytes) { results.push({ key, status: 'failed', reason: 'memory quota exceeded' }); continue; }

      staged.push({
        key,
        ownerGaii,
        value: item.value,
        visibility: item.visibility ?? 'private',
        tags: Array.isArray(item.tags) ? item.tags : [],
        ttlHours: item.ttlHours ?? null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(item.groupId ? { groupId: item.groupId } : {}),
        ...(item.workspaceRef ? { workspaceRef: item.workspaceRef } : {}),
      });
      results.push({ key, status: existing ? 'updated' : 'created' });
      runningBytes = projected;
      if (!existing) runningKeys++;
    }

    if (staged.length) await this.repo.writeMany(staged);

    return {
      created: results.filter(r => r.status === 'created').length,
      updated: results.filter(r => r.status === 'updated').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      failed: results.filter(r => r.status === 'failed').length,
      items: results,
    };
  }

  delete(ownerGaii: string, key: string): Promise<boolean> {
    return this.repo.delete(ownerGaii, key);
  }

  listForOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryRecord[]> {
    return this.repo.listForOwner(ownerGaii, opts);
  }

  // ── Owner-scope whole operations (GHII + agents + eco apps) ────────

  /**
   * The owner-scope union — every key across the owner's GHII + agents + ecosystem apps, deduped by key
   * (GHII wins). Same set `GET /v1/memory?owner_scope=true` returns. ONE IN read + a pure dedup.
   */
  async listOwnerScope(ownerName: string, opts?: ListOpts): Promise<MemoryRecord[]> {
    const identities = await this.deps.resolveOwnerIdentities(ownerName);
    const rows = await this.repo.listForOwners(identities, opts);
    return MemoryRepository.dedupByKey(rows, identities);
  }

  /** Owner-scope META listing (`?include=meta`) — value-free rows carrying byteSize, deduped GHII-first. */
  async listOwnerScopeMeta(ownerName: string, opts?: ListOpts): Promise<MemoryMetaRow[]> {
    const identities = await this.deps.resolveOwnerIdentities(ownerName);
    const rows = await this.repo.listMetaForOwners(identities, opts);
    return MemoryRepository.dedupByKey(rows, identities);
  }

  /**
   * One key across the owner-scope (GHII first, then agents/eco in order). Reads the GHII copy first
   * (the common hit) and only fans across the other identities on a miss — the same two-step shape the
   * current getOwnerScopeMemory uses, so the round-trip count is unchanged.
   */
  async getOwnerScope(ownerName: string, key: string): Promise<MemoryRecord | null> {
    const ghii = await this.repo.get(this.ghii(ownerName), key);
    if (ghii) return ghii;
    const identities = await this.deps.resolveOwnerIdentities(ownerName);
    const others = identities.filter(id => id !== this.ghii(ownerName));
    if (others.length === 0) return null;
    const rows = await this.repo.getAcrossOwners(others, key);
    return MemoryRepository.firstByPriority(rows, others);
  }

  /** DISTINCT-key count across the owner-scope identity set. */
  async countOwnerScope(ownerName: string, opts?: CountOpts): Promise<number> {
    const identities = await this.deps.resolveOwnerIdentities(ownerName);
    return this.repo.countForOwners(identities, opts);
  }

  /** Total value bytes across the owner-scope identity set (profile Home usage). */
  async sumBytesOwnerScope(ownerName: string): Promise<number> {
    const identities = await this.deps.resolveOwnerIdentities(ownerName);
    return this.repo.sumBytesForOwners(identities);
  }

  /**
   * Owner-scope full-text search — ONE indexed query across the owner's whole identity set (GHII +
   * agents + eco apps), ranked best-first. Mirrors the crud.ts search path.
   */
  async searchOwnerScope(ownerName: string, query: string, opts?: Omit<MemoryTextSearchOpts, 'ownerGaiis'>): Promise<MemoryTextHit[]> {
    const identities = await this.deps.resolveOwnerIdentities(ownerName);
    return this.repo.search(query, { ...opts, ownerGaiis: identities });
  }

  /**
   * Delete a record's whole family (`base` + `base.*`) under one owner in one operation — the structural
   * replacement for the key-by-key delete a CADENCE record teardown does today. Returns rows removed.
   */
  deleteRecordFamily(ownerGaii: string, baseKey: string): Promise<number> {
    return this.repo.deleteSubtree(ownerGaii, baseKey);
  }
}
