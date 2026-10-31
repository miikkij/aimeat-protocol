/**
 * @file test/unit/metered-pacing-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The metered chokepoint (services/metered-access.ts authoriseMeteredCall) refuses a
 *   call for an inactive contract, a full rate window, a spent budget or a provider's carried
 *   ceiling before it charges the pacing, so a refused call writes no pacing rows and moves no
 *   morsels (secaudit 2026-10-31, f-secaudit2026oct31-extra-metered-pacing-order). Usage kept: an
 *   allowed contracted call is paced once, the price is settled, and the provider is credited.
 *   Real in-memory SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/metered-pacing-order.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31, f-secaudit2026oct31-extra-metered-pacing-order).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { authoriseMeteredCall } from '../../src/services/metered-access.js';
import { persistEntitlement, type MeteredEntitlement } from '../../src/services/metered-entitlements.js';

const NODE = 'meter-node';
const CALLER = `bob@${NODE}`;
const PROVIDER = `sally@${NODE}`;
const config = {
  nodeId: NODE, burnRate: 0, marketplaceFeeMode: 'burn', pacingTollDefault: 0, extensionMaxDebitPerCall: 1000,
  commerceFeePercent: 0,
} as unknown as AimeatConfig;

let storage: Storage;
async function person(ghii: string, balance: number): Promise<void> {
  const name = ghii.split('@')[0]!;
  await storage.createGHII({
    username: name, nodeId: NODE, ghii, displayName: name,
    verificationLevel: 0, ownerName: name, createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z',
  } as never);
  if (balance > 0) await storage.creditBalance(ghii, balance);
}
const balanceOf = async (ghii: string): Promise<number> => Number((await storage.getGHII(ghii))?.morselBalance ?? 0);
const pacingRows = async (ghii: string) =>
  (await storage.getTransactions(ghii, 100)).filter(t => t.type === 'pacing_charge' || t.type === 'pacing_burn');

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await person(CALLER, 100);
  await person(PROVIDER, 50);
});

/** A morsel contract on paidext/run: pacing 5 per call, price 2 per call. */
async function contract(over: Partial<MeteredEntitlement> = {}): Promise<MeteredEntitlement> {
  const now = new Date().toISOString();
  const ent: MeteredEntitlement = {
    entitlementId: randomUUID(), consumerGaii: CALLER, appId: null, providerGhii: PROVIDER, ext: 'paidext', action: 'run',
    capabilityLabel: 'paidext/run', unit: 'morsels', pricePerCall: 2, currency: null,
    pricing: { model: 'per_call' }, budget: { capUnits: null, spentUnits: 0, calls: 0 }, rakePercent: 0,
    tollMorsels: 5, contractRef: 'test:paidext.run', escrowParty: null, state: 'active',
    createdAt: now, createdBy: CALLER, updatedAt: now, ...over,
  };
  await persistEntitlement(storage, ent);
  return ent;
}

const call = () => authoriseMeteredCall({
  config, storage, caller: CALLER,
  product: { ext: 'paidext', action: 'run', label: 'paidext/run', providerOwner: 'sally' },
});

describe('a contracted call the chokepoint refuses for its limits', () => {
  it('for a paused contract, is refused before the pacing is charged', async () => {
    await contract({ state: 'paused' });
    const out = await call();
    expect(out.kind).toBe('inactive');
    expect(await balanceOf(CALLER)).toBe(100);
    expect(await balanceOf(PROVIDER)).toBe(50);
    expect(await pacingRows(CALLER)).toHaveLength(0);
  });

  it('for a full rate window, is refused before the pacing is charged', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await contract({
      pricing: {
        model: 'subscription', periodSeconds: 3600, periodPrice: 30, callsPerWindow: 2, windowSeconds: 3600,
        validUntil: future, windowStart: new Date().toISOString(), windowCount: 2,
      },
    });
    const out = await call();
    expect(out.kind).toBe('refused_rate');
    expect(await balanceOf(CALLER)).toBe(100);
    expect(await pacingRows(CALLER)).toHaveLength(0);
  });

  it('for a spent budget, is refused before the pacing is charged', async () => {
    await contract({ budget: { capUnits: 10, spentUnits: 10, calls: 5 } });
    const out = await call();
    expect(out.kind).toBe('refused_budget');
    expect(await balanceOf(CALLER)).toBe(100);
    expect(await pacingRows(CALLER)).toHaveLength(0);
  });

  it('for a grant at its carried ceiling, is refused before the provider pays the pacing', async () => {
    await contract({
      pricePerCall: 0,
      grant: {
        grantedBy: 'sally', listPricePerCall: 2, carriedUnits: 10, capCarriedUnits: 10, note: '', reason: null,
        issuedAt: new Date().toISOString(),
      },
    });
    const out = await call();
    expect(out.kind).toBe('refused_grant_cap');
    expect(await balanceOf(PROVIDER)).toBe(50);
    expect(await balanceOf(CALLER)).toBe(100);
    expect(await pacingRows(PROVIDER)).toHaveLength(0);
  });
});

describe('a contracted call whose settlement refuses after the pacing', () => {
  it('gives the pacing back when the morsel price cannot be covered', async () => {
    await contract();
    // 6 covers the pacing (5) but not the pacing and the price (7).
    await storage.debitBalance(CALLER, 94);
    const out = await call();
    expect(out.kind).toBe('insufficient');
    expect(await balanceOf(CALLER)).toBe(6);
    expect(await balanceOf(PROVIDER)).toBe(50);
  });
});

describe('usage kept', () => {
  it('an allowed contracted call is paced once, settled, and the provider is credited', async () => {
    await contract();
    const out = await call();
    expect(out.kind).toBe('settled');
    // Pacing 5 plus the morsel price 2; burn rate 0 and rake 0, so the provider gets all 7.
    expect(await balanceOf(CALLER)).toBe(93);
    expect(await balanceOf(PROVIDER)).toBe(57);
    // The morsel price is charged through chargePacing too, under the label `exchange:…`; the pacing
    // of the use is the one row under the product's own label.
    const paced = (await pacingRows(CALLER)).filter(t => (t.trackingCode ?? '').startsWith('pacing:paidext/run:'));
    expect(paced).toHaveLength(1);
  });

  it('a caller short of the pacing on an active contract still hears insufficient', async () => {
    await contract();
    await storage.debitBalance(CALLER, 97);
    const out = await call();
    expect(out.kind).toBe('insufficient');
    expect(await balanceOf(CALLER)).toBe(3);
  });
});
