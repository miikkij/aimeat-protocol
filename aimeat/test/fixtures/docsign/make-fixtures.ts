/**
 * @file test/fixtures/docsign/make-fixtures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writes the signed-PDF fixtures the docsign tests read: a test CA, a signer
 *   certificate it issued, and a one-page PDF carrying a PAdES (ETSI.CAdES.detached) signature made
 *   with that certificate, plus a copy with one signed byte changed and a copy with a page appended
 *   after signing. Our own material, so the fixtures carry no third-party licence, and reproducible:
 *   run it again and the tests still pass (the keys and the signing time change, nothing else).
 *
 *   The CMS is built field by field with @peculiar/asn1-cms and signed with node:crypto, which is
 *   the same shape a signing service writes: contentType, signingTime, messageDigest and
 *   signing-certificate-v2 as signed attributes, RSA PKCS#1 v1.5 over SHA-256.
 * @usage cd aimeat && pnpm exec tsx test/fixtures/docsign/make-fixtures.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  Certificate, TBSCertificate, Validity, Name, RelativeDistinguishedName, AttributeTypeAndValue, AttributeValue,
  SubjectPublicKeyInfo, AlgorithmIdentifier, Extension, Extensions, BasicConstraints, KeyUsage, KeyUsageFlags, Version,
} from '@peculiar/asn1-x509';
import {
  ContentInfo, SignedData, SignerInfo, SignerInfos, SignerIdentifier, IssuerAndSerialNumber, EncapsulatedContentInfo,
  CertificateSet, CertificateChoices, Attribute, CMSVersion, DigestAlgorithmIdentifiers,
} from '@peculiar/asn1-cms';
import * as asn1js from 'asn1js';

const here = dirname(fileURLToPath(import.meta.url));
const SHA256_RSA = '1.2.840.113549.1.1.11';
const SHA256 = '2.16.840.1.101.3.4.2.1';

function name(cn: string, o: string, c = 'FI'): Name {
  const rdn = (type: string, v: string, printable = false) => new RelativeDistinguishedName([
    new AttributeTypeAndValue({ type, value: new AttributeValue(printable ? { printableString: v } : { utf8String: v }) }),
  ]);
  return new Name([rdn('2.5.4.6', c, true), rdn('2.5.4.10', o), rdn('2.5.4.3', cn)]);
}

function makeCert(opts: { subject: Name; issuer: Name; publicKey: KeyObject; signer: KeyObject; ca: boolean; serial: number }): Buffer {
  const spki = AsnConvert.parse(opts.publicKey.export({ type: 'spki', format: 'der' }), SubjectPublicKeyInfo);
  const now = Date.now();
  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: new Uint8Array([0x01, opts.serial & 0xff, ...randomBytes(6)]).buffer,
    signature: new AlgorithmIdentifier({ algorithm: SHA256_RSA, parameters: null }),
    issuer: opts.issuer,
    validity: new Validity({ notBefore: new Date(now - 86_400_000), notAfter: new Date(now + 20 * 365 * 86_400_000) }),
    subject: opts.subject,
    subjectPublicKeyInfo: spki,
    extensions: new Extensions([
      new Extension({ extnID: '2.5.29.19', critical: true, extnValue: new OctetString(AsnConvert.serialize(new BasicConstraints({ cA: opts.ca }))) }),
      new Extension({
        extnID: '2.5.29.15', critical: true,
        extnValue: new OctetString(AsnConvert.serialize(new KeyUsage(opts.ca ? KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign : KeyUsageFlags.digitalSignature | KeyUsageFlags.nonRepudiation))),
      }),
    ]),
  });
  const tbsDer = Buffer.from(AsnConvert.serialize(tbs));
  const sig = createSign('sha256').update(tbsDer).sign(opts.signer);
  const cert = new Certificate({
    tbsCertificate: tbs,
    signatureAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256_RSA, parameters: null }),
    signatureValue: new Uint8Array(sig).buffer,
  });
  return Buffer.from(AsnConvert.serialize(cert));
}

const attr = (type: string, value: ArrayBuffer) => new Attribute({ attrType: type, attrValues: [value] });

function buildCms(content: Buffer, signerCert: Buffer, signerKey: KeyObject, chain: Buffer[]): Buffer {
  const cert = AsnConvert.parse(signerCert, Certificate);
  const certHash = createHash('sha256').update(signerCert).digest();
  // ESS signing-certificate-v2: SEQ { SEQ OF ESSCertIDv2 { certHash } } with sha256 as the default algorithm.
  const scv2 = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: certHash })] })] })] });
  const signedAttrs = [
    attr('1.2.840.113549.1.9.3', new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' }).toBER()),
    attr('1.2.840.113549.1.9.5', new asn1js.UTCTime({ valueDate: new Date() }).toBER()),
    attr('1.2.840.113549.1.9.4', new asn1js.OctetString({ valueHex: createHash('sha256').update(content).digest() }).toBER()),
    attr('1.2.840.113549.1.9.16.2.47', scv2.toBER()),
  ];
  // What is signed is the DER of the attributes as a SET OF; their DER order is by encoding.
  const encoded = signedAttrs.map((a) => Buffer.from(AsnConvert.serialize(a))).sort(Buffer.compare);
  const setOf = Buffer.concat([Buffer.from([0x31]), derLen(encoded.reduce((n, b) => n + b.length, 0)), ...encoded]);
  const signature = createSign('sha256').update(setOf).sign(signerKey);
  const si = new SignerInfo({
    version: CMSVersion.v1,
    sid: new SignerIdentifier({ issuerAndSerialNumber: new IssuerAndSerialNumber({ issuer: cert.tbsCertificate.issuer, serialNumber: cert.tbsCertificate.serialNumber }) }),
    digestAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256 }),
    signedAttrs: encoded.map((b) => AsnConvert.parse(b, Attribute)),
    signatureAlgorithm: new AlgorithmIdentifier({ algorithm: '1.2.840.113549.1.1.1', parameters: null }),
    signature: new OctetString(signature),
  });
  const sd = new SignedData({
    version: CMSVersion.v1,
    digestAlgorithms: new DigestAlgorithmIdentifiers([new AlgorithmIdentifier({ algorithm: SHA256 })]),
    encapContentInfo: new EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    certificates: new CertificateSet([signerCert, ...chain].map((c) => new CertificateChoices({ certificate: AsnConvert.parse(c, Certificate) }))),
    signerInfos: new SignerInfos([si]),
  });
  return Buffer.from(AsnConvert.serialize(new ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: AsnConvert.serialize(sd) })));
}

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** A one-page PDF with an empty signature field, its /Contents a hex placeholder of `slot` bytes. */
function unsignedPdf(slot: number, text: string): { pdf: Buffer; contentsAt: number; byteRangeAt: number } {
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> /Annots [5 0 R] >>');
  const stream = `BT /F1 14 Tf 72 760 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push('<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0] /P 3 0 R /V 7 0 R >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const placeholder = '0'.repeat(slot * 2);
  objs.push(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /Name (AIMEAT Test Signer) /Reason (Test fixture) /M (D:20261009120000Z) /ByteRange [0 0000000000 0000000000 0000000000] /Contents <${placeholder}> >>`);
  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdf = Buffer.from(out, 'latin1');
  return { pdf, contentsAt: pdf.indexOf(`<${placeholder}>`), byteRangeAt: pdf.indexOf('/ByteRange [') };
}

function signPdf(signerCert: Buffer, signerKey: KeyObject, chain: Buffer[], text: string): Buffer {
  const slot = 8192;
  const { pdf, contentsAt, byteRangeAt } = unsignedPdf(slot, text);
  const gapStart = contentsAt;
  const gapEnd = contentsAt + slot * 2 + 2;
  const br = [0, gapStart, gapEnd, pdf.length - gapEnd];
  const brText = `/ByteRange [0 ${String(br[1]).padStart(10, '0')} ${String(br[2]).padStart(10, '0')} ${String(br[3]).padStart(10, '0')}]`;
  pdf.write(brText, byteRangeAt, 'latin1');
  const signed = Buffer.concat([pdf.subarray(0, gapStart), pdf.subarray(gapEnd)]);
  const cms = buildCms(signed, signerCert, signerKey, chain);
  if (cms.length > slot) throw new Error('signature does not fit the placeholder');
  pdf.write(`<${cms.toString('hex').padEnd(slot * 2, '0')}>`, gapStart, 'latin1');
  return pdf;
}

const pem = (der: Buffer) => `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;

const ca = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const caName = name('AIMEAT Test Root CA', 'AIMEAT Test');
const caCert = makeCert({ subject: caName, issuer: caName, publicKey: ca.publicKey, signer: ca.privateKey, ca: true, serial: 1 });
const signerCert = makeCert({ subject: name('Testi Allekirjoittaja', 'AIMEAT Test'), issuer: caName, publicKey: signer.publicKey, signer: ca.privateKey, ca: false, serial: 2 });

const signed = signPdf(signerCert, signer.privateKey, [caCert], 'Testisopimus: AIMEAT docsign fixture');
// One byte inside the first signed span changed: the page text.
const tampered = Buffer.from(signed);
const at = tampered.indexOf('Testisopimus');
tampered.write('Testisopimuz', at, 'latin1');
// An incremental update after signing that adds a page: a content change the signature does not cover.
const added = Buffer.concat([signed, Buffer.from('8 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n%%EOF\n', 'latin1')]);

// A .txt, because the repository ignores *.pem and *.crt (key material). This is the test CA's public
// certificate only, in the PEM bundle form AIMEAT_DOCSIGN_TRUST_ANCHORS reads.
writeFileSync(join(here, 'trust-anchors.txt'), pem(caCert));
writeFileSync(join(here, 'signed.pdf'), signed);
writeFileSync(join(here, 'signed-tampered.pdf'), tampered);
writeFileSync(join(here, 'signed-page-added.pdf'), added);
console.log('wrote trust-anchors.txt, signed.pdf, signed-tampered.pdf, signed-page-added.pdf');
