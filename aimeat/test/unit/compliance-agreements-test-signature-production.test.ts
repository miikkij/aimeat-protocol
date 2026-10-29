/**
 * @file test/unit/compliance-agreements-test-signature-production.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a node running production settings (test mode and dev mode off), a wallet
 *   signature on the EU reference wallet's test roots does not bring a data processing agreement into
 *   force: the version both parties signed stays at `test-signed`, "signed in test, not in force", the
 *   version in force before it stays in force, and no in-force notice goes out. On a node in test or
 *   development settings the behaviour stays as round 8 left it (compliance-agreements-test-signature
 *   .test.ts, unchanged). A version with no test signature comes into force as before either way
 *   (secaudit2026oct26 round 8c, syncDocsign:test-anchor-wallet-signature-as-advanced).
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-agreements-test-signature-production.test.ts
 * @version-history
 *   2026-10-29 — Initial (secaudit2026oct26 round 8c).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { completeIfSigned, syncDocsign, testSignaturesInForce } from '../../src/services/compliance-agreements-sign.js';
import { readAgreement, statusOf, writeNewAgreement } from '../../src/services/compliance-agreements.js';
import { OptionsSchema, type Agreement, type AgreementSignature, type AgreementVersion } from '../../src/services/compliance-agreements-schemas.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const now = '2026-10-29T10:00:00.000Z';
const NODE = 'n';

function version(n: number, status: AgreementVersion['status'], signatures: AgreementSignature[], docsignId?: string): AgreementVersion {
  return {
    n, status, sources: {}, options: OptionsSchema.parse({}), createdAt: now, createdBy: `op@${NODE}`, signatures, remindersSent: [],
    ...(docsignId ? { docsignId } : {}),
    ...(status === 'signed' ? { signedAt: now, effectiveFrom: now } : {}),
    annexes: {
      I: { controller: { name: 'Asiakas Oy', account: `cust@${NODE}` }, processor: { name: 'Overscale Solutions Oy' } },
      II: { subjects: ['käyttäjät'], categories: ['tilit'], sensitive: 'Ei.', nature: 'Hostaus.', purposes: 'Palvelu.', duration: 'Sopimuksen ajan.' },
      III: { measures: [{ area: 'transmission', text: 'HTTPS.', source: 'evidence' }], assistance: 'Vienti ja poisto.' },
      IV: { subprocessors: [] },
    },
  };
}
function agreement(versions: AgreementVersion[]): Agreement {
  return {
    id: 'dpa-abcdef123456', type: 'dpa-art28', template: 'eu-scc-2021-915', language: 'fi', ourRole: 'processor', product: 'place',
    subject: 'Palvelu', counterparty: { name: 'Asiakas Oy' }, versions, createdAt: now, updatedAt: now,
    history: [{ at: now, by: `op@${NODE}`, event: 'created', detail: 'Draft made.' }],
  };
}
const sig = (party: 'controller' | 'processor', method: AgreementSignature['method'], level: AgreementSignature['level']): AgreementSignature =>
  ({ party, method, level, signer: `${party}@${NODE}`, at: now });

const production = { testMode: false, devMode: false };

describe('which settings let a test wallet signature bring an agreement into force', () => {
  it('production settings do not; test mode or dev mode do, as before', () => {
    expect(testSignaturesInForce(production)).toBe(false);
    expect(testSignaturesInForce({ testMode: true, devMode: false })).toBe(true);
    expect(testSignaturesInForce({ testMode: false, devMode: true })).toBe(true);
  });
});

describe('a version both parties signed, one with a test wallet signature, on production settings', () => {
  it('stays signed in test and not in force, and the version in force before it stays in force', () => {
    const v1 = version(1, 'signed', [sig('controller', 'aimeat', 'aimeat'), sig('processor', 'aimeat', 'aimeat')]);
    const v2 = version(2, 'sent', [sig('controller', 'eudi-wallet', 'test'), sig('processor', 'aimeat', 'aimeat')]);
    const out = completeIfSigned(agreement([v1, v2]), v2, now, { testSignaturesInForce: false });
    expect(out.versions[1]!.status).toBe('test-signed');
    expect(out.versions[1]!.effectiveFrom).toBeUndefined();
    expect(out.versions[0]!.status).toBe('signed');
    const last = out.history[out.history.length - 1]!;
    expect(last.event).toBe('test-signed');
    expect(last.detail).toMatch(/not in force/);
    expect(last.detail).toMatch(/controller/);
    expect(statusOf(out)).toBe('signed');
  });

  it('reads as signed in test when no earlier version is in force', () => {
    const v = version(1, 'sent', [sig('controller', 'eudi-wallet', 'test'), sig('processor', 'aimeat', 'aimeat')]);
    const out = completeIfSigned(agreement([v]), v, now, { testSignaturesInForce: false });
    expect(statusOf(out)).toBe('test-signed');
  });

  it('a version with no test signature comes into force as before', () => {
    const v = version(1, 'sent', [sig('controller', 'eudi-wallet', 'qualified'), sig('processor', 'aimeat', 'aimeat')]);
    const out = completeIfSigned(agreement([v]), v, now, { testSignaturesInForce: false });
    expect(out.versions[0]!.status).toBe('signed');
    expect(out.history[out.history.length - 1]!.detail).toBe('Version 1 signed by both parties; in force.');
  });
});

describe('syncDocsign on a node with production settings', () => {
  let storage: Storage;
  beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });
  afterEach(() => { (storage as unknown as { close(): void }).close(); });

  it('records the test wallet signature and leaves the version signed in test, not in force', async () => {
    const ds = `ds-${randomUUID()}`;
    await writeNewAgreement(storage, NODE, agreement([version(1, 'sent', [], ds)]));
    const statement = (method: string) => ({ signedAt: now, method });
    await storage.setMemory({
      key: `docsign.req.${ds}`, ownerGaii: 'sys:docsign', visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      value: {
        v: 1, id: ds, state: 'complete', title: 'DPA', message: null, document: { sha256: 'x', name: 'dpa.pdf', size: 1, mediaType: 'application/pdf' },
        parties: [{ identity: `cust@${NODE}`, name: null }, { identity: `op@${NODE}`, name: null }],
        signatures: {
          [`cust@${NODE}`]: { statement: statement('eudi-wallet'), wallet: { validation: { level: 'unknown', test: true, trustSource: 'eudi-test-anchor' } } },
          [`op@${NODE}`]: { statement: statement('session') },
        },
        createdBy: `op@${NODE}`, createdAt: now, completedAt: now, cancelledAt: null,
      },
    });
    const config = { nodeId: NODE, baseUrl: 'http://localhost', ...production } as unknown as AimeatConfig;
    const a = (await readAgreement(storage, NODE, 'dpa-abcdef123456'))!;
    const out = await syncDocsign({ storage, config }, a);
    const v = out.versions[0]!;
    expect(v.signatures.map(s => `${s.party}:${s.level}`).sort()).toEqual(['controller:test', 'processor:aimeat']);
    expect(v.status).toBe('test-signed');
    expect(statusOf(out)).toBe('test-signed');
    expect(out.history.some(h => h.event === 'in-force')).toBe(false);
  });
});
