/**
 * @file test/unit/docsign-embedded-ocsp-freshness.test.ts
 * @description An OCSP answer a signature carries speaks for its own thisUpdate only. A good answer
 *   from before the certificate was revoked does not stand in for a fresh one when the signing time
 *   is not proven: the responder is asked, and its "revoked" decides. A good answer made after a
 *   qualified signature timestamp is used as it is, with no fetch (PAdES-LT).
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-embedded-ocsp-freshness.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, revocation.ts:embedded-ocsp-accepted-without-freshness).
 */
import { describe, it, expect } from 'vitest';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { useTrustWorld, onlineConfig, TRUST_BASE } from '../fixtures/docsign/trust-world-seams.js';

const tw = useTrustWorld();

describe('revocation answers the signature carries', () => {
  it('a good answer from before the revocation does not hide it: the responder is asked', async () => {
    tw.fetched.length = 0;
    const s = (await validatePdf(onlineConfig(), tw.world.audit.staleEmbeddedOcsp)).signatures[0]!;
    expect(s.revocation.status).toBe('revoked');
    expect(s.verdict).toBe('invalid');
    expect(tw.fetched).toContain(`${TRUST_BASE}/ocsp/revoked`);
  });

  it('a good answer made after a qualified signature timestamp is used as it is (PAdES-LT)', async () => {
    tw.fetched.length = 0;
    const s = (await validatePdf(onlineConfig(), tw.world.audit.freshEmbeddedOcspTimestamped)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.revocation).toMatchObject({ status: 'good', source: 'embedded-ocsp' });
    expect(tw.fetched.some((u) => u.includes('/ocsp/'))).toBe(false);
  });
});
