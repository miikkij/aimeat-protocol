/**
 * @file test/unit/docsign-wallet-name.test.ts
 * @description A wallet signature is sealed as an account only when the signing certificate names
 *   the person behind it: the name an identity verification proved when the account has one, not the
 *   display name the account holder edits (secaudit2026oct22, lead 3924; developer decision
 *   2026-10-25). An account with no verified name seals on its display name with the caveat
 *   NAME_NOT_VERIFIED. The certificate subject goes into the sealed statement, the checks and the
 *   public lookup. The verified name lives under a service-owned key no memory route writes.
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 3924).
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { walletNameBinding, walletCaveats } from '../../src/services/docsign/eudi.js';
import { verifiedNameOfClaims, recordVerifiedName, readVerifiedName, VERIFIED_NAME_KEY } from '../../src/services/verified-name.js';
import { isServiceOwnedKey } from '../../src/utils/reserved-keys.js';
import type { SignatureReport } from '../../src/services/docsign/validate.js';
import {
  recordWalletSignature, verifyRecordSignatures, publicView, type DocSignRecord, type WalletEvidence,
} from '../../src/services/docsign/records.js';

describe('walletNameBinding', () => {
  it('compares with the verified name when the account has one, and the display name does not count', () => {
    expect(walletNameBinding('MEIKÄLÄINEN Matti', 'Matti Meikäläinen', 'Somebody Else')).toEqual({ matches: true, basis: 'verified' });
    // The display name was set to the certificate holder's name; the verified name is someone else's.
    expect(walletNameBinding('Somebody Else', 'Matti Meikäläinen', 'Somebody Else')).toEqual({ matches: false, basis: 'verified' });
  });
  it('compares with the display name when no verification recorded a name', () => {
    expect(walletNameBinding('Matti Meikäläinen', null, 'Matti Meikäläinen')).toEqual({ matches: true, basis: 'display-name' });
    expect(walletNameBinding('Matti Meikäläinen', undefined, 'Other Person')).toEqual({ matches: false, basis: 'display-name' });
  });
  it('a display-name match is sealed with the caveat NAME_NOT_VERIFIED', () => {
    const good = { revocation: { status: 'good' } } as unknown as SignatureReport;
    expect(walletCaveats(good, 'display-name').map(c => c.code)).toEqual(['NAME_NOT_VERIFIED']);
    expect(walletCaveats(good, 'verified')).toEqual([]);
  });
});

describe('the verified name', () => {
  it('is read from the given and family name a verification carries', () => {
    expect(verifiedNameOfClaims({ given_name: 'Matti', family_name: 'Meikäläinen', birthdate: '1980-01-01' })).toBe('Matti Meikäläinen');
    expect(verifiedNameOfClaims({ birthdate: '1980-01-01' })).toBeNull();
  });
  it('is kept under a service-owned key, which no memory route writes', async () => {
    expect(isServiceOwnedKey(VERIFIED_NAME_KEY)).toBe(true);
    const mem = new Map<string, Record<string, unknown>>();
    const storage = {
      getMemory: async (o: string, k: string) => mem.get(`${o}|${k}`) ?? null,
      setMemory: async (r: Record<string, unknown>) => { mem.set(`${r.ownerGaii}|${r.key}`, r); },
    } as unknown as Storage;
    expect(await readVerifiedName(storage, 'matti@n')).toBeNull();
    await recordVerifiedName(storage, 'matti@n', 'Matti Meikäläinen', 'ftn');
    expect(await readVerifiedName(storage, 'matti@n')).toMatchObject({ name: 'Matti Meikäläinen', method: 'ftn' });
  });
});

describe('the sealed statement of a wallet signature', () => {
  it('names the certificate subject and issuer, and the checks and the public lookup show them', async () => {
    const id = 'ds-00000000-0000-4000-8000-0000000000d1';
    const ALICE = 'alice@n', INPUT = 'a'.repeat(64), NS = 'sys:docsign';
    const rec: DocSignRecord = {
      v: 1, id, state: 'open', title: 't', message: null,
      document: { sha256: INPUT, name: 'd.pdf', size: 10, mediaType: 'application/pdf' },
      parties: [{ identity: ALICE, name: 'Alice' }], signatures: {}, createdBy: ALICE,
      createdAt: '2026-10-10T00:00:00.000Z', completedAt: null, cancelledAt: null,
    };
    const mem = new Map<string, Record<string, unknown>>([[`docsign.req.${id}`, { key: `docsign.req.${id}`, ownerGaii: NS, value: rec, version: 1, createdAt: rec.createdAt, updatedAt: rec.createdAt }]]);
    const nodeKey = await generateKeyPair();
    const storage = {
      getMemory: async (ns: string, key: string) => (ns === NS ? mem.get(key) ?? null : null),
      setMemory: async (r: Record<string, unknown>) => { mem.set(String(r.key), r); },
      getGHII: async () => ({ verificationLevel: 1, displayName: 'Alice Example' }),
      getNodeKey: async () => nodeKey,
    } as unknown as Storage;
    const ctx = { storage, config: { nodeId: 'n' } as AimeatConfig };
    const wallet: WalletEvidence = {
      protocol: 'eudi-rqes-document-retrieval/1', clientId: 'node', signatureQualifier: 'eu_eidas_qes',
      input: { sha256: INPUT, size: 10 }, signed: { sha256: 'e'.repeat(64), size: 20, owner: ALICE, key: 'docsign/x/d-signed.pdf' },
      certificate: { subject: 'CN=Alice Example, C=FI', issuer: 'Trusted QTSP CA', serialNumber: '01', sha256: null },
      validation: { verdict: 'valid', level: 'unknown', reasons: [], trustSource: 'operator-anchor', test: false },
      nameMatches: true, nameBasis: 'display-name', caveats: walletCaveats({ revocation: { status: 'good' } } as unknown as SignatureReport, 'display-name'),
    };
    const sealed = await recordWalletSignature(ctx, id, ALICE, INPUT, wallet, 'd-signed.pdf');
    const st = sealed.signatures[ALICE]!.statement;
    expect(st.certificate).toEqual({ subject: 'CN=Alice Example, C=FI', issuer: 'Trusted QTSP CA' });
    expect(st.caveats?.map(c => c.code)).toEqual(['NAME_NOT_VERIFIED']);
    const checks = await verifyRecordSignatures(ctx, sealed);
    expect(checks[0]!.valid).toBe(true);
    expect(checks[0]!.certificate?.subject).toBe('CN=Alice Example, C=FI');
    const pub = await publicView(ctx, sealed);
    expect(pub.signatures[0]!.certificate?.subject).toBe('CN=Alice Example, C=FI');
    expect(pub.signatures[0]!.caveats.map(c => c.code)).toEqual(['NAME_NOT_VERIFIED']);
  });
});
