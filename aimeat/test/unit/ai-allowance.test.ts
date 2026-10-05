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
  resolveAiKey, readAllowance, debitAllowance, grantAllowance, remainingOf, nodeKeyStanding,
} from '../../src/services/ai-allowance.js';
import { encrypt } from '../../src/services/encryption.js';

/** A key encrypted the way the settings route stores one, so the own-key branch runs for real.
 *  encrypt() takes the raw 32 bytes; config carries the same key as 64 hex characters. */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
const LMSTUDIO_URL = 'http://localhost:1234/v1';
const TEST_ENC_KEY_HEX = 'a'.repeat(64);
const TEST_ENC_KEY = Buffer.from(TEST_ENC_KEY_HEX, 'hex');
function encryptedOwnKey(): string {
  return encrypt('sk-or-the-persons-own-key', TEST_ENC_KEY);
}

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

describe('resolveAiKey', () => {
  it('leaves a node with no key of its own exactly as it was: no key means the old refusal', async () => {
    const storage = await freshStorage();
    await expect(resolveAiKey(storage, cfg(), GAII, 'openrouter', undefined, OPENROUTER_URL))
      .rejects.toThrow(/NO_API_KEY|No OpenRouter API key/);
    storage.close?.();
  });

  it('the person\'s OWN key wins, even on a node that has one, and is never metered', async () => {
    // The property that matters most here. Their key is their provider account and their rate
    // limits; a node that quietly counted their spend against a local balance would be inventing a
    // limit nobody agreed to, and would eventually refuse them for spending their own money.
    const storage = await freshStorage();
    const config = cfg({ openrouterInstanceKey: 'sk-node', chatFreeAllowanceUsd: 5 });
    // An encrypted own key. The value only has to be shaped like one; decryptOwnerKey is exercised
    // where encryption itself is tested.
    const own = { encrypted: encryptedOwnKey() };

    const choice = await resolveAiKey(storage, config, GAII, 'openrouter', own, OPENROUTER_URL);

    assert(choice.scope === 'own', `scope is own, got ${choice.scope}`);
    assert(choice.key !== 'sk-node', 'the node key was NOT used');
    assert(choice.exhausted === false, 'an own key is never exhausted');

    // And nothing was drawn down: the allowance is untouched, not even seeded.
    const rec = await readAllowance(storage, cfg({ chatFreeAllowanceUsd: 0 }), GAII);
    assert(rec.spent_usd === 0, `nothing spent, got ${rec.spent_usd}`);

    storage.close?.();
  });

  it('uses the node key when the person has none, and reports the allowance', async () => {
    const storage = await freshStorage();
    const config = cfg({ openrouterInstanceKey: 'sk-node', chatFreeAllowanceUsd: 2 });

    const choice = await resolveAiKey(storage, config, GAII, 'openrouter', undefined, OPENROUTER_URL);

    assert(choice.key === 'sk-node', `the node key is used, got ${choice.key}`);
    assert(choice.scope === 'node', `scope is node, got ${choice.scope}`);
    assert(choice.exhausted === false, 'a fresh allowance is not exhausted');
    assert(choice.remainingUsd === 2, `two dollars remain, got ${choice.remainingUsd}`);

    storage.close?.();
  });

  it('says exhausted once the allowance is spent, rather than refusing here', async () => {
    // The decision of what to do about it belongs to the caller: the chat path degrades to a free
    // model and says so, while transcription and image generation refuse, because there is no
    // free equivalent to degrade to.
    const storage = await freshStorage();
    const config = cfg({ openrouterInstanceKey: 'sk-node', chatFreeAllowanceUsd: 1 });

    await debitAllowance(storage, config, GAII, 1.5);
    const choice = await resolveAiKey(storage, config, GAII, 'openrouter', undefined, OPENROUTER_URL);

    assert(choice.exhausted === true, 'overspent means exhausted');
    assert(choice.remainingUsd === 0, `remaining never goes negative, got ${choice.remainingUsd}`);
    assert(choice.key === 'sk-node', 'the key is still returned; refusing is the caller\'s call');

    storage.close?.();
  });

  it('a person with no node key configured still gets the plain refusal', async () => {
    const storage = await freshStorage();
    await expect(resolveAiKey(storage, cfg({ chatFreeAllowanceUsd: 5 }), GAII, 'openrouter', undefined, OPENROUTER_URL))
      .rejects.toThrow(/NO_API_KEY|No OpenRouter API key/);
    storage.close?.();
  });

  it('a provider that needs no key is not turned into a refusal', async () => {
    // A local model server is the case: no key, and none required.
    const storage = await freshStorage();
    const choice = await resolveAiKey(storage, cfg(), GAII, 'lmstudio', undefined, LMSTUDIO_URL);
    assert(choice.key === undefined, 'no key, and that is fine');
    assert(choice.scope === 'own', 'nothing of the node was spent');
    storage.close?.();
  });

  it('THE LEAK: the node key never goes to an address the person chose', async () => {
    // A person with no key of their own saved baseUrl=https://attacker.example/ and the node sent
    // its own key there in the Authorization header. Any registered user could take it.
    const storage = await freshStorage();
    const config = cfg({ openrouterInstanceKey: 'sk-node', chatFreeAllowanceUsd: 5 });
    for (const url of ['https://attacker.example/api/v1', 'http://localhost:1234/v1', 'https://openrouter.ai.attacker.example/api/v1', 'not a url']) {
      await expect(resolveAiKey(storage, config, GAII, 'openrouter', undefined, url))
        .rejects.toThrow(/NODE_KEY_HOST|only to OpenRouter/);
    }
    storage.close?.();
  });

  it('the person\'s own key still goes to any address they chose, localhost included', async () => {
    const storage = await freshStorage();
    const config = cfg({ openrouterInstanceKey: 'sk-node', chatFreeAllowanceUsd: 5 });
    const choice = await resolveAiKey(storage, config, GAII, 'openrouter', { encrypted: encryptedOwnKey() }, 'http://localhost:1234/v1');
    assert(choice.scope === 'own' && choice.key !== 'sk-node', `own key, got ${choice.scope}`);
    storage.close?.();
  });
});

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
