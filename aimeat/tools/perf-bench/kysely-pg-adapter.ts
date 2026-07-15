/**
 * @file tools/perf-bench/kysely-pg-adapter.ts
 * @description Phase 4 BENCHMARK CANDIDATE — a thin Postgres memory-domain adapter built on Kysely (the
 *   query layer doc-s4hgvp5 proposes as the Prisma replacement). It implements the SAME
 *   {@link ../../src/storage/adapter/memory-adapter.js MemoryStorageAdapter} contract the SQLite/Mongo
 *   legacy adapter implements, so the backend benchmark runs identical operation chains through each and
 *   compares like-for-like. Schema is self-creating (CREATE TABLE IF NOT EXISTS + btree(key) for prefix
 *   scans + a STORED tsvector column with a GIN index for full-text) so no migration infra is needed to
 *   run the comparison. Lives under tools/ (not src/) because it is a candidate under evaluation — it
 *   graduates to src/storage/adapter/ only if the data favours Postgres+Kysely.
 *
 *   Postgres-specific choices (the point of a thin per-backend adapter): JSONB value, btree PK
 *   (owner_gaii,key) + btree(key text_pattern_ops) for `key LIKE 'prefix%'`, a GENERATED tsvector +
 *   GIN for ranked FTS, and a single multi-row INSERT … ON CONFLICT for bulkUpsert (the import path).
 *
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 4 benchmark candidate: Kysely/Postgres memory adapter.
 */
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { MemoryRecord } from '../../src/storage/interface.js';
import type {
  CountOpts, KeyPrefixOpts, ListOpts, MemoryRef, MemoryStorageAdapter,
  MemoryMetaRow, MemoryTextHit, MemoryTextSearchOpts, MemoryVersionRecord,
} from '../../src/storage/adapter/memory-adapter.js';

const TABLE = 'bench_mem_kv';

interface MemRow {
  owner_gaii: string; key: string; value: unknown; visibility: string; tags: string[];
  ttl_hours: number | null; version: number; byte_size: number; search_blob: string; archived: boolean;
  group_id: string | null; workspace_ref: string | null; created_at: Date; updated_at: Date;
}
interface DB { [TABLE]: MemRow }

/** The search text a row contributes to FTS: its key + tags + recursively-collected scalar values
 *  (depth ≤ 6), space-joined — matching the Mongo/SQLite buildSearchBlob so search hits are comparable. */
function buildSearchBlob(record: MemoryRecord): string {
  const parts: string[] = [record.key, ...(record.tags ?? [])];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v == null) return;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { parts.push(String(v)); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') { for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1); }
  };
  walk(record.value, 0);
  return parts.join(' ');
}

const byteSize = (value: unknown): number => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

export class KyselyPgAdapter implements MemoryStorageAdapter {
  private readonly db: Kysely<DB>;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
    this.db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: this.pool }) });
  }

  /** Create the table + indexes if absent (idempotent). Called once before a bench run. */
  async ensureSchema(): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql.ref(TABLE)} (
        owner_gaii   text        NOT NULL,
        key          text        NOT NULL,
        value        jsonb,
        visibility   text        NOT NULL DEFAULT 'private',
        tags         text[]      NOT NULL DEFAULT '{}',
        ttl_hours    int,
        version      int         NOT NULL DEFAULT 1,
        byte_size    int         NOT NULL DEFAULT 0,
        search_blob  text        NOT NULL DEFAULT '',
        archived     boolean     NOT NULL DEFAULT false,
        group_id     text,
        workspace_ref text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_gaii, key)
      )`.execute(this.db);
    // btree(key) with text_pattern_ops so `key LIKE 'prefix%'` is an index range scan (organism content
    // is addressed by key, not owner). Plus a GENERATED tsvector + GIN for ranked full-text.
    await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(TABLE + '_key_pat')} ON ${sql.ref(TABLE)} (key text_pattern_ops)`.execute(this.db);
    await sql`ALTER TABLE ${sql.ref(TABLE)} ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_blob, ''))) STORED`.execute(this.db);
    await sql`CREATE INDEX IF NOT EXISTS ${sql.ref(TABLE + '_tsv')} ON ${sql.ref(TABLE)} USING GIN (search_tsv)`.execute(this.db);
  }

  /** Empty the table between bench scales (keeps indexes → realistic timings). */
  async truncate(): Promise<void> {
    await sql`TRUNCATE ${sql.ref(TABLE)}`.execute(this.db);
  }

  async close(): Promise<void> {
    await this.db.destroy();
  }

  private toRecord(r: MemRow): MemoryRecord {
    return {
      key: r.key, ownerGaii: r.owner_gaii, value: r.value, visibility: r.visibility as MemoryRecord['visibility'],
      tags: r.tags ?? [], ttlHours: r.ttl_hours, version: r.version,
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
      archived: r.archived, ...(r.group_id ? { groupId: r.group_id } : {}), ...(r.workspace_ref ? { workspaceRef: r.workspace_ref } : {}),
    };
  }

  /** Only-active predicate for the bulk read/search/count primitives (archived excluded by default). */
  private activeOnly(archived?: string): boolean {
    return archived !== 'include' && archived !== 'only';
  }

  // ── Point + cross-owner reads ──────────────────────────────────────
  async getByKey(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    const row = await this.db.selectFrom(TABLE).selectAll().where('owner_gaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    return row ? this.toRecord(row) : null;
  }

  async getByOwners(ownerGaiis: string[], key: string): Promise<MemoryRecord[]> {
    if (ownerGaiis.length === 0) return [];
    const rows = await this.db.selectFrom(TABLE).selectAll().where('owner_gaii', 'in', ownerGaiis).where('key', '=', key).execute();
    return rows.map(r => this.toRecord(r));
  }

  async getByKeys(ownerGaii: string, keys: string[]): Promise<MemoryRecord[]> {
    if (keys.length === 0) return [];
    const rows = await this.db.selectFrom(TABLE).selectAll().where('owner_gaii', '=', ownerGaii).where('key', 'in', keys).execute();
    return rows.map(r => this.toRecord(r));
  }

  // ── Keyspace listings ──────────────────────────────────────────────
  private applyList(q: any, opts?: ListOpts) {
    if (opts?.prefix) q = q.where('key', 'like', opts.prefix + '%');
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (this.activeOnly(opts?.archived)) q = q.where('archived', '=', false);
    else if (opts?.archived === 'only') q = q.where('archived', '=', true);
    return q;
  }

  async findByOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryRecord[]> {
    const rows = await this.applyList(this.db.selectFrom(TABLE).selectAll().where('owner_gaii', '=', ownerGaii), opts).execute();
    return rows.map((r: MemRow) => this.toRecord(r));
  }

  async findByOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryRecord[]> {
    if (ownerGaiis.length === 0) return [];
    const rows = await this.applyList(this.db.selectFrom(TABLE).selectAll().where('owner_gaii', 'in', ownerGaiis), opts).execute();
    return rows.map((r: MemRow) => this.toRecord(r));
  }

  async findMetaByOwner(ownerGaii: string, opts?: ListOpts): Promise<MemoryMetaRow[]> {
    const rows = await this.applyList(this.db.selectFrom(TABLE).select(['key', 'owner_gaii', 'visibility', 'tags', 'version', 'byte_size', 'created_at', 'updated_at']).where('owner_gaii', '=', ownerGaii), opts).execute();
    return rows.map((r: MemRow) => this.toMeta(r));
  }

  async findMetaByOwners(ownerGaiis: string[], opts?: ListOpts): Promise<MemoryMetaRow[]> {
    if (ownerGaiis.length === 0) return [];
    const rows = await this.applyList(this.db.selectFrom(TABLE).select(['key', 'owner_gaii', 'visibility', 'tags', 'version', 'byte_size', 'created_at', 'updated_at']).where('owner_gaii', 'in', ownerGaiis), opts).execute();
    return rows.map((r: MemRow) => this.toMeta(r));
  }

  private toMeta(r: Partial<MemRow>): MemoryMetaRow {
    return {
      key: r.key!, ownerGaii: r.owner_gaii!, visibility: r.visibility as MemoryRecord['visibility'],
      tags: r.tags ?? [], version: r.version ?? 1, flagCount: 0, byteSize: r.byte_size ?? 0,
      createdAt: new Date(r.created_at!).toISOString(), updatedAt: new Date(r.updated_at!).toISOString(),
    };
  }

  async findByKeyPrefix(opts?: KeyPrefixOpts): Promise<{ items: MemoryRecord[]; total: number }> {
    let q = this.db.selectFrom(TABLE).selectAll();
    if (opts?.prefix) q = q.where('key', 'like', opts.prefix + '%');
    if (opts?.ownerPrefix) q = q.where('owner_gaii', 'like', opts.ownerPrefix + '%');
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (this.activeOnly(opts?.archived)) q = q.where('archived', '=', false);
    const all = await q.execute();
    const total = all.length;
    const start = opts?.offset ?? 0;
    const items = (opts?.limit ? all.slice(start, start + opts.limit) : all).map(r => this.toRecord(r));
    return { items, total };
  }

  // ── DB-side aggregates ─────────────────────────────────────────────
  async countByOwners(ownerGaiis: string[], opts?: CountOpts): Promise<number> {
    if (ownerGaiis.length === 0) return 0;
    let q = this.db.selectFrom(TABLE).select(sql<number>`count(distinct key)`.as('n')).where('owner_gaii', 'in', ownerGaiis);
    if (opts?.prefix) q = q.where('key', 'like', opts.prefix + '%');
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (this.activeOnly(opts?.archived)) q = q.where('archived', '=', false);
    const row = await q.executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async sumBytesByOwner(ownerGaii: string): Promise<number> {
    const row = await this.db.selectFrom(TABLE).select(sql<number>`coalesce(sum(byte_size),0)`.as('b')).where('owner_gaii', '=', ownerGaii).where('archived', '=', false).executeTakeFirst();
    return Number(row?.b ?? 0);
  }

  async sumBytesByOwners(ownerGaiis: string[]): Promise<number> {
    if (ownerGaiis.length === 0) return 0;
    const row = await this.db.selectFrom(TABLE).select(sql<number>`coalesce(sum(byte_size),0)`.as('b')).where('owner_gaii', 'in', ownerGaiis).where('archived', '=', false).executeTakeFirst();
    return Number(row?.b ?? 0);
  }

  // ── Full-text search (tsvector + GIN, ranked) ──────────────────────
  async textSearch(query: string, opts?: MemoryTextSearchOpts): Promise<MemoryTextHit[]> {
    const limit = opts?.limit ?? 50;
    let q = this.db.selectFrom(TABLE).selectAll()
      .select(sql<number>`ts_rank(search_tsv, plainto_tsquery('simple', ${query}))`.as('score'))
      .where(sql<boolean>`search_tsv @@ plainto_tsquery('simple', ${query})`);
    if (opts?.ownerGaiis?.length) q = q.where('owner_gaii', 'in', opts.ownerGaiis);
    if (opts?.keyPrefix) q = q.where('key', 'like', opts.keyPrefix + '%');
    if (opts?.visibility) q = q.where('visibility', '=', opts.visibility);
    if (this.activeOnly(opts?.archived)) q = q.where('archived', '=', false);
    else if (opts?.archived === 'only') q = q.where('archived', '=', true);
    const rows = await q.orderBy('score', 'desc').limit(limit).execute();
    return rows.map((r: MemRow & { score: number }) => ({ record: this.toRecord(r), score: Number(r.score) }));
  }

  // ── Writes ─────────────────────────────────────────────────────────
  async upsert(record: MemoryRecord): Promise<MemoryRecord> {
    await this.bulkUpsert([record]);
    return record;
  }

  async bulkUpsert(records: MemoryRecord[]): Promise<MemoryRecord[]> {
    if (records.length === 0) return [];
    // ONE multi-row INSERT … ON CONFLICT per 1000 — the Postgres import primitive. value is cast to jsonb;
    // tags is a text[] literal. search_tsv is generated by the DB from search_blob.
    for (let i = 0; i < records.length; i += 1000) {
      const chunk = records.slice(i, i + 1000);
      const values = chunk.map(r => {
        const now = sql`now()`;
        return sql`(${r.ownerGaii}, ${r.key}, ${JSON.stringify(r.value ?? null)}::jsonb, ${r.visibility ?? 'private'},
          ${sql.val(r.tags ?? [])}, ${r.ttlHours ?? null}, ${r.version ?? 1}, ${byteSize(r.value)}, ${buildSearchBlob(r)},
          ${r.archived ?? false}, ${r.groupId ?? null}, ${r.workspaceRef ?? null}, ${now}, ${now})`;
      });
      await sql`
        INSERT INTO ${sql.ref(TABLE)}
          (owner_gaii, key, value, visibility, tags, ttl_hours, version, byte_size, search_blob, archived, group_id, workspace_ref, created_at, updated_at)
        VALUES ${sql.join(values)}
        ON CONFLICT (owner_gaii, key) DO UPDATE SET
          value = EXCLUDED.value, visibility = EXCLUDED.visibility, tags = EXCLUDED.tags, ttl_hours = EXCLUDED.ttl_hours,
          version = ${sql.ref(TABLE)}.version + 1, byte_size = EXCLUDED.byte_size, search_blob = EXCLUDED.search_blob,
          archived = EXCLUDED.archived, group_id = EXCLUDED.group_id, workspace_ref = EXCLUDED.workspace_ref, updated_at = now()
      `.execute(this.db);
    }
    return records;
  }

  // ── Deletes ────────────────────────────────────────────────────────
  async deleteByKey(ownerGaii: string, key: string): Promise<boolean> {
    const r = await this.db.deleteFrom(TABLE).where('owner_gaii', '=', ownerGaii).where('key', '=', key).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  }

  async bulkDelete(refs: MemoryRef[]): Promise<number> {
    if (refs.length === 0) return 0;
    let removed = 0;
    for (let i = 0; i < refs.length; i += 1000) {
      const chunk = refs.slice(i, i + 1000);
      // (owner_gaii, key) IN (VALUES …) — one statement per 1000.
      const pairs = chunk.map(r => sql`(${r.ownerGaii}, ${r.key})`);
      const res = await sql<{ n: string }>`
        WITH del AS (
          DELETE FROM ${sql.ref(TABLE)} WHERE (owner_gaii, key) IN (${sql.join(pairs)}) RETURNING 1
        ) SELECT count(*)::text AS n FROM del`.execute(this.db);
      removed += Number(res.rows[0]?.n ?? 0);
    }
    return removed;
  }

  async deleteSubtree(ownerGaii: string, baseKey: string): Promise<number> {
    const r = await this.db.deleteFrom(TABLE).where('owner_gaii', '=', ownerGaii)
      .where(eb => eb.or([eb('key', '=', baseKey), eb('key', 'like', baseKey + '.%')])).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  }

  // ── History (not modelled in the bench table) ──────────────────────
  history(_ownerGaii: string, _key: string, _opts?: { limit?: number }): Promise<MemoryVersionRecord[]> {
    return Promise.resolve([]);
  }

  // ── Transaction seam ───────────────────────────────────────────────
  // The bench's bulk primitives are each a single atomic statement, so the read composite needs no
  // multi-statement boundary here; run the callback directly (mirrors the legacy adapter's seam).
  withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
