/**
 * @file daily-allowance.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Feature-list audit row 135: the day's morsels. The daily job credited once per agent,
 *   so three agents gave a person three days' worth and a person with no agent got nothing, and it
 *   wrote no ledger row; POST /v1/wallet/request added the day's amount on every call. Now the grant
 *   is once per person per day, clamped to the daily allowance and the cap, with a ledger row.
 * @usage cd aimeat && pnpm exec vitest run test/unit/daily-allowance.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-15 — Initial (feature-list audit 135).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { grantDailyAllowance, runDailyAllowance, allowanceDayCode } from '../../src/services/daily-allowance.js';

const NODE = 'unit-allowance-001';
const config = { nodeId: NODE, dailyAllowance: 50, dailyAllowanceCap: 500 } as unknown as AimeatConfig;
let storage: Storage;

async function person(name: string, balance: number, agents = 0): Promise<string> {
  const now = new Date().toISOString();
  const ghii = `${name}@${NODE}`;
  await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
  await storage.createGHII({
    username: name, nodeId: NODE, ghii, displayName: name, verificationLevel: 0, ownerName: name,
    totpEnabled: false, morselBalance: balance, loginCount: 0, createdAt: now, updatedAt: now,
  } as never);
  for (let i = 0; i < agents; i++) {
    await storage.createAgent({
      name: `a${i}`, owner: name, gaii: `a${i}#${name}@${NODE}`, capabilities: [], publicKey: 'pk',
      trustScore: 50, morselBalance: 0, createdAt: now, lastSeen: now,
    } as never);
  }
  return ghii;
}

const balance = async (name: string) => (await storage.getGHIIByOwner(name))?.morselBalance ?? 0;

beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

describe('the day\'s grant', () => {
  it('is once a day, clamped to the allowance, with a ledger row', async () => {
    const ghii = await person('ann', 0);
    expect(await grantDailyAllowance(storage, config, ghii, 1000)).toEqual({ credited: 50, already: false });
    expect(await grantDailyAllowance(storage, config, ghii, 1000)).toEqual({ credited: 0, already: true });
    expect(await balance('ann')).toBe(50);
    const rows = (await storage.getTransactions(ghii, 10)).filter(t => t.type === 'allowance');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 50, trackingCode: allowanceDayCode() });
  });

  it('is once a day when requests arrive at the same moment (secaudit2026oct22)', async () => {
    const ghii = await person('eve', 0);
    const outs = await Promise.all([1, 2, 3, 4].map(() => grantDailyAllowance(storage, config, ghii)));
    expect(outs.filter(o => o.credited > 0)).toHaveLength(1);
    expect(outs.filter(o => o.already)).toHaveLength(3);
    expect(await balance('eve')).toBe(50);
    const rows = (await storage.getTransactions(ghii, 10)).filter(t => t.type === 'allowance');
    expect(rows).toHaveLength(1);
  });

  it('stops at the cap', async () => {
    const ghii = await person('ben', 480);
    expect(await grantDailyAllowance(storage, config, ghii)).toEqual({ credited: 20, already: false });
    expect(await balance('ben')).toBe(500);
  });
});

describe('the daily job', () => {
  it('gives each person the day\'s morsels once, with or without agents', async () => {
    await person('cat', 0, 3);
    await person('dan', 0, 0);
    await runDailyAllowance(storage, config);
    await runDailyAllowance(storage, config);
    expect(await balance('cat')).toBe(50);
    expect(await balance('dan')).toBe(50);
  });
});
