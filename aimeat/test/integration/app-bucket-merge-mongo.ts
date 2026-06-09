/**
 * @file app-bucket-merge-mongo.ts
 * @description Live-MongoDB integration check for MongoStorage.mergeForkedAppBuckets().
 *   The SQLite unit test (test/unit/app-owner-normalization.test.ts) covers the
 *   algorithm; this proves the Prisma data path specifically — updating the
 *   compound-unique (ownerGaii, versionNumber) on `app` and the (ownerGaii, key)
 *   on `storageFile` does not violate Mongo's unique indexes when re-keying a
 *   forked bucket into the canonical one. Needs a running Mongo; NOT part of the
 *   auto-run vitest set (no `.test.ts` suffix) so CI without Mongo is unaffected.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.mongodb --import tsx \
 *     test/integration/app-bucket-merge-mongo.ts
 * @version-history
 *   v1.0.0 — 2026-06-09 — initial: fork merge renumber + screenshot/download fold
 */
import { MongoStorage } from '../../src/storage/providers/mongodb/index.js';
import type { AppRecord, GHIIRecord } from '../../src/storage/interface.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error('  ❌ ' + msg); }
  else { passed++; console.log('  ✅ ' + msg); }
}

const DB_URL = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';
if (!DB_URL) {
  console.error('DATABASE_URL not set — run with --env-file=.env.test.mongodb');
  process.exit(1);
}

const NODE = 'node-x';
const STAMP = Date.now() % 1000000;
const OWNER = `mergeowner${STAMP}`;          // unique so we don't collide with other test data
const CANON = `${OWNER}@${NODE}`;
const FORK = `${OWNER}@${NODE}@${NODE}`;
const FN = `merge-demo-${STAMP}.html`;

function ghiiRow(): GHIIRecord {
  const now = new Date().toISOString();
  return { username: OWNER, nodeId: NODE, ghii: CANON, displayName: OWNER, verificationLevel: 0, ownerName: OWNER, createdAt: now, updatedAt: now, totpEnabled: false };
}
function appRowAt(ownerGaii: string, version: number, content: string, createdAt: string): AppRecord {
  return { ownerGaii, ownerName: OWNER, filename: FN, versionNumber: version,
    manifest: { name: FN, description: '', version: '1.0.0', category: 'utility', tags: [], authorDisplay: OWNER, usesCortex: [] },
    mimeType: 'text/html', size: content.length, data: Buffer.from(content), createdAt };
}

console.log('\n=== Forked app bucket merge (MongoDB integration) ===\n');

const storage = new MongoStorage(DB_URL);
await storage.ready;

try {
  await storage.createGHII(ghiiRow());
  await storage.createApp(appRowAt(CANON, 1, 'dash-v1', '2026-06-01T00:00:00.000Z'));
  await storage.createApp(appRowAt(CANON, 2, 'dash-v2', '2026-06-02T00:00:00.000Z'));
  await storage.createApp(appRowAt(FORK, 1, 'mcp-v1', '2026-06-03T00:00:00.000Z'));
  await storage.createApp(appRowAt(FORK, 2, 'mcp-v2', '2026-06-04T00:00:00.000Z'));
  await storage.createApp(appRowAt(FORK, 3, 'mcp-v3-newest', '2026-06-05T00:00:00.000Z'));
  await storage.createStorageFile({ key: `apps/screenshots/${FN}`, ownerGaii: FORK, visibility: 'public', mimeType: 'image/png', size: 3, data: Buffer.from('img'), createdAt: '2026-06-05T00:00:00.000Z' });
  for (let i = 0; i < 4; i++) await storage.incrementAppDownloads(CANON, FN);
  for (let i = 0; i < 7; i++) await storage.incrementAppDownloads(FORK, FN);

  const merged = await storage.mergeForkedAppBuckets();
  assert(merged >= 3, `re-keys at least this owner's 3 forked rows (global count ${merged})`);

  const allVersions = await storage.listAppVersions(CANON, FN);
  assert(allVersions.length === 5, `canonical bucket holds all 5 versions (got ${allVersions.length})`);
  const vNums = allVersions.map(v => v.versionNumber).sort((a, b) => a - b);
  assert(JSON.stringify(vNums) === JSON.stringify([1, 2, 3, 4, 5]), `versions renumbered 1..5 (got ${vNums})`);

  const latest = await storage.getApp(CANON, FN);
  // Mongo returns `data` as a Uint8Array (not a Node Buffer), so normalise before comparing.
  const latestText = latest ? Buffer.from(latest.data).toString() : '';
  assert(latestText === 'mcp-v3-newest', `newest forked content becomes latest (got "${latestText}")`);
  assert(latest?.versionNumber === 5, `newest content at version 5 (got ${latest?.versionNumber})`);

  const forkLeft = await storage.listAppVersions(FORK, FN);
  assert(forkLeft.length === 0, `forked bucket emptied (got ${forkLeft.length})`);

  assert(!!(await storage.getStorageFile(CANON, `apps/screenshots/${FN}`)), 'screenshot moved to canonical bucket');
  assert(!(await storage.getStorageFile(FORK, `apps/screenshots/${FN}`)), 'no screenshot left in forked bucket');

  assert((await storage.getAppDownloads(CANON, FN)) === 11, 'download counters folded (4 + 7 = 11)');
  assert((await storage.getAppDownloads(FORK, FN)) === 0, 'forked download counter removed');

  // Idempotency for this owner: nothing left to move ⇒ canonical bucket unchanged.
  await storage.mergeForkedAppBuckets();
  assert((await storage.listAppVersions(CANON, FN)).length === 5, 'idempotent — canonical bucket still 5 versions after a second merge');
} finally {
  // Clean up the rows this check created.
  await storage.deleteApp(CANON, FN).catch(() => {});
  await storage.deleteApp(FORK, FN).catch(() => {});
  await storage.deleteStorageFile(CANON, `apps/screenshots/${FN}`).catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
