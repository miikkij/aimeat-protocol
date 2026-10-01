/**
 * @file test/unit/app-audit-archive.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app audit log keeps everything unless a limit is set. Before this the log was cut
 *   at 500 entries across every kind, so a busy roster pushed out the legal, settings and
 *   development-right entries. Now the active record rolls its oldest entries into one archive
 *   record per year, a year too large for one record continues in a second part, the roster history
 *   reads the archive, and a limit (the owner's, else the node's) deletes the oldest first.
 *   Real in-memory SQLite; the roll is driven through recordAppAudit, the one write path.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-audit-archive.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { recordAppAudit, readAppAudit, appAuditKey } from '../../src/services/app-audit.js';
import {
  ACTIVE_ROLL_AT, ACTIVE_KEEP, ARCHIVE_PART_MAX, archiveKey, listArchives, readArchiveYear, readAllEntries,
  moveToArchive, bindAppAuditConfig, writeKeep,
} from '../../src/services/app-audit-archive.js';

const OWNER = 'alice@node-test';
const FILE = 'shop.html';
let storage: Storage;

/** Put `n` entries straight into the active record, dated in `year`, oldest first. */
async function seed(n: number, year = '2025', action = 'legal.set') {
  const entries = Array.from({ length: n }, (_, i) => ({
    at: `${year}-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(6, '0')}Z`, by: OWNER, action,
  }));
  const now = new Date().toISOString();
  await storage.setMemory({ key: appAuditKey(FILE), ownerGaii: OWNER, value: { spec: 'aimeat.app-audit/v1', filename: FILE, entries },
    visibility: 'owner', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
}

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  bindAppAuditConfig({ appAuditKeepDefault: 0 });
});

describe('the app audit log', () => {
  it('rolls its oldest entries into the year\'s archive past the roll point and deletes nothing', async () => {
    await seed(ACTIVE_ROLL_AT, '2025');
    await recordAppAudit(storage, { ownerGhii: OWNER, filename: FILE, by: OWNER, action: 'member.approved' });
    const active = await readAppAudit(storage, OWNER, FILE);
    expect(active).toHaveLength(ACTIVE_KEEP);
    expect(active[active.length - 1].action).toBe('member.approved');
    expect(await listArchives(storage, OWNER, FILE)).toEqual([{ year: '2025', entries: ACTIVE_ROLL_AT + 1 - ACTIVE_KEEP }]);
    expect((await readAllEntries(storage, OWNER, FILE, active))).toHaveLength(ACTIVE_ROLL_AT + 1);
  });

  it('a year too large for one record continues in a second part, read back in order', async () => {
    const many = Array.from({ length: ARCHIVE_PART_MAX + 10 }, (_, i) => ({ at: `2024-06-01T00:00:00.${String(i).padStart(6, '0')}Z`, by: OWNER, action: 'seo' as const }));
    await moveToArchive(storage, OWNER, FILE, many);
    expect(await storage.getMemory(OWNER, archiveKey(FILE, '2024', 2))).not.toBeNull();
    const year = await readArchiveYear(storage, OWNER, FILE, '2024');
    expect(year).toHaveLength(ARCHIVE_PART_MAX + 10);
    expect(year[0].at < year[year.length - 1].at).toBe(true);
  });

  it('a limit keeps the newest entries, and the node default applies when the owner set none', async () => {
    await seed(20, '2025');
    bindAppAuditConfig({ appAuditKeepDefault: 5 });
    await recordAppAudit(storage, { ownerGhii: OWNER, filename: FILE, by: OWNER, action: 'seo' });
    expect(await readAppAudit(storage, OWNER, FILE)).toHaveLength(5);
    await writeKeep(storage, OWNER, 0);
    await recordAppAudit(storage, { ownerGhii: OWNER, filename: FILE, by: OWNER, action: 'seo' });
    expect(await readAppAudit(storage, OWNER, FILE)).toHaveLength(6);
  });
});
