/**
 * @file attestation-verify.test.ts
 * @description verifyAttestation (src/services/attestation.ts) is the public "is this deed real"
 *   answer, and the E2E suite only ever observes it answering true. This file makes it answer false:
 *   a completed attestation signed with real Ed25519 keys verifies, and the same record with its
 *   payload altered, with one signature replaced by another party's, or with a party whose key is
 *   gone, does not. Driven against real in-memory SQLite (audit M268).
 * @usage cd aimeat && pnpm exec vitest run test/unit/attestation-verify.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (audit M268).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import {
  createAttestation, signAttestation, verifyAttestation, attestMessage, canonicalJson, type AttestationRecord,
} from '../../src/services/attestation.js';

const NODE = 'aimeat-test-001-attest';
const ALICE = `alice@${NODE}`;
const BOB = `bob@${NODE}`;
const config = { nodeId: NODE } as AimeatConfig;
let storage: Storage;
let completed: AttestationRecord;
let aliceKey = '';

beforeAll(async () => {
  setThisNodeId(NODE);
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  const keys: Record<string, string> = {};
  for (const name of ['alice', 'bob']) {
    const kp = await generateKeyPair();
    keys[name] = kp.privateKey;
    await storage.createOwner({ name, displayName: name, publicKey: kp.publicKey, roles: ['owner'], createdAt: new Date().toISOString() } as never);
  }
  aliceKey = keys.alice;
  const att = await createAttestation(storage, config, {
    payload: { deed: 'trade', amount: 3, items: ['a', 'b'] }, parties: [ALICE, BOB], creatorIdentity: ALICE,
  });
  for (const [who, key] of [[ALICE, keys.alice], [BOB, keys.bob]] as const) {
    completed = await signAttestation(storage, config, {
      id: att.id, signerIdentity: who, signature: await sign(key, attestMessage(att.id, att.payloadHash)),
    });
  }
}, 60_000);

afterAll(() => { setThisNodeId(null); });

const copy = (a: AttestationRecord): AttestationRecord => JSON.parse(JSON.stringify(a));

describe('verifyAttestation', () => {
  it('verifies a completed attestation both parties signed', async () => {
    expect(completed.state).toBe('complete');
    expect(await verifyAttestation(storage, completed)).toBe(true);
  });

  it('refuses a record whose payload was altered after signing', async () => {
    const altered = copy(completed);
    (altered.payload as { amount: number }).amount = 300;
    expect(await verifyAttestation(storage, altered)).toBe(false);
  });

  it('refuses a record whose payload hash was rewritten to match an altered payload', async () => {
    // The hash recomputes, so only the signatures can catch this one.
    const altered = copy(completed);
    (altered.payload as { amount: number }).amount = 300;
    altered.payloadHash = createHash('sha256').update(canonicalJson(altered.payload)).digest('hex');
    expect(await verifyAttestation(storage, altered)).toBe(false);
  });

  it('refuses a record where one party\'s signature bytes are another party\'s', async () => {
    const swapped = copy(completed);
    swapped.signatures[BOB] = { ...swapped.signatures[BOB], signature: swapped.signatures[ALICE].signature };
    expect(await verifyAttestation(storage, swapped)).toBe(false);
  });

  it('refuses a completed record a party never signed', async () => {
    const missing = copy(completed);
    delete missing.signatures[BOB];
    expect(await verifyAttestation(storage, missing)).toBe(false);
  });

  it('refuses a signature made over another attestation id', async () => {
    const other = copy(completed);
    other.signatures[ALICE] = { ...other.signatures[ALICE], signature: await sign(aliceKey, attestMessage('att-other', other.payloadHash)) };
    expect(await verifyAttestation(storage, other)).toBe(false);
  });
});
