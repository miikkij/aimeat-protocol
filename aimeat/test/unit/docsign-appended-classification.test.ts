/**
 * @file test/unit/docsign-appended-classification.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an incremental update after a signature added: content changed after signing
 *   never reads as validation data or as a later signature, while real long-term-validation data and
 *   a real second signature still read as the normal NOT_WHOLE_FILE.
 *
 *   WHY. classifyAppended took validation data from the four characters /DSS anywhere in the
 *   appended bytes and counted an all-zero placeholder /ByteRange as a later signature, and either
 *   one switched off its check for changed content. A page whose content stream was redefined after
 *   signing then read NOT_WHOLE_FILE ("which is normal") and the signature stayed valid. The attack
 *   cases fail on src/services/docsign/pdf-extract.ts as of 2026-10-27; the usage cases pass before
 *   and after.
 *
 *   The PDFs are built here from test/fixtures/docsign/signed.pdf with incremental updates, and the
 *   second signatures with test/fixtures/docsign/pdf-sign.ts, the builders make-fixtures.ts uses.
 * @usage cd aimeat && pnpm exec vitest run test/unit/docsign-appended-classification.test.ts
 * @version-history
 *   v1.1.0 — 2026-11-01 — A real later signature does not cover a changed page: four attack cases
 *     (a page pointed at new content and a grown indirect content list fail on the classifier of
 *     929e228ce; a new page in the signed tree and a new page tree were already caught by the /Pages
 *     type and stay as regression cases) and one usage case (a later signature's widget added to an
 *     indirect annotation list). Finding w3-docsign-later-signature-adds-page.
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { extractPdfSignatures } from '../../src/services/docsign/pdf-extract.js';
import { validatePdf } from '../../src/services/docsign/validate.js';
import { _setTrustListFetcher } from '../../src/services/docsign/trust-list.js';
import { docsignDefaults } from '../../src/config/docsign.js';
import type { AimeatConfig } from '../../src/config.js';
import { appendSignature, makeCert, name, newRsa } from '../fixtures/docsign/pdf-sign.js';

const FIX = join(__dirname, '..', 'fixtures', 'docsign');
const signed = readFileSync(join(FIX, 'signed.pdf'));
const anchored = () => ({ ...docsignDefaults(), docsignTrustAnchorsPath: join(FIX, 'trust-anchors.txt') }) as AimeatConfig;

beforeAll(() => {
  _setTrustListFetcher(async () => { throw new Error('offline in unit tests'); });
});

type Obj = [number, string | Buffer];

/** A stream object's text: its dictionary entries and its data. */
function stream(entries: string, data: Buffer | string): Buffer {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
  return Buffer.concat([Buffer.from(`<< ${entries} /Length ${bytes.length} >>\nstream\n`, 'latin1'), bytes, Buffer.from('\nendstream', 'latin1')]);
}

/** An object stream (ISO 32000-1 7.5.7) holding `objects`, FlateDecode. */
function objectStream(objects: [number, string][]): Buffer {
  let header = '';
  let body = '';
  for (const [num, text] of objects) { header += `${num} ${body.length} `; body += `${text}\n`; }
  const data = deflateSync(Buffer.from(header + body, 'latin1'));
  return stream(`/Type /ObjStm /N ${objects.length} /First ${header.length} /Filter /FlateDecode`, data);
}

/** `base` with one incremental update: the objects, a cross-reference section and a trailer. */
function withUpdate(base: Buffer, objects: Obj[]): Buffer {
  // The last startxref: appendSignature's update writes none of its own.
  const prev = Number([...base.toString('latin1').matchAll(/startxref\s+(\d+)/g)].at(-1)![1]);
  const parts: Buffer[] = [base];
  let at = base.length;
  const offsets: [number, number][] = [];
  for (const [num, body] of objects) {
    const chunk = Buffer.concat([Buffer.from(`${num} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push([num, at]);
    parts.push(chunk);
    at += chunk.length;
  }
  const size = Math.max(100, ...objects.map(([n]) => n + 1));
  const xref = `xref\n${offsets.map(([n, o]) => `${n} 1\n${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${size} /Root 1 0 R /Prev ${prev} >>\nstartxref\n${at}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>';
const CATALOG_DSS = '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> /DSS 20 0 R >>';
const PAGE = (contents: number, annots = '[5 0 R]') => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contents} 0 R /Resources << /Font << /F1 6 0 R >> >> /Annots ${annots} >>`;
const CHANGED = stream('', 'BT /F1 14 Tf 72 760 Td (Kauppahinta 1 000 000 euroa) Tj ET');
const DER = (seed: number) => Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 31 + seed * 7) % 256));

/** A second signer with its own test CA, for the later signatures. */
const signer = () => {
  const ca = newRsa();
  const key = newRsa();
  const caName = name('Second Test CA', 'AIMEAT Test');
  const caCert = makeCert({ subject: caName, issuer: caName, publicKey: ca.publicKey, signer: ca.privateKey, ca: true, serial: 41 });
  const cert = makeCert({ subject: name('Toinen Allekirjoittaja', 'AIMEAT Test'), issuer: caName, publicKey: key.publicKey, signer: ca.privateKey, ca: false, serial: 42 });
  return { cert, key: key.privateKey, chain: [caCert] };
};

/** `base` with `objects` written in one update and a real later signature over the whole file. */
function withLaterSignature(base: Buffer, objects: Obj[]): Buffer {
  const s = signer();
  return appendSignature(withUpdate(base, objects), s.cert, s.key, s.chain);
}

/** The first signature's classification and validation report. */
async function first(pdf: Buffer) {
  const [sig] = extractPdfSignatures(pdf);
  const report = await validatePdf(anchored(), pdf);
  return { appended: sig!.appended!, reasons: report.signatures[0]!.reasons, verdict: report.signatures[0]!.verdict };
}

describe('content changed after signing is never read as validation data or a later signature', () => {
  it('a redefined content stream beside a Catalog with a /DSS key', async () => {
    const pdf = withUpdate(signed, [[4, CHANGED], [1, CATALOG_DSS], [20, '<< >>']]);
    const r = await first(pdf);
    expect(r.appended.otherChanges).toBe(true);
    expect(r.reasons).toContain('CONTENT_ADDED_AFTER_SIGNING');
    expect(r.reasons).not.toContain('NOT_WHOLE_FILE');
    expect(r.verdict).not.toBe('valid');
  });

  it('a redefined content stream beside the characters /DSS in a string', async () => {
    const pdf = withUpdate(signed, [[4, CHANGED], [21, '(/DSS)']]);
    const r = await first(pdf);
    expect(r.appended.validationData).toBe(false);
    expect(r.appended.otherChanges).toBe(true);
    expect(r.reasons).toContain('CONTENT_ADDED_AFTER_SIGNING');
  });

  it('a redefined content stream beside an unsigned signature field (an all-zero /ByteRange)', async () => {
    const pdf = withUpdate(signed, [[4, CHANGED], [21, '<< /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 0 0 0] /Contents <00> >>']]);
    const r = await first(pdf);
    expect(r.appended.laterSignatures).toBe(0);
    expect(r.appended.otherChanges).toBe(true);
    expect(r.reasons).toContain('CONTENT_ADDED_AFTER_SIGNING');
  });

  it('a page redefined inside an object stream, beside a Catalog with a /DSS key and an XRef stream', async () => {
    const pdf = withUpdate(signed, [
      [30, objectStream([[3, PAGE(22)]])],
      [22, CHANGED],
      [1, CATALOG_DSS],
      [20, '<< /Type /DSS >>'],
      [31, stream('/Type /XRef /W [1 2 1] /Index [1 1] /Size 32', Buffer.from([1, 0, 15, 0]))],
    ]);
    const r = await first(pdf);
    expect(r.appended.otherChanges).toBe(true);
    expect(r.reasons).toContain('CONTENT_ADDED_AFTER_SIGNING');
  });

  it('a Catalog with a /DSS key that also points at a new page tree', async () => {
    const pdf = withUpdate(signed, [
      [1, '<< /Type /Catalog /Pages 30 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> /DSS 20 0 R >>'],
      [20, '<< >>'],
      [30, '<< /Kids [31 0 R] /Count 1 >>'],
      [31, '<< /Parent 30 0 R /MediaBox [0 0 595 842] /Contents 32 0 R /Resources << /Font << /F1 6 0 R >> >> >>'],
      [32, CHANGED],
    ]);
    const r = await first(pdf);
    expect(r.appended.otherChanges).toBe(true);
    expect(r.reasons).toContain('CONTENT_ADDED_AFTER_SIGNING');
  });
});

describe('a real later signature does not cover a page changed beside it', () => {
  const expectChanged = async (pdf: Buffer) => {
    const r = await first(pdf);
    expect(r.appended.laterSignatures).toBe(1);
    expect(r.appended.otherChanges).toBe(true);
    expect(r.reasons).toContain('CONTENT_ADDED_AFTER_SIGNING');
    expect(r.verdict).not.toBe('valid');
  };

  it('the signed page pointed at a new content stream', async () => {
    await expectChanged(withLaterSignature(signed, [[3, PAGE(22)], [22, CHANGED]]));
  });

  it('a new page added to the signed page tree', async () => {
    await expectChanged(withLaterSignature(signed, [
      [2, '<< /Type /Pages /Kids [3 0 R 31 0 R] /Count 2 >>'],
      [31, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 32 0 R /Resources << /Font << /F1 6 0 R >> >> >>`],
      [32, CHANGED],
    ]));
  });

  it('the Catalog pointed at a new page tree', async () => {
    await expectChanged(withLaterSignature(signed, [
      [1, '<< /Type /Catalog /Pages 30 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>'],
      [30, '<< /Type /Pages /Kids [31 0 R] /Count 1 >>'],
      [31, `<< /Type /Page /Parent 30 0 R /MediaBox [0 0 595 842] /Contents 32 0 R /Resources << /Font << /F1 6 0 R >> >> >>`],
      [32, CHANGED],
    ]));
  });

  it('a content stream added to the signed page\'s indirect content list', async () => {
    // The signed revision (the second signature's) keeps the page's content in list object 40.
    const base = withLaterSignature(signed, [[3, PAGE(40)], [40, '[4 0 R]']]);
    const pdf = withLaterSignature(base, [[40, '[4 0 R 41 0 R]'], [41, CHANGED]]);
    const second = extractPdfSignatures(pdf)[1]!;
    expect(second.appended).toMatchObject({ laterSignatures: 1, otherChanges: true });
  });
});

/** Long-term-validation data as a PAdES-B-LT update writes it: the Catalog names a /DSS. */
function ltv(base: Buffer): Buffer {
  return withUpdate(base, [
    [1, CATALOG_DSS],
    [20, '<< /Type /DSS /Certs [21 0 R] /OCSPs [22 0 R] /CRLs [23 0 R] /VRI << /0123456789ABCDEF0123456789ABCDEF01234567 << /Cert [21 0 R] /OCSP [22 0 R] /TU (D:20261101120000Z) >> >> >>'],
    [21, stream('', DER(1))],
    [22, stream('', DER(2))],
    [23, stream('', DER(3))],
  ]);
}

describe('validation data and later signatures still read as normal (usage)', () => {
  it('an intact signature reads REVOCATION_UNKNOWN only, the base line for the cases below', async () => {
    const r = await validatePdf(anchored(), signed);
    expect(r.signatures[0]!.reasons).toEqual(['REVOCATION_UNKNOWN']);
  });

  it('a PAdES-B-LT update (Catalog /DSS, the DSS dictionary, certificate, OCSP and CRL streams)', async () => {
    const r = await first(ltv(signed));
    expect(r.appended.validationData).toBe(true);
    expect(r.appended.otherChanges).toBe(false);
    expect(r.reasons).toEqual(['REVOCATION_UNKNOWN', 'NOT_WHOLE_FILE']);
  });

  it('a second validation round that redefines the DSS dictionary without rewriting the Catalog', async () => {
    const pdf = withUpdate(ltv(signed), [
      [20, '<< /Type /DSS /Certs [21 0 R 24 0 R] /OCSPs [22 0 R] /CRLs [23 0 R] >>'],
      [24, stream('', DER(4))],
    ]);
    const r = await first(pdf);
    expect(r.appended.validationData).toBe(true);
    expect(r.appended.otherChanges).toBe(false);
    expect(r.reasons).toEqual(['REVOCATION_UNKNOWN', 'NOT_WHOLE_FILE']);
  });

  it('a validation update whose DSS dictionary sits in an object stream', async () => {
    const pdf = withUpdate(signed, [
      [30, objectStream([[20, '<< /Type /DSS /Certs [21 0 R] /OCSPs [22 0 R] >>']])],
      [1, CATALOG_DSS],
      [21, stream('', DER(1))],
      [22, stream('', DER(2))],
    ]);
    const r = await first(pdf);
    expect(r.appended.validationData).toBe(true);
    expect(r.appended.otherChanges).toBe(false);
    expect(r.reasons).toEqual(['REVOCATION_UNKNOWN', 'NOT_WHOLE_FILE']);
  });

  it('a second signature appended as a wallet does', async () => {
    const s = signer();
    const pdf = appendSignature(signed, s.cert, s.key, s.chain);
    const r = await first(pdf);
    expect(r.appended.laterSignatures).toBe(1);
    expect(r.appended.otherChanges).toBe(false);
    expect(r.reasons).toEqual(['REVOCATION_UNKNOWN', 'NOT_WHOLE_FILE']);
  });

  it('a second signature that adds its field: Catalog, page, widget and appearance redefined or added', async () => {
    const s = signer();
    const prepared = withUpdate(signed, [
      [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 91 0 R] /SigFlags 3 >> >>'],
      [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> /Annots [5 0 R 91 0 R] >>`],
      [91, '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature2) /Rect [400 40 560 90] /P 3 0 R /V 90 0 R /AP << /N 92 0 R >> /F 4 >>'],
      [92, stream('/Type /XObject /Subtype /Form /BBox [0 0 160 50] /Resources << /Font << /F1 6 0 R >> >>', 'BT /F1 9 Tf 4 30 Td (Toinen Allekirjoittaja) Tj ET')],
    ]);
    const pdf = appendSignature(prepared, s.cert, s.key, s.chain);
    const r = await first(pdf);
    expect(r.appended.laterSignatures).toBe(1);
    expect(r.appended.otherChanges).toBe(false);
    expect(r.reasons).toEqual(['REVOCATION_UNKNOWN', 'NOT_WHOLE_FILE']);
  });

  it('a validation round after a later signature rewrites the DSS that signature covers', async () => {
    const s = signer();
    const pdf = withUpdate(appendSignature(ltv(signed), s.cert, s.key, s.chain), [
      [20, '<< /Type /DSS /Certs [21 0 R 24 0 R] /OCSPs [22 0 R] /CRLs [23 0 R] >>'],
      [24, stream('', DER(4))],
    ]);
    const [one, two] = extractPdfSignatures(pdf);
    expect(one!.appended).toMatchObject({ laterSignatures: 1, otherChanges: false });
    expect(two!.appended).toMatchObject({ laterSignatures: 0, validationData: true, otherChanges: false });
  });

  it('a later signature that adds its widget to an indirect annotation list', async () => {
    // The signed revision keeps the page's annotations in list object 42.
    const base = withLaterSignature(signed, [[3, PAGE(4, '42 0 R')], [42, '[5 0 R]']]);
    const pdf = withLaterSignature(base, [
      [1, '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 91 0 R] /SigFlags 3 >> >>'],
      [42, '[5 0 R 91 0 R]'],
      [91, '<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature3) /Rect [400 40 560 90] /P 3 0 R /V 90 0 R >>'],
    ]);
    const second = extractPdfSignatures(pdf)[1]!;
    expect(second.appended).toMatchObject({ laterSignatures: 1, otherChanges: false });
  });

  it('a signature field placed with an unchanged Catalog keeps reading as before', async () => {
    const pdf = withUpdate(signed, [[1, CATALOG]]);
    const [sig] = extractPdfSignatures(pdf);
    // An update with no signature and no validation data was a change before this fix and stays one.
    expect(sig!.appended!.otherChanges).toBe(true);
  });
});
