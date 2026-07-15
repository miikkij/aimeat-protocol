/**
 * @file tools/perf-bench/bench-backends.ts
 * @description Phase 4 BACKEND COMPARISON — runs identical memory-domain operation CHAINS through the
 *   SAME {@link ../../src/storage/adapter/memory-adapter.js MemoryStorageAdapter} contract over each
 *   candidate backend (SQLite, MongoDB-Prisma, Postgres-Prisma, Postgres-Kysely) and reports per-chain
 *   wall time at several scales, so the backend decision (dev-organism doc-s4hgvp5) is made on data, not
 *   assertion. Every backend is seeded the same way (adapter.bulkUpsert) and exercised through the same
 *   calls, so the numbers are like-for-like; the only variable is the backend + query layer.
 * @usage
 *   cd aimeat && pnpm perf:bench:backends
 *     AIMEAT_BENCH_MONGO_URL=... AIMEAT_BENCH_PG_URL=postgresql://user:pw@localhost:5432/db
 *     AIMEAT_BENCH_BACKENDS=sqlite,mongodb,pg-kysely     # subset; default = all reachable
 *     AIMEAT_BENCH_SCALES=agents=100,memories=12000,records=500,versions=3
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 4: SQLite / Mongo-Prisma / Postgres-Prisma / Postgres-Kysely comparison.
 */
import type { MemoryRecord } from '../../src/storage/interface.js';
import type { MemoryStorageAdapter } from '../../src/storage/adapter/memory-adapter.js';
import { LegacyMemoryAdapter } from '../../src/storage/adapter/legacy-memory-adapter.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import { KyselyPgAdapter } from './kysely-pg-adapter.js';

const NODE = 'bench-node';
const OWNER = 'benchowner';
const GHII = `${OWNER}@${NODE}`;

interface Scale { agents: number; memories: number; records: number; versions: number; }

function parseScales(): Scale[] {
  const raw = process.env.AIMEAT_BENCH_SCALES;
  if (raw) {
    const s: Record<string, number> = {};
    for (const kv of raw.split(',')) { const [k, v] = kv.split('='); s[k.trim()] = parseInt(v, 10); }
    return [{ agents: s.agents ?? 10, memories: s.memories ?? 1000, records: s.records ?? 100, versions: s.versions ?? 2 }];
  }
  return [
    { agents: 5, memories: 500, records: 50, versions: 2 },
    { agents: 50, memories: 5000, records: 200, versions: 3 },
    { agents: 100, memories: 12000, records: 500, versions: 3 },
  ];
}

const now = () => new Date().toISOString();
function mem(ownerGaii: string, key: string, value: unknown): MemoryRecord {
  return { key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now(), updatedAt: now() };
}
function identities(agents: number): string[] {
  return [GHII, ...Array.from({ length: agents }, (_, i) => `agent${i}#${OWNER}@${NODE}`)];
}

/** All seed rows for a scale, so a backend seeds in one bulkUpsert batch. */
function seedRows(sc: Scale): MemoryRecord[] {
  const rows: MemoryRecord[] = [];
  for (let i = 0; i < sc.memories; i++) {
    const owner = i % 7 === 0 && sc.agents > 0 ? `agent${i % sc.agents}#${OWNER}@${NODE}` : GHII;
    rows.push(mem(owner, `data.item.${i}`, { name: `Item ${i}`, note: 'seeded row for the perf bench', n: i }));
  }
  const wsRoot = `organism.org-bench.w.ws-bench`;
  for (let r = 0; r < sc.records; r++) {
    const base = `${wsRoot}.crm.contacts.rec${r}`;
    for (let v = 1; v <= sc.versions; v++) rows.push(mem(GHII, `${base}.version.${v}`, { etunimi: `C${r}`, v }));
    rows.push(mem(GHII, `${base}.latest`, { etunimi: `C${r}`, sukunimi: `L${r}` }));
  }
  return rows;
}

async function ms(fn: () => Promise<unknown>): Promise<number> {
  const t0 = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

const CHAINS = ['seed(bulk)', 'ownerLIST', 'ownerMETA', 'point(miss)', 'search', 'count', 'sumBytes', 'import500', 'delFamily', 'bulkDel200'] as const;
type ChainName = typeof CHAINS[number];

async function runChains(adapter: MemoryStorageAdapter, sc: Scale): Promise<Record<ChainName, number>> {
  const ids = identities(sc.agents);
  const out = {} as Record<ChainName, number>;

  out['seed(bulk)'] = await ms(() => adapter.bulkUpsert(seedRows(sc)));
  out['ownerLIST'] = await ms(() => adapter.findByOwners(ids));
  out['ownerMETA'] = await ms(() => adapter.findMetaByOwners(ids));
  out['point(miss)'] = await ms(() => adapter.getByOwners(ids, 'data.item.does-not-exist'));
  out['search'] = await ms(() => adapter.textSearch('seeded', { ownerGaiis: [GHII], limit: 50 }));
  out['count'] = await ms(() => adapter.countByOwners(ids));
  out['sumBytes'] = await ms(() => adapter.sumBytesByOwners(ids));
  // import 500 brand-new keys (the bulk write path)
  const importRows = Array.from({ length: 500 }, (_, i) => mem(GHII, `bench.import.${i}`, { n: i, note: 'imported' }));
  out['import500'] = await ms(() => adapter.bulkUpsert(importRows));
  // delete one record's whole family (.latest + .version.1..V)
  out['delFamily'] = await ms(() => adapter.deleteSubtree(GHII, `organism.org-bench.w.ws-bench.crm.contacts.rec0`));
  // bulk delete 200 imported rows by ref
  const refs = Array.from({ length: 200 }, (_, i) => ({ ownerGaii: GHII, key: `bench.import.${i}` }));
  out['bulkDel200'] = await ms(() => adapter.bulkDelete(refs));
  return out;
}

interface Backend { name: string; make: () => Promise<{ adapter: MemoryStorageAdapter; reset: () => Promise<void>; close: () => Promise<void> }>; }

function selectedBackends(): string[] {
  const raw = process.env.AIMEAT_BENCH_BACKENDS;
  return raw ? raw.split(',').map(s => s.trim()) : ['sqlite', 'mongodb', 'pg-prisma', 'pg-kysely'];
}

const MONGO_URL = process.env.AIMEAT_BENCH_MONGO_URL;
const PG_URL = process.env.AIMEAT_BENCH_PG_URL ?? 'postgresql://appuser:devpassword123@localhost:5432/appdb';

const BACKENDS: Record<string, Backend> = {
  sqlite: {
    name: 'SQLite',
    make: async () => {
      const s = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' });
      return { adapter: new LegacyMemoryAdapter(s), reset: async () => {}, close: async () => { (s as any).close?.(); } };
    },
  },
  mongodb: {
    name: 'MongoDB (Prisma)',
    make: async () => {
      if (!MONGO_URL) throw new Error('AIMEAT_BENCH_MONGO_URL not set');
      const s = await createStorage({ provider: 'mongodb', dbUrl: MONGO_URL });
      const wipe = async () => { const p = (s as any).prisma; if (p?.$runCommandRaw) for (const t of ['Memory', 'MemoryVersion']) await p.$runCommandRaw({ delete: t, deletes: [{ q: {}, limit: 0 }] }).catch(() => {}); };
      return { adapter: new LegacyMemoryAdapter(s), reset: wipe, close: async () => { (s as any).close?.(); } };
    },
  },
  'pg-prisma': {
    name: 'Postgres (Prisma)',
    make: async () => {
      const s = await createStorage({ provider: 'postgresql', dbUrl: PG_URL });
      const wipe = async () => { const p = (s as any).prisma; if (p?.$executeRawUnsafe) await p.$executeRawUnsafe('TRUNCATE "Memory","MemoryVersion" RESTART IDENTITY CASCADE').catch(() => {}); };
      return { adapter: new LegacyMemoryAdapter(s), reset: wipe, close: async () => { (s as any).close?.(); } };
    },
  },
  'pg-kysely': {
    name: 'Postgres (Kysely)',
    make: async () => {
      const a = new KyselyPgAdapter(PG_URL);
      await a.ensureSchema();
      return { adapter: a, reset: () => a.truncate(), close: () => a.close() };
    },
  },
};

async function main(): Promise<void> {
  const wanted = selectedBackends();
  for (const sc of parseScales()) {
    console.log(`\n════ scale: ${sc.agents} agents · ${sc.memories} memories · ${sc.records} records×${sc.versions} versions ════`);
    const results: Record<string, Record<ChainName, number> | string> = {};
    for (const key of wanted) {
      const be = BACKENDS[key];
      if (!be) { console.log(`  (unknown backend ${key})`); continue; }
      try {
        const { adapter, reset, close } = await be.make();
        await reset();
        results[be.name] = await runChains(adapter, sc);
        await close();
      } catch (err) {
        results[be.name] = `SKIP (${(err as Error).message.split('\n')[0]})`;
      }
    }
    // Table: rows = chains, cols = backends.
    const names = wanted.map(k => BACKENDS[k]?.name).filter(Boolean) as string[];
    const pad = (s: string, n: number) => s.padEnd(n);
    console.log('  ' + pad('chain', 14) + names.map(n => pad(n, 20)).join(''));
    for (const chain of CHAINS) {
      const cells = names.map(n => {
        const r = results[n];
        return pad(typeof r === 'string' ? '—' : `${r[chain].toFixed(1)}ms`, 20);
      });
      console.log('  ' + pad(chain, 14) + cells.join(''));
    }
    for (const n of names) if (typeof results[n] === 'string') console.log(`  ${n}: ${results[n]}`);
  }
  process.exit(0);
}

await main();
