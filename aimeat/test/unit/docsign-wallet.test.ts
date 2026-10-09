/**
 * @file test/unit/docsign-wallet.test.ts
 * @description Wallet signing without a node: the forms a wallet may post the signed PDF in, and the
 *   EU reference wallet's test CAs, which are trusted only while docsign.eudi_test_roots is on and
 *   are never reported as anything but a test. The full flow, with the suite playing the wallet,
 *   is e2e-docsign.ts.
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-allekirjoitus-eudi-lompakolla).
 */
import { describe, it, expect } from 'vitest';
import { X509Certificate, createHash } from 'node:crypto';
import { parseDocumentWithSignature } from '../../src/services/docsign/eudi.js';
import { isEudiTestRoot } from '../../src/services/docsign/chain.js';
import { EUDI_TEST_ROOTS_B64 } from '../../src/data/eudi-test-roots.js';

describe('the signed PDF in a wallet response form', () => {
  it('reads the reference wallet\'s JSON array, a plain value, repeated and indexed fields, and commas', () => {
    expect(parseDocumentWithSignature({ documentWithSignature: '["QUJD"]' })).toEqual(['QUJD']);
    expect(parseDocumentWithSignature({ documentWithSignature: 'QUJD' })).toEqual(['QUJD']);
    expect(parseDocumentWithSignature({ documentWithSignature: ['QUJD', 'REVG'] })).toEqual(['QUJD', 'REVG']);
    expect(parseDocumentWithSignature({ 'documentWithSignature[0]': 'QUJD' })).toEqual(['QUJD']);
    expect(parseDocumentWithSignature({ documentWithSignature: 'QUJD, REVG' })).toEqual(['QUJD', 'REVG']);
  });

  it('finds nothing when there is nothing, and does not throw on a broken JSON array', () => {
    expect(parseDocumentWithSignature({ state: 'x' })).toEqual([]);
    expect(parseDocumentWithSignature({ documentWithSignature: '' })).toEqual([]);
    expect(parseDocumentWithSignature({ documentWithSignature: '[QUJD' })).toEqual(['[QUJD']);
  });
});

describe('the EU reference wallet test CAs', () => {
  it('are self-signed CA certificates of the EUDI Wallet Reference Implementation', () => {
    expect(EUDI_TEST_ROOTS_B64.length).toBeGreaterThanOrEqual(7);
    for (const b64 of EUDI_TEST_ROOTS_B64) {
      const c = new X509Certificate(Buffer.from(b64, 'base64'));
      expect(c.ca).toBe(true);
      expect(c.subject).toBe(c.issuer);
      expect(c.subject).toContain('EUDI Wallet Reference Implementation');
    }
  });

  it('are recognised by their certificate hash, and nothing else is', () => {
    const sha = createHash('sha256').update(Buffer.from(EUDI_TEST_ROOTS_B64[0]!, 'base64')).digest('hex');
    expect(isEudiTestRoot(sha)).toBe(true);
    expect(isEudiTestRoot('0'.repeat(64))).toBe(false);
  });
});
