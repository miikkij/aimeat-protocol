/**
 * @file test/unit/docsign-wallet-test-mark.test.ts
 * @description A wallet signature whose certificate chains to an EU reference-wallet test CA is
 *   sealed with `test: true`, and the signature checks and the public lookup say `test: true`, so a
 *   counterparty who checks the document by its hash sees it is a test. A wallet signature from any
 *   other trusted root is sealed without the field, so its statement is byte-for-byte what it was.
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, test-anchored wallet signature mark).
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import {
  recordWalletSignature, verifyRecordSignatures, publicView, type DocSignRecord, type WalletEvidence,
} from '../../src/services/docsign/records.js';

const NS = 'sys:docsign';
const ALICE = 'alice@n';
const INPUT = 'a'.repeat(64);

async function world(id: string) {
  const rec: DocSignRecord = {
    v: 1, id, state: 'open', title: 't', message: null,
    document: { sha256: INPUT, name: 'd.pdf', size: 10, mediaType: 'application/pdf' },
    parties: [{ identity: ALICE, name: 'Alice' }], signatures: {}, createdBy: ALICE,
    createdAt: '2026-10-10T00:00:00.000Z', completedAt: null, cancelledAt: null,
  };
  const mem = new Map<string, Record<string, unknown>>();
  mem.set(`docsign.req.${id}`, { key: `docsign.req.${id}`, ownerGaii: NS, value: rec, version: 1, createdAt: rec.createdAt, updatedAt: rec.createdAt });
  const nodeKey = await generateKeyPair();
  const storage = {
    getMemory: async (ns: string, key: string) => (ns === NS ? mem.get(key) ?? null : null),
    setMemory: async (r: Record<string, unknown>) => { mem.set(String(r.key), r); },
    getGHII: async () => ({ verificationLevel: 1, displayName: 'Alice' }),
    getNodeKey: async () => nodeKey,
  } as unknown as Storage;
  return { ctx: { storage, config: { nodeId: 'n' } as AimeatConfig }, mem };
}

const evidence = (test: boolean, signedSha: string): WalletEvidence => ({
  protocol: 'eudi-rqes-document-retrieval/1', clientId: 'node', signatureQualifier: 'eu_eidas_qes',
  input: { sha256: INPUT, size: 10 }, signed: { sha256: signedSha, size: 20, owner: ALICE, key: 'docsign/x/d-signed.pdf' },
  certificate: { subject: 'CN=Alice', issuer: 'Test CA', serialNumber: '01', sha256: null },
  validation: { verdict: 'valid', level: 'unknown', reasons: test ? ['TEST_TRUST_ANCHOR'] : [], trustSource: test ? 'eudi-test-anchor' : 'operator-anchor', test },
  nameMatches: true,
});

describe('a wallet signature from an EU reference-wallet test certificate', () => {
  it('is sealed, checked and published as a test', async () => {
    const id = 'ds-00000000-0000-4000-8000-0000000000a1';
    const { ctx } = await world(id);
    const rec = await recordWalletSignature(ctx, id, ALICE, INPUT, evidence(true, 'c'.repeat(64)), 'd-signed.pdf');
    expect(rec.signatures[ALICE]!.statement.test).toBe(true);
    const checks = await verifyRecordSignatures(ctx, rec);
    expect(checks[0]!.valid).toBe(true);
    expect(checks[0]!.test).toBe(true);
    const pub = await publicView(ctx, rec);
    expect(pub.signatures[0]!.test).toBe(true);
  });

  it('a wallet signature from another trusted root carries no test field, and its seal verifies', async () => {
    const id = 'ds-00000000-0000-4000-8000-0000000000a2';
    const { ctx } = await world(id);
    const rec = await recordWalletSignature(ctx, id, ALICE, INPUT, evidence(false, 'd'.repeat(64)), 'd-signed.pdf');
    expect('test' in rec.signatures[ALICE]!.statement).toBe(false);
    const checks = await verifyRecordSignatures(ctx, rec);
    expect(checks[0]!.valid).toBe(true);
    expect(checks[0]!.test).toBe(false);
    expect((await publicView(ctx, rec)).signatures[0]!.test).toBe(false);
  });
});
