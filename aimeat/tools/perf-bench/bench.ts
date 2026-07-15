/**
 * @file tools/perf-bench/bench.ts
 * @description Structural performance harness. Boots a real Storage backend, seeds a configurable
 *   dataset (owner + N agents + K owner memories + a workspace organism of R records each with V
 *   published versions), then runs the platform's hot operation CHAINS — not single ops — and reports,
 *   per chain, the DB query COUNT + wall time, at several data/agent scales. It is meant to answer
 *   "how does operation X scale with data and agent count, and how many round-trips does it really do",
 *   so structural fixes can target whole chains instead of one op at a time. Runs on localhost against
 *   SQLite (default) or MongoDB — no HTTP, no prod — so we can iterate fast.
 * @usage
 *   cd aimeat && pnpm perf:bench                 # SQLite in-memory, default scales
 *   AIMEAT_BENCH_DB=mongodb AIMEAT_BENCH_URL=mongodb://localhost:27017/aimeat_bench pnpm perf:bench
 *   AIMEAT_BENCH_SCALES=agents=10,memories=2000,records=200,versions=3 pnpm perf:bench
 * @version-history
 *   v1.0.0 — 2026-07-15 — Initial harness (write/read/search/usage/publish/delete chains, scaled).
 */
process.env.AIMEAT_PERF_TRACE = '1';

import type { Storage, MemoryRecord, AgentRecord } from '../../src/storage/interface.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import { traceOperation, formatTrace, instrumentStorage } from '../../src/services/perf-trace.js';
import { listOwnerScopeMemory, listOwnerScopeMemoryMeta, getOwnerScopeMemory } from '../../src/services/owner-memory.js';
import { getOwnerUsageSummary } from '../../src/services/usage-summary.js';
import { checkMemoryQuota } from '../../src/services/quota.js';
import { validateMemoryWrite } from '../../src/services/schema-validator.js';
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

async function bench(label: string, fn: () => Promise<unknown>): Promise<void> {
  const { store } = await traceOperation(fn);
  console.log(`  ${label.padEnd(40)} ${formatTrace(store)}`);
}

async function runScale(sc: Scale): Promise<void> {
  console.log(`\n════ scale: ${sc.agents} agents · ${sc.memories} memories · ${sc.records} records×${sc.versions} versions ════`);
  const storage = instrumentStorage(
    await createStorage({ provider: (process.env.AIMEAT_BENCH_DB as 'sqlite' | 'mongodb') ?? 'memory', sqlitePath: ':memory:', dbUrl: process.env.AIMEAT_BENCH_URL }),
    true,
  );
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
  // (single deleteMemory per key) — this is the delete cost the harness exposes.
  await bench(`delete 1 record family (${sc.versions + 1} keys, per-key)`, async () => {
    const base = `${ORG === '' ? '' : ''}organism.${ORG}.w.${WS}.crm.contacts.rec0`;
    for (let v = 1; v <= sc.versions; v++) await storage.deleteMemory(GHII, `${base}.version.${v}`);
    await storage.deleteMemory(GHII, `${base}.latest`);
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
