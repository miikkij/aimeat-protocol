/**
 * @file test/unit/memory-meta-page.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A cursor page of the metadata listing (services/memory-query.ts listMemoryMetaPage)
 *   gives, page after page, exactly the rows the whole listing gives, in key order: an owner and an
 *   agent holding the same keys across several SQL batches, so a key's two rows meet at a batch's
 *   edge and must still come out once, as the owner's (GHII first), with the agent's copy named in
 *   alsoUnder. The caller's filter runs on every batch, and a filtered-out row leaves no gap.
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial (performance work, architecture item 4).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { listMemoryMetaFor, listMemoryMetaPage } from '../../src/services/memory-query.js';
import type { MemoryMetaRow } from '../../src/storage/repositories/memory.repository.js';

const NODE = 'node-mp';
const OWNER = 'alice';
const GHII = `${OWNER}@${NODE}`;
const AGENT = `bot#${OWNER}@${NODE}`;
const deps = (storage: Storage) => ({ storage, config: { nodeId: NODE } });

function mem(ownerGaii: string, key: string): MemoryRecord {
  const now = new Date().toISOString();
  return { key, ownerGaii, value: { k: key }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
}

let storage: Storage;
beforeAll(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  await storage.createAgent({ name: 'bot', owner: OWNER, gaii: AGENT, publicKey: 'pk', trustScore: 50, morselBalance: 0, capabilities: [], createdAt: now, lastSeen: now } as never);
  // 520 keys: every one under the owner, every third also under the agent, every fifth only under the agent.
  for (let i = 0; i < 520; i++) {
    const key = `k.${String(i).padStart(4, '0')}`;
    if (i % 5 !== 0) await storage.setMemory(mem(GHII, key));
    if (i % 3 === 0 || i % 5 === 0) await storage.setMemory(mem(AGENT, key));
  }
});

async function walk(limit: number, keep: (rows: MemoryMetaRow[]) => Promise<MemoryMetaRow[]> = async r => r): Promise<MemoryMetaRow[]> {
  const out: MemoryMetaRow[] = [];
  let cursor = '';
  for (let guard = 0; guard < 1000; guard++) {
    const page = await listMemoryMetaPage(deps(storage), { ownerScopeOf: OWNER, gaii: GHII, cursor, limit, keep });
    expect(page.rows.length).toBeLessThanOrEqual(limit);
    out.push(...page.rows);
    if (page.nextCursor === null) return out;
    cursor = page.nextCursor;
  }
  throw new Error('the walk did not end');
}

describe('listMemoryMetaPage', () => {
  it('walks the owner scope page by page to exactly the whole listing, in key order, each key once', async () => {
    const whole = (await listMemoryMetaFor(deps(storage), { ownerScopeOf: OWNER, gaii: GHII }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const limit of [7, 100, 333]) {
      const pages = await walk(limit);
      expect(pages.map(r => `${r.key}@${r.ownerGaii}`)).toEqual(whole.map(r => `${r.key}@${r.ownerGaii}`));
      expect(new Set(pages.map(r => r.key)).size).toBe(pages.length);
    }
  });

  it('keeps the owner\'s copy of a key both hold and names the agent\'s in alsoUnder', async () => {
    const pages = await walk(50);
    const both = pages.find(r => r.key === 'k.0003') as MemoryMetaRow & { alsoUnder?: string[] };
    expect(both.ownerGaii).toBe(GHII);
    expect(both.alsoUnder).toEqual([AGENT]);
    expect(pages.find(r => r.key === 'k.0005')?.ownerGaii).toBe(AGENT);
  });

  it('runs the caller\'s filter on every batch and fills the page past what it drops', async () => {
    const dropOdd = async (rows: MemoryMetaRow[]) => rows.filter(r => Number(r.key.slice(2)) % 2 === 0);
    const pages = await walk(40, dropOdd);
    expect(pages.length).toBe(260);
    expect(pages.every(r => Number(r.key.slice(2)) % 2 === 0)).toBe(true);
    const first = await listMemoryMetaPage(deps(storage), { ownerScopeOf: OWNER, gaii: GHII, cursor: '', limit: 40, keep: dropOdd });
    expect(first.rows.length).toBe(40);
    expect(first.nextCursor).toBe(first.rows[39].key);
  });

  it('answers an empty page with no next cursor past the last key', async () => {
    const page = await listMemoryMetaPage(deps(storage), { ownerScopeOf: OWNER, gaii: GHII, cursor: 'k.9999', limit: 10, keep: async r => r });
    expect(page).toEqual({ rows: [], nextCursor: null });
  });
});
