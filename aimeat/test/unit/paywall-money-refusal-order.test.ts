/**
 * @file test/unit/paywall-money-refusal-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The raw-invoke paywall (routes/extensions/paywall.ts) refuses a money-priced action's
 *   call that brings no usable pay token, or comes from an app without the spend permission, before
 *   it charges the pacing. It charged the pacing first and credited the provider, then refused and
 *   reversed the charge, and a reversal gives back only what the provider still holds
 *   (secaudit 2026-10-31 inv-08). Usage kept: a valid pay token is consumed once, the pacing is
 *   charged and the call goes on. Real in-memory SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/paywall-money-refusal-order.test.ts
 * @version-history
 *   v1.1.0 -- 2026-10-31 -- A caller short of the pacing gets INSUFFICIENT_MORSELS before the money
 *     price is asked, and keeps an unspent pay token for the retry (inv-08 capability-loss review).
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-08).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { enforcePaywall } from '../../src/routes/extensions/paywall.js';
import { mintExtPayToken } from '../../src/services/ext-pay-token.js';
import { createRefusalRecorder } from '../../src/routes/extensions/metered-response.js';

const NODE = 'paywall-node';
const CALLER = `bob@${NODE}`;
const PROVIDER = `sally@${NODE}`;
const config = {
  nodeId: NODE, burnRate: 0, marketplaceFeeMode: 'burn', pacingTollDefault: 0, extensionMaxDebitPerCall: 1000,
} as unknown as AimeatConfig;

let storage: SqliteStorage;
async function person(ghii: string, balance: number): Promise<void> {
  const name = ghii.split('@')[0]!;
  await storage.createGHII({
    username: name, nodeId: NODE, ghii, displayName: name,
    verificationLevel: 0, ownerName: name, createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z',
  } as never);
  if (balance > 0) await storage.creditBalance(ghii, balance);
}
const balanceOf = async (ghii: string): Promise<number> => Number((await storage.getGHII(ghii))?.morselBalance ?? 0);

const ext = {
  name: 'paidext', installedBy: 'sally', status: 'active', config: {},
  actions: [{ id: 'run', method: 'POST', path: '/run', tollMorsels: 5, commercial: { payMoney: { amount: 1_000_000, currency: 'EUR' } } }],
} as unknown as ExtensionRecord;
const action = ext.actions[0]!;

beforeEach(async () => {
  storage = new SqliteStorage(':memory:');
  await person(CALLER, 100);
  await person(PROVIDER, 0);
  // The provider spends what it is credited at once: a reversal can then take nothing back from it.
  const credit = storage.creditBalance.bind(storage);
  storage.creditBalance = async (ghii: string, amount: number) => {
    const done = await credit(ghii, amount);
    if (ghii === PROVIDER) await storage.debitBalance(PROVIDER, amount);
    return done;
  };
});

const call = (extra: { payToken?: string; session?: { roles: string[]; scopes: string[]; appGrantId?: string | null } }) => {
  const res = createRefusalRecorder();
  return enforcePaywall({ config, storage: storage as unknown as Storage, ext, action, callerGaii: CALLER, res, ...extra })
    .then(out => ({ out, refusal: res.refusal }));
};

describe('a money-priced raw call the paywall refuses', () => {
  it('without a pay token, is refused before the pacing is charged', async () => {
    const { out, refusal } = await call({});
    expect(out.ok).toBe(false);
    expect(refusal?.status).toBe(402);
    expect(await balanceOf(CALLER)).toBe(100);
  });

  it('with a pay token minted for another action, is refused before the pacing is charged', async () => {
    const { token } = await mintExtPayToken(storage as unknown as Storage, { buyerOwner: 'bob', ext: 'paidext', action: 'other' } as never);
    const { out, refusal } = await call({ payToken: token });
    expect(out.ok).toBe(false);
    expect(refusal?.status).toBe(402);
    expect(await balanceOf(CALLER)).toBe(100);
  });

  it('from an app without the spend permission, is refused before the pacing is charged', async () => {
    const { out, refusal } = await call({ session: { roles: ['app'], scopes: ['memory:read'], appGrantId: null } });
    expect(out.ok).toBe(false);
    expect(refusal?.status).toBe(403);
    expect(await balanceOf(CALLER)).toBe(100);
  });

  it('from a caller short of the pacing, is refused for morsels before it asks for money', async () => {
    await storage.debitBalance(CALLER, 97);
    const { out, refusal } = await call({});
    expect(out.ok).toBe(false);
    expect(refusal?.status).toBe(402);
    expect((refusal?.body as { error?: { code?: string } })?.error?.code).toBe('INSUFFICIENT_MORSELS');
    expect(await balanceOf(CALLER)).toBe(3);
  });

  it('usage kept: a caller short of the pacing keeps an unspent pay token for the retry', async () => {
    await storage.debitBalance(CALLER, 97);
    const { token } = await mintExtPayToken(storage as unknown as Storage, { buyerOwner: 'bob', ext: 'paidext', action: 'run' } as never);
    const short = await call({ payToken: token });
    expect((short.refusal?.body as { error?: { code?: string } })?.error?.code).toBe('INSUFFICIENT_MORSELS');
    await storage.creditBalance(CALLER, 2);
    const { out } = await call({ payToken: token });
    expect(out.ok).toBe(true);
    expect(await balanceOf(CALLER)).toBe(0);
  });

  it('usage kept: a valid pay token is consumed once, the pacing is charged, and the call goes on', async () => {
    const { token } = await mintExtPayToken(storage as unknown as Storage, { buyerOwner: 'bob', ext: 'paidext', action: 'run' } as never);
    const { out } = await call({ payToken: token });
    expect(out.ok).toBe(true);
    expect(await balanceOf(CALLER)).toBe(95);
    const again = await call({ payToken: token });
    expect(again.out.ok).toBe(false);
    expect(again.refusal?.status).toBe(402);
  });
});
