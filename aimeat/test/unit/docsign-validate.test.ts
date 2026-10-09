/**
 * @file test/unit/docsign-validate.test.ts
 * @description The signature validation engine without the network: PDF signature extraction, the
 *   CMS checks, an operator trust anchor, and the verdicts for an intact, a changed and an appended
 *   PDF. The fixtures are test/fixtures/docsign/*.pdf (make-fixtures.ts, our own test CA). The EU
 *   list fetch is replaced with one that fails, so the anchor is the only trust there is.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdfSignatures, pdfDateToIso } from '../../src/services/docsign/pdf-extract.js';
import { verifyCms } from '../../src/services/docsign/cms-verify.js';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { _setTrustListFetcher } from '../../src/services/docsign/trust-list.js';
import { docsignDefaults } from '../../src/config-docsign.js';
import type { AimeatConfig } from '../../src/config.js';

const FIX = join(__dirname, '..', 'fixtures', 'docsign');
const read = (f: string) => readFileSync(join(FIX, f));

const config = (overrides: Partial<AimeatConfig> = {}) => ({ ...docsignDefaults(), ...overrides }) as AimeatConfig;

beforeAll(() => {
  _setTrustListFetcher(async () => { throw new Error('offline in unit tests'); });
});

describe('PDF signature extraction', () => {
  it('finds the one signature, the dictionary fields, and that it covers the whole file', () => {
    const [sig, ...rest] = extractPdfSignatures(read('signed.pdf'));
    expect(rest).toHaveLength(0);
    expect(sig!.subFilter).toBe('ETSI.CAdES.detached');
    expect(sig!.name).toBe('AIMEAT Test Signer');
    expect(sig!.coversWholeFile).toBe(true);
    expect(sig!.cms[0]).toBe(0x30);
  });

  it('classifies an appended page as a change the signature does not cover', () => {
    const [sig] = extractPdfSignatures(read('signed-page-added.pdf'));
    expect(sig!.coversWholeFile).toBe(false);
    expect(sig!.appended?.otherChanges).toBe(true);
    expect(sig!.appended?.laterSignatures).toBe(0);
  });

  it('refuses a file that is not a PDF and returns nothing for an unsigned one', () => {
    expect(() => extractPdfSignatures(Buffer.from('hello'))).toThrow(/not a PDF/);
    expect(extractPdfSignatures(Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF'))).toEqual([]);
  });

  it('reads PDF dates with and without an offset', () => {
    expect(pdfDateToIso('D:20261009120000Z')).toBe('2026-10-09T12:00:00.000Z');
    expect(pdfDateToIso("D:20261009150000+03'00'")).toBe('2026-10-09T12:00:00.000Z');
    expect(pdfDateToIso('nonsense')).toBeNull();
  });
});

describe('CMS verification', () => {
  it('an intact signature: the digest matches and the signature verifies with the certificate', () => {
    const [sig] = extractPdfSignatures(read('signed.pdf'));
    const c = verifyCms(sig!.cms, sig!.signedBytes);
    expect(c.integrity).toBe(true);
    expect(c.signatureValid).toBe(true);
    expect(c.signingCertificateBound).toBe(true);
    expect(c.problems).toEqual([]);
  });

  it('a changed byte: the digest does not match', () => {
    const [sig] = extractPdfSignatures(read('signed-tampered.pdf'));
    const c = verifyCms(sig!.cms, sig!.signedBytes);
    expect(c.integrity).toBe(false);
    expect(c.problems).toContain('DIGEST_MISMATCH');
  });

  it('garbage is unparsable, not a crash', () => {
    expect(verifyCms(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]), null).problems).toContain('CMS_UNPARSABLE');
  });
});

describe('validatePdf', () => {
  it('without a trust anchor the chain reaches nothing trusted', async () => {
    const r = await validatePdf(config(), read('signed.pdf'));
    expect(r.signatures[0]!.verdict).toBe('indeterminate');
    expect(r.signatures[0]!.reasons).toContain('TRUST_LIST_UNAVAILABLE');
  });

  it('with the operator anchor the chain is trusted; only revocation stays open', async () => {
    const r = await validatePdf(config({ docsignTrustAnchorsPath: join(FIX, 'trust-anchors.txt') }), read('signed.pdf'));
    const s = r.signatures[0]!;
    expect(s.trust.trusted).toBe(true);
    expect(s.trust.source).toBe('operator-anchor');
    expect(s.level).toBe('advanced');
    expect(s.reasons).toEqual(['REVOCATION_UNKNOWN']);
    expect(s.signer?.name).toBe('Testi Allekirjoittaja');
    expect(r.document.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a changed PDF is invalid whatever the trust', async () => {
    const r = await validatePdf(config({ docsignTrustAnchorsPath: join(FIX, 'trust-anchors.txt') }), read('signed-tampered.pdf'));
    expect(r.verdict).toBe('invalid');
    expect(r.signatures[0]!.reasons[0]).toBe('DIGEST_MISMATCH');
    expect(r.signatures[0]!.level).toBe('unknown');
  });

  it('offline, nothing is fetched and the report says so', async () => {
    const r = await validatePdf(config({ docsignOnlineChecks: false }), read('signed.pdf'));
    expect(r.online).toBe(false);
    expect(r.signatures[0]!.reasons).toContain('ONLINE_CHECKS_OFF');
  });
});
