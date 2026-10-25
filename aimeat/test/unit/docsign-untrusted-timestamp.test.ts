/**
 * @file test/unit/docsign-untrusted-timestamp.test.ts
 * @description A signature timestamp from a TSA on no trusted list and no operator anchor does not
 *   prove the signing time. A certificate revoked after that timestamp's time is therefore not read
 *   as "revoked after signing" (valid), but as revoked with no proof of time. A qualified signature
 *   timestamp still proves the time, and a signature revoked after it stays valid.
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-untrusted-timestamp.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, validate.ts:untrusted-timestamp-proves-signing-time).
 */
import { describe, it, expect } from 'vitest';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { useTrustWorld, onlineConfig } from '../fixtures/docsign/trust-world-seams.js';

const tw = useTrustWorld();

describe('a signature timestamp from an authority nobody trusts', () => {
  it('does not prove the signing time: revoked later is not "revoked after signing"', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.audit.revokedAfterUntrustedTimestamp)).signatures[0]!;
    expect(s.verdict).not.toBe('valid');
    expect(s.reasons).toContain('TIMESTAMP_UNTRUSTED');
    expect(s.reasons).not.toContain('REVOKED_AFTER_SIGNING');
    expect(s.reasons).toContain('REVOKED_NO_PROOF_OF_TIME');
  });

  it('a qualified signature timestamp still proves the time: revoked after it stays valid', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.pdf.revokedAfterTimestamp)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.reasons).toContain('REVOKED_AFTER_SIGNING');
    expect(s.signedAt.source).toBe('qualified-timestamp');
  });
});
