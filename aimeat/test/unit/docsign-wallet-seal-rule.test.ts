/**
 * @file test/unit/docsign-wallet-seal-rule.test.ts
 * @description The rule a wallet's newest signature passes before the node seals it. A wallet signs
 *   during the session, so a certificate that is revoked now is never sealed, whatever signing time
 *   the signature claims; the validator's leniency for a historical document with an unproven time
 *   does not apply here. A good, trusted signature still seals, and an unknown revocation status is
 *   left as it was (a decision for the developer, secaudit2026oct22).
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, wallet seal rule and revocation).
 */
import { describe, it, expect } from 'vitest';
import { walletSealRefusal } from '../../src/services/docsign/eudi.js';
import type { SignatureReport } from '../../src/services/docsign/validate.js';

function report(over: Partial<SignatureReport> = {}): SignatureReport {
  return {
    index: 1, kind: 'signature', verdict: 'valid', reasons: [], summary: 'Signature by Alice: valid.', level: 'advanced', purpose: 'esign',
    signer: { name: 'Alice Example', commonName: 'Alice Example', organization: null, organizationIdentifier: null, serialNumber: null, country: 'FI', email: null, subject: 'CN=Alice Example' },
    issuer: null, certificate: null,
    signedAt: { time: '2026-10-25T10:00:00.000Z', source: 'claimed', timestampAuthority: null },
    integrity: { contentIntact: true, signatureValid: true, algorithm: 'RSA-SHA256', digestAlgorithm: 'sha256', signingCertificateBound: true },
    coverage: { wholeFile: true, laterSignatures: 0, validationDataAdded: false, otherContentAdded: false, addedObjectTypes: [] },
    trust: { trusted: true, source: 'operator-anchor', service: null, chain: [], territoriesChecked: [], errors: [] },
    revocation: { status: 'good', source: 'ocsp', revokedAt: null, producedAt: '2026-10-25T10:00:00.000Z', notes: [] },
    pdf: null,
    ...over,
  };
}

describe('walletSealRefusal', () => {
  it('refuses a certificate that is revoked now, even when the claimed signing time is before the revocation', () => {
    const r = walletSealRefusal(report({
      verdict: 'indeterminate', reasons: ['REVOKED_NO_PROOF_OF_TIME'],
      revocation: { status: 'revoked', source: 'ocsp', revokedAt: '2026-10-25T11:00:00.000Z', producedAt: '2026-10-25T12:00:00.000Z', notes: [] },
    }), 1);
    expect(r?.code).toBe('CERTIFICATE_REVOKED');
  });

  it('refuses a revoked certificate even when a timestamp puts the signature before the revocation', () => {
    const r = walletSealRefusal(report({
      reasons: ['REVOKED_AFTER_SIGNING'], signedAt: { time: '2026-10-25T10:00:00.000Z', source: 'qualified-timestamp', timestampAuthority: 'TSA' },
      revocation: { status: 'revoked', source: 'ocsp', revokedAt: '2026-10-25T11:00:00.000Z', producedAt: '2026-10-25T12:00:00.000Z', notes: [] },
    }), 1);
    expect(r?.code).toBe('CERTIFICATE_REVOKED');
  });

  it('seals a good, trusted signature', () => {
    expect(walletSealRefusal(report(), 1)).toBeNull();
  });

  it('keeps the earlier refusals', () => {
    expect(walletSealRefusal(undefined, 0)?.code).toBe('SIGNATURE_NOT_VALID');
    expect(walletSealRefusal(report({ verdict: 'invalid' }), 1)?.code).toBe('SIGNATURE_NOT_VALID');
    expect(walletSealRefusal(report({ trust: { trusted: false, source: null, service: null, chain: [], territoriesChecked: [], errors: [] } }), 1)?.code).toBe('SIGNER_NOT_TRUSTED');
  });

  it('leaves an unknown revocation status as it was', () => {
    expect(walletSealRefusal(report({ verdict: 'indeterminate', reasons: ['REVOCATION_UNKNOWN'], revocation: { status: 'unknown', source: null, revokedAt: null, producedAt: null, notes: [] } }), 1)).toBeNull();
  });
});
