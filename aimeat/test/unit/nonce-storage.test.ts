/**
 * @file nonce-storage.test.ts
 * @description Unit tests for verification nonce CRUD and expiry
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { VerificationNonceRecord } from '../../src/storage/interface.js';

function makeInMemoryNonceStorage() {
  const nonces = new Map<string, VerificationNonceRecord>();

  return {
    nonces,
    async createVerificationNonce(record: VerificationNonceRecord) {
      if ([...nonces.values()].some(n => n.state === record.state)) {
        throw new Error('UNIQUE constraint failed: state');
      }
      nonces.set(record.id, record);
      return record;
    },
    async getVerificationNonce(state: string) {
      return [...nonces.values()].find(n => n.state === state) ?? null;
    },
    async deleteVerificationNonce(state: string) {
      for (const [id, n] of nonces) {
        if (n.state === state) { nonces.delete(id); break; }
      }
    },
    async cleanExpiredNonces() {
      const now = new Date().toISOString();
      let count = 0;
      for (const [id, n] of nonces) {
        if (n.expiresAt < now) { nonces.delete(id); count++; }
      }
      return count;
    },
  };
}

function makeNonce(overrides: Partial<VerificationNonceRecord> = {}): VerificationNonceRecord {
  const now = new Date();
  return {
    id: `nonce-${Math.random().toString(36).slice(2, 8)}`,
    owner: 'testuser',
    type: 'eudiw',
    state: `state-${Math.random().toString(36).slice(2, 12)}`,
    nonce: `nonce-${Math.random().toString(36).slice(2, 12)}`,
    redirectUri: '',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    ...overrides,
  };
}

describe('Verification Nonce Storage', () => {
  let storage: ReturnType<typeof makeInMemoryNonceStorage>;

  beforeEach(() => {
    storage = makeInMemoryNonceStorage();
  });

  it('creates and retrieves a nonce by state', async () => {
    const record = makeNonce({ state: 'unique-state-1' });
    await storage.createVerificationNonce(record);
    const found = await storage.getVerificationNonce('unique-state-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(record.id);
    expect(found!.owner).toBe('testuser');
    expect(found!.type).toBe('eudiw');
  });

  it('returns null for non-existent state', async () => {
    const found = await storage.getVerificationNonce('does-not-exist');
    expect(found).toBeNull();
  });

  it('enforces unique state constraint', async () => {
    const record1 = makeNonce({ state: 'dup-state' });
    const record2 = makeNonce({ state: 'dup-state' });
    await storage.createVerificationNonce(record1);
    await expect(storage.createVerificationNonce(record2)).rejects.toThrow('UNIQUE');
  });

  it('deletes a nonce by state', async () => {
    const record = makeNonce({ state: 'to-delete' });
    await storage.createVerificationNonce(record);
    await storage.deleteVerificationNonce('to-delete');
    const found = await storage.getVerificationNonce('to-delete');
    expect(found).toBeNull();
  });

  it('cleanExpiredNonces removes expired nonces and returns count', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 300_000).toISOString();
    await storage.createVerificationNonce(makeNonce({ state: 'expired-1', expiresAt: past }));
    await storage.createVerificationNonce(makeNonce({ state: 'expired-2', expiresAt: past }));
    await storage.createVerificationNonce(makeNonce({ state: 'still-valid', expiresAt: future }));

    const cleaned = await storage.cleanExpiredNonces();
    expect(cleaned).toBe(2);
    expect(await storage.getVerificationNonce('still-valid')).not.toBeNull();
    expect(await storage.getVerificationNonce('expired-1')).toBeNull();
  });

  it('stores eudiw and ftn types', async () => {
    await storage.createVerificationNonce(makeNonce({ state: 'eudiw-state', type: 'eudiw' }));
    await storage.createVerificationNonce(makeNonce({ state: 'ftn-state', type: 'ftn' }));
    expect((await storage.getVerificationNonce('eudiw-state'))!.type).toBe('eudiw');
    expect((await storage.getVerificationNonce('ftn-state'))!.type).toBe('ftn');
  });
});
