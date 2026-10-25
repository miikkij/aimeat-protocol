/**
 * @file test/unit/docsign-wallet-caveats.test.ts
 * @description A wallet signature whose certificate's revocation status could not be established is
 *   still sealed, and the sealed statement, the signature checks and the public lookup carry the
 *   recorded caveat REVOCATION_UNKNOWN (secaudit2026oct22, lead 3895; developer decision 2026-10-25).
 *   A certificate whose status is good is sealed with no caveat, so its statement has no such field.
 *   The caveat is covered by the seal: a statement with the caveat taken out does not verify.
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 3895).
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { walletCaveats } from '../../src/services/docsign/eudi.js';
import { verifySeal } from '../../src/services/docsign/statement.js';
import type { SignatureReport } from '../../src/services/docsign/validate.js';
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
  return { storage, config: { nodeId: 'n' } as AimeatConfig };
}

const report = (status: string) => ({ revocation: { status, source: null, revokedAt: null, producedAt: null, notes: [] } }) as unknown as SignatureReport;

const evidence = (signedSha: string, revocation: string): WalletEvidence => ({
  protocol: 'eudi-rqes-document-retrieval/1', clientId: 'node', signatureQualifier: 'eu_eidas_qes',
  input: { sha256: INPUT, size: 10 }, signed: { sha256: signedSha, size: 20, owner: ALICE, key: 'docsign/x/d-signed.pdf' },
  certificate: { subject: 'CN=Alice', issuer: 'Trusted CA', serialNumber: '01', sha256: null },
  validation: { verdict: 'indeterminate', level: 'unknown', reasons: [], trustSource: 'operator-anchor', test: false },
  nameMatches: true,
  ...(walletCaveats(report(revocation)).length ? { caveats: walletCaveats(report(revocation)) } : {}),
});

describe('walletCaveats', () => {
  it('names REVOCATION_UNKNOWN for a status that is not good, and nothing for a good one', () => {
    for (const status of ['unknown', 'unchecked']) {
      expect(walletCaveats(report(status)).map(c => c.code)).toEqual(['REVOCATION_UNKNOWN']);
      expect(walletCaveats(report(status))[0]!.text).toMatch(/revoked could not be established/);
    }
    expect(walletCaveats(report('good'))).toEqual([]);
  });
});

describe('a wallet signature whose revocation status is not known', () => {
  it('is sealed with the caveat, and the checks and the public lookup carry it', async () => {
    const id = 'ds-00000000-0000-4000-8000-0000000000c1';
    const ctx = await world(id);
    const rec = await recordWalletSignature(ctx, id, ALICE, INPUT, evidence('c'.repeat(64), 'unknown'), 'd-signed.pdf');
    const st = rec.signatures[ALICE]!.statement;
    expect(st.caveats?.map(c => c.code)).toEqual(['REVOCATION_UNKNOWN']);
    const checks = await verifyRecordSignatures(ctx, rec);
    expect(checks[0]!.valid).toBe(true);
    expect(checks[0]!.caveats.map(c => c.code)).toEqual(['REVOCATION_UNKNOWN']);
    const pub = await publicView(ctx, rec);
    expect(pub.signatures[0]!.caveats.map(c => c.code)).toEqual(['REVOCATION_UNKNOWN']);
    // The seal covers the caveat: the statement without it does not verify.
    const { caveats: _gone, ...without } = st;
    expect(await verifySeal(without, rec.signatures[ALICE]!.seal)).toBe(false);
  });

  it('a certificate whose status is good is sealed with no caveat field', async () => {
    const id = 'ds-00000000-0000-4000-8000-0000000000c2';
    const ctx = await world(id);
    const rec = await recordWalletSignature(ctx, id, ALICE, INPUT, evidence('d'.repeat(64), 'good'), 'd-signed.pdf');
    expect('caveats' in rec.signatures[ALICE]!.statement).toBe(false);
    expect((await verifyRecordSignatures(ctx, rec))[0]!.caveats).toEqual([]);
    expect((await publicView(ctx, rec)).signatures[0]!.caveats).toEqual([]);
  });
});
