/**
 * @file src/services/docsign/x509-info.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a certificate says about its holder and about how to check it: the subject's
 *   names and identifiers, the issuer, the validity period, the key usages, the eIDAS qualified
 *   certificate statements (ETSI EN 319 412-5), and where its issuer and revocation status are
 *   published (AIA, CRL distribution points).
 *
 *   node:crypto's X509Certificate does the cryptography (signature checks, the public key, the
 *   raw bytes). The extensions it does not decode are read with @peculiar/asn1-x509 (MIT).
 * @structure CertInfo · readCert · nameParts · OID
 * @usage const info = readCert(der);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { X509Certificate, createHash } from 'node:crypto';
import { AsnConvert } from '@peculiar/asn1-schema';
import {
  Certificate, Name, AuthorityInfoAccessSyntax, CRLDistributionPoints, KeyUsage, KeyUsageFlags,
  SubjectKeyIdentifier, AuthorityKeyIdentifier, BasicConstraints, CertificatePolicies, ExtendedKeyUsage,
} from '@peculiar/asn1-x509';
import * as asn1js from 'asn1js';

export const OID = {
  qcStatements: '1.3.6.1.5.5.7.1.3',
  qcCompliance: '0.4.0.1862.1.1',
  qcSscd: '0.4.0.1862.1.4',
  qcType: '0.4.0.1862.1.6',
  qcTypeEsign: '0.4.0.1862.1.6.1',
  qcTypeEseal: '0.4.0.1862.1.6.2',
  qcTypeWeb: '0.4.0.1862.1.6.3',
  qcPds: '0.4.0.1862.1.5',
  aia: '1.3.6.1.5.5.7.1.1',
  ocsp: '1.3.6.1.5.5.7.48.1',
  caIssuers: '1.3.6.1.5.5.7.48.2',
  crlDp: '2.5.29.31',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  ski: '2.5.29.14',
  aki: '2.5.29.35',
  basicConstraints: '2.5.29.19',
  certPolicies: '2.5.29.32',
  ocspNoCheck: '1.3.6.1.5.5.7.48.1.5',
  ekuOcspSigning: '1.3.6.1.5.5.7.3.9',
  ekuTimeStamping: '1.3.6.1.5.5.7.3.8',
} as const;

const NAME_OIDS: Record<string, string> = {
  '2.5.4.3': 'CN', '2.5.4.4': 'SN', '2.5.4.42': 'G', '2.5.4.5': 'serialNumber', '2.5.4.6': 'C',
  '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.12': 'T',
  '2.5.4.97': 'organizationIdentifier', '1.2.840.113549.1.9.1': 'E', '2.5.4.46': 'dnQualifier',
  '2.5.4.65': 'pseudonym',
};

export interface NameParts {
  /** The whole name, RFC 4514 style, most significant last as certificates write it. */
  text: string;
  commonName: string | null;
  givenName: string | null;
  surname: string | null;
  organization: string | null;
  /** ETSI EN 319 412-1 semantics identifier for a legal person (e.g. VATFI-12345678, NTRFI-…). */
  organizationIdentifier: string | null;
  /** For a natural person: e.g. PNOFI-…, IDCFI-…, or a vendor's opaque value. */
  serialNumber: string | null;
  country: string | null;
  email: string | null;
}

export interface QcInfo {
  /** QcCompliance: the issuer states this is an EU qualified certificate. */
  compliance: boolean;
  /** QcSSCD: the private key is on a qualified signature/seal creation device. */
  sscd: boolean;
  /** QcType: what it is for. */
  type: 'esign' | 'eseal' | 'web' | null;
  /** Whether a qcStatements extension was present at all. */
  present: boolean;
}

export interface CertInfo {
  der: Buffer;
  x509: X509Certificate;
  subject: NameParts;
  issuer: NameParts;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sha256: string;
  selfSigned: boolean;
  isCa: boolean;
  keyUsage: string[];
  extKeyUsage: string[];
  qc: QcInfo;
  ocspUrls: string[];
  caIssuerUrls: string[];
  crlUrls: string[];
  subjectKeyId: string | null;
  authorityKeyId: string | null;
  policies: string[];
  ocspNoCheck: boolean;
}

function decodeAttrValue(value: unknown): string {
  // AttributeValue is an ASN.1 ANY; asn1-x509 gives the DER of a DirectoryString or a typed choice.
  const v = value as { toString?: () => string; utf8String?: string; printableString?: string; ia5String?: string; teletexString?: string; bmpString?: string; universalString?: string; anyValue?: ArrayBuffer };
  for (const k of ['utf8String', 'printableString', 'ia5String', 'teletexString', 'bmpString', 'universalString'] as const) {
    if (typeof v?.[k] === 'string') return v[k]!;
  }
  if (v?.anyValue) {
    const parsed = asn1js.fromBER(v.anyValue);
    const block = parsed.result as unknown as { valueBlock?: { value?: unknown } };
    if (typeof block?.valueBlock?.value === 'string') return block.valueBlock.value;
  }
  return typeof v?.toString === 'function' ? v.toString() : '';
}

export function nameParts(name: Name): NameParts {
  const pairs: [string, string][] = [];
  for (const rdn of name) {
    for (const atv of rdn) {
      pairs.push([NAME_OIDS[atv.type] ?? atv.type, decodeAttrValue(atv.value)]);
    }
  }
  const first = (k: string) => pairs.find(([key]) => key === k)?.[1] ?? null;
  return {
    text: pairs.map(([k, v]) => `${k}=${v}`).join(', '),
    commonName: first('CN'),
    givenName: first('G'),
    surname: first('SN'),
    organization: first('O'),
    organizationIdentifier: first('organizationIdentifier'),
    serialNumber: first('serialNumber'),
    country: first('C'),
    email: first('E'),
  };
}

function readQc(extValue: ArrayBuffer): QcInfo {
  const out: QcInfo = { compliance: false, sscd: false, type: null, present: true };
  const parsed = asn1js.fromBER(extValue);
  if (parsed.offset === -1) return out;
  const seq = parsed.result as asn1js.Sequence;
  for (const statement of seq.valueBlock.value as asn1js.Sequence[]) {
    const items = statement.valueBlock?.value ?? [];
    const id = (items[0] as asn1js.ObjectIdentifier | undefined)?.valueBlock?.toString?.();
    if (id === OID.qcCompliance) out.compliance = true;
    else if (id === OID.qcSscd) out.sscd = true;
    else if (id === OID.qcType) {
      const types = (items[1] as asn1js.Sequence | undefined)?.valueBlock?.value ?? [];
      for (const t of types as asn1js.ObjectIdentifier[]) {
        const tid = t.valueBlock.toString();
        if (tid === OID.qcTypeEsign) out.type = 'esign';
        else if (tid === OID.qcTypeEseal) out.type = 'eseal';
        else if (tid === OID.qcTypeWeb) out.type = 'web';
      }
    }
  }
  return out;
}

const KEY_USAGE_NAMES: [number, string][] = [
  [KeyUsageFlags.digitalSignature, 'digitalSignature'], [KeyUsageFlags.nonRepudiation, 'nonRepudiation'],
  [KeyUsageFlags.keyEncipherment, 'keyEncipherment'], [KeyUsageFlags.dataEncipherment, 'dataEncipherment'],
  [KeyUsageFlags.keyAgreement, 'keyAgreement'], [KeyUsageFlags.keyCertSign, 'keyCertSign'],
  [KeyUsageFlags.cRLSign, 'cRLSign'],
];

/** Read one DER certificate. Throws on bytes that are not a certificate. */
export function readCert(der: Buffer): CertInfo {
  const x509 = new X509Certificate(der);
  const cert = AsnConvert.parse(der, Certificate);
  const tbs = cert.tbsCertificate;
  const info: CertInfo = {
    der,
    x509,
    subject: nameParts(tbs.subject),
    issuer: nameParts(tbs.issuer),
    serialNumber: x509.serialNumber.toLowerCase(),
    notBefore: new Date(x509.validFrom).toISOString(),
    notAfter: new Date(x509.validTo).toISOString(),
    sha256: createHash('sha256').update(der).digest('hex'),
    selfSigned: false,
    isCa: false,
    keyUsage: [],
    extKeyUsage: [],
    qc: { compliance: false, sscd: false, type: null, present: false },
    ocspUrls: [],
    caIssuerUrls: [],
    crlUrls: [],
    subjectKeyId: null,
    authorityKeyId: null,
    policies: [],
    ocspNoCheck: false,
  };
  for (const ext of tbs.extensions ?? []) {
    const value = ext.extnValue.buffer;
    try {
      switch (ext.extnID) {
        case OID.qcStatements: info.qc = readQc(value); break;
        case OID.aia: {
          const aia = AsnConvert.parse(value, AuthorityInfoAccessSyntax);
          for (const ad of aia) {
            const uri = ad.accessLocation.uniformResourceIdentifier;
            if (!uri) continue;
            if (ad.accessMethod === OID.ocsp) info.ocspUrls.push(uri);
            else if (ad.accessMethod === OID.caIssuers) info.caIssuerUrls.push(uri);
          }
          break;
        }
        case OID.crlDp: {
          const dps = AsnConvert.parse(value, CRLDistributionPoints);
          for (const dp of dps) {
            for (const gn of dp.distributionPoint?.fullName ?? []) {
              if (gn.uniformResourceIdentifier) info.crlUrls.push(gn.uniformResourceIdentifier);
            }
          }
          break;
        }
        case OID.keyUsage: {
          const ku = AsnConvert.parse(value, KeyUsage);
          info.keyUsage = KEY_USAGE_NAMES.filter(([flag]) => ku.toNumber() & flag).map(([, n]) => n);
          break;
        }
        case OID.extKeyUsage:
          info.extKeyUsage = [...AsnConvert.parse(value, ExtendedKeyUsage)].map(String);
          break;
        case OID.ski:
          info.subjectKeyId = Buffer.from(AsnConvert.parse(value, SubjectKeyIdentifier).buffer).toString('hex');
          break;
        case OID.aki: {
          const aki = AsnConvert.parse(value, AuthorityKeyIdentifier);
          if (aki.keyIdentifier) info.authorityKeyId = Buffer.from(aki.keyIdentifier.buffer).toString('hex');
          break;
        }
        case OID.basicConstraints:
          info.isCa = AsnConvert.parse(value, BasicConstraints).cA === true;
          break;
        case OID.certPolicies:
          info.policies = [...AsnConvert.parse(value, CertificatePolicies)].map((p) => p.policyIdentifier);
          break;
        case OID.ocspNoCheck:
          info.ocspNoCheck = true;
          break;
        default:
          break;
      }
    // eslint-disable-next-line aimeat/no-silent-catch -- a malformed optional extension in an uploaded certificate reads as absent; the signature checks still run
    } catch {
      // A malformed optional extension is reported as absent; the signature checks still run.
    }
  }
  info.selfSigned = x509.subject === x509.issuer && safeVerify(x509, x509);
  return info;
}

/** Did `issuer` sign `cert`? False on any error rather than a throw. */
export function safeVerify(cert: X509Certificate, issuer: X509Certificate): boolean {
  try {
    return cert.verify(issuer.publicKey);
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- a key node cannot use cannot have signed the certificate; false is the answer
    return false;
  }
}

/** A short human label for a holder: the person's or the organisation's name. */
export function holderLabel(n: NameParts): string {
  if (n.givenName && n.surname) return `${n.givenName} ${n.surname}`;
  return n.commonName ?? n.organization ?? n.text;
}
