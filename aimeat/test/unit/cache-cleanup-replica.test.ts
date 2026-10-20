/**
 * @file cache-cleanup-replica.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The federation retention sweep reaches a replica stored under a FOREIGN principal.
 *
 *   A received replica is keyed `replica:<source>:<key>` under the SENDING node's principal, and no
 *   code path writes a foreign principal into the agents table. Until 2026-10-20 runCleanupCycle
 *   enumerated storage.listAgents() and read each local agent's memory, so it visited none of those
 *   rows: the 168 h TTL was declared and never applied (secaudit 2026-10,
 *   cache-cleanup.ts:runCleanupCycle:replica-under-sender-identity-never-expires).
 *
 *   The dummy storage here holds one aged replica under a principal of another node and no local
 *   agent at all, and its listAgents() throws: a sweep that still walks the agents table cannot pass.
 * @structure
 *   - the aged replica under a foreign principal is removed, and listAgents is never asked
 *   - a fresh replica of the same shape stays
 *   - the TTLs apply per prefix: expiring: takes the de-peering grace, a conflict copy takes 7 days
 *   - the sweep pages past the page size
 * @usage cd aimeat && pnpm exec vitest run test/unit/cache-cleanup-replica.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, replica retention).
 */

import { describe, it, expect } from 'vitest';
import { runCleanupCycle } from '../../src/services/cache-cleanup.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { MemoryMetaRow } from '../../src/storage/repositories/memory.repository.js';

const PEER = 'aimeat-peer-001';
const FOREIGN = `claude#alice@${PEER}`;

const config = { genesisMemoryCacheTtlHours: 168, depeeringGracePeriodHours: 72 } as AimeatConfig;

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

function row(ownerGaii: string, key: string, updatedAt: string): MemoryMetaRow {
  return {
    key, ownerGaii, visibility: 'public', tags: [`replica:${PEER}`], version: 1,
    flagCount: 0, byteSize: 8, ttlHours: null, createdAt: updatedAt, updatedAt,
  };
}

/**
 * A storage that answers the one cross-owner listing the sweep uses and records every delete. Its
 * listAgents throws, which is the point: the sweep must not reach for the agents table.
 */
function dummyStorage(rows: MemoryMetaRow[]): { storage: Storage; deleted: string[]; left: MemoryMetaRow[] } {
  const left = [...rows];
  const deleted: string[] = [];
  const storage = {
    listAgents: async () => { throw new Error('the cleanup cycle must not enumerate the agents table'); },
    listMemory: async () => { throw new Error('the cleanup cycle must not read one owner at a time'); },
    listAllMemoryMeta: async (opts?: { prefix?: string; limit?: number; offset?: number }) => {
      const match = left.filter(r => r.key.startsWith(opts?.prefix ?? ''));
      const from = opts?.offset ?? 0;
      const items = match.slice(from, from + (opts?.limit ?? match.length));
      return { items, total: match.length };
    },
    deleteMemory: async (ownerGaii: string, key: string) => {
      const at = left.findIndex(r => r.ownerGaii === ownerGaii && r.key === key);
      if (at < 0) return false;
      left.splice(at, 1);
      deleted.push(`${ownerGaii}|${key}`);
      return true;
    },
  } as unknown as Storage;
  return { storage, deleted, left };
}

describe('the federation retention sweep', () => {
  it('removes an aged replica stored under a foreign principal, without asking the agents table', async () => {
    const { storage, deleted } = dummyStorage([
      row(FOREIGN, `replica:${PEER}:notes.a`, hoursAgo(169)),
    ]);

    const result = await runCleanupCycle(config, storage);

    expect(deleted).toEqual([`${FOREIGN}|replica:${PEER}:notes.a`]);
    expect(result.replicaRemoved).toBe(1);
    expect(result.ownersScanned).toBe(1);
    expect(result.rowsScanned).toBe(1);
  });

  it('leaves a replica that is still inside its TTL', async () => {
    const { storage, deleted } = dummyStorage([
      row(FOREIGN, `replica:${PEER}:notes.a`, hoursAgo(167)),
    ]);

    const result = await runCleanupCycle(config, storage);

    expect(deleted).toEqual([]);
    expect(result.replicaRemoved).toBe(0);
    expect(result.rowsScanned).toBe(1);
  });

  it('gives each prefix its own TTL: the cache TTL, the de-peering grace, and seven days for a conflict copy', async () => {
    // Three distinct TTLs, so one cutoff cannot stand in for another.
    const spread = { genesisMemoryCacheTtlHours: 24, depeeringGracePeriodHours: 72 } as AimeatConfig;
    const { storage, deleted } = dummyStorage([
      // Past the 24 h cache TTL.
      row(FOREIGN, `replica:${PEER}:notes.x`, hoursAgo(25)),
      // Past the 72 h grace, under a foreign principal.
      row(FOREIGN, `expiring:${PEER}:notes.a`, hoursAgo(73)),
      // Inside the grace: stays, although the cache TTL would have taken it.
      row(FOREIGN, `expiring:${PEER}:notes.b`, hoursAgo(71)),
      // A conflict copy kept beside a replica keeps its seven days, not the cache TTL.
      row(FOREIGN, `replica:${PEER}:notes.c._conflict_1`, hoursAgo(100)),
      row(FOREIGN, `replica:${PEER}:notes.d._conflict_2`, hoursAgo(169)),
    ]);

    const result = await runCleanupCycle(spread, storage);

    expect(deleted.sort()).toEqual([
      `${FOREIGN}|expiring:${PEER}:notes.a`,
      `${FOREIGN}|replica:${PEER}:notes.d._conflict_2`,
      `${FOREIGN}|replica:${PEER}:notes.x`,
    ].sort());
    expect(result.replicaRemoved).toBe(1);
    expect(result.expiringRemoved).toBe(1);
    expect(result.conflictRemoved).toBe(1);
  });

  it('pages past the listing window, so a node holding more replicas than one page loses them all', async () => {
    // 1200 rows is more than two pages of 500, under three different foreign principals.
    const rows: MemoryMetaRow[] = [];
    for (let i = 0; i < 1200; i++) {
      rows.push(row(`a${i % 3}#bob@${PEER}`, `replica:${PEER}:bulk.${String(i).padStart(4, '0')}`, hoursAgo(200)));
    }
    const { storage, deleted, left } = dummyStorage(rows);

    const result = await runCleanupCycle(config, storage);

    expect(deleted.length).toBe(1200);
    expect(left.length).toBe(0);
    expect(result.replicaRemoved).toBe(1200);
    expect(result.ownersScanned).toBe(3);
  });
});
