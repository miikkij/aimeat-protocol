/**
 * @file test/pg-kysely-memory.ts
 * @description Phase 5 integration test — exercises the memory domain of the Postgres+Kysely provider
 *   directly against a live Postgres, proving parity with the SQLite/Mongo backends BEFORE the auth
 *   domains exist (so it can't yet run through the HTTP E2E). Covers CRUD, version bump + trackable
 *   history, owner-scope reads/aggregates, tsvector search, bulk upsert, subtree/prefix delete, and
 *   archive/unarchive.
 * @usage cd aimeat && AIMEAT_TEST_PG_URL=postgresql://appuser:devpassword123@localhost:5432/aimeat_kysely \
 *          node --import tsx test/pg-kysely-memory.ts
 */
import { PostgresKyselyStorage } from '../src/storage/providers/postgres-kysely/index.js';
import type { MemoryRecord } from '../src/storage/interface.js';

const URL = process.env.AIMEAT_TEST_PG_URL ?? 'postgresql://appuser:devpassword123@localhost:5432/aimeat_kysely';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const now = () => new Date().toISOString();
const rec = (ownerGaii: string, key: string, value: unknown, extra: Partial<MemoryRecord> = {}): MemoryRecord =>
  ({ key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now(), updatedAt: now(), ...extra });

console.log('\n=== Postgres+Kysely memory-domain integration ===\n');
const s = new PostgresKyselyStorage(URL);
await s.ready;
await s.db.deleteFrom('Memory').execute();
await s.db.deleteFrom('MemoryVersion').execute();

const G = 'alice@n', A = 'claude#alice@n';

await test('setMemory (new) + getMemory round-trip', async () => {
  await s.setMemory(rec(G, 'note.1', { title: 'Hello', n: 1 }));
  const r = await s.getMemory(G, 'note.1');
  assert(!!r && (r.value as { title: string }).title === 'Hello', 'value round-trips');
  assert(r!.version === 1, `version 1 (got ${r!.version})`);
});

await test('setMemory (overwrite) bumps version', async () => {
  await s.setMemory(rec(G, 'note.1', { title: 'Hello2', n: 2 }));
  const r = await s.getMemory(G, 'note.1');
  assert(r!.version === 2, `version 2 (got ${r!.version})`);
  assert((r!.value as { n: number }).n === 2, 'new value');
});

await test('trackable key archives previous value to history', async () => {
  await s.setMemory(rec(G, 'doc.x', { v: 'a' }, { trackable: true }));
  await s.setMemory(rec(G, 'doc.x', { v: 'b' }, { trackable: true }));
  await s.setMemory(rec(G, 'doc.x', { v: 'c' }, { trackable: true }));
  const hist = await s.listMemoryHistory(G, 'doc.x');
  assert(hist.length === 2, `2 archived versions (got ${hist.length})`);
  assert(hist[0].version === 2 && (hist[0].value as { v: string }).v === 'b', 'newest history first');
  const cur = await s.getMemory(G, 'doc.x');
  assert(cur!.version === 3 && (cur!.value as { v: string }).v === 'c', 'latest is v3=c');
});

await test('owner-scope list + count + sumBytes across identities (IN query)', async () => {
  await s.setMemory(rec(A, 'agent.mem.1', { x: 1 }));
  await s.setMemory(rec(A, 'agent.mem.2', { x: 2 }));
  const list = await s.listMemoryForOwners([G, A]);
  assert(list.length >= 4, `owner-scope union (got ${list.length})`);
  const count = await s.countMemory([G, A]);
  assert(count >= 4, `count distinct keys (got ${count})`);
  const bytes = await s.sumMemoryBytesForOwners([G, A]);
  assert(bytes > 0, 'byte sum > 0');
});

await test('prefix list filters by key', async () => {
  const notes = await s.listMemory(G, { prefix: 'note.' });
  assert(notes.every(r => r.key.startsWith('note.')), 'all note.* ');
  assert(notes.some(r => r.key === 'note.1'), 'note.1 present');
});

await test('tsvector searchText ranks a hit', async () => {
  await s.setMemory(rec(G, 'searchable.1', { body: 'the quick brown fox jumps' }));
  const hits = await s.searchText('brown', { ownerGaiis: [G], limit: 10 });
  assert(hits.length >= 1, `found a hit (got ${hits.length})`);
  assert(hits[0].record.key === 'searchable.1', 'right record');
  assert(typeof hits[0].score === 'number', 'has a score');
});

await test('bulkSetMemory inserts many in one statement (getMemoryByKeys reads them)', async () => {
  const rows = Array.from({ length: 50 }, (_, i) => rec(G, `bulk.${i}`, { i, note: 'bulk' }));
  await s.bulkSetMemory(rows);
  const back = await s.getMemoryByKeys(G, rows.map(r => r.key));
  assert(back.length === 50, `read back 50 (got ${back.length})`);
});

await test('deleteMemorySubtree removes a family, not a sibling', async () => {
  await s.setMemory(rec(G, 'fam.rec1.latest', { a: 1 }));
  await s.setMemory(rec(G, 'fam.rec1.version.1', { a: 1 }));
  await s.setMemory(rec(G, 'fam.rec11.latest', { b: 1 }));   // sibling — must survive
  const removed = await s.deleteMemorySubtree(G, 'fam.rec1');
  assert(removed === 2, `removed 2 (got ${removed})`);
  assert((await s.getMemory(G, 'fam.rec11.latest')) !== null, 'sibling rec11 survives');
});

await test('archive + unarchive by root', async () => {
  await s.setMemory(rec(G, 'arch.1', { z: 1 }));
  const n = await s.archiveMemoryByKey('arch.', { archivedRoot: 'root-A', archivedBy: G, archivedAt: now(), match: 'prefix' });
  assert(n >= 1, `archived ${n}`);
  const listed = await s.listMemory(G, { prefix: 'arch.' });   // default excludes archived
  assert(listed.length === 0, 'archived excluded from default list');
  const restored = await s.unarchiveMemoryByRoot('root-A');
  assert(restored >= 1, `restored ${restored}`);
  const listed2 = await s.listMemory(G, { prefix: 'arch.' });
  assert(listed2.length === 1, 'restored row visible again');
});

await test('deleteMemory returns true then false', async () => {
  assert((await s.deleteMemory(G, 'note.1')) === true, 'deleted');
  assert((await s.deleteMemory(G, 'note.1')) === false, 'already gone');
});

await s.close();
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
