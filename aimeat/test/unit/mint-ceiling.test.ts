/**
 * @file mint-ceiling.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 176: an operator's mint and a sold pacing pack share one daily
 *   ceiling. The mint counted mint rows only, so after a day of pack sales the operator could still
 *   mint the whole ceiling; both summed over the newest 10 000 ledger rows. Now both read addedToday,
 *   summed by the database.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mint-ceiling.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 176).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { mintMorsels } from '../../src/services/morsel.js';
import { addedToday } from '../../src/services/mint-ceiling.js';

const NODE = 'unit-mint-001';
const config = { nodeId: NODE, maxOperatorMintPerDay: 10_000 } as unknown as AimeatConfig;
const AGENT = `bot#ann@${NODE}`;
let storage: Storage;

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  await storage.createOwner({ name: 'ann', displayName: 'Ann', publicKey: 'pk', roles: ['owner'], createdAt: now });
  await storage.createGHII({
    username: 'ann', nodeId: NODE, ghii: `ann@${NODE}`, displayName: 'Ann', verificationLevel: 0, ownerName: 'ann',
    totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: now, updatedAt: now,
  } as never);
  await storage.createAgent({
    name: 'bot', owner: 'ann', gaii: AGENT, capabilities: [], publicKey: 'pk', trustScore: 50, morselBalance: 0,
    createdAt: now, lastSeen: now,
  } as never);
});

describe('the shared daily ceiling', () => {
  it('counts sold pacing packs against the operator mint', async () => {
    await storage.addTransaction({ id: 'p1', gaii: `ann@${NODE}`, type: 'pacing_pack', amount: 9_000, timestamp: new Date().toISOString() });
    expect(await addedToday(storage)).toBe(9_000);
    const out = await mintMorsels({ storage, config }, `op@${NODE}`, AGENT, 2_000);
    expect(out).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' });
    expect(await mintMorsels({ storage, config }, `op@${NODE}`, AGENT, 1_000)).toMatchObject({ ok: true, mintedToday: 10_000 });
  });

  it('leaves out yesterday and the other ledger types', async () => {
    const yesterday = new Date(Date.now() - 36 * 3_600_000).toISOString();
    await storage.addTransaction({ id: 'm0', gaii: `ann@${NODE}`, type: 'mint', amount: 5_000, timestamp: yesterday });
    await storage.addTransaction({ id: 'a1', gaii: `ann@${NODE}`, type: 'allowance', amount: 50, timestamp: new Date().toISOString() });
    expect(await addedToday(storage)).toBe(0);
  });
});
