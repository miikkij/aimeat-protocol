/**
 * @file test/unit/app-audit-concurrent-move.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's audit log keeps every entry exactly once when an audited change lands while
 *   the log is being moved into its archive. Three operations move entries between the active record
 *   and the per-year archive: the owner's "archive before a date", the owner's limit, and the roll a
 *   long log makes on its next append. Each ends with a compare-and-swap on the active record; when
 *   another writer changed it first, the operation is refused and retried. The archive half must not
 *   have been written by then, or the refused attempt leaves entries in both places (a duplicate) or
 *   removes archived ones while answering that nothing was removed.
 *
 *   THE INTERLEAVING is deterministic: a storage proxy answers the operation's read of the active
 *   record with the record as it was, after a second audited change has already been written through
 *   the real storage. SQLite in memory, and PostgreSQL when DATABASE_URL is set.
 *   FIRST FAIL: against the tree before this change the three cases count 21, 11 and 1503 entries.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-audit-concurrent-move.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit 2026-10-31 inv-11).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import {
  recordAppAudit, readAppAudit, appAuditKey, archiveAppAuditBefore, applyAppAuditKeep,
} from '../../src/services/app-audit.js';
import {
  ACTIVE_ROLL_AT, ACTIVE_KEEP, listArchives, readAllEntries, moveToArchive, bindAppAuditConfig,
} from '../../src/services/app-audit-archive.js';
import { requirePostgresWhenAsked } from './postgres-arm.js';

requirePostgresWhenAsked('app-audit-concurrent-move');
const PG_URL = process.env.DATABASE_URL ?? '';
const FILE = 'shop.html';

interface Provider { name: 'sqlite' | 'postgres-kysely'; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
  bindAppAuditConfig({ appAuditKeepDefault: 0 });
  provs.push({ name: 'sqlite', storage: new SqliteStorage(':memory:') as unknown as Storage });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) await (storage as unknown as { close?: () => unknown }).close?.();
});

/** Put `n` entries straight into the active record, dated in `year`, oldest first. */
async function seed(real: Storage, owner: string, n: number, year = '2025') {
  const entries = Array.from({ length: n }, (_, i) => ({
    at: `${year}-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(6, '0')}Z`, by: owner, action: 'legal.set',
  }));
  const now = new Date().toISOString();
  await real.setMemory({ key: appAuditKey(FILE), ownerGaii: owner, value: { spec: 'aimeat.app-audit/v1', filename: FILE, entries },
    visibility: 'owner', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
}

/**
 * The real storage, except that the FIRST read of the active record answers it as it was and, before
 * answering, lets another audited change land through the real storage. Everything else is the real
 * method bound to the real storage.
 */
function racing(real: Storage, owner: string): Storage {
  let raced = false;
  return new Proxy(real, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (prop === 'getMemory') {
        return async (o: string, key: string) => {
          const rec = await target.getMemory(o, key);
          if (!raced && key === appAuditKey(FILE)) {
            raced = true;
            await recordAppAudit(real, { ownerGhii: owner, filename: FILE, by: `agent#${owner}`, action: 'seo' });
          }
          return rec;
        };
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

async function wholeLog(real: Storage, owner: string) {
  return readAllEntries(real, owner, FILE, await readAppAudit(real, owner, FILE));
}

const ownerName = () => `au${randomUUID().slice(0, 8)}@node-test`;

for (const which of ['sqlite', 'postgres-kysely'] as const) {
  describe(`${which}: moving audit entries while another change is recorded`, () => {
    it('archive before a date: a refused attempt leaves every entry once, and the retry moves them', async () => {
      const p = provs.find(x => x.name === which);
      if (!p) return;
      const owner = ownerName();
      await seed(p.storage, owner, 10, '2025');
      await expect(archiveAppAuditBefore(racing(p.storage, owner), owner, FILE, '2026-01-01T00:00:00.000Z')).rejects.toThrow(/changed while this was being applied/);
      expect((await wholeLog(p.storage, owner)).length, 'ten seeded entries and the concurrent one, each once').toBe(11);
      expect(await listArchives(p.storage, owner, FILE), 'the refused attempt wrote no archive').toEqual([]);

      expect(await archiveAppAuditBefore(p.storage, owner, FILE, '2026-01-01T00:00:00.000Z')).toBe(10);
      expect((await wholeLog(p.storage, owner)).length).toBe(11);
      expect(await listArchives(p.storage, owner, FILE)).toEqual([{ year: '2025', entries: 10 }]);
      await p.storage.deleteAllMemory(owner);
    });

    it('the owner\'s limit: a refused attempt removes nothing, and the retry applies the limit', async () => {
      const p = provs.find(x => x.name === which);
      if (!p) return;
      const owner = ownerName();
      const archived = Array.from({ length: 10 }, (_, i) => ({ at: `2024-03-01T00:00:00.${String(i).padStart(6, '0')}Z`, by: owner, action: 'seo' }));
      await moveToArchive(p.storage, owner, FILE, archived);
      await seed(p.storage, owner, 10, '2025');
      await expect(applyAppAuditKeep(racing(p.storage, owner), owner, FILE, 5)).rejects.toThrow(/Nothing was removed from it/);
      expect((await wholeLog(p.storage, owner)).length, 'nothing was removed: 10 archived, 10 active and the concurrent one').toBe(21);

      expect(await applyAppAuditKeep(p.storage, owner, FILE, 5)).toBe(16);
      const after = await wholeLog(p.storage, owner);
      expect(after.length).toBe(5);
      expect(after[after.length - 1]!.action, 'the newest entry is kept').toBe('seo');
      await p.storage.deleteAllMemory(owner);
    });

    it('the roll on append: two changes at the roll point leave every entry once', async () => {
      const p = provs.find(x => x.name === which);
      if (!p) return;
      const owner = ownerName();
      await seed(p.storage, owner, ACTIVE_ROLL_AT, '2025');
      await recordAppAudit(racing(p.storage, owner), { ownerGhii: owner, filename: FILE, by: owner, action: 'member.approved' });
      const all = await wholeLog(p.storage, owner);
      expect(all.length, 'the seeded entries and the two new ones, each once').toBe(ACTIVE_ROLL_AT + 2);
      expect(new Set(all.map(e => JSON.stringify(e))).size).toBe(ACTIVE_ROLL_AT + 2);
      const active = await readAppAudit(p.storage, owner, FILE);
      expect(active.length).toBe(ACTIVE_KEEP + 1);
      expect(active[active.length - 1]!.action).toBe('member.approved');
      await p.storage.deleteAllMemory(owner);
    });
  });
}
