/**
 * @file test/unit/pacing-reverse.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reversal of a pacing charge (services/metered-settlement.ts chargePacing) against
 *   real in-memory SQLite. A use that fails after the charge gives the payer everything back when the
 *   provider still holds its share; when the provider no longer does, the payer gets back only what
 *   was recovered plus the burned part, so a reversal never adds morsels (secaudit2026oct22).
 * @usage cd aimeat && pnpm exec vitest run test/unit/pacing-reverse.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, metered-settlement:chargePacing:reverse-ignores-failed-debit).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { chargePacing } from '../../src/services/metered-settlement.js';

const PAYER = 'payer@node';
const PROVIDER = 'provider@node';
let storage: Storage;
const config = { burnRate: 0.1, marketplaceFeeMode: 'burn' } as unknown as AimeatConfig;

async function person(ghii: string, balance: number): Promise<void> {
  const name = ghii.split('@')[0]!;
  await storage.createGHII({
    username: name, nodeId: 'node', ghii, displayName: name,
    verificationLevel: 0, ownerName: name, createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z',
  } as never);
  if (balance > 0) await storage.creditBalance(ghii, balance);
}
const balanceOf = async (ghii: string): Promise<number> => Number((await storage.getGHII(ghii))?.morselBalance ?? 0);

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await person(PAYER, 100);
  await person(PROVIDER, 0);
});

describe('chargePacing reverse', () => {
  it('gives the payer everything back when the provider still holds its share', async () => {
    const charge = await chargePacing({ config, storage, caller: PAYER, providerGhii: PROVIDER, amount: 50, label: 'test' });
    expect(charge).not.toBeNull();
    expect(charge!.burned).toBe(5);
    expect(await balanceOf(PAYER)).toBe(50);
    expect(await balanceOf(PROVIDER)).toBe(45);
    await charge!.reverse();
    expect(await balanceOf(PAYER)).toBe(100);
    expect(await balanceOf(PROVIDER)).toBe(0);
  });

  it('credits only what was recovered, plus the burned part, when the provider spent its share', async () => {
    const charge = await chargePacing({ config, storage, caller: PAYER, providerGhii: PROVIDER, amount: 50, label: 'test' });
    // The provider spends 35 of its 45 before the reversal (its own use, or ctx.buy in the script).
    expect(await storage.debitBalance(PROVIDER, 35)).toBe(true);
    await charge!.reverse();
    // The provider's share could not be taken back, so the payer gets the burned 5 only.
    expect(await balanceOf(PROVIDER)).toBe(10);
    expect(await balanceOf(PAYER)).toBe(55);
    // No morsels were added: before the reversal 50 + 10 existed, after it 55 + 10 (the burn returned by design).
    expect((await balanceOf(PAYER)) + (await balanceOf(PROVIDER))).toBe(50 + 10 + 5);
  });
});
