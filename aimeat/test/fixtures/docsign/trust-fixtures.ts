/**
 * @file test/fixtures/docsign/trust-fixtures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builders for the online half of signature validation, generated at run time with the
 *   crypto libraries already in the dependency tree (node:crypto, @peculiar/asn1-*, asn1js,
 *   xml-crypto), no new dependency and no committed key material:
 *   - certificates with the extensions the validator reads (QC statements, an OCSP responder and a
 *     CRL distribution point in AIA / CRLDP, extended key usage);
 *   - a CMS SignedData, detached or attached (.p7s / .p7m), with an optional RFC 3161 signature
 *     timestamp, and an RFC 3161 timestamp token on its own;
 *   - a signed PDF with a chosen SubFilter (ETSI.CAdES.detached, adbe.pkcs7.detached) and a PDF
 *     document timestamp (ETSI.RFC3161);
 *   - an OCSP response (good or revoked) signed by the issuing CA, and a CRL listing a serial;
 *   - an EU List of Trusted Lists and member-state trusted lists (ETSI TS 119 612), each with an
 *     enveloped XML signature (xml-crypto), so the node's own list reader and signature checks run.
 *   test/e2e-docsign-validation.ts serves them from the test process and points an in-process node
 *   at them (docsignLotlUrl, and the URLs written into the certificates).
 * @structure makeCertX · buildCmsX · timestampToken · signPdfAs · docTimestampPdf · ocspResponse ·
 *   crl · trustedList · lotl · signXml · qcStatements
 * @usage const ca = makeCertX({ ... ca: true }); const pdf = signPdfAs('adbe.pkcs7.detached', signer, key, [ca], 'text');
 * @version-history
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: buildCmsX can carry OCSP responses as an unsigned
 *     adbe-revocationInfoArchival attribute, leave out the signer or the messageDigest attribute;
 *     ocspResponse takes a thisUpdate; signXmlById signs one element by its Id.
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F03b-04).
 */
import { createHash, createSign, type KeyObject } from 'node:crypto';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  Certificate, TBSCertificate, Validity, Name, SubjectPublicKeyInfo, AlgorithmIdentifier, Extension, Extensions,
  BasicConstraints, KeyUsage, KeyUsageFlags, Version, AuthorityInfoAccessSyntax, AccessDescription, GeneralName,
  CRLDistributionPoints, DistributionPoint, DistributionPointName, ExtendedKeyUsage, CertificateList, TBSCertList,
  RevokedCertificate, Time,
} from '@peculiar/asn1-x509';
import {
  ContentInfo, SignedData, SignerInfo, SignerInfos, SignerIdentifier, IssuerAndSerialNumber, EncapsulatedContentInfo,
  EncapsulatedContent, CertificateSet, CertificateChoices, Attribute, CMSVersion, DigestAlgorithmIdentifiers,
} from '@peculiar/asn1-cms';
import {
  OCSPResponse, OCSPResponseStatus, ResponseBytes, BasicOCSPResponse, ResponseData, ResponderID, SingleResponse,
  CertStatus, RevokedInfo, CertID,
} from '@peculiar/asn1-ocsp';
import { TSTInfo, MessageImprint } from '@peculiar/asn1-tsp';
import * as asn1js from 'asn1js';
import { SignedXml } from 'xml-crypto';
import { unsignedPdf, pem } from './pdf-sign.js';

const SHA256_RSA = '1.2.840.113549.1.1.11';
const SHA256 = '2.16.840.1.101.3.4.2.1';
const SHA1 = '1.3.14.3.2.26';
const DATA = '1.2.840.113549.1.7.1';
const TSTINFO = '1.2.840.113549.1.9.16.1.4';
const SIGNATURE_TIMESTAMP = '1.2.840.113549.1.9.16.2.14';
export const EKU_TIMESTAMPING = '1.3.6.1.5.5.7.3.8';
const DAY = 86_400_000;

// ── certificates ──

/** QCStatements: compliance, optionally the QSCD statement, and the QcType. */
export function qcStatements(opts: { sscd: boolean; type?: 'esign' | 'eseal' }): ArrayBuffer {
  const stmt = (oid: string, value?: asn1js.AsnType) => new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: oid }), ...(value ? [value] : [])] });
  const items = [stmt('0.4.0.1862.1.1')];
  if (opts.sscd) items.push(stmt('0.4.0.1862.1.4'));
  if (opts.type) items.push(stmt('0.4.0.1862.1.6', new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: opts.type === 'esign' ? '0.4.0.1862.1.6.1' : '0.4.0.1862.1.6.2' })] })));
  return new asn1js.Sequence({ value: items }).toBER(false);
}

export interface CertOpts {
  subject: Name; issuer: Name; publicKey: KeyObject; signer: KeyObject; ca: boolean;
  /** The serial's bytes; the first should be below 0x80 to keep it positive. */
  serial: Buffer;
  ocspUrl?: string; crlUrl?: string;
  qc?: { sscd: boolean; type?: 'esign' | 'eseal' };
  eku?: string[];
}

export function makeCertX(o: CertOpts): Buffer {
  const spki = AsnConvert.parse(o.publicKey.export({ type: 'spki', format: 'der' }), SubjectPublicKeyInfo);
  const now = Date.now();
  const sigAlg = new AlgorithmIdentifier({ algorithm: SHA256_RSA, parameters: null });
  const ext = (id: string, value: ArrayBuffer, critical = false) => new Extension({ extnID: id, critical, extnValue: new OctetString(value) });
  const extensions = [
    ext('2.5.29.19', AsnConvert.serialize(new BasicConstraints({ cA: o.ca })), true),
    ext('2.5.29.15', AsnConvert.serialize(new KeyUsage(o.ca ? KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign : KeyUsageFlags.digitalSignature | KeyUsageFlags.nonRepudiation)), true),
  ];
  if (o.ocspUrl) {
    extensions.push(ext('1.3.6.1.5.5.7.1.1', AsnConvert.serialize(new AuthorityInfoAccessSyntax([
      new AccessDescription({ accessMethod: '1.3.6.1.5.5.7.48.1', accessLocation: new GeneralName({ uniformResourceIdentifier: o.ocspUrl }) }),
    ]))));
  }
  if (o.crlUrl) {
    extensions.push(ext('2.5.29.31', AsnConvert.serialize(new CRLDistributionPoints([
      new DistributionPoint({ distributionPoint: new DistributionPointName({ fullName: [new GeneralName({ uniformResourceIdentifier: o.crlUrl })] }) }),
    ]))));
  }
  if (o.qc) extensions.push(ext('1.3.6.1.5.5.7.1.3', qcStatements(o.qc)));
  if (o.eku?.length) extensions.push(ext('2.5.29.37', AsnConvert.serialize(new ExtendedKeyUsage(o.eku)), true));
  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: new Uint8Array(o.serial).buffer,
    signature: sigAlg,
    issuer: o.issuer,
    validity: new Validity({ notBefore: new Date(now - DAY), notAfter: new Date(now + 5 * 365 * DAY) }),
    subject: o.subject,
    subjectPublicKeyInfo: spki,
    extensions: new Extensions(extensions),
  });
  const tbsDer = Buffer.from(AsnConvert.serialize(tbs));
  const sig = createSign('sha256').update(tbsDer).sign(o.signer);
  return Buffer.from(AsnConvert.serialize(new Certificate({ tbsCertificate: tbs, signatureAlgorithm: sigAlg, signatureValue: new Uint8Array(sig).buffer })));
}

// ── CMS ──

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const attr = (type: string, value: ArrayBuffer) => new Attribute({ attrType: type, attrValues: [value] });

export interface CmsOpts {
  /** Carry the content inside the SignedData (.p7m, a timestamp token). */
  attached?: boolean;
  eContentType?: string;
  /** Leave out the signing-time attribute (a timestamp token carries its time in TSTInfo). */
  noSigningTime?: boolean;
  /** An RFC 3161 token over the signature value, added as the signature-timestamp unsigned attribute. */
  timestamp?: (signatureValue: Buffer) => Buffer;
  /** OCSP responses carried as an unsigned adbe-revocationInfoArchival attribute. */
  unsignedOcsp?: Buffer[];
  /** A SignedData with an empty signerInfos SET. */
  noSigner?: boolean;
  /** Leave the messageDigest attribute out of the signed attributes. */
  noMessageDigest?: boolean;
}

const ADBE_REVOCATION = '1.2.840.113583.1.1.8';

/** RevocationInfoArchival { ocsp [1] EXPLICIT SEQUENCE OF OCSPResponse }. */
function adbeRevocationValue(ocsp: Buffer[]): ArrayBuffer {
  const responses = ocsp.map((d) => asn1js.fromBER(new Uint8Array(d).buffer).result);
  return new asn1js.Sequence({
    value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 1 }, value: [new asn1js.Sequence({ value: responses })] })],
  }).toBER();
}

/** A CMS SignedData by one RSA signer, SHA-256, with the four signed attributes a PAdES signer writes. */
export function buildCmsX(content: Buffer, signerCert: Buffer, signerKey: KeyObject, chain: Buffer[], o: CmsOpts = {}): Buffer {
  const cert = AsnConvert.parse(signerCert, Certificate);
  const eContentType = o.eContentType ?? DATA;
  const certHash = createHash('sha256').update(signerCert).digest();
  const scv2 = new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: certHash })] })] })] });
  const signedAttrs = [
    attr('1.2.840.113549.1.9.3', new asn1js.ObjectIdentifier({ value: eContentType }).toBER()),
    ...(o.noSigningTime ? [] : [attr('1.2.840.113549.1.9.5', new asn1js.UTCTime({ valueDate: new Date() }).toBER())]),
    ...(o.noMessageDigest ? [] : [attr('1.2.840.113549.1.9.4', new asn1js.OctetString({ valueHex: createHash('sha256').update(content).digest() }).toBER())]),
    attr('1.2.840.113549.1.9.16.2.47', scv2.toBER()),
  ];
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
    ...(o.timestamp || o.unsignedOcsp ? { unsignedAttrs: [
      ...(o.timestamp ? [attr(SIGNATURE_TIMESTAMP, new Uint8Array(o.timestamp(signature)).buffer)] : []),
      ...(o.unsignedOcsp ? [attr(ADBE_REVOCATION, adbeRevocationValue(o.unsignedOcsp))] : []),
    ] } : {}),
  });
  const sd = new SignedData({
    version: o.eContentType && o.eContentType !== DATA ? CMSVersion.v3 : CMSVersion.v1,
    digestAlgorithms: new DigestAlgorithmIdentifiers([new AlgorithmIdentifier({ algorithm: SHA256 })]),
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType,
      ...(o.attached ? { eContent: new EncapsulatedContent({ single: new OctetString(content) }) } : {}),
    }),
    certificates: new CertificateSet([signerCert, ...chain].map((c) => new CertificateChoices({ certificate: AsnConvert.parse(c, Certificate) }))),
    signerInfos: new SignerInfos(o.noSigner ? [] : [si]),
  });
  return Buffer.from(AsnConvert.serialize(new ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: AsnConvert.serialize(sd) })));
}

/** An RFC 3161 TimeStampToken over `imprinted`, issued at `genTime` by the TSA certificate. */
export function timestampToken(imprinted: Buffer, tsaCert: Buffer, tsaKey: KeyObject, chain: Buffer[], genTime: Date): Buffer {
  const tst = new TSTInfo({
    version: 1,
    policy: '1.3.6.1.4.1.99999.1.1',
    messageImprint: new MessageImprint({
      hashAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256 }),
      hashedMessage: new OctetString(createHash('sha256').update(imprinted).digest()),
    }),
    serialNumber: new Uint8Array([0x01, ...createHash('sha256').update(imprinted).digest().subarray(0, 7)]).buffer,
    genTime,
  });
  const der = Buffer.from(AsnConvert.serialize(tst));
  return buildCmsX(der, tsaCert, tsaKey, chain, { attached: true, eContentType: TSTINFO, noSigningTime: true });
}

// ── PDF ──

/** Fill the /ByteRange and /Contents placeholders: `contents` gets the bytes the signature covers. */
function fill(pdf: Buffer, contentsAt: number, byteRangeAt: number, slot: number, contents: (signed: Buffer) => Buffer): Buffer {
  const gapStart = contentsAt;
  const gapEnd = contentsAt + slot * 2 + 2;
  const br = [0, gapStart, gapEnd, pdf.length - gapEnd];
  pdf.write(`/ByteRange [0 ${String(br[1]).padStart(10, '0')} ${String(br[2]).padStart(10, '0')} ${String(br[3]).padStart(10, '0')}]`, byteRangeAt, 'latin1');
  const signed = Buffer.concat([pdf.subarray(0, gapStart), pdf.subarray(gapEnd)]);
  const cms = contents(signed);
  if (cms.length > slot) throw new Error('signature does not fit the placeholder');
  pdf.write(`<${cms.toString('hex').padEnd(slot * 2, '0')}>`, gapStart, 'latin1');
  return pdf;
}

/** The one-page fixture PDF with its SubFilter replaced by one of the same length, so no offset moves. */
function pdfWithSubFilter(subFilter: string, slot: number, text: string) {
  const base = unsignedPdf(slot, text);
  const from = '/SubFilter /ETSI.CAdES.detached';
  const to = `/SubFilter /${subFilter}`.padEnd(from.length, ' ');
  if (to.length !== from.length) throw new Error(`SubFilter ${subFilter} is longer than the placeholder`);
  const at = base.pdf.indexOf(from);
  base.pdf.write(to, at, 'latin1');
  return base;
}

/** A one-page PDF signed by `signerCert` with the given SubFilter, optionally with a signature timestamp. */
export function signPdfAs(subFilter: 'ETSI.CAdES.detached' | 'adbe.pkcs7.detached', signerCert: Buffer, signerKey: KeyObject, chain: Buffer[], text: string,
  timestamp?: (signatureValue: Buffer) => Buffer, extra: CmsOpts = {}): Buffer {
  const slot = 16384;
  const { pdf, contentsAt, byteRangeAt } = pdfWithSubFilter(subFilter, slot, text);
  return fill(pdf, contentsAt, byteRangeAt, slot, (signed) => buildCmsX(signed, signerCert, signerKey, chain, { ...extra, timestamp }));
}

/** A one-page PDF whose only signature field is a document timestamp (SubFilter ETSI.RFC3161). */
export function docTimestampPdf(tsaCert: Buffer, tsaKey: KeyObject, chain: Buffer[], text: string, genTime: Date): Buffer {
  const slot = 16384;
  const { pdf, contentsAt, byteRangeAt } = pdfWithSubFilter('ETSI.RFC3161', slot, text);
  return fill(pdf, contentsAt, byteRangeAt, slot, (signed) => timestampToken(signed, tsaCert, tsaKey, chain, genTime));
}

// ── revocation ──

function issuerHashes(issuerCert: Buffer): { nameHash: Buffer; keyHash: Buffer } {
  const c = AsnConvert.parse(issuerCert, Certificate);
  return {
    nameHash: createHash('sha1').update(Buffer.from(AsnConvert.serialize(c.tbsCertificate.subject))).digest(),
    keyHash: createHash('sha1').update(Buffer.from(c.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey)).digest(),
  };
}

/** An OCSP response about `cert`, signed by its issuing CA. */
export function ocspResponse(cert: Buffer, issuerCert: Buffer, issuerKey: KeyObject, status: { revokedAt?: Date; thisUpdate?: Date } = {}): Buffer {
  const { nameHash, keyHash } = issuerHashes(issuerCert);
  const serial = AsnConvert.parse(cert, Certificate).tbsCertificate.serialNumber;
  const now = status.thisUpdate ?? new Date();
  const data = new ResponseData({
    responderID: new ResponderID({ byKey: new OctetString(keyHash) }),
    producedAt: now,
    responses: [new SingleResponse({
      certID: new CertID({
        hashAlgorithm: new AlgorithmIdentifier({ algorithm: SHA1, parameters: null }),
        issuerNameHash: new OctetString(nameHash), issuerKeyHash: new OctetString(keyHash), serialNumber: serial,
      }),
      certStatus: status.revokedAt ? new CertStatus({ revoked: new RevokedInfo({ revocationTime: status.revokedAt }) }) : new CertStatus({ good: null }),
      thisUpdate: now,
      nextUpdate: new Date(now.getTime() + DAY),
    })],
  });
  const tbs = Buffer.from(AsnConvert.serialize(data));
  const sig = createSign('sha256').update(tbs).sign(issuerKey);
  const basic = new BasicOCSPResponse({
    tbsResponseData: data,
    signatureAlgorithm: new AlgorithmIdentifier({ algorithm: SHA256_RSA, parameters: null }),
    signature: new Uint8Array(sig).buffer,
  });
  return Buffer.from(AsnConvert.serialize(new OCSPResponse({
    responseStatus: OCSPResponseStatus.successful,
    responseBytes: new ResponseBytes({ responseType: '1.3.6.1.5.5.7.48.1.1', response: new OctetString(AsnConvert.serialize(basic)) }),
  })));
}

/** A CRL of `issuerCert` listing each serial with its revocation time. */
export function crl(issuerCert: Buffer, issuerKey: KeyObject, revoked: Array<{ cert: Buffer; at: Date }>): Buffer {
  const issuer = AsnConvert.parse(issuerCert, Certificate).tbsCertificate.subject;
  const sigAlg = new AlgorithmIdentifier({ algorithm: SHA256_RSA, parameters: null });
  const now = Date.now();
  const tbs = new TBSCertList({
    version: Version.v2,
    signature: sigAlg,
    issuer,
    thisUpdate: new Time(new Date(now - 3600_000)),
    nextUpdate: new Time(new Date(now + DAY)),
    revokedCertificates: revoked.map((r) => new RevokedCertificate({
      userCertificate: AsnConvert.parse(r.cert, Certificate).tbsCertificate.serialNumber,
      revocationDate: new Time(r.at),
    })),
  });
  const tbsDer = Buffer.from(AsnConvert.serialize(tbs));
  const sig = createSign('sha256').update(tbsDer).sign(issuerKey);
  return Buffer.from(AsnConvert.serialize(new CertificateList({ tbsCertList: tbs, signatureAlgorithm: sigAlg, signature: new Uint8Array(sig).buffer })));
}

// ── trusted lists ──

const TSL_NS = 'http://uri.etsi.org/02231/v2#';
const b64 = (der: Buffer) => der.toString('base64');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export interface ListedService {
  /** CA/QC, CA/PKC, TSA/QTST, … */
  type: string;
  name: string;
  cert: Buffer;
  /** Newest first: [current, ...history]. Status names: granted, withdrawn, … */
  periods: Array<{ status: string; from: string }>;
}

/** Sign `xml` with an enveloped XML signature (RSA-SHA256, exclusive C14N) over the whole document. */
export function signXml(xml: string, key: KeyObject, cert: Buffer): string {
  const sx = new SignedXml({ privateKey: key.export({ type: 'pkcs8', format: 'pem' }).toString(), publicCert: pem(cert) });
  sx.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sx.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sx.addReference({
    xpath: '/*',
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    isEmptyUri: true,
  });
  sx.computeSignature(xml);
  return sx.getSignedXml();
}

/** Sign `xml` with an enveloped XML signature whose one reference names the element carrying `Id="id"`. */
export function signXmlById(xml: string, key: KeyObject, cert: Buffer, id: string): string {
  const sx = new SignedXml({ privateKey: key.export({ type: 'pkcs8', format: 'pem' }).toString(), publicCert: pem(cert) });
  sx.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sx.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sx.addReference({
    xpath: `//*[@Id='${id}']`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
  });
  sx.computeSignature(xml);
  return sx.getSignedXml();
}

/** A member state's trusted list with one provider and the given services. Unsigned; pass it to signXml. */
export function trustedList(territory: string, tspName: string, services: ListedService[]): string {
  const period = (p: { status: string; from: string }) =>
    `<ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/${p.status}</ServiceStatus><StatusStartingTime>${p.from}</StatusStartingTime>`;
  const svc = (s: ListedService) => {
    const [current, ...history] = s.periods;
    const identity = `<ServiceDigitalIdentity><DigitalId><X509Certificate>${b64(s.cert)}</X509Certificate></DigitalId></ServiceDigitalIdentity>`;
    const head = `<ServiceTypeIdentifier>http://uri.etsi.org/TrstSvc/Svctype/${s.type}</ServiceTypeIdentifier><ServiceName><Name xml:lang="en">${esc(s.name)}</Name></ServiceName>${identity}`;
    return `<TSPService><ServiceInformation>${head}${period(current!)}</ServiceInformation>${history.length
      ? `<ServiceHistory>${history.map((h) => `<ServiceHistoryInstance><ServiceTypeIdentifier>http://uri.etsi.org/TrstSvc/Svctype/${s.type}</ServiceTypeIdentifier><ServiceName><Name xml:lang="en">${esc(s.name)}</Name></ServiceName>${identity}${period(h)}</ServiceHistoryInstance>`).join('')}</ServiceHistory>`
      : ''}</TSPService>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?><TrustServiceStatusList xmlns="${TSL_NS}" Id="tsl-${territory}" TSLTag="http://uri.etsi.org/19612/TSLTag">`
    + `<SchemeInformation><TSLVersionIdentifier>5</TSLVersionIdentifier><TSLSequenceNumber>1</TSLSequenceNumber><SchemeTerritory>${territory}</SchemeTerritory>`
    + `<NextUpdate><dateTime>${new Date(Date.now() + 30 * DAY).toISOString().slice(0, 19)}Z</dateTime></NextUpdate></SchemeInformation>`
    + `<TrustServiceProviderList><TrustServiceProvider><TSPInformation><TSPName><Name xml:lang="en">${esc(tspName)}</Name></TSPName></TSPInformation>`
    + `<TSPServices>${services.map(svc).join('')}</TSPServices></TrustServiceProvider></TrustServiceProviderList></TrustServiceStatusList>`;
}

/** The List of Trusted Lists: one pointer per territory (its list's address and signer), and its own. Unsigned. */
export function lotl(selfUrl: string, selfSigner: Buffer, pointers: Array<{ territory: string; url: string; signer: Buffer }>): string {
  const ptr = (territory: string, url: string, signer: Buffer) =>
    `<OtherTSLPointer><ServiceDigitalIdentities><ServiceDigitalIdentity><DigitalId><X509Certificate>${b64(signer)}</X509Certificate></DigitalId></ServiceDigitalIdentity></ServiceDigitalIdentities>`
    + `<TSLLocation>${esc(url)}</TSLLocation><AdditionalInformation><OtherInformation><SchemeTerritory>${territory}</SchemeTerritory></OtherInformation>`
    + `<OtherInformation><MimeType>application/vnd.etsi.tsl+xml</MimeType></OtherInformation></AdditionalInformation></OtherTSLPointer>`;
  return `<?xml version="1.0" encoding="UTF-8"?><TrustServiceStatusList xmlns="${TSL_NS}" Id="lotl" TSLTag="http://uri.etsi.org/19612/TSLTag">`
    + `<SchemeInformation><TSLVersionIdentifier>5</TSLVersionIdentifier><TSLSequenceNumber>1</TSLSequenceNumber><SchemeTerritory>EU</SchemeTerritory>`
    + `<PointersToOtherTSL>${ptr('EU', selfUrl, selfSigner)}${pointers.map((p) => ptr(p.territory, p.url, p.signer)).join('')}</PointersToOtherTSL>`
    + `</SchemeInformation></TrustServiceStatusList>`;
}
