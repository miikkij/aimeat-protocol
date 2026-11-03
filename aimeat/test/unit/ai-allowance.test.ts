/**
 * @file ai-allowance.test.ts
 * @description Unit tests for whose key pays and how much of the node's key one person may use.
 *
 *   Two properties matter more than the arithmetic. A person with their OWN key must never be
 *   metered — it is their provider account, and a node that quietly counted their spend against a
 *   local balance would be inventing a limit nobody agreed to. And a node with no key of its own
 *   must behave exactly as it did before this file existed, because that is every node today.
 * @usage cd aimeat && pnpm vitest run test/unit/ai-allowance.test.ts
 * @version-history
 *   v1.3.0 — 2026-11-04 — The resolveAiKey cases are removed with the function, which production had
 *     not called since 2026-09-28; which key pays is the AI planner's (services/ai/route-plan.ts), and
 *     the node key's address rule is proven on the live path by e2e-ai-provider-stub and
 *     e2e-own-key-roads (codebase analysis 2026-11-03, item A10).
 *   v1.2.0 — 2026-10-05 — nodeKeyStanding: refuse pays nothing past the allowance; limits pays up to
 *     the account's and the node's caps for the UTC day (secaudit 2026-10, AI-1).
 *   v1.1.0 — 2026-09-16 — the node key goes only to OpenRouter's own address; an own key still goes
 *     anywhere, localhost included.
 *   v1.0.0 — 2026-08-16 — initial: selection order, the free grant applied once, debit and grant,
 *     exhaustion, and the untouched-node case.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  readAllowance, debitAllowance, grantAllowance, remainingOf, nodeKeyStanding,
} from '../../src/services/ai-allowance.js';

const TEST_ENC_KEY_HEX = 'a'.repeat(64);

const NODE = 'node-test';
const GAII = `alice@${NODE}`;

function cfg(over: Partial<Record<string, unknown>> = {}): AimeatConfig {
  return {
    nodeId: NODE,
    encryptionKey: TEST_ENC_KEY_HEX,
    totpSecretEncryptionKey: null,
    openrouterInstanceKey: '',
    chatFreeAllowanceUsd: 0,
    modelFreeFallback: 'openrouter/free',
    ...over,
  } as unknown as AimeatConfig;
}

function assert(cond: boolean, msg: string): void {
  expect(cond, msg).toBe(true);
}

async function freshStorage(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:');
  const now = new Date().toISOString();
  const ghii: GHIIRecord = {
    username: 'alice', nodeId: NODE, ghii: GAII, displayName: 'alice',
    verificationLevel: 0, ownerName: 'alice', createdAt: now, updatedAt: now, totpEnabled: false,
  };
  await storage.createGHII(ghii);
  return storage as unknown as Storage;
}

describe('the allowance itself', () => {
  it('applies the free grant once, not once per read', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatFreeAllowanceUsd: 3 });

    const first = await readAllowance(storage, config, GAII);
    const second = await readAllowance(storage, config, GAII);
    const third = await readAllowance(storage, config, GAII);

    assert(first.granted_usd === 3, `granted once, got ${first.granted_usd}`);
    assert(second.granted_usd === 3 && third.granted_usd === 3,
      `still three after three reads, got ${second.granted_usd} and ${third.granted_usd}`);
    assert(first.free_granted === true, 'the grant is marked as applied');

    storage.close?.();
  });

  it('grants nothing when the node offers nothing', async () => {
    const storage = await freshStorage();
    const rec = await readAllowance(storage, cfg(), GAII);
    assert(rec.granted_usd === 0 && remainingOf(rec) === 0, 'no free amount means no balance');
    storage.close?.();
  });

  it('debits accumulate and a purchase tops the balance back up', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatFreeAllowanceUsd: 1 });

    await debitAllowance(storage, config, GAII, 0.4);
    await debitAllowance(storage, config, GAII, 0.4);
    let rec = await readAllowance(storage, config, GAII);
    assert(Math.abs(remainingOf(rec) - 0.2) < 1e-9, `0.20 left, got ${remainingOf(rec)}`);

    rec = await grantAllowance(storage, config, GAII, 5, 'purchase');
    assert(Math.abs(remainingOf(rec) - 5.2) < 1e-9, `5.20 after a top-up, got ${remainingOf(rec)}`);
    assert(rec.spent_usd === 0.8, 'spending is not erased by a grant');

    storage.close?.();
  });

  it('a zero or negative charge changes nothing', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatFreeAllowanceUsd: 1 });
    await debitAllowance(storage, config, GAII, 0);
    await debitAllowance(storage, config, GAII, -5);
    const rec = await readAllowance(storage, config, GAII);
    assert(rec.spent_usd === 0, `nothing was charged, got ${rec.spent_usd}`);
    storage.close?.();
  });

  it('refuses a non-positive grant rather than recording a meaningless one', async () => {
    const storage = await freshStorage();
    await expect(grantAllowance(storage, cfg(), GAII, 0, 'oops')).rejects.toThrow();
    await expect(grantAllowance(storage, cfg(), GAII, -1, 'oops')).rejects.toThrow();
    storage.close?.();
  });
});

describe('nodeKeyStanding: what the node\'s key does once an allowance is spent (secaudit 2026-10, AI-1)', () => {
  const BOB = `bob@${NODE}`;

  it('pays while the allowance lasts, whatever the mode', async () => {
    const storage = await freshStorage();
    const s = await nodeKeyStanding(storage, cfg({ chatFreeAllowanceUsd: 1, aiNodeKeyWhenSpent: 'refuse' }), GAII);
    assert(s.mayPay && Math.abs(s.remainingUsd - 1) < 1e-9, `pays with 1.00 left, got ${JSON.stringify(s)}`);
    storage.close?.();
  });

  it('refuse (the default): a spent allowance pays for nothing more', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatFreeAllowanceUsd: 0.5, aiNodeKeyWhenSpent: 'refuse', aiNodeKeyAccountDailyUsd: 100, aiNodeKeyNodeDailyUsd: 100 });
    await debitAllowance(storage, config, GAII, 0.5);
    const s = await nodeKeyStanding(storage, config, GAII);
    assert(!s.mayPay && s.reason === 'allowance-spent', `refused, got ${JSON.stringify(s)}`);
    storage.close?.();
  });

  it('limits: a spent allowance keeps paying until the account\'s cap for the day', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatFreeAllowanceUsd: 0.5, aiNodeKeyWhenSpent: 'limits', aiNodeKeyAccountDailyUsd: 1, aiNodeKeyNodeDailyUsd: 100 });
    await debitAllowance(storage, config, GAII, 0.5);
    let s = await nodeKeyStanding(storage, config, GAII);
    assert(s.mayPay && s.remainingUsd === 0, `pays past the allowance, got ${JSON.stringify(s)}`);
    await debitAllowance(storage, config, GAII, 0.6);
    s = await nodeKeyStanding(storage, config, GAII);
    assert(!s.mayPay && s.reason === 'account-daily-limit', `the account's cap (1.10 of 1.00 today), got ${JSON.stringify(s)}`);
    storage.close?.();
  });

  it('limits: the cap for all accounts stops a second account too', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatFreeAllowanceUsd: 0, aiNodeKeyWhenSpent: 'limits', aiNodeKeyAccountDailyUsd: 100, aiNodeKeyNodeDailyUsd: 1 });
    await debitAllowance(storage, config, GAII, 1.2);
    const bob = await nodeKeyStanding(storage, config, BOB);
    assert(!bob.mayPay && bob.reason === 'node-daily-limit', `the node's cap, got ${JSON.stringify(bob)}`);
    storage.close?.();
  });

  it('limits: yesterday\'s spend does not count today', async () => {
    const storage = await freshStorage();
    const config = cfg({ chatFreeAllowanceUsd: 0, aiNodeKeyWhenSpent: 'limits', aiNodeKeyAccountDailyUsd: 1, aiNodeKeyNodeDailyUsd: 100 });
    await debitAllowance(storage, config, GAII, 2);
    const rec = await readAllowance(storage, config, GAII);
    const now = new Date().toISOString();
    await storage.setMemory({ key: `ai-usage.allowance.${GAII}`, ownerGaii: GAII, value: { ...rec, day: '2000-01-01' } as unknown as Record<string, unknown>,
      visibility: 'private', tags: [], ttlHours: null, version: 99, createdAt: now, updatedAt: now });
    const s = await nodeKeyStanding(storage, config, GAII);
    assert(s.mayPay, `a new day, got ${JSON.stringify(s)}`);
    storage.close?.();
  });
});

describe('calls that settle at the same moment (secaudit2026oct22)', () => {
  it('count every debit once', async () => {
    const storage = await freshStorage();
    const config = cfg({ openrouterInstanceKey: 'sk-node' });
    await grantAllowance(storage, config, GAII, 10, 'test');
    await Promise.all(Array.from({ length: 20 }, () => debitAllowance(storage, config, GAII, 0.1)));
    const rec = await readAllowance(storage, config, GAII);
    expect(rec.spent_usd).toBeCloseTo(2.0, 6);
    expect(rec.day_spent_usd).toBeCloseTo(2.0, 6);
    storage.close?.();
  });

  it('keep a grant that lands among debits', async () => {
    const storage = await freshStorage();
    const config = cfg({ openrouterInstanceKey: 'sk-node' });
    await grantAllowance(storage, config, GAII, 1, 'test');
    await Promise.all([
      debitAllowance(storage, config, GAII, 0.25),
      grantAllowance(storage, config, GAII, 5, 'test'),
      debitAllowance(storage, config, GAII, 0.25),
    ]);
    const rec = await readAllowance(storage, config, GAII);
    expect(rec.granted_usd).toBeCloseTo(6, 6);
    expect(rec.spent_usd).toBeCloseTo(0.5, 6);
    storage.close?.();
  });
});
