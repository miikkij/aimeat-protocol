/**
 * @file psp-secrets.test.ts
 * @description Unit tests for the seller's payment secrets at rest (src/commerce/psp-secrets.ts):
 *   the boot pass that encrypts records written in plain text, and the open that the Stripe
 *   handler and the webhook verifier use.
 * @usage cd aimeat && pnpm vitest run test/unit/psp-secrets.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-16 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { sealStoredPspRecords, openPspSecret, pspSecretHint, isSealedPspSecret } from '../../src/commerce/psp-secrets.js';

const KEY_HEX = 'b'.repeat(64);
const WITH_KEY = { encryptionKey: KEY_HEX, totpSecretEncryptionKey: null };
const NO_KEY = { encryptionKey: null, totpSecretEncryptionKey: null };
const SELLER = 'seller@node-test';
const STRIPE = 'sk_test_plain_legacy_4f2a';
const HOOK = 'whsec_plain_legacy_91bd';

async function storageWithPlainRecord(): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  await storage.setMemory({
    key: 'commerce.psp', ownerGaii: SELLER, visibility: 'private', tags: ['commerce'], ttlHours: null,
    value: { provider: 'stripe', secretKey: STRIPE, webhookSecret: HOOK, payTo: '0x' + 'ab'.repeat(20) },
    version: 1, createdAt: now, updatedAt: now,
  });
  return storage;
}

describe('sealStoredPspRecords', () => {
  it('encrypts a plain record, keeps the other fields, and the handler still opens the key', async () => {
    const storage = await storageWithPlainRecord();
    expect(await sealStoredPspRecords(storage, WITH_KEY)).toBe(1);
    const v = (await storage.getMemory(SELLER, 'commerce.psp'))!.value as Record<string, unknown>;
    expect(JSON.stringify(v)).not.toContain(STRIPE);
    expect(JSON.stringify(v)).not.toContain(HOOK);
    expect(isSealedPspSecret(v.secretKey)).toBe(true);
    expect(v.payTo).toBe('0x' + 'ab'.repeat(20));
    expect(pspSecretHint(v.secretKey)).toBe('…4f2a');
    expect(openPspSecret(WITH_KEY, v.secretKey)).toBe(STRIPE);
    expect(openPspSecret(WITH_KEY, v.webhookSecret)).toBe(HOOK);
  });

  it('is idempotent: a sealed record is left as it is', async () => {
    const storage = await storageWithPlainRecord();
    await sealStoredPspRecords(storage, WITH_KEY);
    const first = (await storage.getMemory(SELLER, 'commerce.psp'))!;
    expect(await sealStoredPspRecords(storage, WITH_KEY)).toBe(0);
    const second = (await storage.getMemory(SELLER, 'commerce.psp'))!;
    expect(second.version).toBe(first.version);
  });

  it('changes nothing on a node with no encryption key', async () => {
    const storage = await storageWithPlainRecord();
    expect(await sealStoredPspRecords(storage, NO_KEY)).toBe(0);
    const v = (await storage.getMemory(SELLER, 'commerce.psp'))!.value as Record<string, unknown>;
    expect(v.secretKey).toBe(STRIPE);
  });
});

describe('openPspSecret', () => {
  it('reads a plain legacy string, and answers empty for a value this node cannot open', async () => {
    expect(openPspSecret(WITH_KEY, STRIPE)).toBe(STRIPE);
    const storage = await storageWithPlainRecord();
    await sealStoredPspRecords(storage, WITH_KEY);
    const v = (await storage.getMemory(SELLER, 'commerce.psp'))!.value as Record<string, unknown>;
    expect(openPspSecret({ encryptionKey: 'c'.repeat(64), totpSecretEncryptionKey: null }, v.secretKey)).toBe('');
    expect(openPspSecret(NO_KEY, v.secretKey)).toBe('');
    expect(openPspSecret(WITH_KEY, undefined)).toBe('');
  });
});
