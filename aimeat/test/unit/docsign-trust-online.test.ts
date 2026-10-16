/**
 * @file test/unit/docsign-trust-online.test.ts
 * @description The online half of signature validation, which no test reached before (QA audit
 *   F03b-04): the EU List of Trusted Lists and a member-state list read and signature-checked, the
 *   issuing service matched with its status at signing time, revocation by OCSP and by CRL, the eIDAS
 *   level, signature and document timestamps, adbe.pkcs7.detached, and CMS .p7s / .p7m files.
 *
 *   The trust world is test/fixtures/docsign/trust-world.ts, made at run time. The node's own
 *   fetchers are replaced through the two test seams (_setTrustListFetcher, _setRevocationFetcher)
 *   with lookups in that world, so everything after the fetch (XML signature checks, list parsing,
 *   OCSP and CRL signature checks, the verdict rules) is the production code. The same world served
 *   over HTTP to a node is test/e2e-docsign-validation.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-trust-online.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F03b-04).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { validatePdf, validateCmsFile } from '../../src/services/docsign/validate.js';
import { _setTrustListFetcher, clearTrustListCache } from '../../src/services/docsign/trust-list.js';
import { _setRevocationFetcher } from '../../src/services/docsign/revocation.js';
import { docsignDefaults } from '../../src/config-docsign.js';
import type { AimeatConfig } from '../../src/config.js';
import { buildTrustWorld, type TrustWorld } from '../fixtures/docsign/trust-world.js';

const BASE = 'http://trust.test';
let world: TrustWorld;
const fetched: string[] = [];

const config = (overrides: Partial<AimeatConfig> = {}) => ({
  ...docsignDefaults(), docsignOnlineChecks: true, docsignTrustAnchorsPath: '', docsignLotlSignerSha256: [],
  docsignLotlUrl: `${BASE}/lotl.xml`, ...overrides,
}) as AimeatConfig;

const served = (url: string): Buffer => {
  fetched.push(url);
  const f = world.files.get(url.slice(BASE.length));
  if (!f) throw new Error(`HTTP 404 from ${url}`);
  return f.body;
};

beforeAll(() => {
  world = buildTrustWorld(BASE);
  _setTrustListFetcher(async (url) => served(url).toString('utf8'));
  _setRevocationFetcher(async (url) => served(url));
}, 60_000);

afterAll(() => {
  _setTrustListFetcher(async () => { throw new Error('offline in unit tests'); });
});

describe('a qualified signature on the EU trusted list', () => {
  it('is valid at the qualified level: list signature, granted CA/QC service, OCSP good', async () => {
    const r = await validatePdf(config(), world.pdf.qualified);
    const s = r.signatures[0]!;
    expect(r.verdict).toBe('valid');
    expect(s.verdict).toBe('valid');
    expect(s.reasons).toEqual([]);
    expect(s.level).toBe('qualified');
    expect(s.purpose).toBe('esign');
    expect(s.trust).toMatchObject({ trusted: true, source: 'eu-trusted-list' });
    expect(s.trust.service).toMatchObject({ territory: 'FI', type: 'CA/QC', statusAtSigning: 'granted', provider: 'Test QTSP FI' });
    expect(s.revocation).toMatchObject({ status: 'good', source: 'ocsp' });
    expect(s.summary).toMatch(/qualified electronic signature\): valid\./);
    expect(fetched).toContain(`${BASE}/tl/fi.xml`);
  });

  it('adbe.pkcs7.detached is checked the same way', async () => {
    const s = (await validatePdf(config(), world.pdf.adbe)).signatures[0]!;
    expect(s.pdf?.subFilter).toBe('adbe.pkcs7.detached');
    expect(s.verdict).toBe('valid');
    expect(s.level).toBe('qualified');
  });

  it('a qualified certificate without a QSCD is advanced-qc, not qualified', async () => {
    const s = (await validatePdf(config(), world.pdf.noQscd)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.level).toBe('advanced-qc');
  });
});

describe('revocation', () => {
  it('revoked by OCSP before the claimed signing time, with no timestamp: invalid', async () => {
    const s = (await validatePdf(config(), world.pdf.revokedOcsp)).signatures[0]!;
    expect(s.verdict).toBe('invalid');
    expect(s.reasons).toContain('REVOKED_NO_PROOF_OF_TIME');
    expect(s.revocation).toMatchObject({ status: 'revoked', source: 'ocsp', revokedAt: world.revokedAt.toISOString() });
    expect(s.level).toBe('unknown');
  });

  it('revoked by CRL (no OCSP responder in the certificate): invalid', async () => {
    const s = (await validatePdf(config(), world.pdf.revokedCrl)).signatures[0]!;
    expect(s.verdict).toBe('invalid');
    expect(s.revocation).toMatchObject({ status: 'revoked', source: 'crl' });
  });

  it('revoked after a qualified signature timestamp: stays valid, and the time is proven by the timestamp', async () => {
    const s = (await validatePdf(config(), world.pdf.revokedAfterTimestamp)).signatures[0]!;
    expect(s.verdict).toBe('valid');
    expect(s.reasons).toContain('REVOKED_AFTER_SIGNING');
    expect(s.signedAt).toMatchObject({ time: world.timestampAt.toISOString(), source: 'qualified-timestamp' });
    expect(s.signedAt.timestampAuthority).toBe('Test Qualified TSA FI');
  });
});

describe('the trusted lists themselves', () => {
  it('a service withdrawn before the signing time: indeterminate, with the status the list gave', async () => {
    const s = (await validatePdf(config(), world.pdf.withdrawn)).signatures[0]!;
    expect(s.verdict).toBe('indeterminate');
    expect(s.reasons).toContain('SERVICE_NOT_GRANTED_AT_SIGNING');
    expect(s.trust.trusted).toBe(false);
    expect(s.trust.service?.statusAtSigning).toBe('withdrawn');
  });

  it('a member-state list signed by a key the LOTL does not name is not used', async () => {
    const s = (await validatePdf(config(), world.pdf.badList)).signatures[0]!;
    expect(s.verdict).toBe('indeterminate');
    expect(s.reasons).toContain('TRUST_LIST_UNAVAILABLE');
    expect(s.trust.errors.join(' ')).toMatch(/DK: .*signature does not verify/);
    expect(s.level).toBe('unknown');
  });

  it('a pinned LOTL signer that is not the one that signed: nothing is trusted', async () => {
    clearTrustListCache();
    const s = (await validatePdf(config({ docsignLotlSignerSha256: ['0'.repeat(64)] }), world.pdf.qualified)).signatures[0]!;
    expect(s.verdict).toBe('indeterminate');
    expect(s.reasons).toContain('TRUST_LIST_UNAVAILABLE');
    clearTrustListCache();
    const pinned = (await validatePdf(config({ docsignLotlSignerSha256: [world.lotlSignerSha256] }), world.pdf.qualified)).signatures[0]!;
    expect(pinned.verdict).toBe('valid');
    clearTrustListCache();
  });
});

describe('timestamps and CMS files', () => {
  it('a PDF document timestamp from a qualified TSA: valid, qualified', async () => {
    const r = await validatePdf(config(), world.pdf.docTimestamp);
    const s = r.signatures[0]!;
    expect(s.kind).toBe('document-timestamp');
    expect(s.verdict).toBe('valid');
    expect(s.level).toBe('qualified');
    expect(s.signedAt.source).toBe('qualified-timestamp');
  });

  it('a detached .p7s with its document: valid, qualified, and the report names the document', async () => {
    const r = await validateCmsFile(config(), world.cms.detached, world.cms.detachedDocument);
    expect(r.verdict).toBe('valid');
    expect(r.signatures[0]!.level).toBe('qualified');
    expect(r.document.size).toBe(world.cms.detachedDocument.length);
  });

  it('the same .p7s over another document: invalid', async () => {
    const r = await validateCmsFile(config(), world.cms.detached, Buffer.from('another document'));
    expect(r.verdict).toBe('invalid');
    expect(r.signatures[0]!.reasons).toContain('DIGEST_MISMATCH');
  });

  it('an attached .p7m carries its content: valid, qualified', async () => {
    const r = await validateCmsFile(config(), world.cms.attached, null);
    expect(r.verdict).toBe('valid');
    expect(r.signatures[0]!.level).toBe('qualified');
    expect(r.document.size).toBe(world.cms.attachedContent.length);
  });

  it('a detached .p7s without its document is refused with DOCUMENT_REQUIRED', async () => {
    await expect(validateCmsFile(config(), world.cms.detached, null)).rejects.toMatchObject({ code: 'DOCUMENT_REQUIRED' });
  });
});
