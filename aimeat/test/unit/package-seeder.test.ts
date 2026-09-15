/**
 * @file package-seeder.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Server-less tests for the example-package sync that runs at every boot.
 *
 *   The case that matters is the one an operator of another node reported on 2026-09-15: a node
 *   seeded company-brain on 2026-09-01, 3.15.0 shipped fixes to it, and the node kept the first
 *   seed, so nobody who had installed it was ever offered the fix. The test builds exactly that
 *   state (an older published version whose component bytes differ) and boots the seeder over it.
 * @usage cd aimeat && pnpm vitest run test/unit/package-seeder.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-15 — initial: a changed package gets a new version, an unchanged one does not,
 *     the listing keeps its counts, key order does not count as a change, versions sort forward.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, PackageRecord } from '../../src/storage/interface.js';
import { getExamplePackages, buildRecords } from '../../src/data/example-packages.js';
import { seedExamplePackages, packageFingerprint, nextSeedVersion } from '../../src/services/package-seeder.js';

const SYSTEM = 'system@aimeat-test-001-dev';
const GROUP = 'company-brain::system';
const OLD_VERSION = 'v2026-09-01-0655';

function freshStorage(): Storage {
  return new SqliteStorage(':memory:') as unknown as Storage;
}

/** What a node that seeded company-brain before the 3.15.0 fixes holds: other bytes, same name. */
async function seedStaleCompanyBrain(storage: Storage): Promise<PackageRecord> {
  const def = getExamplePackages().find(d => d.name === 'company-brain')!;
  const stale = { ...def, components: def.components.map((c, i) => (i === 0 ? { ...c, content: `${c.content}\n// before the fix` } : c)) };
  const { pkg, listing } = buildRecords(stale, 'system', SYSTEM);
  pkg.version = OLD_VERSION;
  await storage.createPackage(pkg);
  await storage.createTemplateListing({ ...listing, installCount: 7, reviewCount: 2, rating: 4.5 });
  return pkg;
}

describe('example package sync at boot', () => {
  it('publishes a new version of a package whose bundled content changed', async () => {
    const storage = freshStorage();
    const stale = await seedStaleCompanyBrain(storage);

    await seedExamplePackages(storage, SYSTEM);

    const latest = await storage.getLatestPublished(GROUP);
    expect(latest?.version).not.toBe(OLD_VERSION);
    expect(latest!.version > OLD_VERSION).toBe(true);
    expect((await storage.getPackage(stale.id))?.status).toBe('archived');

    const def = getExamplePackages().find(d => d.name === 'company-brain')!;
    expect(packageFingerprint(latest!)).toBe(packageFingerprint(buildRecords(def, 'system', SYSTEM).pkg));
  });

  it('keeps the listing, with its install count and ratings', async () => {
    const storage = freshStorage();
    await seedStaleCompanyBrain(storage);
    const before = await storage.getListingByPackage(GROUP);

    await seedExamplePackages(storage, SYSTEM);

    const after = await storage.getListingByPackage(GROUP);
    expect(after?.id).toBe(before?.id);
    expect(after?.installCount).toBe(7);
    expect(after?.reviewCount).toBe(2);
  });

  it('makes no new version when nothing changed, however many times it runs', async () => {
    const storage = freshStorage();
    const first = await seedExamplePackages(storage, SYSTEM);
    expect(first).toBe(getExamplePackages().length);
    const versionBefore = (await storage.getLatestPublished(GROUP))!.version;

    expect(await seedExamplePackages(storage, SYSTEM)).toBe(0);
    expect(await seedExamplePackages(storage, SYSTEM)).toBe(0);
    expect((await storage.getLatestPublished(GROUP))!.version).toBe(versionBefore);
  });
});

describe('packageFingerprint', () => {
  it('does not count a different key order in component metadata as a change', () => {
    // What Postgres jsonb hands back: the same object with its keys in another order.
    const { pkg } = buildRecords(getExamplePackages()[0]!, 'system', SYSTEM);
    const meta = { app: { datamap: { records: 6 }, id: 'brain' }, binding: 'x' };
    const stored = { ...pkg, components: pkg.components.map((c, i) => (i === 0 ? { ...c, meta } : c)) };
    const reordered = {
      ...pkg,
      components: pkg.components.map((c, i) => (i === 0 ? { ...c, meta: { binding: 'x', app: { id: 'brain', datamap: { records: 6 } } } } : c)),
    };
    expect(packageFingerprint(reordered)).toBe(packageFingerprint(stored));
  });

  it('counts a changed byte, a changed label and a changed description', () => {
    const { pkg } = buildRecords(getExamplePackages()[0]!, 'system', SYSTEM);
    const base = packageFingerprint(pkg);
    const c0 = pkg.components[0]!;
    expect(packageFingerprint({ ...pkg, components: [{ ...c0, contentHash: 'x' }, ...pkg.components.slice(1)] })).not.toBe(base);
    expect(packageFingerprint({ ...pkg, components: [{ ...c0, label: 'x' }, ...pkg.components.slice(1)] })).not.toBe(base);
    expect(packageFingerprint({ ...pkg, description: 'x' })).not.toBe(base);
  });
});

describe('nextSeedVersion', () => {
  it('uses the candidate when it already sorts last', () => {
    expect(nextSeedVersion('v2026-09-15-1010', ['v2026-09-01-0655'])).toBe('v2026-09-15-1010');
    expect(nextSeedVersion('v2026-09-15-1010', [])).toBe('v2026-09-15-1010');
  });

  it('counts on from a version in the same minute, and from a clock behind the stored one', () => {
    expect(nextSeedVersion('v2026-09-15-1010', ['v2026-09-15-1010'])).toBe('v2026-09-15-1010-002');
    expect(nextSeedVersion('v2026-09-15-1010', ['v2026-09-15-1010', 'v2026-09-15-1010-002'])).toBe('v2026-09-15-1010-003');
    expect(nextSeedVersion('v2026-09-15-0900', ['v2026-09-15-1010'])).toBe('v2026-09-15-1010-002');
  });

  it('keeps sorting forward past nine', () => {
    const taken = ['v2026-09-15-1010', ...Array.from({ length: 9 }, (_, i) => `v2026-09-15-1010-${String(i + 2).padStart(3, '0')}`)];
    const next = nextSeedVersion('v2026-09-15-1010', taken);
    expect(next).toBe('v2026-09-15-1010-011');
    expect([...taken, next].sort().at(-1)).toBe(next);
  });
});
