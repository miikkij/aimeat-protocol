/**
 * @file memory-restore-legacy-price.test.ts
 * @description Restoring a record from the bin answers to the write path's rule on the old morsel
 *   price (feature-list audit #205). An offers document holding `price` is refused on POST, PUT and
 *   PATCH /v1/memory from 4.0.0 with 400 MORSEL_PRICE_REMOVED; the restore wrote the same document
 *   back without asking. Against SqliteStorage(':memory:') and the real service.
 * @usage pnpm exec vitest run test/unit/memory-restore-legacy-price.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #205).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../../src/services/memory-bin.js';
import type { AimeatConfig } from '../../src/config.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const stamp = '2026-10-15T12:00:00.000Z';
const config = { nodeId: N, memoryDeleteGraceDays: 30 } as AimeatConfig;

describe('restore from the bin and the old morsel price', () => {
  let storage: SqliteStorage;
  const put = (key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: ALICE, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
  });
  const req = (key: string) => ({ caller: ALICE, ownerName: 'alice', key, ownerScope: true, roles: ['owner'] });

  beforeEach(() => { storage = new SqliteStorage(':memory:'); });
  afterEach(() => { storage.close(); });

  it('an offers document with the old price stays in the bin: 400 MORSEL_PRICE_REMOVED', async () => {
    // Stored before 4.0.0, when the field was still read as pacing.
    await put('agents.joker.offers', { offers: [{ id: 'summary', price: 5 }] });
    expect((await deleteMemoryRecord({ storage, config }, req('agents.joker.offers'))).ok).toBe(true);

    const back = await restoreMemoryRecord({ storage, config }, req('agents.joker.offers'));
    expect(back.ok).toBe(false);
    if (!back.ok) {
      expect(back.code).toBe('MORSEL_PRICE_REMOVED');
      expect(back.status).toBe(400);
    }
    expect(await storage.getMemory(ALICE, 'agents.joker.offers')).toBeNull();
    expect((await storage.listDeletedMemory(ALICE)).map(r => r.key)).toContain('agents.joker.offers');
  });

  it('an offers document without the old price is put back', async () => {
    await put('agents.joker.offers', { offers: [{ id: 'summary', tollMorsels: 5 }] });
    await deleteMemoryRecord({ storage, config }, req('agents.joker.offers'));
    const back = await restoreMemoryRecord({ storage, config }, req('agents.joker.offers'));
    expect(back.ok).toBe(true);
    expect(await storage.getMemory(ALICE, 'agents.joker.offers')).not.toBeNull();
  });
});
