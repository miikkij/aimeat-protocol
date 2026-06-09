/**
 * @file app-owner-normalization.test.ts
 * @description Server-less unit tests for the two SqliteStorage app-owner hygiene
 *   migrations. (1) normalizeAppOwnerNames(): legacy app rows whose ownerName was
 *   stored as a full GHII (`owner@node`) are rewritten to the bare owner name, so
 *   the catalog "my apps" filter and the by-owner-name delete sweep (both keyed on
 *   the bare name) find them again. (2) mergeForkedAppBuckets(): when the same
 *   owner published an app under different identity forms (dashboard bare name vs
 *   MCP/PAT full GHII), the ownerGaii storage bucket forked into two records with
 *   independent version counters. The merge folds every stray bucket into the
 *   owner's canonical GHII bucket — renumbering versions after the canonical max,
 *   moving the screenshot, and summing download counters.
 * @usage cd aimeat && pnpm exec tsx test/unit/app-owner-normalization.test.ts
 * @version-history
 *   v1.0.0 — 2026-06-05 — initial: normalize, resolvability, idempotency
 *   v1.1.0 — 2026-06-09 — add mergeForkedAppBuckets() coverage: fork merge with
 *     renumbering, pure re-key (empty canonical), screenshot/download folding,
 *     unknown-owner skip, idempotency.
 */
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AppRecord, GHIIRecord } from '../../src/storage/interface.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error('  ❌ ' + msg); }
  else { passed++; console.log('  ✅ ' + msg); }
}

function appRow(ownerGaii: string, ownerName: string, filename: string, version: number): AppRecord {
  return {
    ownerGaii,
    ownerName,
    filename,
    versionNumber: version,
    manifest: { name: filename, description: '', version: '1.0.0', category: 'utility', tags: [], authorDisplay: ownerName, usesCortex: [] },
    mimeType: 'text/html',
    size: 5,
    data: Buffer.from('<h1/>'),
    createdAt: new Date().toISOString(),
  };
}

console.log('\n=== App ownerName normalization (unit) ===\n');

const storage = new SqliteStorage(':memory:');

// Legacy row: ownerName carries the full GHII suffix (two versions in one bucket).
await storage.createApp(appRow('alice@node-x', 'alice@node-x', 'legacy.html', 1));
await storage.createApp(appRow('alice@node-x', 'alice@node-x', 'legacy.html', 2));
// Modern row: ownerName already bare — must be left untouched.
await storage.createApp(appRow('bob@node-x', 'bob', 'modern.html', 1));

const updated = await storage.normalizeAppOwnerNames();
assert(updated === 2, `rewrites exactly the 2 GHII-ownerName rows (got ${updated})`);

const legacy = await storage.getAppByOwnerName('alice', 'legacy.html');
assert(!!legacy, 'legacy app resolvable by bare owner name "alice"');
assert(legacy?.ownerName === 'alice', `ownerName rewritten to bare (got "${legacy?.ownerName}")`);
assert(legacy?.versionNumber === 2, 'latest version still returned after normalization');
assert(legacy?.ownerGaii === 'alice@node-x', 'ownerGaii (storage bucket key) left intact');

const modern = await storage.getAppByOwnerName('bob', 'modern.html');
assert(modern?.ownerName === 'bob', 'already-bare ownerName untouched');

const second = await storage.normalizeAppOwnerNames();
assert(second === 0, `idempotent — second pass updates 0 rows (got ${second})`);

storage.close();

// ── mergeForkedAppBuckets() ──────────────────────────────────────────────────
console.log('\n=== Forked app bucket merge (unit) ===\n');

function ghiiRow(ownerName: string, ghii: string, nodeId: string): GHIIRecord {
  const now = new Date().toISOString();
  return {
    username: ownerName, nodeId, ghii, displayName: ownerName,
    verificationLevel: 0, ownerName, createdAt: now, updatedAt: now, totpEnabled: false,
  };
}
// appRow with explicit content + createdAt so we can assert "newest stays latest".
function appRowAt(ownerGaii: string, ownerName: string, filename: string, version: number, content: string, createdAt: string): AppRecord {
  return {
    ownerGaii, ownerName, filename, versionNumber: version,
    manifest: { name: filename, description: '', version: '1.0.0', category: 'utility', tags: [], authorDisplay: ownerName, usesCortex: [] },
    mimeType: 'text/html', size: content.length, data: Buffer.from(content), createdAt,
  };
}

const m = new SqliteStorage(':memory:');
const NODE = 'node-x';

// Owner "happy" with a real GHII record → canonical bucket = "happy@node-x".
await m.createGHII(ghiiRow('happy', `happy@${NODE}`, NODE));
const CANON = `happy@${NODE}`;
const FORK = `happy@${NODE}@${NODE}`; // legacy double-node bucket from the GHII-form owner claim
const FN = 'sanomat.html';

// Canonical (dashboard) bucket: v1, v2 — older timestamps.
await m.createApp(appRowAt(CANON, 'happy', FN, 1, 'dash-v1', '2026-06-01T00:00:00.000Z'));
await m.createApp(appRowAt(CANON, 'happy', FN, 2, 'dash-v2', '2026-06-02T00:00:00.000Z'));
// Forked (MCP) bucket: v1, v2, v3 — newer timestamps; v3 is the newest content overall.
await m.createApp(appRowAt(FORK, 'happy', FN, 1, 'mcp-v1', '2026-06-03T00:00:00.000Z'));
await m.createApp(appRowAt(FORK, 'happy', FN, 2, 'mcp-v2', '2026-06-04T00:00:00.000Z'));
await m.createApp(appRowAt(FORK, 'happy', FN, 3, 'mcp-v3-newest', '2026-06-05T00:00:00.000Z'));
// Screenshot + downloads live only on the forked bucket.
await m.createStorageFile({ key: `apps/screenshots/${FN}`, ownerGaii: FORK, visibility: 'public', mimeType: 'image/png', size: 3, data: Buffer.from('img'), createdAt: '2026-06-05T00:00:00.000Z' });
for (let i = 0; i < 4; i++) await m.incrementAppDownloads(CANON, FN); // 4 on canonical
for (let i = 0; i < 7; i++) await m.incrementAppDownloads(FORK, FN);  // 7 on fork

const merged = await m.mergeForkedAppBuckets();
assert(merged === 3, `re-keys the 3 forked rows into the canonical bucket (got ${merged})`);

const allVersions = await m.listAppVersions(CANON, FN);
assert(allVersions.length === 5, `canonical bucket now holds all 5 versions (got ${allVersions.length})`);
assert(allVersions.every(v => v.ownerGaii === CANON), 'every merged row sits in the canonical bucket');
const vNums = allVersions.map(v => v.versionNumber).sort((a, b) => a - b);
assert(JSON.stringify(vNums) === JSON.stringify([1, 2, 3, 4, 5]), `versions renumbered 1..5 with no collision (got ${vNums})`);

const latest = await m.getApp(CANON, FN);
assert(latest?.data.toString() === 'mcp-v3-newest', `newest forked content (v3) becomes the served latest (got "${latest?.data.toString()}")`);
assert(latest?.versionNumber === 5, `newest content sits at the highest version 5 (got ${latest?.versionNumber})`);

const forkLeft = await m.listAppVersions(FORK, FN);
assert(forkLeft.length === 0, `nothing left in the forked bucket (got ${forkLeft.length})`);

const ssCanon = await m.getStorageFile(CANON, `apps/screenshots/${FN}`);
assert(!!ssCanon, 'screenshot moved into the canonical bucket');
const ssFork = await m.getStorageFile(FORK, `apps/screenshots/${FN}`);
assert(!ssFork, 'no screenshot left in the forked bucket');

const dlCanon = await m.getAppDownloads(CANON, FN);
assert(dlCanon === 11, `download counters folded (4 + 7 = 11, got ${dlCanon})`);
const dlFork = await m.getAppDownloads(FORK, FN);
assert(dlFork === 0, `forked download counter removed (got ${dlFork})`);

const mergeAgain = await m.mergeForkedAppBuckets();
assert(mergeAgain === 0, `idempotent — second merge re-keys 0 rows (got ${mergeAgain})`);

// Pure re-key: only a forked bucket exists (no canonical rows yet) → preserve versions.
await m.createGHII(ghiiRow('solo', `solo@${NODE}`, NODE));
const SOLO_CANON = `solo@${NODE}`;
const SOLO_FORK = `solo@${NODE}@${NODE}`;
await m.createApp(appRowAt(SOLO_FORK, 'solo', 'one.html', 1, 's1', '2026-06-01T00:00:00.000Z'));
await m.createApp(appRowAt(SOLO_FORK, 'solo', 'one.html', 2, 's2', '2026-06-02T00:00:00.000Z'));
const soloMerged = await m.mergeForkedAppBuckets();
assert(soloMerged === 2, `re-keys both solo rows (got ${soloMerged})`);
const soloVersions = await m.listAppVersions(SOLO_CANON, 'one.html');
assert(soloVersions.map(v => v.versionNumber).sort((a, b) => a - b).join(',') === '1,2', 'version numbers preserved when canonical bucket was empty');

// Unknown owner (no GHII record) is left untouched — cannot canonicalize safely.
await m.createApp(appRowAt(`ghostless@${NODE}@${NODE}`, 'ghostless', 'x.html', 1, 'g1', '2026-06-01T00:00:00.000Z'));
const ghostMerged = await m.mergeForkedAppBuckets();
assert(ghostMerged === 0, `owner without a GHII record is skipped (got ${ghostMerged})`);
const ghostStill = await m.getApp(`ghostless@${NODE}@${NODE}`, 'x.html');
assert(!!ghostStill, 'un-canonicalizable owner row left intact');

m.close();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
