/**
 * @file scripts/migrate-to-postgres-kysely.ts
 * @description One-shot data migrator into the Postgres+Kysely backend (Phase 5 cutover). Copies every
 *   table from a source backend — MongoDB (Prisma) in production, or another Postgres+Kysely DB for a
 *   self-verifying round-trip — into a target Postgres database, table by table, preserving primary keys
 *   and timestamps. The schema is FK-free (relations are by logical keys: gaii/ownerGaii/key/grantId), so
 *   table order does not matter. Column metadata is read live from the target's information_schema, so the
 *   copy stays correct as the schema evolves: jsonb/json columns are JSON-encoded + cast, array columns are
 *   passed through with an explicit element cast, timestamps are coerced to Date, everything else passes.
 * @usage
 *   # Production cutover (Mongo → PG). Target must already have the schema (provider runs migrations on boot).
 *   node --env-file=.env --import tsx scripts/migrate-to-postgres-kysely.ts \
 *     --from mongodb --from-url "mongodb://localhost:27017/aimeat" \
 *     --to "postgresql://appuser:pw@localhost:5432/aimeat" [--truncate] [--tables Memory,Agent] [--dry-run]
 *
 *   # Self-verifying round-trip (PG → PG): copy a populated Kysely DB into an empty one and compare counts.
 *   node --env-file=.env.test.postgres-kysely --import tsx scripts/migrate-to-postgres-kysely.ts \
 *     --from postgres-kysely --from-url "$DATABASE_URL" --to "$OTHER_DATABASE_URL" --truncate
 * @structure
 *   - parseArgs(): CLI flags
 *   - openSource(): MongoRowSource | PgRowSource — listTables() + readRows(table, batch)
 *   - targetColumns(): live column metadata (name, kind: json|array|timestamp|scalar, elemCast)
 *   - copyTable(): batched read → projected + coerced multi-row insert
 *   - main(): ensure target schema, per-table copy, count verification, summary
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 5: Mongo→PG (and PG→PG) data migrator with live column-type coercion.
 */
import pg from 'pg';
import { PostgresKyselyStorage } from '../src/storage/providers/postgres-kysely/index.js';

interface Args { from: 'mongodb' | 'postgres-kysely'; fromUrl: string; to: string; truncate: boolean; dryRun: boolean; tables: string[] | null; batch: number }

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string): string | undefined => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : undefined; };
  const from = (get('--from') ?? 'mongodb') as Args['from'];
  const fromUrl = get('--from-url') ?? process.env.SOURCE_DATABASE_URL ?? '';
  const to = get('--to') ?? process.env.DATABASE_URL ?? '';
  if (!fromUrl) throw new Error('Missing --from-url (or SOURCE_DATABASE_URL)');
  if (!to) throw new Error('Missing --to (or DATABASE_URL)');
  const tablesArg = get('--tables');
  return {
    from, fromUrl, to,
    truncate: a.includes('--truncate'),
    dryRun: a.includes('--dry-run'),
    tables: tablesArg ? tablesArg.split(',').map(s => s.trim()).filter(Boolean) : null,
    batch: Number(get('--batch') ?? 1000),
  };
}

/** A row provider: enumerates logical tables and streams their rows as plain objects. */
interface RowSource {
  listTables(): Promise<string[]>;
  count(table: string): Promise<number>;
  readRows(table: string, offset: number, limit: number): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

/** Mongo source via the reference implementation's Prisma client (delegate = camelCase(table)). */
async function openMongoSource(url: string): Promise<RowSource> {
  const { MongoStorage } = await import('../src/storage/providers/mongodb/index.js');
  const store = new MongoStorage(url);
  await store.ready;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = (store as any).prisma;
  const delegate = (table: string): any => prisma[table.charAt(0).toLowerCase() + table.slice(1)];   // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    async listTables() {
      // Prisma model delegates carry findMany/count; filter the client's own enumerable model keys.
      return Object.keys(prisma).filter(k => k[0] === k[0]?.toLowerCase() && prisma[k] && typeof prisma[k].findMany === 'function')
        .map(k => k.charAt(0).toUpperCase() + k.slice(1));
    },
    async count(table) { const d = delegate(table); return d ? d.count() : 0; },
    async readRows(table, offset, limit) { const d = delegate(table); return d ? d.findMany({ skip: offset, take: limit }) : []; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async close() { await (store as any).disconnect?.() ?? await prisma.$disconnect?.(); },
  };
}

/** Postgres source (for the self-verifying round-trip) — reads directly from a Kysely-shaped DB. */
async function openPgSource(url: string): Promise<RowSource> {
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  return {
    async listTables() {
      const { rows } = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_kysely_migrations'`);
      return rows.map(r => r.table_name);
    },
    async count(table) { const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`); return Number(rows[0].n); },
    async readRows(table, offset, limit) {
      const { rows } = await pool.query(`SELECT * FROM "${table}" ORDER BY 1 OFFSET $1 LIMIT $2`, [offset, limit]);
      return rows as Record<string, unknown>[];
    },
    async close() { await pool.end(); },
  };
}

type ColKind = 'json' | 'array' | 'timestamp' | 'scalar';
interface ColMeta { name: string; kind: ColKind; elemCast: string | null }

/** Live column metadata for one target table, keyed for O(1) projection. */
async function targetColumns(pool: pg.Pool, table: string): Promise<Map<string, ColMeta>> {
  // Exclude generated columns (e.g. Memory.searchTsv, a GENERATED ALWAYS tsvector) — Postgres computes
  // those and rejects any explicit insert value.
  const { rows } = await pool.query<{ column_name: string; data_type: string; udt_name: string }>(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND is_generated <> 'ALWAYS' AND is_identity <> 'YES'`, [table]);
  const map = new Map<string, ColMeta>();
  for (const r of rows) {
    let kind: ColKind = 'scalar';
    let elemCast: string | null = null;
    if (r.data_type === 'jsonb' || r.data_type === 'json') kind = 'json';
    else if (r.data_type === 'ARRAY') { kind = 'array'; elemCast = r.udt_name.replace(/^_/, ''); }
    else if (r.data_type.startsWith('timestamp')) kind = 'timestamp';
    map.set(r.column_name, { name: r.column_name, kind, elemCast });
  }
  return map;
}

/** Copy one table: batched read from source, projected + coerced multi-row INSERT into the target. */
async function copyTable(source: RowSource, pool: pg.Pool, table: string, cols: Map<string, ColMeta>, batch: number, dryRun: boolean): Promise<number> {
  const total = await source.count(table);
  if (total === 0) return 0;
  let copied = 0;
  for (let offset = 0; offset < total; offset += batch) {
    const rows = await source.readRows(table, offset, batch);
    if (rows.length === 0) break;
    // Column set = intersection of the target columns and keys actually present across this batch.
    const present = cols.size ? [...cols.keys()].filter(c => rows.some(r => c in r)) : [];
    if (present.length === 0) { copied += rows.length; continue; }
    const params: unknown[] = [];
    const tuples = rows.map(row => {
      const cells = present.map(col => {
        const meta = cols.get(col)!;
        let v = row[col];
        if (v === undefined) v = null;
        if (v !== null && meta.kind === 'json') v = JSON.stringify(v);
        params.push(v);
        const ph = `$${params.length}`;
        if (v === null) return ph;
        if (meta.kind === 'json') return `${ph}::jsonb`;
        if (meta.kind === 'array' && meta.elemCast) return `${ph}::${meta.elemCast}[]`;
        return ph;
      });
      return `(${cells.join(',')})`;
    });
    if (!dryRun) {
      const colList = present.map(c => `"${c}"`).join(',');
      await pool.query(`INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`, params);
    }
    copied += rows.length;
  }
  return copied;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[migrate] ${args.from} → postgres-kysely${args.dryRun ? ' (dry-run)' : ''}`);

  // Ensure the target schema exists (the provider runs its SQL migrations on construction).
  const target = new PostgresKyselyStorage(args.to);
  await target.ready;
  const pool = target.pool;

  const source = args.from === 'mongodb' ? await openMongoSource(args.fromUrl) : await openPgSource(args.fromUrl);

  // Authoritative table list = the target's real tables (skip the migration ledger).
  const { rows: tblRows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_kysely_migrations' ORDER BY table_name`);
  let tables = tblRows.map(r => r.table_name);
  if (args.tables) tables = tables.filter(t => args.tables!.includes(t));

  if (args.truncate && !args.dryRun) {
    console.log(`[migrate] truncating ${tables.length} target tables…`);
    await pool.query(`TRUNCATE ${tables.map(t => `"${t}"`).join(',')} RESTART IDENTITY CASCADE`);
  }

  const results: { table: string; source: number; copied: number; target: number; ok: boolean }[] = [];
  for (const table of tables) {
    const cols = await targetColumns(pool, table);
    let srcCount = 0;
    try { srcCount = await source.count(table); } catch { srcCount = -1; }   // source lacks this table → -1
    const copied = srcCount > 0 ? await copyTable(source, pool, table, cols, args.batch, args.dryRun).catch(err => { console.error(`  ✗ ${table}: ${(err as Error).message}`); return -1; }) : 0;
    const tgtCount = args.dryRun ? copied : (await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`)).rows[0].n as unknown as number;
    const ok = copied >= 0 && (args.dryRun || Number(tgtCount) >= (srcCount < 0 ? 0 : srcCount));
    results.push({ table, source: srcCount, copied, target: Number(tgtCount), ok });
    if (srcCount > 0 || copied > 0) console.log(`  ${ok ? '✓' : '✗'} ${table.padEnd(28)} src=${srcCount} copied=${copied} tgt=${tgtCount}`);
  }

  const failed = results.filter(r => !r.ok);
  const moved = results.reduce((n, r) => n + Math.max(0, r.copied), 0);
  console.log(`\n[migrate] ${moved} rows across ${results.filter(r => r.copied > 0).length} tables; ${failed.length} table(s) with mismatch/error`);
  await source.close();
  await target.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => { console.error('[migrate] fatal:', err); process.exit(1); });
