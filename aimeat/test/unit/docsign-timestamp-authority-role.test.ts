/**
 * @file test/unit/docsign-timestamp-authority-role.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A timestamp proves a signing time only when its signer acts as a time-stamping
 *   authority: the certificate carries id-kp-timeStamping (RFC 3161 section 2.3) and was in force at
 *   genTime. A token signed by any other key under a trusted CA (the signer's own key, for one) or by
 *   a TSA whose certificate had expired is a stated time, so a revocation after it is not excused as
 *   "revoked after signing". A qualified TSA still proves the time (secaudit2026oct31w2 round 10,
 *   validate.ts:assess:timestamp-authority-not-bound-to-timestamping-eku).
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-timestamp-authority-role.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect } from 'vitest';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { useTrustWorld, onlineConfig } from '../fixtures/docsign/trust-world-seams.js';

const tw = useTrustWorld();

describe('a timestamp whose signer is not a time-stamping authority', () => {
  it('signed by the signing key itself: the time is not proven, so a later revocation is not excused', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.audit.nonTsaTimestamp)).signatures[0]!;
    expect(s.reasons).toContain('TIMESTAMP_NOT_TSA');
    expect(s.reasons).not.toContain('REVOKED_AFTER_SIGNING');
    expect(s.reasons).toContain('REVOKED_NO_PROOF_OF_TIME');
    expect(s.verdict).not.toBe('valid');
    expect(s.signedAt.source).toBe('timestamp');
  });

  it('a TSA whose certificate had expired at genTime: the time is not proven', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.audit.expiredTsaTimestamp)).signatures[0]!;
    expect(s.reasons).toContain('TIMESTAMP_NOT_TSA');
    expect(s.reasons).not.toContain('REVOKED_AFTER_SIGNING');
    expect(s.verdict).not.toBe('valid');
  });

  it('a document timestamp signed by a signing key does not count as a trusted timestamp', async () => {
    const r = await validatePdf(onlineConfig(), tw.world.audit.docTimestampByNonTsa);
    const d = r.signatures.find((x) => x.kind === 'document-timestamp')!;
    expect(d.reasons).toContain('TIMESTAMP_NOT_TSA');
    expect(d.verdict).toBe('indeterminate');
  });
});

describe('uses that stay as they were', () => {
  it('a qualified signature timestamp still proves the time: revoked after it stays valid', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.pdf.revokedAfterTimestamp)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.reasons).toContain('REVOKED_AFTER_SIGNING');
    expect(s.reasons).not.toContain('TIMESTAMP_NOT_TSA');
    expect(s.signedAt.source).toBe('qualified-timestamp');
  });

  it('a qualified document timestamp stays valid and qualified', async () => {
    const r = await validatePdf(onlineConfig(), tw.world.pdf.docTimestamp);
    const d = r.signatures.find((x) => x.kind === 'document-timestamp')!;
    expect(d.verdict).toBe('valid');
    expect(d.level).toBe('qualified');
    expect(d.reasons).not.toContain('TIMESTAMP_NOT_TSA');
  });

  it('a signature without a timestamp is untouched', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.pdf.qualified)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.level).toBe('qualified');
  });
});
