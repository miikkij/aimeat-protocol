/**
 * @file test/unit/docsign-stale-ocsp-fallback.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An OCSP "good" answer the signature carries that does not cover a proven signing time
 *   is never the revocation status. When the responder cannot be asked (it is unreachable, or the
 *   check's outbound budget is spent), the status is unknown and the verdict carries the
 *   REVOCATION_UNKNOWN doubt; the embedded answer stays in the report as the source and in the notes.
 *   Kept: a good answer made after a qualified timestamp is used as it is (PAdES-LT), and a signature
 *   whose responder answers good stays valid (secaudit2026oct31w2 round 10,
 *   revocation.ts:checkRevocation:stale-embedded-ocsp-good-fallback).
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-stale-ocsp-fallback.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit2026oct31w2 round 10).
 */
import { describe, it, expect } from 'vitest';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { checkRevocation, _setRevocationFetcher } from '../../src/services/docsign/revocation.js';
import { extractPdfSignatures } from '../../src/services/docsign/pdf-extract.js';
import { verifyCms } from '../../src/services/docsign/cms-verify.js';
import { readCert } from '../../src/services/docsign/x509-info.js';
import { withOnlineBudget, takeOnlineFetch } from '../../src/services/docsign/online-budget.js';
import { useTrustWorld, onlineConfig, TRUST_BASE } from '../fixtures/docsign/trust-world-seams.js';

const tw = useTrustWorld();

/** Serve the world as useTrustWorld does, except that the responder at `down` does not answer. */
function responderDown(down: string): void {
  _setRevocationFetcher(async (url) => {
    tw.fetched.push(url);
    if (url === `${TRUST_BASE}${down}`) throw new Error('connect ECONNREFUSED');
    const f = tw.world.files.get(url.slice(TRUST_BASE.length));
    if (!f) throw new Error(`HTTP 404 from ${url}`);
    return f.body;
  });
}
function responderUp(): void {
  _setRevocationFetcher(async (url) => {
    tw.fetched.push(url);
    const f = tw.world.files.get(url.slice(TRUST_BASE.length));
    if (!f) throw new Error(`HTTP 404 from ${url}`);
    return f.body;
  });
}

describe('a stale embedded good answer with no fresh answer', () => {
  it('responder unreachable: the status is unknown and the verdict is not valid', async () => {
    responderDown('/ocsp/revoked');
    try {
      const s = (await validatePdf(onlineConfig(), tw.world.audit.staleEmbeddedOcsp)).signatures[0]!;
      expect(s.revocation.status).toBe('unknown');
      expect(s.revocation.source).toBe('embedded-ocsp');
      expect(s.reasons).toContain('REVOCATION_UNKNOWN');
      expect(s.verdict).toBe('indeterminate');
      expect(s.revocation.notes.some((n) => /ECONNREFUSED/.test(n))).toBe(true);
      expect(s.revocation.notes.some((n) => /said good/.test(n))).toBe(true);
    } finally { responderUp(); }
  });

  it('outbound budget spent: the status is unknown, never good', async () => {
    const [field] = extractPdfSignatures(tw.world.audit.staleEmbeddedOcsp);
    const cms = verifyCms(field!.cms, field!.signedBytes);
    const signer = readCert(cms.signerCert!);
    const issuer = readCert(cms.certificates.find((c) => !c.equals(cms.signerCert!))!);
    const r = await withOnlineBudget(1, async () => {
      takeOnlineFetch();
      return checkRevocation(signer, issuer, { embeddedOcsp: cms.embeddedOcsp, online: true });
    });
    expect(r.status).toBe('unknown');
    expect(r.notes.some((n) => /docsign\.max_fetches/.test(n))).toBe(true);
  });

  it('online checks off: the status is unknown, never good', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.audit.staleEmbeddedOcsp, { online: false })).signatures[0]!;
    expect(s.revocation.status).toBe('unknown');
    expect(s.verdict).not.toBe('valid');
  });
});

describe('uses that stay as they were', () => {
  it('a reachable responder decides: revoked stays revoked', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.audit.staleEmbeddedOcsp)).signatures[0]!;
    expect(s.revocation.status).toBe('revoked');
    expect(s.verdict).toBe('invalid');
  });

  it('a good answer made after a qualified timestamp is used as it is, with no fetch (PAdES-LT)', async () => {
    tw.fetched.length = 0;
    const s = (await validatePdf(onlineConfig(), tw.world.audit.freshEmbeddedOcspTimestamped)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.revocation).toMatchObject({ status: 'good', source: 'embedded-ocsp' });
    expect(tw.fetched.some((u) => u.includes('/ocsp/'))).toBe(false);
  });

  it('a signature whose responder answers good stays valid and qualified', async () => {
    const s = (await validatePdf(onlineConfig(), tw.world.pdf.qualified)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.level).toBe('qualified');
    expect(s.revocation).toMatchObject({ status: 'good', source: 'ocsp' });
  });
});
