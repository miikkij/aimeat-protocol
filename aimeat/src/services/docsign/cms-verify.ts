/**
 * @file src/services/docsign/cms-verify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Verifies a CMS SignedData (RFC 5652) the way PAdES and CAdES use it: the content
 *   digest against the messageDigest attribute, the signer's signature over the signed attributes,
 *   the ESS signing-certificate binding, and an RFC 3161 timestamp token either over the signature
 *   (a signature timestamp) or over the document (a document timestamp).
 *
 *   THE SIGNED ATTRIBUTES ARE VERIFIED AS RECEIVED. The signature covers the encoding of the
 *   signed attributes with the outer tag changed from [0] to SET. Re-encoding a parsed structure
 *   can change bytes (a BER length, an attribute order), so the raw bytes are taken from the BER
 *   tree with asn1js and only the first byte is replaced. The typed fields are read with
 *   @peculiar/asn1-cms. Both are MIT.
 *
 *   THIS FILE DECIDES NOTHING ABOUT TRUST. It answers "is this signature intact and made with the
 *   key in this certificate". Whether that certificate belongs to someone trusted is
 *   trust-chain.ts's question, and whether it was revoked is revocation.ts's.
 * @structure CmsCheck · TimestampCheck · verifyCms · verifyTimestampToken · digestName · OIDs
 * @usage const check = verifyCms(cmsDer, signedBytes);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { createHash, createPublicKey, publicDecrypt, verify as cryptoVerify, constants, X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import { AsnConvert } from '@peculiar/asn1-schema';
import { ContentInfo, SignedData, SignerInfo } from '@peculiar/asn1-cms';
import { TSTInfo } from '@peculiar/asn1-tsp';
import { readCert } from './x509-info.js';

export const CMS_OID = {
  signedData: '1.2.840.113549.1.7.2',
  data: '1.2.840.113549.1.7.1',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  contentType: '1.2.840.113549.1.9.3',
  signingCertificate: '1.2.840.113549.1.9.16.2.12',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  signatureTimeStamp: '1.2.840.113549.1.9.16.2.14',
  adbeRevocation: '1.2.840.113583.1.1.8',
} as const;

const DIGESTS: Record<string, string> = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.4': 'sha224',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
  '2.16.840.1.101.3.4.2.8': 'sha3-256',
  '2.16.840.1.101.3.4.2.9': 'sha3-384',
  '2.16.840.1.101.3.4.2.10': 'sha3-512',
};

/** Signature algorithm OID → [kind, digest or null when the digest comes from digestAlgorithm]. */
const SIG_ALGS: Record<string, [kind: 'rsa' | 'pss' | 'ecdsa' | 'ed25519' | 'ed448', digest: string | null]> = {
  '1.2.840.113549.1.1.1': ['rsa', null],
  '1.2.840.113549.1.1.5': ['rsa', 'sha1'],
  '1.2.840.113549.1.1.14': ['rsa', 'sha224'],
  '1.2.840.113549.1.1.11': ['rsa', 'sha256'],
  '1.2.840.113549.1.1.12': ['rsa', 'sha384'],
  '1.2.840.113549.1.1.13': ['rsa', 'sha512'],
  '2.16.840.1.101.3.4.3.14': ['rsa', 'sha3-256'],
  '2.16.840.1.101.3.4.3.15': ['rsa', 'sha3-384'],
  '2.16.840.1.101.3.4.3.16': ['rsa', 'sha3-512'],
  '1.2.840.113549.1.1.10': ['pss', null],
  '1.2.840.10045.2.1': ['ecdsa', null],
  '1.2.840.10045.4.1': ['ecdsa', 'sha1'],
  '1.2.840.10045.4.3.1': ['ecdsa', 'sha224'],
  '1.2.840.10045.4.3.2': ['ecdsa', 'sha256'],
  '1.2.840.10045.4.3.3': ['ecdsa', 'sha384'],
  '1.2.840.10045.4.3.4': ['ecdsa', 'sha512'],
  '2.16.840.1.101.3.4.3.10': ['ecdsa', 'sha3-256'],
  '2.16.840.1.101.3.4.3.11': ['ecdsa', 'sha3-384'],
  '2.16.840.1.101.3.4.3.12': ['ecdsa', 'sha3-512'],
  '1.3.101.112': ['ed25519', null],
  '1.3.101.113': ['ed448', null],
};

export function digestName(oid: string): string | null {
  return DIGESTS[oid] ?? null;
}

/** Why a check could not pass. Codes, so the report and the tests read the same thing. */
export type CmsProblem =
  | 'CMS_UNPARSABLE' | 'NOT_SIGNED_DATA' | 'NO_SIGNER' | 'MULTIPLE_SIGNERS'
  | 'SIGNER_CERT_MISSING' | 'DIGEST_ALGORITHM_UNSUPPORTED' | 'SIGNATURE_ALGORITHM_UNSUPPORTED'
  | 'NO_MESSAGE_DIGEST' | 'DIGEST_MISMATCH' | 'SIGNATURE_INVALID' | 'SIGNING_CERT_ATTR_MISMATCH'
  | 'WEAK_DIGEST' | 'TIMESTAMP_IMPRINT_MISMATCH' | 'TIMESTAMP_INVALID' | 'NOT_A_TIMESTAMP';

export interface TimestampCheck {
  genTime: string | null;
  /** The imprint in the token equals the hash of what it claims to timestamp. */
  imprintMatches: boolean;
  /** The TSA's signature over the token is intact. */
  signatureValid: boolean;
  tsaCert: Buffer | null;
  certificates: Buffer[];
  problems: CmsProblem[];
}

export interface CmsCheck {
  /** The content digest equals the signed messageDigest (or, without signed attributes, the signature covers the content). */
  integrity: boolean;
  /** The signature over the signed attributes verifies with the signer certificate's key. */
  signatureValid: boolean;
  signerCert: Buffer | null;
  /** Every certificate the CMS carries, DER. */
  certificates: Buffer[];
  digestAlgorithm: string | null;
  signatureAlgorithm: string | null;
  /** The signing-time signed attribute: the signer's own clock, claimed and not proved. */
  claimedSigningTime: string | null;
  /** ESS signing-certificate(-v2) present and naming the signer certificate. null = absent. */
  signingCertificateBound: boolean | null;
  /** A signature timestamp from the unsigned attributes, when there is one. */
  timestamp: TimestampCheck | null;
  /** Revocation evidence the signer embedded (adbe-revocationInfoArchival, CMS crls): DER blobs. */
  embeddedOcsp: Buffer[];
  embeddedCrls: Buffer[];
  /** For a CMS that encapsulates its content (adbe.pkcs7.sha1, an attached .p7m): those bytes. */
  encapsulated: Buffer | null;
  problems: CmsProblem[];
}

// ── raw BER navigation (asn1js) ──

type Block = asn1js.AsnType & {
  idBlock: { tagClass: number; tagNumber: number };
  valueBlock: { value?: Block[] };
  valueBeforeDecodeView: Uint8Array;
};

function children(b: Block | undefined): Block[] {
  return (b?.valueBlock?.value ?? []) as Block[];
}
const raw = (b: Block): Buffer => Buffer.from(b.valueBeforeDecodeView);
const isContext = (b: Block, n: number) => b.idBlock.tagClass === 3 && b.idBlock.tagNumber === n;

interface RawSignedData {
  certificates: Buffer[];
  crls: Buffer[];
  signerInfos: { signedAttrs: Buffer | null }[];
}

/**
 * asn1js stops at 10 000 nodes by default, which a signature carrying an embedded CRL passes. The
 * input is already capped in size (config.docsignMaxMb), so a higher node ceiling is safe here.
 */
const BER = { maxNodes: 250_000 };
const PARSE = { berOptions: BER };

function rawSignedData(cms: Buffer): RawSignedData | null {
  const parsed = asn1js.fromBER(cms, BER);
  if (parsed.offset === -1) return null;
  const contentInfo = parsed.result as unknown as Block;
  const explicit = children(contentInfo)[1];
  const sd = children(explicit)[0];
  if (!sd) return null;
  const items = children(sd);
  const out: RawSignedData = { certificates: [], crls: [], signerInfos: [] };
  for (const item of items) {
    if (isContext(item, 0)) out.certificates = children(item).filter((c) => c.idBlock.tagClass === 1 && c.idBlock.tagNumber === 16).map(raw);
    else if (isContext(item, 1)) out.crls = children(item).filter((c) => c.idBlock.tagClass === 1).map(raw);
  }
  const signerInfos = items[items.length - 1];
  for (const si of children(signerInfos)) {
    const attrs = children(si).find((c) => isContext(c, 0));
    if (!attrs) { out.signerInfos.push({ signedAttrs: null }); continue; }
    const bytes = raw(attrs);
    bytes[0] = 0x31; // [0] IMPLICIT → SET OF, which is what was signed
    out.signerInfos.push({ signedAttrs: bytes });
  }
  return out;
}

// ── signature verification ──

/** RSASSA-PSS parameters: hash, and salt length (RFC 4055 defaults: sha1, 20). */
function pssParams(params: ArrayBuffer | null | undefined): { hash: string; salt: number } {
  const out = { hash: 'sha1', salt: 20 };
  if (!params) return out;
  const parsed = asn1js.fromBER(params);
  if (parsed.offset === -1) return out;
  for (const field of children(parsed.result as unknown as Block)) {
    if (isContext(field, 0)) {
      const oid = (children(field)[0] as unknown as { valueBlock: { value: Block[] } })?.valueBlock?.value?.[0] as unknown as asn1js.ObjectIdentifier;
      const name = oid ? DIGESTS[oid.valueBlock.toString()] : undefined;
      if (name) out.hash = name;
    } else if (isContext(field, 2)) {
      const int = children(field)[0] as unknown as asn1js.Integer;
      if (int) out.salt = int.valueBlock.valueDec;
    }
  }
  return out;
}

/** Verify `signature` over `data` with `cert`'s key, by signature algorithm OID. Also used for OCSP and CRL signatures. */
export function verifySignature(
  cert: X509Certificate, sigAlgOid: string, sigAlgParams: ArrayBuffer | null | undefined,
  digestAlgOid: string, data: Buffer, signature: Buffer,
): { ok: boolean; algorithm: string | null; problem?: CmsProblem } {
  const alg = SIG_ALGS[sigAlgOid];
  if (!alg) return { ok: false, algorithm: null, problem: 'SIGNATURE_ALGORITHM_UNSUPPORTED' };
  const [kind, fixedDigest] = alg;
  const key = createPublicKey(cert.publicKey.export({ format: 'pem', type: 'spki' }));
  try {
    if (kind === 'ed25519' || kind === 'ed448') {
      return { ok: cryptoVerify(null, data, key, signature), algorithm: kind };
    }
    if (kind === 'pss') {
      const p = pssParams(sigAlgParams);
      return {
        ok: cryptoVerify(p.hash, data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: p.salt }, signature),
        algorithm: `rsa-pss-${p.hash}`,
      };
    }
    const digest = fixedDigest ?? DIGESTS[digestAlgOid];
    if (!digest) return { ok: false, algorithm: null, problem: 'DIGEST_ALGORITHM_UNSUPPORTED' };
    if (kind === 'ecdsa') {
      return { ok: cryptoVerify(digest, data, { key, dsaEncoding: 'der' }, signature), algorithm: `ecdsa-${digest}` };
    }
    if (cryptoVerify(digest, data, { key, padding: constants.RSA_PKCS1_PADDING }, signature)) return { ok: true, algorithm: `rsa-${digest}` };
    return { ok: digestInfoWithoutNull(key, digest, data, signature), algorithm: `rsa-${digest}` };
  } catch {
    return { ok: false, algorithm: kind };
  }
}

const DIGEST_OID_BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(DIGESTS).map(([oid, name]) => [name, oid]));

/**
 * RFC 8017 §9.2 note 1: the DigestInfo's AlgorithmIdentifier parameters may be absent instead of
 * NULL, and some signers (Poland's trusted-profile seal among them) write it that way. node's verify
 * accepts only the NULL form, so the other is checked here: the recovered block must equal, byte
 * for byte, the DER of DigestInfo { algorithm, digest } with no parameters. An exact comparison,
 * never a parse, because lenient DigestInfo parsing is what made the e=3 signature forgeries work.
 */
function digestInfoWithoutNull(key: ReturnType<typeof createPublicKey>, digest: string, data: Buffer, signature: Buffer): boolean {
  const oid = DIGEST_OID_BY_NAME[digest];
  if (!oid) return false;
  let recovered: Buffer;
  // eslint-disable-next-line aimeat/no-silent-catch -- a signature block that does not unpad is a signature that does not verify; false is the answer, not a lost error
  try { recovered = publicDecrypt({ key, padding: constants.RSA_PKCS1_PADDING }, signature); } catch { return false; }
  const hash = createHash(digest).update(data).digest();
  const expected = Buffer.from(new asn1js.Sequence({
    value: [
      new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: oid })] }),
      new asn1js.OctetString({ valueHex: hash }),
    ],
  }).toBER(false));
  return recovered.equals(expected);
}

/** The signer's certificate: by issuer and serial number, or by subject key identifier. */
function findSignerCert(si: SignerInfo, certs: Buffer[]): Buffer | null {
  const ias = si.sid.issuerAndSerialNumber;
  const ski = si.sid.subjectKeyIdentifier ? Buffer.from(si.sid.subjectKeyIdentifier.buffer).toString('hex') : null;
  for (const der of certs) {
    let x: X509Certificate;
    // eslint-disable-next-line aimeat/no-silent-catch -- the CMS came from an uploaded file; an unreadable certificate in it is not the signer's
    try { x = new X509Certificate(der); } catch { continue; }
    if (ias) {
      const serial = Buffer.from(ias.serialNumber).toString('hex').replace(/^0+/, '').toLowerCase();
      if (x.serialNumber.toLowerCase().replace(/^0+/, '') === serial) {
        // Same serial from another issuer is possible in principle; compare the issuer's DER too.
        const issuerDer = Buffer.from(AsnConvert.serialize(ias.issuer));
        if (rawIssuer(der).equals(issuerDer)) return der;
      }
    } else if (ski) {
      // eslint-disable-next-line aimeat/no-silent-catch -- as above: an unreadable certificate is not the signer's, and SIGNER_CERT_MISSING reports the outcome
      try { if (readCert(der).subjectKeyId === ski) return der; } catch { /* not a readable certificate */ }
    }
  }
  return null;
}

/** The issuer Name of a certificate, as the DER it was written in. */
function rawIssuer(certDer: Buffer): Buffer {
  const parsed = asn1js.fromBER(certDer);
  const tbs = children(parsed.result as unknown as Block)[0];
  const fields = children(tbs);
  // tbsCertificate: [0] version (optional), serialNumber, signature, issuer, …
  const offset = fields[0] && isContext(fields[0], 0) ? 1 : 0;
  return fields[offset + 2] ? raw(fields[offset + 2]!) : Buffer.alloc(0);
}

/** Read the ESS signing-certificate(-v2) attribute and compare its hash with the signer cert. */
function signingCertBinding(attrValue: ArrayBuffer, v2: boolean, signerDer: Buffer): boolean {
  const parsed = asn1js.fromBER(attrValue);
  if (parsed.offset === -1) return false;
  // SigningCertificateV2 ::= SEQ { certs SEQ OF ESSCertIDv2, policies OPTIONAL }
  // ESSCertIDv2 ::= SEQ { hashAlgorithm AlgId DEFAULT sha256, certHash OCTET, issuerSerial OPTIONAL }
  const first = children(children(children(parsed.result as unknown as Block)[0])[0]);
  let hash = v2 ? 'sha256' : 'sha1';
  let certHash: Buffer | null = null;
  for (const f of first) {
    if (f.idBlock.tagClass === 1 && f.idBlock.tagNumber === 16 && v2 && !certHash) {
      const oid = children(f)[0] as unknown as asn1js.ObjectIdentifier;
      hash = DIGESTS[oid.valueBlock.toString()] ?? hash;
    } else if (f.idBlock.tagClass === 1 && f.idBlock.tagNumber === 4 && !certHash) {
      certHash = Buffer.from((f as unknown as asn1js.OctetString).valueBlock.valueHexView);
    }
  }
  if (!certHash) return false;
  return createHash(hash).update(signerDer).digest().equals(certHash);
}

/** adbe-revocationInfoArchival: SEQ { [0] crls SEQ OF CRL, [1] ocsps SEQ OF OCSPResponse, [2] other }. */
function adbeRevocation(attrValue: ArrayBuffer): { ocsp: Buffer[]; crls: Buffer[] } {
  const out = { ocsp: [] as Buffer[], crls: [] as Buffer[] };
  const parsed = asn1js.fromBER(attrValue, BER);
  if (parsed.offset === -1) return out;
  for (const field of children(parsed.result as unknown as Block)) {
    const list = children(children(field)[0]);
    if (isContext(field, 0)) out.crls.push(...list.map(raw));
    else if (isContext(field, 1)) out.ocsp.push(...list.map(raw));
  }
  return out;
}

function parseSignedData(cms: Buffer): { sd: SignedData; contentType: string } | null {
  try {
    const ci = AsnConvert.parse(cms, ContentInfo, PARSE);
    if (ci.contentType !== CMS_OID.signedData) return { sd: new SignedData(), contentType: ci.contentType };
    return { sd: AsnConvert.parse(ci.content, SignedData, PARSE), contentType: ci.contentType };
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- null is reported as CMS_UNPARSABLE: bytes from an uploaded file that are not a CMS are the finding, not a lost error
    return null;
  }
}

/**
 * Verify a SignedData with ONE signer over `content` (the PDF's signed byte ranges, or a detached
 * file). When `content` is null the encapsulated content is used.
 */
export function verifyCms(cms: Buffer, content: Buffer | null): CmsCheck {
  const result: CmsCheck = {
    integrity: false, signatureValid: false, signerCert: null, certificates: [], digestAlgorithm: null,
    signatureAlgorithm: null, claimedSigningTime: null, signingCertificateBound: null, timestamp: null,
    embeddedOcsp: [], embeddedCrls: [], encapsulated: null, problems: [],
  };
  const parsed = parseSignedData(cms);
  const rawSd = rawSignedData(cms);
  if (!parsed || !rawSd) { result.problems.push('CMS_UNPARSABLE'); return result; }
  if (parsed.contentType !== CMS_OID.signedData) { result.problems.push('NOT_SIGNED_DATA'); return result; }
  const { sd } = parsed;
  result.certificates = rawSd.certificates;
  result.embeddedCrls = rawSd.crls;
  const si = sd.signerInfos[0];
  if (!si) { result.problems.push('NO_SIGNER'); return result; }
  if (sd.signerInfos.length > 1) result.problems.push('MULTIPLE_SIGNERS');

  const eContent = sd.encapContentInfo.eContent?.single?.buffer ?? sd.encapContentInfo.eContent?.any;
  if (eContent) result.encapsulated = Buffer.from(eContent);
  const data = content ?? result.encapsulated;

  const digest = DIGESTS[si.digestAlgorithm.algorithm] ?? null;
  result.digestAlgorithm = digest;
  if (!digest) { result.problems.push('DIGEST_ALGORITHM_UNSUPPORTED'); return result; }
  if (digest === 'sha1') result.problems.push('WEAK_DIGEST');

  const signerDer = findSignerCert(si, rawSd.certificates);
  result.signerCert = signerDer;
  if (!signerDer) result.problems.push('SIGNER_CERT_MISSING');

  const rawAttrs = rawSd.signerInfos[0]?.signedAttrs ?? null;
  let signedData: Buffer;
  if (si.signedAttrs && rawAttrs) {
    const md = si.signedAttrs.find((a) => a.attrType === CMS_OID.messageDigest);
    if (!md || !md.attrValues[0]) {
      result.problems.push('NO_MESSAGE_DIGEST');
    } else {
      const mdParsed = asn1js.fromBER(md.attrValues[0]);
      const claimed = Buffer.from((mdParsed.result as asn1js.OctetString).valueBlock.valueHexView);
      if (data) {
        result.integrity = createHash(digest).update(data).digest().equals(claimed);
        if (!result.integrity) result.problems.push('DIGEST_MISMATCH');
      }
    }
    const st = si.signedAttrs.find((a) => a.attrType === CMS_OID.signingTime);
    if (st?.attrValues[0]) {
      const t = asn1js.fromBER(st.attrValues[0]).result as unknown as { toDate?: () => Date };
      if (typeof t.toDate === 'function') result.claimedSigningTime = t.toDate().toISOString();
    }
    const scv2 = si.signedAttrs.find((a) => a.attrType === CMS_OID.signingCertificateV2);
    const scv1 = si.signedAttrs.find((a) => a.attrType === CMS_OID.signingCertificate);
    if (signerDer && (scv2 || scv1)) {
      result.signingCertificateBound = signingCertBinding((scv2 ?? scv1)!.attrValues[0]!, !!scv2, signerDer);
      if (!result.signingCertificateBound) result.problems.push('SIGNING_CERT_ATTR_MISMATCH');
    }
    signedData = rawAttrs;
  } else {
    // No signed attributes: the signature is directly over the content.
    signedData = data ?? Buffer.alloc(0);
    result.integrity = !!data;
  }

  if (signerDer) {
    const v = verifySignature(new X509Certificate(signerDer), si.signatureAlgorithm.algorithm,
      si.signatureAlgorithm.parameters, si.digestAlgorithm.algorithm, signedData, Buffer.from(si.signature.buffer));
    result.signatureAlgorithm = v.algorithm;
    result.signatureValid = v.ok;
    if (v.problem) result.problems.push(v.problem);
    else if (!v.ok) result.problems.push('SIGNATURE_INVALID');
    if (!si.signedAttrs) result.integrity = v.ok;
  }

  for (const attr of si.unsignedAttrs ?? []) {
    if (attr.attrType === CMS_OID.signatureTimeStamp && attr.attrValues[0] && !result.timestamp) {
      result.timestamp = verifyTimestampToken(Buffer.from(attr.attrValues[0]), Buffer.from(si.signature.buffer));
    }
  }
  for (const attr of [...(si.signedAttrs ?? []), ...(si.unsignedAttrs ?? [])]) {
    if (attr.attrType === CMS_OID.adbeRevocation && attr.attrValues[0]) {
      const rev = adbeRevocation(attr.attrValues[0]);
      result.embeddedOcsp.push(...rev.ocsp);
      result.embeddedCrls.push(...rev.crls);
    }
  }
  return result;
}

/**
 * An RFC 3161 timestamp token over `imprintedData`: for a signature timestamp the signature value,
 * for a document timestamp the PDF's signed byte ranges.
 */
export function verifyTimestampToken(token: Buffer, imprintedData: Buffer): TimestampCheck {
  const out: TimestampCheck = { genTime: null, imprintMatches: false, signatureValid: false, tsaCert: null, certificates: [], problems: [] };
  const cms = verifyCms(token, null);
  out.certificates = cms.certificates;
  out.tsaCert = cms.signerCert;
  out.signatureValid = cms.signatureValid && cms.integrity;
  if (!out.signatureValid) out.problems.push('TIMESTAMP_INVALID');
  if (!cms.encapsulated) { out.problems.push('NOT_A_TIMESTAMP'); return out; }
  try {
    const tst = AsnConvert.parse(cms.encapsulated, TSTInfo);
    out.genTime = tst.genTime.toISOString();
    const alg = DIGESTS[tst.messageImprint.hashAlgorithm.algorithm];
    if (alg) {
      out.imprintMatches = createHash(alg).update(imprintedData).digest()
        .equals(Buffer.from(tst.messageImprint.hashedMessage.buffer));
    }
    if (!out.imprintMatches) out.problems.push('TIMESTAMP_IMPRINT_MISMATCH');
  // eslint-disable-next-line aimeat/no-silent-catch -- surfaced as NOT_A_TIMESTAMP in the report: content that is not a TSTInfo is the finding
  } catch {
    out.problems.push('NOT_A_TIMESTAMP');
  }
  return out;
}
