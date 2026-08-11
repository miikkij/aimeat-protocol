/**
 * @file src/storage/providers/postgres-kysely/methods/memory.ts
 * @description Memory-domain methods for the Postgres+Kysely backend — the MemoryRepository contract
 *   implemented as thin Kysely queries over the Memory / MemoryVersion tables, with the same semantics
 *   the SQLite/Mongo backends have (version bump + trackable-history archive on overwrite, byteSize +
 *   searchBlob maintenance, TTL-live filtering, archived-filter handling). Postgres-specific wins: bulk
 *   upsert is one multi-row INSERT … ON CONFLICT, and searchText uses the GENERATED tsvector + GIN
 *   (ranked, best-first). Bound to PostgresKyselyStorage via the prototype merge in ../index.ts.
 * @version-history
 *   v1.2.0 — 2026-07-25 — listAllMemory gains excludeOwnerPrefix (filters in SQL, so a windowed read
 *     is not emptied by rows it was going to drop) and newestFirst (key order made `limit` return an
 *     alphabetical slice here while SQLite returned the newest rows for the same call).
 *   v1.1.0 — 2026-07-16 — Add getMemoryByKeysAnyOwner (Phase 2 N×M): many keys across ALL owners in one query.
 *   v1.0.0 — 2026-07-15 — Phase 5: memory domain on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { ArchiveFilter, MemoryRecord } from '../../../interface.js';
import type { MemoryMetaRow, MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord } from '../../../repositories/memory.repository.js';
import type { PostgresKyselyStorage } from '../index.js';
import { buildSearchBlob, byteSize, isLive, jsonb, rowToMeta, rowToRecord } from '../helpers.js';

type ListOpts = { prefix?: string; visibility?: string; tags?: string[]; maxFlags?: number; archived?: ArchiveFilter };
type CountOpts = { prefix?: string; visibility?: string; archived?: ArchiveFilter };

/** Annotation reader — the archived history keeps who/what changed a value (value._actor / _event). */
function annotation(value: unknown, field: '_actor' | '_event'): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = (value as Record<string, unknown>)[field];
    if (typeof v === 'string') return v;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyArchive(q: any, archived?: ArchiveFilter) {
  if (archived === 'only') return q.where('archived', '=', true);
  if (archived === 'include') return q;
  return q.where('archived', '=', false);   // default: exclude archived
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyList(q: any, opts?: ListOpts) {
  if (opts?.prefix) q = q.where('key', 'like', opts.prefix + '%');
  if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
  if (typeof opts?.maxFlags === 'number') q = q.where('flagCount', '<=', opts.maxFlags);
  q = applyArchive(q, opts?.archived);
  if (opts?.tags?.length) q = q.where(sql<boolean>`"tags" @> ${sql.val(opts.tags)}`);   // array-contains-all
  return q;
}

const META_COLS = ['key', 'ownerGaii', 'visibility', 'tags', 'version', 'flagCount', 'byteSize', 'createdAt', 'updatedAt'] as const;

export const memoryMethods = {
  /** Raw current row (any TTL/archive state) — for existence/version continuity on write. */
  async _rawMemory(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    const r = await this.db.selectFrom('Memory').selectAll().where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    return r ? rowToRecord(r) : null;
  },

  async setMemory(this: PostgresKyselyStorage, record: MemoryRecord): Promise<MemoryRecord> {
    const existing = await this._rawMemory(record.ownerGaii, record.key);
    // trackable is a property of the KEY: inherit the existing setting if the writer didn't specify.
    const trackable = record.trackable ?? existing?.trackable ?? false;
    record.trackable = trackable || undefined;
    if (existing) {
      if (existing.trackable) {
        // keep the previous version before overwrite (INSERT … ON CONFLICT DO NOTHING = INSERT OR IGNORE)
        await this.db.insertInto('MemoryVersion').values({
          ownerGaii: existing.ownerGaii, key: existing.key, version: existing.version,
          value: jsonb(existing.value), actor: annotation(existing.value, '_actor'), event: annotation(existing.value, '_event'),
          recordedAt: new Date(existing.updatedAt),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any).onConflict(oc => oc.columns(['ownerGaii', 'key', 'version']).doNothing()).execute();
      }
      record.version = existing.version + 1;
      await this.db.updateTable('Memory').set({
        value: jsonb(record.value), visibility: record.visibility, tags: record.tags ?? [], ttlHours: record.ttlHours,
        version: record.version, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
        flagCount: record.flagCount ?? 0, allowedOrigins: record.allowedOrigins ?? null, trackable,
        byteSize: byteSize(record.value), searchBlob: buildSearchBlob(record),
        // Write-through, deliberately NOT inherited from `existing`: a new value is new content, and
        // keeping the old provenance id would assert something about bytes that no longer exist.
        aiProvenanceId: record.aiProvenanceId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).where('ownerGaii', '=', record.ownerGaii).where('key', '=', record.key).execute();
    } else {
      // Upsert (ON CONFLICT DO UPDATE), not a bare INSERT: two concurrent first-writes of the same
      // (ownerGaii,key) — e.g. parallel OTK replays within the grace window — must not raise a unique
      // violation. The loser's write folds into an update of the same row instead of 500-ing.
      const insertCols = {
        value: jsonb(record.value), visibility: record.visibility, tags: record.tags ?? [], ttlHours: record.ttlHours,
        version: record.version, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
        flagCount: record.flagCount ?? 0, allowedOrigins: record.allowedOrigins ?? null,
        trackable, byteSize: byteSize(record.value), searchBlob: buildSearchBlob(record),
        groupId: record.groupId ?? null, workspaceRef: record.workspaceRef ?? null,
        aiProvenanceId: record.aiProvenanceId ?? null,
      };
      await this.db.insertInto('Memory').values({ ownerGaii: record.ownerGaii, key: record.key, ...insertCols } as never)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onConflict(oc => oc.columns(['ownerGaii', 'key']).doUpdateSet(insertCols as any)).execute();
    }
    return record;
  },

  async createMemoryIfAbsent(this: PostgresKyselyStorage, record: MemoryRecord): Promise<MemoryRecord | null> {
    // The create half of the compare-and-swap pair. onConflict doNothing means the unique index on
    // (ownerGaii, key) decides the winner, so two writers racing to start the same shared record
    // cannot both think they created it — the loser gets null and re-reads to merge.
    const res = await this.db.insertInto('Memory').values({
      ownerGaii: record.ownerGaii, key: record.key,
      value: jsonb(record.value), visibility: record.visibility, tags: record.tags ?? [],
      workspaceRef: record.workspaceRef ?? null, ttlHours: record.ttlHours,
      version: record.version, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
      flagCount: record.flagCount ?? 0, allowedOrigins: record.allowedOrigins ?? null,
      trackable: record.trackable ?? false,
      byteSize: byteSize(record.value), searchBlob: buildSearchBlob(record),
      aiProvenanceId: record.aiProvenanceId ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
      .onConflict(oc => oc.columns(['ownerGaii', 'key']).doNothing())
      .executeTakeFirst();
    return (res.numInsertedOrUpdatedRows ?? 0n) > 0n ? record : null;
  },

  async setMemoryIfVersion(this: PostgresKyselyStorage, record: MemoryRecord, expectedVersion: number): Promise<MemoryRecord | null> {
    // Atomic compare-and-swap: lock the row FOR UPDATE inside one transaction so two concurrent writers
    // at the same version are serialised — the first bumps to N+1 and commits, the second re-reads N+1,
    // sees it no longer equals its expectedVersion, and gets a conflict (null). A plain read-then-write
    // (as setMemory does) lets both pass the version check and both succeed.
    return this.transaction(async () => {
      const trx = this.db;
      const existing = await trx.selectFrom('Memory').selectAll()
        .where('ownerGaii', '=', record.ownerGaii).where('key', '=', record.key).forUpdate().executeTakeFirst();
      if (!existing || existing.version !== expectedVersion) return null;
      const trackable = record.trackable ?? existing.trackable ?? false;
      if (existing.trackable) {
        await trx.insertInto('MemoryVersion').values({
          ownerGaii: existing.ownerGaii, key: existing.key, version: existing.version,
          value: jsonb(existing.value), actor: annotation(existing.value, '_actor'), event: annotation(existing.value, '_event'),
          recordedAt: existing.updatedAt instanceof Date ? existing.updatedAt : new Date(existing.updatedAt),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any).onConflict(oc => oc.columns(['ownerGaii', 'key', 'version']).doNothing()).execute();
      }
      const newVersion = existing.version + 1;
      await trx.updateTable('Memory').set({
        value: jsonb(record.value), visibility: record.visibility, tags: record.tags ?? [], ttlHours: record.ttlHours,
        version: newVersion, createdAt: new Date(record.createdAt), updatedAt: new Date(record.updatedAt),
        flagCount: record.flagCount ?? 0, allowedOrigins: record.allowedOrigins ?? null, trackable,
        byteSize: byteSize(record.value), searchBlob: buildSearchBlob(record),
        aiProvenanceId: record.aiProvenanceId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).where('ownerGaii', '=', record.ownerGaii).where('key', '=', record.key).where('version', '=', expectedVersion).execute();
      record.version = newVersion;
      record.trackable = trackable || undefined;
      return record;
    });
  },

  async getMemory(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    const r = await this.db.selectFrom('Memory').selectAll().where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    if (!r || !isLive(r)) return null;
    return rowToRecord(r);
  },

  async getMemoryByKeys(this: PostgresKyselyStorage, ownerGaii: string, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return [];
    const rows = await this.db.selectFrom('Memory').selectAll().where('ownerGaii', '=', ownerGaii).where('key', 'in', keys).execute();
    return rows.filter(isLive).map(rowToRecord);
  },

  // BULK PRIMITIVE (Phase 2) — many keys across ALL owners in ONE `key IN (…)` query (no owner filter).
  // Live rows only. Backs the organism discovery list's batched workspace-manifest read (N canReadWs
  // manifest scans → 1). A key forked across owners returns >1 row; the caller dedupes.
  async getMemoryByKeysAnyOwner(this: PostgresKyselyStorage, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return [];
    const rows = await this.db.selectFrom('Memory').selectAll().where('key', 'in', keys).execute();
    return rows.filter(isLive).map(rowToRecord);
  },

  async bulkSetMemory(this: PostgresKyselyStorage, records: MemoryRecord[]): Promise<MemoryRecord[]> {
    if (records.length === 0) return [];
    // Resolve which (ownerGaii,key) already exist in one chunked read; NEW rows → one multi-row INSERT
    // per 1000, EXISTING → per-row setMemory (version bump + trackable history — rare on an import).
    const present = new Set<string>();
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const rows = await this.db.selectFrom('Memory').select(['ownerGaii', 'key'])
        .where(eb => eb.or(chunk.map(r => eb.and([eb('ownerGaii', '=', r.ownerGaii), eb('key', '=', r.key)])))).execute();
      for (const r of rows) present.add(r.ownerGaii + ' ' + r.key);
    }
    const fresh = records.filter(r => !present.has(r.ownerGaii + ' ' + r.key));
    const existing = records.filter(r => present.has(r.ownerGaii + ' ' + r.key));
    for (let i = 0; i < fresh.length; i += 1000) {
      const chunk = fresh.slice(i, i + 1000);
      const values = chunk.map(r => sql`(${r.ownerGaii}, ${r.key}, ${JSON.stringify(r.value ?? null)}::jsonb, ${r.visibility},
        ${sql.val(r.tags ?? [])}, ${r.ttlHours ?? null}, ${r.version}, ${r.flagCount ?? 0}, ${r.allowedOrigins ?? null},
        ${r.groupId ?? null}, ${r.workspaceRef ?? null}, ${byteSize(r.value)}, ${buildSearchBlob(r)}, ${r.trackable ?? false},
        ${new Date(r.createdAt)}, ${new Date(r.updatedAt)})`);
      await sql`
        INSERT INTO "Memory" ("ownerGaii","key","value","visibility","tags","ttlHours","version","flagCount","allowedOrigins","groupId","workspaceRef","byteSize","searchBlob","trackable","createdAt","updatedAt")
        VALUES ${sql.join(values)}
        ON CONFLICT ("ownerGaii","key") DO NOTHING
      `.execute(this.db);
    }
    for (const r of existing) await this.setMemory(r);
    return records;
  },

  async deleteMemory(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Memory').where('ownerGaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async deleteAllMemory(this: PostgresKyselyStorage, ownerGaii: string): Promise<number> {
    const r = await this.db.deleteFrom('Memory').where('ownerGaii', '=', ownerGaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async deleteMemorySubtree(this: PostgresKyselyStorage, ownerGaii: string, baseKey: string): Promise<number> {
    const r = await this.db.deleteFrom('Memory').where('ownerGaii', '=', ownerGaii)
      .where(eb => eb.or([eb('key', '=', baseKey), eb('key', 'like', baseKey + '.%')])).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async deleteMemoryByPrefix(this: PostgresKyselyStorage, keyPrefix: string): Promise<number> {
    const r = await this.db.deleteFrom('Memory').where('key', 'like', keyPrefix + '%').executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async bulkDeleteMemory(this: PostgresKyselyStorage, refs: { ownerGaii: string; key: string }[]): Promise<number> {
    if (refs.length === 0) return 0;
    let removed = 0;
    for (let i = 0; i < refs.length; i += 500) {
      const chunk = refs.slice(i, i + 500);
      const r = await this.db.deleteFrom('Memory')
        .where(eb => eb.or(chunk.map(x => eb.and([eb('ownerGaii', '=', x.ownerGaii), eb('key', '=', x.key)])))).executeTakeFirst();
      removed += Number(r.numDeletedRows ?? 0);
    }
    return removed;
  },

  async listMemoryKeysByPrefix(this: PostgresKyselyStorage, keyPrefix: string): Promise<{ ownerGaii: string; key: string }[]> {
    const rows = await this.db.selectFrom('Memory').select(['ownerGaii', 'key']).where('key', 'like', keyPrefix + '%').where('archived', '=', false).execute();
    return rows.map(r => ({ ownerGaii: r.ownerGaii, key: r.key }));
  },

  async listMemory(this: PostgresKyselyStorage, ownerGaii: string, opts?: ListOpts): Promise<MemoryRecord[]> {
    const rows = await applyList(this.db.selectFrom('Memory').selectAll().where('ownerGaii', '=', ownerGaii), opts).execute();
    return rows.filter(isLive).map(rowToRecord);
  },

  async listMemoryMeta(this: PostgresKyselyStorage, ownerGaii: string, opts?: ListOpts): Promise<MemoryMetaRow[]> {
    const rows = await applyList(this.db.selectFrom('Memory').select(META_COLS).where('ownerGaii', '=', ownerGaii), opts).execute();
    return rows.map(rowToMeta);
  },

  async listMemoryForOwners(this: PostgresKyselyStorage, ownerGaiis: string[], opts?: ListOpts): Promise<MemoryRecord[]> {
    if (ownerGaiis.length === 0) return [];
    const rows = await applyList(this.db.selectFrom('Memory').selectAll().where('ownerGaii', 'in', ownerGaiis), opts).execute();
    return rows.filter(isLive).map(rowToRecord);
  },

  async listMemoryMetaForOwners(this: PostgresKyselyStorage, ownerGaiis: string[], opts?: ListOpts): Promise<MemoryMetaRow[]> {
    if (ownerGaiis.length === 0) return [];
    const rows = await applyList(this.db.selectFrom('Memory').select(META_COLS).where('ownerGaii', 'in', ownerGaiis), opts).execute();
    return rows.map(rowToMeta);
  },

  async countMemory(this: PostgresKyselyStorage, ownerGaiis: string[], opts?: CountOpts): Promise<number> {
    if (ownerGaiis.length === 0) return 0;
    let q = this.db.selectFrom('Memory').select(sql<number>`count(distinct "key")`.as('n')).where('ownerGaii', 'in', ownerGaiis);
    if (opts?.prefix) q = q.where('key', 'like', opts.prefix + '%');
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    q = applyArchive(q, opts?.archived);
    const r = await q.executeTakeFirst();
    return Number(r?.n ?? 0);
  },

  async sumMemoryBytes(this: PostgresKyselyStorage, ownerGaii: string): Promise<number> {
    const r = await this.db.selectFrom('Memory').select(sql<number>`coalesce(sum("byteSize"),0)`.as('b')).where('ownerGaii', '=', ownerGaii).where('archived', '=', false).executeTakeFirst();
    return Number(r?.b ?? 0);
  },

  async sumMemoryBytesForOwners(this: PostgresKyselyStorage, ownerGaiis: string[]): Promise<number> {
    if (ownerGaiis.length === 0) return 0;
    const r = await this.db.selectFrom('Memory').select(sql<number>`coalesce(sum("byteSize"),0)`.as('b')).where('ownerGaii', 'in', ownerGaiis).where('archived', '=', false).executeTakeFirst();
    return Number(r?.b ?? 0);
  },

  async incrementMemoryFlagCount(this: PostgresKyselyStorage, ownerGaii: string, key: string): Promise<void> {
    await this.db.updateTable('Memory').set({ flagCount: sql`"flagCount" + 1` }).where('ownerGaii', '=', ownerGaii).where('key', '=', key).execute();
  },

  async searchMemory(this: PostgresKyselyStorage, ownerGaii: string, query: string, opts?: { visibility?: string; maxFlags?: number; prefix?: string; archived?: ArchiveFilter; limit?: number }): Promise<MemoryRecord[]> {
    let q = applyList(this.db.selectFrom('Memory').selectAll().where('ownerGaii', '=', ownerGaii), opts as ListOpts);
    q = q.where(sql<boolean>`"searchBlob" ILIKE ${'%' + query + '%'}`);
    const rows = await q.limit(opts?.limit ?? 100).execute();
    return rows.filter(isLive).map(rowToRecord);
  },

  async searchText(this: PostgresKyselyStorage, query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
    // Prefix matching, parity with the SQLite FTS5 `token*` behaviour: tokenise to alphanumerics, lowercase,
    // and OR each token's prefix pattern so "qwopdoc" finds "qwopdocterm". Empty query → no hits.
    const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
    if (!tokens || tokens.length === 0) return [];
    const tsquery = tokens.map(t => `${t}:*`).join(' | ');
    let q = this.db.selectFrom('Memory').selectAll()
      .select(sql<number>`ts_rank("searchTsv", to_tsquery('simple', ${tsquery}))`.as('score'))
      .where(sql<boolean>`"searchTsv" @@ to_tsquery('simple', ${tsquery})`);
    if (opts?.ownerGaiis?.length) q = q.where('ownerGaii', 'in', opts.ownerGaiis);
    if (opts?.keyPrefix) q = q.where('key', 'like', opts.keyPrefix + '%');
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (typeof opts?.maxFlags === 'number') q = q.where('flagCount', '<=', opts.maxFlags);
    q = applyArchive(q, opts?.archived);
    const rows = await q.orderBy('score', 'desc').limit(opts?.limit ?? 50).execute();
    return rows.filter(isLive).map(r => ({ record: rowToRecord(r), score: Number((r as { score: number }).score) }));
  },

  async listAllMemory(this: PostgresKyselyStorage, opts?: { prefix?: string; ownerPrefix?: string; excludeOwnerPrefix?: string; visibility?: string; limit?: number; offset?: number; archived?: ArchiveFilter; excludeVersionRows?: boolean; newestFirst?: boolean }): Promise<{ items: MemoryRecord[]; total: number }> {
    let q = this.db.selectFrom('Memory').selectAll();
    if (opts?.prefix) q = q.where('key', 'like', opts.prefix + '%');
    if (opts?.ownerPrefix) q = q.where('ownerGaii', 'like', opts.ownerPrefix + '%');
    // Excluded IN SQL, not after the slice: a windowed read whose window is entirely unwanted
    // rows would otherwise come back empty (how the landing ticker emptied itself).
    if (opts?.excludeOwnerPrefix) q = q.where('ownerGaii', 'not like', opts.excludeOwnerPrefix + '%');
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    // Drop `.version.N` workspace history rows in SQL (hot read paths always discard them).
    if (opts?.excludeVersionRows) q = q.where('key', 'not like', '%.version.%');
    q = applyArchive(q, opts?.archived);
    // Default stays key order (many callers enumerate rather than page); newestFirst is what a
    // limited "most recent" read must ask for — key order made `limit` return an alphabetical
    // slice here while SQLite returned the newest rows for the same call.
    const ordered = opts?.newestFirst ? q.orderBy('updatedAt', 'desc') : q.orderBy('key');
    const all = (await ordered.execute()).filter(isLive);
    const total = all.length;
    const start = opts?.offset ?? 0;
    const items = (opts?.limit ? all.slice(start, start + opts.limit) : all).map(rowToRecord);
    return { items, total };
  },

  async listMemoryHistory(this: PostgresKyselyStorage, ownerGaii: string, key: string, opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
    const rows = await this.db.selectFrom('MemoryVersion').selectAll().where('ownerGaii', '=', ownerGaii).where('key', '=', key)
      .orderBy('version', 'desc').limit(opts?.limit ?? 200).execute();
    return rows.map(r => ({
      ownerGaii: r.ownerGaii, key: r.key, version: r.version, value: r.value,
      actor: r.actor ?? null, event: r.event ?? null,
      recordedAt: (r.recordedAt instanceof Date ? r.recordedAt : new Date(r.recordedAt)).toISOString(),
    }));
  },

  async archiveMemoryByKey(this: PostgresKyselyStorage, keyOrPrefix: string, opts: { archivedRoot: string; archivedBy: string; archivedAt: string; match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
    let q = this.db.updateTable('Memory').set({ archived: true, archivedRoot: opts.archivedRoot, archivedBy: opts.archivedBy, archivedAt: new Date(opts.archivedAt) }).where('archived', '=', false);
    if (opts.match === 'prefix') q = q.where('key', 'like', keyOrPrefix + '%');
    else if (opts.match === 'subtree') q = q.where(eb => eb.or([eb('key', '=', keyOrPrefix), eb('key', 'like', keyOrPrefix + '.%')]));
    else q = q.where('key', '=', keyOrPrefix);
    const r = await q.executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  },

  async unarchiveMemoryByRoot(this: PostgresKyselyStorage, archivedRoot: string): Promise<number> {
    const r = await this.db.updateTable('Memory').set({ archived: false, archivedRoot: null, archivedBy: null, archivedAt: null }).where('archivedRoot', '=', archivedRoot).where('archived', '=', true).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  },

  async unarchiveMemoryByKey(this: PostgresKyselyStorage, keyOrPrefix: string, opts?: { match?: 'exact' | 'prefix' | 'subtree' }): Promise<number> {
    const match = opts?.match ?? 'subtree';   // default subtree, matching the SQLite repo
    let q = this.db.updateTable('Memory').set({ archived: false, archivedRoot: null, archivedBy: null, archivedAt: null }).where('archived', '=', true);
    if (match === 'exact') q = q.where('key', '=', keyOrPrefix);
    else if (match === 'prefix') q = q.where('key', 'like', keyOrPrefix + '%');
    else q = q.where(eb => eb.or([eb('key', '=', keyOrPrefix), eb('key', 'like', keyOrPrefix + '.%')]));
    const r = await q.executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  },

  async countArchivedByKeyPrefix(this: PostgresKyselyStorage, keyPrefix: string): Promise<number> {
    const r = await this.db.selectFrom('Memory').select(sql<number>`count(*)`.as('n')).where('key', 'like', keyPrefix + '%').where('archived', '=', true).executeTakeFirst();
    return Number(r?.n ?? 0);
  },
};
