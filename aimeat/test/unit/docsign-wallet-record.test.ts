/**
 * @file test/unit/docsign-wallet-record.test.ts
 * @description Recording a wallet signature on a stub store: the signed PDF's hash is indexed only
 *   after the seal is stored (secaudit 2026-10-10 I15), and checkWalletSignature refuses a request
 *   that moved on before the PDF is stored (I14; the stored-file half is in e2e-docsign.ts).
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (secaudit 2026-10-10 I14, I15).
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import {
  recordWalletSignature, checkWalletSignature, type DocSignRecord, type WalletEvidence,
} from '../../src/services/docsign/records.js';

const NS = 'sys:docsign';
const ID = 'ds-00000000-0000-4000-8000-000000000001';
const ALICE = 'alice@n';
const INPUT = 'a'.repeat(64);
const SIGNED = 'b'.repeat(64);

/** The memory calls records.ts makes, on a Map; no node key, so sealInto throws NODE_KEY_MISSING. */
function stubStorage(rec: DocSignRecord) {
  const mem = new Map<string, Record<string, unknown>>();
  mem.set(`docsign.req.${rec.id}`, { key: `docsign.req.${rec.id}`, ownerGaii: NS, value: rec, version: 1, createdAt: rec.createdAt, updatedAt: rec.createdAt });
  const storage = {
    getMemory: async (ns: string, key: string) => (ns === NS ? mem.get(key) ?? null : null),
    setMemory: async (r: Record<string, unknown>) => { mem.set(String(r.key), r); },
    getGHII: async () => null,
    getNodeKey: async () => null,
  } as unknown as Storage;
  return { storage, mem };
}

function openRequest(state: DocSignRecord['state'] = 'open'): DocSignRecord {
  return {
    v: 1, id: ID, state, title: 't', message: null,
    document: { sha256: INPUT, name: 'd.pdf', size: 10, mediaType: 'application/pdf' },
    parties: [{ identity: ALICE, name: null }], signatures: {}, createdBy: ALICE,
    createdAt: '2026-10-10T00:00:00.000Z', completedAt: null, cancelledAt: state === 'cancelled' ? '2026-10-10T00:01:00.000Z' : null,
  };
}

const wallet: WalletEvidence = {
  protocol: 'eudi-rqes-document-retrieval/1', clientId: 'node', signatureQualifier: 'eu_eidas_qes',
  input: { sha256: INPUT, size: 10 }, signed: { sha256: SIGNED, size: 20, owner: ALICE, key: 'docsign/x/d-signed.pdf' },
  certificate: { subject: 's', issuer: null, serialNumber: null, sha256: null },
  validation: { verdict: 'valid', level: 'qes', reasons: [], trustSource: null, test: true },
  nameMatches: null,
};

describe('recordWalletSignature', () => {
  it('a seal that throws leaves no index entry for the signed PDF\'s hash (I15)', async () => {
    const { storage, mem } = stubStorage(openRequest());
    const ctx = { storage, config: { nodeId: 'n' } as AimeatConfig };
    await expect(recordWalletSignature(ctx, ID, ALICE, INPUT, wallet, 'd-signed.pdf')).rejects.toMatchObject({ code: 'NODE_KEY_MISSING' });
    expect(mem.has(`docsign.hash.${SIGNED}`)).toBe(false);
  });
});

describe('checkWalletSignature (I14)', () => {
  it('passes an open request for a party with the latest PDF', async () => {
    const { storage } = stubStorage(openRequest());
    await expect(checkWalletSignature({ storage, config: {} as AimeatConfig }, ID, ALICE, INPUT)).resolves.toBeUndefined();
  });

  it('refuses a cancelled request, and a PDF that is not the latest', async () => {
    const cancelled = stubStorage(openRequest('cancelled'));
    await expect(checkWalletSignature({ storage: cancelled.storage, config: {} as AimeatConfig }, ID, ALICE, INPUT)).rejects.toMatchObject({ code: 'NOT_OPEN' });
    const open = stubStorage(openRequest());
    await expect(checkWalletSignature({ storage: open.storage, config: {} as AimeatConfig }, ID, ALICE, 'c'.repeat(64))).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
