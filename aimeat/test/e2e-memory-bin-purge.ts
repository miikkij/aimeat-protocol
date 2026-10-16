/**
 * @file e2e-memory-bin-purge.ts
 * @description The end of the memory delete grace window, on the backend the runner started (run it
 *   on both): the sweep removes a binned record older than the window and nothing else, and a record
 *   past the window cannot be restored even before the sweep has removed it.
 *
 *   WHY THIS SUITE. sweepMemoryBin (services/memory-bin-sweep.ts) is the only caller of
 *   purgeDeletedMemory, the one timed call that deletes memory rows across every account, and the
 *   two providers implement it differently (SQLite compares an ISO string, PostgreSQL a TIMESTAMPTZ).
 *   No test called either, so a purge that matched nothing would leave every delete restorable for
 *   ever, and one that matched too much would remove live records for good, with every suite green
 *   (QA audit F05a-02). And restoreMemoryRecord compared no date, so "restorable for seven days" held
 *   only as long as the hourly timer had run.
 *
 *   HOW THE WINDOW IS CLOSED IN A TEST. The server's own sweep runs on a one-hour timer. The suite
 *   opens the server's database (test/helpers/server-db.ts), moves one tombstone eight days back
 *   with the provider's own query handle, and runs sweepMemoryBin against that storage with the
 *   default seven-day window: the same function and the same provider method the timer runs.
 * @structure
 *   - Setup: an owner with a live record, a record deleted now and a record deleted eight days ago
 *   - Before the sweep: the old record cannot be restored; the young one is still listed
 *   - The sweep: the old row is gone, the young one and the live one are not
 *   - After: the young one is restored whole
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=memory-bin-purge
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F05a-02).
 */

import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
import type { AimeatConfig } from '../src/config.js';
import { sweepMemoryBin } from '../src/services/memory-bin-sweep.js';
import { serverSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const PROVIDER = (process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const stamp = Date.now();
const owner = `mbp${stamp}`;
const ownerGhii = `${owner}@${NODE_ID}`;
const LIVE = 'binpurge.live';
const YOUNG = 'binpurge.young';
const OLD = 'binpurge.old';
const DAY = 86_400_000;
let token = '';
let storage: Storage | null = null;

/** Move one tombstone back in time, with the provider's own query handle. */
async function backdateTombstone(key: string, deletedAt: Date): Promise<number> {
    const db = (storage as unknown as { db: any }).db;
    if (PROVIDER === 'sqlite') {
        return db.prepare('UPDATE memory SET deletedAt = ? WHERE ownerGaii = ? AND key = ? AND deletedAt IS NOT NULL')
            .run(deletedAt.toISOString(), ownerGhii, key).changes as number;
    }
    const r = await db.updateTable('Memory').set({ deletedAt })
        .where('ownerGaii', '=', ownerGhii).where('key', '=', key).where('deletedAt', 'is not', null).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
}

async function binKeys(): Promise<string[]> {
    const r = await json('/v1/memory/deleted', { headers: auth(token) });
    assert(r.status === 200, `bin listing: ${r.status} ${JSON.stringify(r.body)}`);
    return (r.body.data.items as Array<{ key: string }>).map(i => i.key);
}

console.log(`\n=== AIMEAT: the memory bin purge (${PROVIDER}) ===\n`);

console.log('Setup');
await test('The server\'s database is reachable from this process', async () => {
    const sqlitePath = serverSqlitePath();
    const dbUrl = serverDbUrl();
    // An in-memory backend lives inside the server process; a second handle would open another,
    // empty database, and a test that passes by not running proves nothing.
    assert((PROVIDER === 'sqlite' && !!sqlitePath) || (PROVIDER === 'postgres-kysely' && !!dbUrl), `backend "${PROVIDER}" is not reachable from this process`);
    storage = await createStorage({ provider: PROVIDER, sqlitePath, dbUrl });
});

await test('An owner with three records: one stays live, two go to the bin, one of them eight days ago', async () => {
    token = (await registerOwner(BASE, owner)).token;
    for (const key of [LIVE, YOUNG, OLD]) {
        const w = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key, value: { note: key }, visibility: 'private' }) });
        assert(w.status === 200 || w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body)}`);
    }
    for (const key of [YOUNG, OLD]) {
        const d = await json(`/v1/memory/${key}`, { method: 'DELETE', headers: auth(token) });
        assert(d.status === 200 && d.body.data.grace_days === 7, `delete ${key} (the default seven-day window): ${d.status} ${JSON.stringify(d.body)}`);
    }
    const moved = await backdateTombstone(OLD, new Date(Date.now() - 8 * DAY));
    assert(moved === 1, `one tombstone moved back: ${moved}`);
});

console.log('\nBefore the sweep');
await test('A record past the window cannot be restored, even though the sweep has not removed it yet', async () => {
    const r = await json(`/v1/memory/${OLD}/restore`, { method: 'POST', headers: auth(token), body: '{}' });
    assert(r.status === 404 && r.body.error?.code === 'NOT_RESTORABLE', `restore past the window: ${r.status} ${JSON.stringify(r.body)}`);
    const read = await json(`/v1/memory/${OLD}`, { headers: auth(token) });
    assert(read.status === 404, `and it is not back: ${read.status}`);
});

console.log('\nThe sweep');
await test('The sweep removes the binned record older than the window, and only that one', async () => {
    const config = { memoryDeleteGraceDays: 7 } as AimeatConfig;
    const removed = await sweepMemoryBin(storage!, config);
    assert(removed >= 1, `the sweep removed something: ${removed}`);
    const bin = (await storage!.listDeletedMemory(ownerGhii)).map(r => r.key);
    assert(!bin.includes(OLD), `the old tombstone is gone from the table: ${JSON.stringify(bin)}`);
    assert(bin.includes(YOUNG), `the young tombstone is still in the bin: ${JSON.stringify(bin)}`);
    assert(await storage!.getMemory(ownerGhii, OLD) === null, 'the old row cannot be read either');
    const live = await json(`/v1/memory/${LIVE}`, { headers: auth(token) });
    assert(live.status === 200 && live.body.data.value?.note === LIVE, `the live record is untouched: ${live.status} ${JSON.stringify(live.body)}`);
    const keys = await binKeys();
    assert(keys.includes(YOUNG) && !keys.includes(OLD), `the owner's bin lists the young record only: ${JSON.stringify(keys)}`);
});

await test('A second sweep removes nothing of this owner\'s', async () => {
    await sweepMemoryBin(storage!, { memoryDeleteGraceDays: 7 } as AimeatConfig);
    const bin = (await storage!.listDeletedMemory(ownerGhii)).map(r => r.key);
    assert(bin.length === 1 && bin[0] === YOUNG, `only the young tombstone: ${JSON.stringify(bin)}`);
});

console.log('\nAfter');
await test('The record inside the window is restored whole', async () => {
    const r = await json(`/v1/memory/${YOUNG}/restore`, { method: 'POST', headers: auth(token), body: '{}' });
    assert(r.status === 200, `restore: ${r.status} ${JSON.stringify(r.body)}`);
    const read = await json(`/v1/memory/${YOUNG}`, { headers: auth(token) });
    assert(read.status === 200 && read.body.data.value?.note === YOUNG, `it is back with its value: ${read.status} ${JSON.stringify(read.body)}`);
    assert(!(await binKeys()).includes(YOUNG), 'and out of the bin');
});

try { await (storage as Storage | null)?.close?.(); } catch { /* the process is going away regardless */ }
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
