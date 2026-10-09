/**
 * @file src/services/docsign/validate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Validates the signatures on a document signed somewhere else: a PDF with PAdES or
 *   adbe.pkcs7 signatures and document timestamps, or a CMS signature file (.p7s next to the
 *   document it signs, or a .p7m that carries it). One report per document, one entry per
 *   signature, each with a verdict in the three ETSI EN 319 102-1 terms:
 *
 *   - valid: intact, made with the key in the certificate, the certificate chains to a trusted
 *     anchor, was in force at signing time and not revoked before it, and nothing but later
 *     signatures or validation data was added to the file after it.
 *   - invalid: a check failed in a way no further information can repair (the bytes changed, the
 *     signature does not verify, the certificate was revoked or expired before the proven signing
 *     time).
 *   - indeterminate: intact, but something needed to call it valid could not be established (the
 *     chain reaches no trusted anchor, revocation could not be checked, content was added later).
 *
 *   Every reason is a code from REASONS, so the app, the MCP tool and a test read the same thing,
 *   and each entry carries an English `summary` an AI can repeat.
 *
 *   THE eIDAS READING (`level`). From the EU trusted list entry of the service that issued the
 *   signer's certificate, at the signing time: `qualified` (a qualified certificate on a
 *   qualified signature or seal creation device: a QES or a qualified seal), `advanced-qc`
 *   (a qualified certificate without the device), `advanced` (a trusted chain, not qualified),
 *   `unknown`. Simplified from ETSI TS 119 615; trust-list.ts says what is left out.
 * @structure Verdict · SignatureReport · ValidationReport · validatePdf · validateCmsFile · REASONS
 * @usage const report = await validatePdf(config, pdfBuffer);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — A chain that ends at an EU reference wallet test CA: trust source
 *     eudi-test-anchor, reason TEST_TRUST_ANCHOR, level unknown (wish-allekirjoitus-eudi-lompakolla).
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import { extractPdfSignatures, PdfExtractError, type PdfSignatureField } from './pdf-extract.js';
import { verifyCms, verifyTimestampToken, type CmsCheck, type TimestampCheck } from './cms-verify.js';
import { buildChain, isEudiTestRoot, type BuiltChain } from './chain.js';
import { findIssuingService, qualifiersFor, type TrustMatch } from './trust-list.js';
import { checkRevocation, type RevocationResult } from './revocation.js';
import { readCert, holderLabel, type CertInfo } from './x509-info.js';

export type Verdict = 'valid' | 'invalid' | 'indeterminate';

/** Every reason a report can give, with the sentence an AI repeats. */
export const REASONS = {
  BYTE_RANGE_MALFORMED: 'The signature field names byte ranges that do not fit the file, so it cannot be checked.',
  CMS_UNPARSABLE: 'The signature data could not be read.',
  DIGEST_MISMATCH: 'The signed content has changed since it was signed.',
  SIGNATURE_INVALID: 'The signature does not verify with the key in the signer certificate.',
  SIGNER_CERT_MISSING: 'The signature does not carry the signer certificate.',
  SIGNING_CERT_ATTR_MISMATCH: 'The signature names a different certificate than the one it carries.',
  ALGORITHM_UNSUPPORTED: 'The signature uses an algorithm this node cannot check.',
  WEAK_DIGEST: 'The signature uses SHA-1, which is no longer considered secure.',
  KEY_USAGE: 'The signer certificate is not meant for signing.',
  CERT_NOT_YET_VALID: 'The signer certificate was not yet in force at the signing time.',
  CERT_EXPIRED_AT_SIGNING: 'The signer certificate had expired at the proven signing time.',
  CERT_EXPIRED_NO_PROOF: 'The signer certificate has expired, and no timestamp proves the signature was made before that.',
  REVOKED_BEFORE_SIGNING: 'The signer certificate was revoked before the signing time.',
  REVOKED_NO_PROOF_OF_TIME: 'The signer certificate has been revoked, and no timestamp proves the signature was made before that.',
  REVOKED_AFTER_SIGNING: 'The signer certificate was revoked after the proven signing time; the signature stays valid.',
  REVOCATION_UNKNOWN: 'Whether the signer certificate was revoked could not be established.',
  NO_TRUSTED_ANCHOR: 'The certificate chain does not reach a trusted certification authority.',
  TRUST_LIST_UNAVAILABLE: 'The EU trusted list could not be read, so trust was not decided.',
  SERVICE_NOT_GRANTED_AT_SIGNING: 'The certification service was not in a granted status on the EU trusted list at the signing time.',
  TIMESTAMP_INVALID: 'The timestamp on the signature does not verify.',
  TIMESTAMP_UNTRUSTED: 'The timestamp verifies, but its authority is not on a trusted list.',
  CONTENT_ADDED_AFTER_SIGNING: 'Content other than signatures was added to the file after this signature. The signed version is intact, but what you see is not exactly what was signed.',
  NOT_WHOLE_FILE: 'Later signatures or validation data were added after this signature, which is normal.',
  ONLINE_CHECKS_OFF: 'This node does not reach the network for validation, so trust and revocation were not checked.',
  MULTIPLE_SIGNERS: 'The signature data holds more than one signer; only the first was checked.',
  TEST_TRUST_ANCHOR: 'The certificate comes from a test authority of the EU reference wallet. The signature is a test and has no legal effect.',
} as const;
export type Reason = keyof typeof REASONS;

export interface PartyName {
  name: string;
  commonName: string | null;
  organization: string | null;
  organizationIdentifier: string | null;
  serialNumber: string | null;
  country: string | null;
  email: string | null;
  subject: string;
}

export interface SignatureReport {
  index: number;
  kind: 'signature' | 'document-timestamp';
  verdict: Verdict;
  /** Why the verdict is what it is: codes from REASONS, worst first. */
  reasons: Reason[];
  /** One English sentence for an AI to repeat. */
  summary: string;
  level: 'qualified' | 'advanced-qc' | 'advanced' | 'unknown';
  /** What the certificate says it is for (QcType), when it says. */
  purpose: 'esign' | 'eseal' | 'web' | null;
  signer: PartyName | null;
  issuer: PartyName | null;
  certificate: { serialNumber: string; notBefore: string; notAfter: string; sha256: string; qcCompliance: boolean; qcSscd: boolean } | null;
  signedAt: { time: string | null; source: 'qualified-timestamp' | 'timestamp' | 'claimed' | null; timestampAuthority: string | null };
  integrity: { contentIntact: boolean; signatureValid: boolean; algorithm: string | null; digestAlgorithm: string | null; signingCertificateBound: boolean | null };
  coverage: { wholeFile: boolean; laterSignatures: number; validationDataAdded: boolean; otherContentAdded: boolean; addedObjectTypes: string[] } | null;
  trust: {
    trusted: boolean;
    source: 'eu-trusted-list' | 'operator-anchor' | 'eudi-test-anchor' | null;
    service: { territory: string; provider: string; name: string; type: string; statusAtSigning: string | null; qualifiers: string[] } | null;
    chain: { subject: string; issuer: string; sha256: string }[];
    territoriesChecked: string[];
    errors: string[];
  };
  revocation: RevocationResult;
  pdf: { subFilter: string | null; name: string | null; reason: string | null; location: string | null; claimedTime: string | null } | null;
}

export interface ValidationReport {
  document: { sha256: string; size: number; mediaType: string };
  verdict: Verdict | 'unsigned';
  checkedAt: string;
  online: boolean;
  signatures: SignatureReport[];
  /** What this validation does not do, stated once so nobody reads more into a "valid" than it says. */
  limits: string[];
}

const LIMITS = [
  'Long-term validation data embedded in the PDF (/DSS) is not used; revocation is checked online or from what the signature itself carries.',
  'Changes after a signature are classified by object type, not compared object by object.',
  'The EU qualification is read from the trusted list in a simplified form of ETSI TS 119 615.',
  'XAdES, JAdES and ASiC containers are not validated.',
];

function party(c: CertInfo | null): PartyName | null {
  if (!c) return null;
  const n = c.subject;
  return {
    name: holderLabel(n), commonName: n.commonName, organization: n.organization,
    organizationIdentifier: n.organizationIdentifier, serialNumber: n.serialNumber, country: n.country,
    email: n.email, subject: n.text,
  };
}

function issuerParty(c: CertInfo | null): PartyName | null {
  if (!c) return null;
  const n = c.issuer;
  return {
    name: holderLabel(n), commonName: n.commonName, organization: n.organization,
    organizationIdentifier: n.organizationIdentifier, serialNumber: n.serialNumber, country: n.country,
    email: n.email, subject: n.text,
  };
}

const RANK: Record<Verdict, number> = { valid: 0, indeterminate: 1, invalid: 2 };

function summarize(r: SignatureReport): string {
  const who = r.signer?.name ?? 'an unknown signer';
  const when = r.signedAt.time ? ` on ${r.signedAt.time.slice(0, 10)}` : '';
  const what = r.kind === 'document-timestamp' ? 'Document timestamp' : `Signature by ${who}${when}`;
  const level = r.level === 'qualified' ? (r.purpose === 'eseal' ? ' (qualified electronic seal)' : ' (qualified electronic signature)')
    : r.level === 'advanced-qc' ? ' (advanced, qualified certificate)' : '';
  const first = r.reasons.find((x) => x !== 'NOT_WHOLE_FILE' && x !== 'REVOKED_AFTER_SIGNING' && x !== 'TEST_TRUST_ANCHOR');
  if (r.verdict === 'valid' && r.trust.source === 'eudi-test-anchor') return `${what}: valid as a test. ${REASONS.TEST_TRUST_ANCHOR}`;
  if (r.verdict === 'valid') return `${what}${level}: valid.`;
  return `${what}: ${r.verdict}. ${first ? REASONS[first] : ''}`.trim();
}

/** Trust, revocation and time for one checked CMS. Shared by PDF signatures and .p7s/.p7m files. */
async function assess(
  config: AimeatConfig, cms: CmsCheck, field: PdfSignatureField | null, online: boolean,
  laterDocTimestamp: TimestampCheck | null,
): Promise<SignatureReport> {
  const reasons: Reason[] = [];
  // Widened on purpose: fail() and doubt() change it from closures, which narrowing cannot see.
  let verdict = 'valid' as Verdict;
  const fail = (r: Reason) => { reasons.push(r); verdict = 'invalid'; };
  const doubt = (r: Reason) => { reasons.push(r); if (verdict === 'valid') verdict = 'indeterminate'; };

  if (cms.problems.includes('CMS_UNPARSABLE') || cms.problems.includes('NOT_SIGNED_DATA')) fail('CMS_UNPARSABLE');
  if (cms.problems.includes('DIGEST_MISMATCH')) fail('DIGEST_MISMATCH');
  if (cms.problems.includes('SIGNATURE_INVALID')) fail('SIGNATURE_INVALID');
  if (cms.problems.includes('SIGNING_CERT_ATTR_MISMATCH')) fail('SIGNING_CERT_ATTR_MISMATCH');
  if (cms.problems.includes('SIGNATURE_ALGORITHM_UNSUPPORTED') || cms.problems.includes('DIGEST_ALGORITHM_UNSUPPORTED')) doubt('ALGORITHM_UNSUPPORTED');
  if (cms.problems.includes('SIGNER_CERT_MISSING')) doubt('SIGNER_CERT_MISSING');
  if (cms.problems.includes('MULTIPLE_SIGNERS')) reasons.push('MULTIPLE_SIGNERS');
  if (cms.problems.includes('WEAK_DIGEST')) doubt('WEAK_DIGEST');

  const signer = cms.signerCert ? safeRead(cms.signerCert) : null;
  if (signer && signer.keyUsage.length && !signer.keyUsage.includes('digitalSignature') && !signer.keyUsage.includes('nonRepudiation')) fail('KEY_USAGE');

  // ── signing time ──
  let timeSource: SignatureReport['signedAt']['source'] = null;
  let signingTime: Date | null = null;
  let tsaName: string | null = null;
  let proven = false;
  const ts = cms.timestamp;
  if (ts) {
    if (!ts.signatureValid || !ts.imprintMatches) doubt('TIMESTAMP_INVALID');
    else if (ts.genTime) {
      signingTime = new Date(ts.genTime);
      timeSource = 'timestamp';
      proven = true;
      const tsa = ts.tsaCert ? safeRead(ts.tsaCert) : null;
      tsaName = tsa ? holderLabel(tsa.subject) : null;
      if (tsa && online) {
        const tsaChain = await buildChain(config, tsa.der, ts.certificates, online);
        const tsaTrust = await findIssuingService(config, tsaChain.certs, signingTime, ['TSA/QTST', 'TSA', 'CA/QC', 'CA/PKC']);
        if (tsaTrust.match?.positiveAt) timeSource = tsaTrust.match.service.type === 'TSA/QTST' ? 'qualified-timestamp' : 'timestamp';
        else if (!tsaChain.operatorAnchor) reasons.push('TIMESTAMP_UNTRUSTED');
      }
    }
  }
  if (!signingTime && laterDocTimestamp?.genTime && laterDocTimestamp.signatureValid && laterDocTimestamp.imprintMatches) {
    // A later document timestamp proves the signature existed by then: an upper bound.
    signingTime = new Date(laterDocTimestamp.genTime);
    timeSource = 'timestamp';
    proven = true;
  }
  if (!signingTime) {
    const claimed = cms.claimedSigningTime ?? field?.claimedSigningTime ?? null;
    if (claimed) { signingTime = new Date(claimed); timeSource = 'claimed'; }
  }
  const at = signingTime ?? new Date();

  // ── certificate in force ──
  if (signer) {
    if (Date.parse(signer.notBefore) > at.getTime()) fail('CERT_NOT_YET_VALID');
    if (Date.parse(signer.notAfter) < at.getTime()) fail('CERT_EXPIRED_AT_SIGNING');
    else if (Date.parse(signer.notAfter) < Date.now() && !proven) doubt('CERT_EXPIRED_NO_PROOF');
  }

  // ── chain and trust ──
  let chain: BuiltChain | null = null;
  let match: TrustMatch | null = null;
  let territories: string[] = [];
  let trustErrors: string[] = [];
  if (signer) {
    chain = await buildChain(config, signer.der, [...cms.certificates, ...(ts?.certificates ?? [])], online);
    if (online) {
      const found = await findIssuingService(config, chain.certs, at, ['CA/QC', 'CA/PKC']);
      match = found.match;
      territories = found.checked;
      trustErrors = found.errors;
    }
  }
  const trustedByList = !!match?.positiveAt;
  const trustedByOperator = !!chain?.operatorAnchor;
  const testAnchor = !trustedByList && !!chain?.operatorAnchor && isEudiTestRoot(chain.operatorAnchor.sha256);
  if (testAnchor) reasons.push('TEST_TRUST_ANCHOR');
  if (signer && !online) doubt('ONLINE_CHECKS_OFF');
  else if (signer && !trustedByList && !trustedByOperator) {
    if (match && !match.positiveAt) doubt('SERVICE_NOT_GRANTED_AT_SIGNING');
    else if (!territories.length && trustErrors.length) doubt('TRUST_LIST_UNAVAILABLE');
    else doubt('NO_TRUSTED_ANCHOR');
  }

  // ── revocation ──
  let revocation: RevocationResult = { status: 'unchecked', source: null, revokedAt: null, producedAt: null, notes: [] };
  if (signer) {
    const issuer = chain?.certs[1] ?? null;
    // A responder from another CA is accepted when the EU list names it, or its CA, under the same
    // provider that issued the signer's certificate.
    const trustResponder = async (responder: CertInfo, pool: Buffer[]) => {
      if (!online || !match?.positiveAt) return false;
      const rc = await buildChain(config, responder.der, pool, online);
      const rm = (await findIssuingService(config, rc.certs, new Date(), ['OCSP/QC', 'OCSP', 'CA/QC', 'CA/PKC'])).match;
      return !!rm?.positiveAt && rm.service.tspName === match.service.tspName;
    };
    revocation = await checkRevocation(signer, issuer, { embeddedOcsp: cms.embeddedOcsp, online, trustResponder });
    if (revocation.status === 'revoked') {
      const revokedAt = revocation.revokedAt ? Date.parse(revocation.revokedAt) : 0;
      if (proven && revokedAt > at.getTime()) reasons.push('REVOKED_AFTER_SIGNING');
      else if (proven || revokedAt <= at.getTime()) fail(proven ? 'REVOKED_BEFORE_SIGNING' : 'REVOKED_NO_PROOF_OF_TIME');
      else doubt('REVOKED_NO_PROOF_OF_TIME');
    } else if (revocation.status !== 'good' && online) {
      doubt('REVOCATION_UNKNOWN');
    }
  }

  // ── what was added after ──
  if (field?.appended) {
    if (field.appended.otherChanges) doubt('CONTENT_ADDED_AFTER_SIGNING');
    else reasons.push('NOT_WHOLE_FILE');
  }

  // ── eIDAS level ──
  let level: SignatureReport['level'] = 'unknown';
  let qualifiers: string[] = [];
  let purpose = signer?.qc.type ?? null;
  if (signer && match?.positiveAt && match.service.type === 'CA/QC') {
    qualifiers = qualifiersFor(match.periodAt, signer);
    const qualified = (signer.qc.compliance || qualifiers.includes('QCStatement')) && !qualifiers.includes('NotQualified');
    const device = qualifiers.some((q) => q === 'QCWithSSCD' || q === 'QCWithQSCD') ? true
      : qualifiers.some((q) => q === 'QCNoSSCD' || q === 'QCNoQSCD') ? false : signer.qc.sscd;
    level = qualified ? (device ? 'qualified' : 'advanced-qc') : 'advanced';
    purpose ??= qualifiers.includes('QCForESeal') ? 'eseal' : qualifiers.includes('QCForESig') ? 'esign' : null;
    if (!purpose && match.periodAt?.additionalInfo.some((a) => a.endsWith('ForeSeals'))) purpose = 'eseal';
    if (!purpose && match.periodAt?.additionalInfo.some((a) => a.endsWith('ForeSignatures'))) purpose = 'esign';
  } else if (signer && (trustedByList || trustedByOperator) && !testAnchor) {
    level = 'advanced';
  }
  if (verdict === 'invalid') level = 'unknown';

  reasons.sort((a, b) => order(a) - order(b));
  const report: SignatureReport = {
    index: field?.index ?? 0,
    kind: 'signature',
    verdict,
    reasons,
    summary: '',
    level,
    purpose,
    signer: party(signer),
    issuer: issuerParty(signer),
    certificate: signer ? {
      serialNumber: signer.serialNumber, notBefore: signer.notBefore, notAfter: signer.notAfter, sha256: signer.sha256,
      qcCompliance: signer.qc.compliance, qcSscd: signer.qc.sscd,
    } : null,
    signedAt: { time: signingTime?.toISOString() ?? null, source: timeSource, timestampAuthority: tsaName },
    integrity: {
      contentIntact: cms.integrity, signatureValid: cms.signatureValid, algorithm: cms.signatureAlgorithm,
      digestAlgorithm: cms.digestAlgorithm, signingCertificateBound: cms.signingCertificateBound,
    },
    coverage: field ? {
      wholeFile: field.coversWholeFile,
      laterSignatures: field.appended?.laterSignatures ?? 0,
      validationDataAdded: field.appended?.validationData ?? false,
      otherContentAdded: field.appended?.otherChanges ?? false,
      addedObjectTypes: field.appended?.types ?? [],
    } : null,
    trust: {
      trusted: trustedByList || trustedByOperator,
      source: trustedByList ? 'eu-trusted-list' : testAnchor ? 'eudi-test-anchor' : trustedByOperator ? 'operator-anchor' : null,
      service: match ? {
        territory: match.service.territory, provider: match.service.tspName, name: match.service.serviceName,
        type: match.service.type, statusAtSigning: match.periodAt?.statusName ?? null, qualifiers,
      } : null,
      chain: (chain?.certs ?? []).map((c) => ({ subject: c.subject.text, issuer: c.issuer.text, sha256: c.sha256 })),
      territoriesChecked: territories,
      errors: trustErrors,
    },
    revocation,
    pdf: field ? {
      subFilter: field.subFilter, name: field.name, reason: field.reason, location: field.location, claimedTime: field.claimedSigningTime,
    } : null,
  };
  report.summary = summarize(report);
  return report;
}

const ORDER: Reason[] = Object.keys(REASONS) as Reason[];
const order = (r: Reason) => ORDER.indexOf(r);

function safeRead(der: Buffer): CertInfo | null {
  // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable signer certificate is reported as SIGNER_CERT_MISSING by the caller
  try { return readCert(der); } catch { return null; }
}

async function assessDocTimestamp(config: AimeatConfig, field: PdfSignatureField, online: boolean): Promise<{ report: SignatureReport; ts: TimestampCheck }> {
  const ts = verifyTimestampToken(field.cms, field.signedBytes);
  const reasons: Reason[] = [];
  let verdict: Verdict = 'valid';
  if (!ts.signatureValid || !ts.imprintMatches) { reasons.push(ts.imprintMatches ? 'TIMESTAMP_INVALID' : 'DIGEST_MISMATCH'); verdict = 'invalid'; }
  const tsa = ts.tsaCert ? safeRead(ts.tsaCert) : null;
  let match: TrustMatch | null = null;
  let chain: BuiltChain | null = null;
  if (tsa && verdict === 'valid') {
    chain = await buildChain(config, tsa.der, ts.certificates, online);
    if (online) match = (await findIssuingService(config, chain.certs, ts.genTime ? new Date(ts.genTime) : new Date(), ['TSA/QTST', 'TSA', 'CA/QC', 'CA/PKC'])).match;
    if (!online) { reasons.push('ONLINE_CHECKS_OFF'); verdict = 'indeterminate'; }
    else if (!match?.positiveAt && !chain.operatorAnchor) { reasons.push('TIMESTAMP_UNTRUSTED'); verdict = 'indeterminate'; }
  }
  if (field.appended?.otherChanges) { reasons.push('CONTENT_ADDED_AFTER_SIGNING'); if (verdict === 'valid') verdict = 'indeterminate'; }
  const report: SignatureReport = {
    index: field.index, kind: 'document-timestamp', verdict, reasons, summary: '',
    level: match?.service.type === 'TSA/QTST' && match.positiveAt ? 'qualified' : 'unknown', purpose: null,
    signer: party(tsa), issuer: issuerParty(tsa),
    certificate: tsa ? { serialNumber: tsa.serialNumber, notBefore: tsa.notBefore, notAfter: tsa.notAfter, sha256: tsa.sha256, qcCompliance: tsa.qc.compliance, qcSscd: tsa.qc.sscd } : null,
    signedAt: { time: ts.genTime, source: match?.service.type === 'TSA/QTST' ? 'qualified-timestamp' : 'timestamp', timestampAuthority: tsa ? holderLabel(tsa.subject) : null },
    integrity: { contentIntact: ts.imprintMatches, signatureValid: ts.signatureValid, algorithm: null, digestAlgorithm: null, signingCertificateBound: null },
    coverage: {
      wholeFile: field.coversWholeFile, laterSignatures: field.appended?.laterSignatures ?? 0,
      validationDataAdded: field.appended?.validationData ?? false, otherContentAdded: field.appended?.otherChanges ?? false,
      addedObjectTypes: field.appended?.types ?? [],
    },
    trust: {
      trusted: !!match?.positiveAt || !!chain?.operatorAnchor,
      source: match?.positiveAt ? 'eu-trusted-list' : chain?.operatorAnchor ? 'operator-anchor' : null,
      service: match ? { territory: match.service.territory, provider: match.service.tspName, name: match.service.serviceName, type: match.service.type, statusAtSigning: match.periodAt?.statusName ?? null, qualifiers: [] } : null,
      chain: (chain?.certs ?? []).map((c) => ({ subject: c.subject.text, issuer: c.issuer.text, sha256: c.sha256 })),
      territoriesChecked: [], errors: [],
    },
    revocation: { status: 'unchecked', source: null, revokedAt: null, producedAt: null, notes: [] },
    pdf: { subFilter: field.subFilter, name: null, reason: null, location: null, claimedTime: null },
  };
  report.summary = summarize(report);
  return { report, ts };
}

function overall(signatures: SignatureReport[]): ValidationReport['verdict'] {
  if (!signatures.length) return 'unsigned';
  return signatures.reduce<Verdict>((acc, s) => (RANK[s.verdict] > RANK[acc] ? s.verdict : acc), 'valid');
}

function documentOf(buf: Buffer, mediaType: string): ValidationReport['document'] {
  return { sha256: createHash('sha256').update(buf).digest('hex'), size: buf.length, mediaType };
}

export class ValidationInputError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export async function validatePdf(config: AimeatConfig, pdf: Buffer, opts: { online?: boolean } = {}): Promise<ValidationReport> {
  const online = config.docsignOnlineChecks && opts.online !== false;
  let fields: PdfSignatureField[];
  try {
    fields = extractPdfSignatures(pdf);
  } catch (err) {
    if (err instanceof PdfExtractError) throw new ValidationInputError(err.code, err.message);
    throw err;
  }
  const signatures: SignatureReport[] = [];
  // Document timestamps first, so a signature can use a later one as proof of its time.
  const docTs = new Map<number, TimestampCheck>();
  for (const f of fields.filter((x) => x.isDocTimestamp && x.cms.length)) {
    const { report, ts } = await assessDocTimestamp(config, f, online);
    docTs.set(f.index, ts);
    signatures.push(report);
  }
  for (const f of fields) {
    if (f.isDocTimestamp && f.cms.length) continue;
    if (!f.cms.length) {
      const r: SignatureReport = {
        index: f.index, kind: 'signature', verdict: 'invalid', reasons: ['BYTE_RANGE_MALFORMED'], summary: '', level: 'unknown', purpose: null,
        signer: null, issuer: null, certificate: null, signedAt: { time: null, source: null, timestampAuthority: null },
        integrity: { contentIntact: false, signatureValid: false, algorithm: null, digestAlgorithm: null, signingCertificateBound: null },
        coverage: null,
        trust: { trusted: false, source: null, service: null, chain: [], territoriesChecked: [], errors: [] },
        revocation: { status: 'unchecked', source: null, revokedAt: null, producedAt: null, notes: [] },
        pdf: { subFilter: f.subFilter, name: f.name, reason: f.reason, location: f.location, claimedTime: f.claimedSigningTime },
      };
      r.summary = summarize(r);
      signatures.push(r);
      continue;
    }
    // adbe.pkcs7.sha1 signs a SHA-1 of the byte ranges carried as the encapsulated content.
    let cms = verifyCms(f.cms, f.subFilter === 'adbe.pkcs7.sha1' ? null : f.signedBytes);
    if (f.subFilter === 'adbe.pkcs7.sha1' && cms.encapsulated) {
      const sha1 = createHash('sha1').update(f.signedBytes).digest();
      if (!sha1.equals(cms.encapsulated)) cms = { ...cms, integrity: false, problems: [...cms.problems, 'DIGEST_MISMATCH'] };
    }
    const later = [...docTs.entries()].filter(([i]) => i > f.index).map(([, t]) => t)
      .sort((a, b) => Date.parse(a.genTime ?? '') - Date.parse(b.genTime ?? ''))[0] ?? null;
    signatures.push(await assess(config, cms, f, online, later));
  }
  signatures.sort((a, b) => a.index - b.index);
  return { document: documentOf(pdf, 'application/pdf'), verdict: overall(signatures), checkedAt: new Date().toISOString(), online, signatures, limits: LIMITS };
}

/**
 * A CMS signature file: detached (.p7s) with the document it signs, or attached (.p7m) carrying
 * the document inside it. The report's document is the signed content in both cases.
 */
export async function validateCmsFile(
  config: AimeatConfig, signature: Buffer, content: Buffer | null, opts: { online?: boolean } = {},
): Promise<ValidationReport> {
  const online = config.docsignOnlineChecks && opts.online !== false;
  const cms = verifyCms(signature, content);
  if (cms.problems.includes('CMS_UNPARSABLE')) throw new ValidationInputError('NOT_A_SIGNATURE', 'The signature file is not a CMS/PKCS#7 signature.');
  const signed = content ?? cms.encapsulated;
  if (!signed) throw new ValidationInputError('DOCUMENT_REQUIRED', 'This is a detached signature: send the document it signs as well.');
  const report = await assess(config, cms, null, online, null);
  return {
    document: documentOf(signed, 'application/octet-stream'), verdict: overall([report]), checkedAt: new Date().toISOString(),
    online, signatures: [report], limits: LIMITS,
  };
}
