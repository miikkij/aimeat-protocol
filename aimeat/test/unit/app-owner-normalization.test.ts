/**
 * @file app-owner-normalization.test.ts
 * @description Server-less unit test for SqliteStorage.normalizeAppOwnerNames().
 *   Legacy app rows whose ownerName was stored as a full GHII (`owner@node`) are
 *   rewritten to the bare owner name, so the catalog "my apps" filter and the
 *   by-owner-name delete sweep (both keyed on the bare name) find them again.
 * @usage cd aimeat && pnpm exec tsx test/unit/app-owner-normalization.test.ts
 * @version-history
 *   v1.0.0 — 2026-06-05 — initial: normalize, resolvability, idempotency
 */
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AppRecord } from '../../src/storage/interface.js';

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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
