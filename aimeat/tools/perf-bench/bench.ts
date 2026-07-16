/**
 * @file tools/perf-bench/bench.ts
 * @description Structural performance harness. Boots a real Storage backend, seeds a configurable
 *   dataset (owner + N agents + K owner memories + a workspace organism of R records each with V
 *   published versions), then runs the platform's hot operation CHAINS — not single ops — and reports,
 *   per chain, the DB query COUNT + wall time, at several data/agent scales. It is meant to answer
 *   "how does operation X scale with data and agent count, and how many round-trips does it really do",
 *   so structural fixes can target whole chains instead of one op at a time. Runs on localhost against
 *   SQLite (default) or PostgreSQL+Kysely — no HTTP, no prod — so we can iterate fast.
 * @usage
 *   cd aimeat && pnpm perf:bench                 # SQLite in-memory, default scales
 *   AIMEAT_BENCH_DB=postgres-kysely AIMEAT_BENCH_URL=postgresql://localhost:5432/aimeat_bench pnpm perf:bench
 *   AIMEAT_BENCH_SCALES=agents=10,memories=2000,records=200,versions=3 pnpm perf:bench
 * @version-history
 *   v1.0.0 — 2026-07-15 — Initial harness (write/read/search/usage/publish/delete chains, scaled).
 *   v1.1.0 — 2026-07-15 — Reset the persistent backend (Mongo/Postgres) between scales — SQLite uses a
 *     fresh :memory: db per scale, but a persistent db carried scale-1's seed into scale-2 and the owner
 *     re-insert hit a unique-constraint (bench only completed scale-1). Clears the bench collections
 *     (keeps indexes → realistic timings) before each scale's seed.
 *   v1.2.0 — 2026-07-15 — Add the Phase-1 bulk-write comparison chains (import N keys OLD per-item vs NEW
 *     MemoryDbService.writeMany) + the subtree-delete primitive, to quantify the round-trip reduction.
 */
process.env.AIMEAT_PERF_TRACE = '1';

import type { Storage, MemoryRecord, AgentRecord } from '../../src/storage/interface.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import { traceOperation, formatTrace, instrumentStorage } from '../../src/services/perf-trace.js';
import { listOwnerScopeMemory, listOwnerScopeMemoryMeta, getOwnerScopeMemory } from '../../src/services/owner-memory.js';
import { getOwnerUsageSummary, invalidateOwnerUsage } from '../../src/services/usage-summary.js';
import { checkMemoryQuota } from '../../src/services/quota.js';
import { validateMemoryWrite } from '../../src/services/schema-validator.js';
import { createMemoryDbService, createHomeDashboardService } from '../../src/services/db/index.js';
import { createOrganismHelpers } from '../../src/routes/organisms/shared.js';
import { loadConfig } from '../../src/config.js';

const NODE = 'bench-node';
const OWNER = 'benchowner';
const GHII = `${OWNER}@${NODE}`;
const ORG = 'org-bench-0001';
const WS = 'ws-bench';

interface Scale { agents: number; memories: number; records: number; versions: number; }

function parseScales(): Scale[] {
  const raw = process.env.AIMEAT_BENCH_SCALES;
  if (raw) {
    const s: Record<string, number> = {};
    for (const kv of raw.split(',')) { const [k, v] = kv.split('='); s[k.trim()] = parseInt(v, 10); }
    return [{ agents: s.agents ?? 10, memories: s.memories ?? 1000, records: s.records ?? 100, versions: s.versions ?? 2 }];
  }
  // Default: three scales to expose growth (small → prod-like → large).
  return [
    { agents: 5, memories: 500, records: 50, versions: 2 },
    { agents: 50, memories: 5000, records: 200, versions: 3 },
    { agents: 100, memories: 12000, records: 500, versions: 3 },
  ];
}

function minimalAgent(i: number): AgentRecord {
  const now = new Date().toISOString();
  return {
    name: `agent${i}`, owner: OWNER, gaii: `agent${i}#${OWNER}@${NODE}`,
    displayName: `Agent ${i}`, description: '', capabilities: [], publicKey: `pk${i}`,
    trustScore: 50, morselBalance: 0, allowedOrigins: [], defaultScopes: ['*'], federate: false,
    mode: 'interactive', maxConcurrentTasks: 1, tags: [], createdAt: now, lastSeen: now,
  } as AgentRecord;
}

function mem(ownerGaii: string, key: string, value: unknown): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

async function seed(storage: Storage, sc: Scale): Promise<void> {
  await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() });
  for (let i = 0; i < sc.agents; i++) await storage.createAgent(minimalAgent(i));
  // Owner GHII memories (spread a few under agents too, to make owner-scope realistic).
  for (let i = 0; i < sc.memories; i++) {
    const owner = i % 7 === 0 && sc.agents > 0 ? `agent${i % sc.agents}#${OWNER}@${NODE}` : GHII;
    await storage.setMemory(mem(owner, `data.item.${i}`, { name: `Item ${i}`, note: 'seeded row for the perf bench', n: i }));
  }
  // Workspace records with published versions (the CADENCE shape: .latest + .version.1..V).
  const wsRoot = `organism.${ORG}.w.${WS}`;
  for (let r = 0; r < sc.records; r++) {
    const base = `${wsRoot}.crm.contacts.rec${r}`;
    for (let v = 1; v <= sc.versions; v++) await storage.setMemory(mem(GHII, `${base}.version.${v}`, { etunimi: `C${r}`, v }));
    await storage.setMemory(mem(GHII, `${base}.latest`, { etunimi: `C${r}`, sukunimi: `L${r}` }));
  }
}

const config = { ...loadConfig(), nodeId: NODE } as ReturnType<typeof loadConfig>;

/** Empty the bench's collections on a PERSISTENT backend before a scale seeds, so a prior scale's (or
 *  a prior run's) rows don't collide on the owner unique-constraint or pollute owner-scoped timings.
 *  Deletes rows only (indexes are kept, so timings stay realistic). No-op for SQLite (:memory: is
 *  already fresh each scale). Best-effort — a clear failure is warned, never fatal. */
async function resetPersistentData(_storage: Storage): Promise<void> {
  const provider = process.env.AIMEAT_BENCH_DB;
  if (provider !== 'postgres-kysely') return;
  const dbUrl = process.env.AIMEAT_BENCH_URL;
  if (!dbUrl) return;
  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      await client.query(`DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_kysely_migrations') LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;`);
    } finally {
      await client.end();
    }
  } catch (err) {
    console.warn(`  (reset skipped: ${(err as { message?: string })?.message ?? err})`);
  }
}

async function bench(label: string, fn: () => Promise<unknown>): Promise<void> {
  const { store } = await traceOperation(fn);
  console.log(`  ${label.padEnd(40)} ${formatTrace(store)}`);
}

async function runScale(sc: Scale): Promise<void> {
  console.log(`\n════ scale: ${sc.agents} agents · ${sc.memories} memories · ${sc.records} records×${sc.versions} versions ════`);
  const storage = instrumentStorage(
    await createStorage({ provider: (process.env.AIMEAT_BENCH_DB as 'sqlite' | 'postgres-kysely') ?? 'memory', sqlitePath: ':memory:', dbUrl: process.env.AIMEAT_BENCH_URL }),
    true,
  );
  await resetPersistentData(storage);
  const t0 = process.hrtime.bigint();
  await seed(storage, sc);
  console.log(`  (seeded in ${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(1)}s)`);

  // CHAIN: a single memory write's storage sequence (what crud.ts POST does, minus HTTP/auth).
  await bench('WRITE chain (1 new key)', async () => {
    const key = `data.item.new`;
    await storage.getMemory(GHII, key);
    await storage.countMemory([GHII]);
    const valueSize = Buffer.byteLength(JSON.stringify({ n: 1 }), 'utf8');
    await checkMemoryQuota(config, storage, GHII, valueSize, 0);
    await validateMemoryWrite(key, { n: 1 }, storage);
    await storage.setMemory(mem(GHII, key, { n: 1 }));
  });
  // CHAIN: owner-scope list + meta + single-key read + search + usage.
  await bench('owner-scope LIST (no prefix)', () => listOwnerScopeMemory(storage, NODE, OWNER));
  await bench('owner-scope META (?include=meta)', () => listOwnerScopeMemoryMeta(storage, NODE, OWNER));
  await bench('owner-scope single-key (miss)', () => getOwnerScopeMemory(storage, NODE, OWNER, 'data.item.does-not-exist'));
  await bench('search q=seeded', () => storage.searchText('seeded', { ownerGaiis: [GHII], limit: 50 }));
  await bench('owner/usage summary', () => getOwnerUsageSummary(config, storage, OWNER));
  // CHAIN: delete ONE workspace record's whole family (.latest + .version.1..V) the way it happens today
  // (single deleteMemory per key) vs the Phase-1 subtree primitive (one statement).
  await bench(`delete 1 record family (${sc.versions + 1} keys, per-key)`, async () => {
    const base = `organism.${ORG}.w.${WS}.crm.contacts.rec0`;
    for (let v = 1; v <= sc.versions; v++) await storage.deleteMemory(GHII, `${base}.version.${v}`);
    await storage.deleteMemory(GHII, `${base}.latest`);
  });
  await bench(`delete 1 record family (subtree primitive)`, async () => {
    const base = `organism.${ORG}.w.${WS}.crm.contacts.rec1`;
    await storage.deleteMemorySubtree!(GHII, base);
  });

  // CHAIN: import IMPORT_N brand-new keys. OLD = per-item pipeline (getMemory + countMemory + quota +
  // schema + setMemory) — what POST /v1/memory/import does today, N× the single-write chain. NEW =
  // MemoryDbService.writeMany: batched existing-lookup (1) + byte-sum (1) + key-count (1) + N schema
  // validations (cached) + ONE bulkSetMemory. Watch the q count: OLD grows ~6×N, NEW stays ~3 + N-writes.
  const IMPORT_N = 100;
  const memoryDb = createMemoryDbService(storage, config);
  await bench(`import ${IMPORT_N} keys — OLD per-item`, async () => {
    for (let i = 0; i < IMPORT_N; i++) {
      const key = `bench.import.old.${i}`;
      await storage.getMemory(GHII, key);
      await storage.countMemory([GHII]);
      const valueSize = Buffer.byteLength(JSON.stringify({ n: i }), 'utf8');
      await checkMemoryQuota(config, storage, GHII, valueSize, 0);
      await validateMemoryWrite(key, { n: i }, storage);
      await storage.setMemory(mem(GHII, key, { n: i }));
    }
  });
  await bench(`import ${IMPORT_N} keys — NEW writeMany`, async () => {
    const entries = Array.from({ length: IMPORT_N }, (_, i) => ({ key: `bench.import.new.${i}`, value: { n: i } }));
    await memoryDb.writeMany(GHII, entries, {
      quota: { maxKeysPerOwner: 1_000_000, maxValueSizeBytes: 1024 * 1024, totalQuotaBytes: 1024 ** 3 },
      validate: (key, value) => validateMemoryWrite(key, value, storage).then(r => ({ valid: r.valid })),
    });
  });

  // ── CADENCE workspace ops (Phase 2): the actual publish + delete code paths, old-per-record vs new
  // batched. Uses the REAL helpers (createOrganismHelpers → publishDraft / publishDraftsBatch), not an
  // approximation, so the numbers reflect production behaviour. K record families in a fresh namespace. ──
  const H = createOrganismHelpers(config, storage);
  const K = 50;
  const wsRoot = `organism.${ORG}.w.${WS}`;
  const seedDrafts = async (ns: string, tag: string): Promise<void> => {
    for (let i = 0; i < K; i++) await storage.setMemory(mem(GHII, `${wsRoot}.${ns}.${tag}${i}.draft`, { id: `${tag}${i}`, title: `Task ${i}`, body: 'cadence record draft' }));
  };
  // PUBLISH: OLD = one publishDraft per record (per-record scan + manifest read + 2 writes + draft delete);
  // NEW = one publishDraftsBatch (ONE namespace scan + ONE manifest read + ONE bulkSetMemory + ONE bulkDelete).
  await seedDrafts('crm.pubold', 'r');
  await bench(`CADENCE publish ${K} records — OLD per-record`, async () => {
    for (let i = 0; i < K; i++) await H.publishDraft(ORG, WS, 'crm.pubold', `r${i}`, GHII);
  });
  await seedDrafts('crm.pubnew', 'r');
  await bench(`CADENCE publish ${K} records — NEW batch`, async () => {
    await H.publishDraftsBatch(ORG, WS, 'crm.pubnew', Array.from({ length: K }, (_, i) => `r${i}`), GHII);
  });
  // DELETE the K record families just published (.latest + .version.1 each). Fair comparison: BOTH paths
  // scan each record's family (what object_delete does per record) — the difference is OLD fires a
  // deleteMemory per key (+ in reality one MCP/HTTP round-trip per record), NEW collects every ref and
  // fires ONE bulkDeleteMemory in ONE request.
  await bench(`CADENCE delete ${K} record families — OLD per-record (scan+per-key)`, async () => {
    for (let i = 0; i < K; i++) {
      const base = `${wsRoot}.crm.pubold.r${i}`;
      const { items } = await storage.listAllMemory({ prefix: base, limit: 100 });
      for (const r of items) if (r.key === base || r.key.startsWith(`${base}.`)) await storage.deleteMemory(r.ownerGaii, r.key);
    }
  });
  await bench(`CADENCE delete ${K} record families — NEW batch (1 keys-scan+bulk)`, async () => {
    // ONE value-free namespace key-scan (no values) + filter + ONE bulkDeleteMemory — the endpoint's path.
    const nsKeys = await storage.listMemoryKeysByPrefix!(`${wsRoot}.crm.pubnew.`);
    const refs: { ownerGaii: string; key: string }[] = [];
    for (let i = 0; i < K; i++) {
      const base = `${wsRoot}.crm.pubnew.r${i}`;
      for (const r of nsKeys) if (r.key === base || r.key.startsWith(`${base}.`)) refs.push({ ownerGaii: r.ownerGaii, key: r.key });
    }
    await storage.bulkDeleteMemory!(refs);
  });

  // ── HOME dashboard (Phase 3): the profile Home load. OLD = the stats-bar + cards fan-out, which
  // re-resolves the owner's agent list once per widget (usage summary, stats-bar agents, Agents card,
  // work inbox) + a separate balance read. NEW = HomeDashboardService.load — ONE identity resolution
  // (IdentityMap) shared across usage + agent overview + work. Watch getAgentsByOwner drop 4→1. Usage
  // cache is invalidated before each variant so both pay the same cold compute (a fair comparison). ──
  const home = createHomeDashboardService(config, storage);
  await bench('home dashboard — OLD fan-out (agents re-read per widget)', async () => {
    invalidateOwnerUsage(OWNER);
    await getOwnerUsageSummary(config, storage, OWNER);   // UsageCard + most stat counts
    await storage.getAgentsByOwner(OWNER);                // stats-bar agents + chatSessions
    await storage.getAgentsByOwner(OWNER);                // Agents card list
    const ags = await storage.getAgentsByOwner(OWNER);    // work inbox owner fan-out
    for (const a of ags) await storage.listWorkByProvider(a.gaii);
    await storage.getGHIIByOwner(OWNER);                  // stats-bar morsel balance
  });
  await bench('home dashboard — NEW composite (one identity resolution)', async () => {
    invalidateOwnerUsage(OWNER);
    await home.load(OWNER);
  });

  if ('close' in storage && typeof (storage as { close?: () => Promise<void> }).close === 'function') {
    await (storage as { close: () => Promise<void> }).close();
  }
}

for (const sc of parseScales()) {
  await runScale(sc);
}
console.log('\n(q = storage calls, dbms = summed call time, wall = chain wall time; watch q GROW with agents/records)');
process.exit(0);
