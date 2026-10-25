/**
 * @file test/unit/docsign-no-signer.test.ts
 * @description A PDF signature whose SignedData has no SignerInfo, or whose SignerInfo states no
 *   messageDigest, is invalid: `valid` means intact and made with the key in the certificate, and
 *   neither was established. The qualified signature of the trust world stays valid.
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-no-signer.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, validate.ts:no-signer-cms-reported-valid).
 */
import { describe, it, expect } from 'vitest';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { useTrustWorld, onlineConfig } from '../fixtures/docsign/trust-world-seams.js';

const tw = useTrustWorld();

describe('a signature with nothing to verify', () => {
  it('no SignerInfo: invalid, never valid', async () => {
    const r = await validatePdf(onlineConfig(), tw.world.audit.noSigner);
    expect(r.signatures[0]!.verdict).toBe('invalid');
    expect(r.signatures[0]!.reasons).toContain('NO_SIGNER');
    expect(r.verdict).toBe('invalid');
  });

  it('the same offline: invalid', async () => {
    const r = await validatePdf(onlineConfig(), tw.world.audit.noSigner, { online: false });
    expect(r.signatures[0]!.verdict).toBe('invalid');
  });

  it('no messageDigest in the signed attributes: invalid', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.audit.noMessageDigest)).signatures[0]!;
    expect(s.verdict).toBe('invalid');
    expect(s.reasons).toContain('NO_MESSAGE_DIGEST');
  });

  it('the qualified signature is still valid', async () => {
    expect((await validatePdf(onlineConfig(), tw.world.pdf.qualified)).signatures[0]!.verdict).toBe('valid');
  });
});
