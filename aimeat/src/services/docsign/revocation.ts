/**
 * @file src/services/docsign/revocation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Was a certificate revoked, and when? Answered from, in order: an OCSP response the
 *   signer embedded in the signature, the issuer's OCSP responder (RFC 6960), the issuer's CRL
 *   (RFC 5280). Every answer is signature-checked: an OCSP response by the issuer or by a responder
 *   certificate the issuer signed for OCSP signing, a CRL by the issuer.
 *
 *   Network calls go through safeFetch with a timeout and a size cap, because the addresses come
 *   from a certificate inside a file somebody uploaded. CRLs are kept in this process until their
 *   nextUpdate (an hour at most), because one CA's CRL answers for every certificate it issued.
 * @structure RevocationResult · checkRevocation · _setRevocationFetcher (test seam)
 * @usage const r = await checkRevocation(cert, issuer, { embeddedOcsp, online: true });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { createHash } from 'node:crypto';
import * as asn1js from 'asn1js';
import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import { AlgorithmIdentifier, Certificate } from '@peculiar/asn1-x509';
import { OCSPRequest, TBSRequest, Request, CertID, OCSPResponse, BasicOCSPResponse, OCSPResponseStatus } from '@peculiar/asn1-ocsp';
import { safeFetch } from '../../utils/url-validator.js';
import { readBodyCapped } from '../../utils/read-capped.js';
import { verifySignature } from './cms-verify.js';
import { readCert, safeVerify, OID, type CertInfo } from './x509-info.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_OCSP_BYTES = 256 * 1024;
const MAX_CRL_BYTES = 24 * 1024 * 1024;
const CRL_CACHE_MAX = 16;
const ID_PKIX_OCSP_BASIC = '1.3.6.1.5.5.7.48.1.1';
const SHA1 = '1.3.14.3.2.26';

export interface RevocationResult {
  status: 'good' | 'revoked' | 'unknown' | 'unchecked';
  source: 'embedded-ocsp' | 'ocsp' | 'crl' | null;
  revokedAt: string | null;
  /** When the answer was produced (OCSP thisUpdate, CRL thisUpdate). */
  producedAt: string | null;
  /** What was tried and why it did not answer, for the report. */
  notes: string[];
}

type Fetch = (url: string, init?: { body?: Buffer; contentType?: string; max: number }) => Promise<Buffer>;
let fetchBytes: Fetch = async (url, init) => {
  const res = await safeFetch(url, {
    method: init?.body ? 'POST' : 'GET',
    headers: init?.contentType ? { 'Content-Type': init.contentType } : undefined,
    body: init?.body ? new Uint8Array(init.body) : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await readBodyCapped(res, init?.max ?? MAX_OCSP_BYTES);
  if (!buf) throw new Error('response too large');
  return buf;
};

/** TEST SEAM: replace the network fetch. Never called by the server. */
export function _setRevocationFetcher(f: Fetch | null): void {
  if (f) fetchBytes = f;
  crlCache.clear();
}

const crlCache = new Map<string, { until: number; crl: Buffer }>();

type Block = { idBlock: { tagClass: number; tagNumber: number }; valueBlock: { value?: Block[] }; valueBeforeDecodeView: Uint8Array };
const kids = (b: Block | undefined): Block[] => (b?.valueBlock?.value ?? []) as Block[];
const rawOf = (b: Block): Buffer => Buffer.from(b.valueBeforeDecodeView);

/** The issuer-name and issuer-key hashes and the serial an OCSP CertID is made of. */
function certIdParts(cert: CertInfo, issuer: CertInfo): { nameHash: Buffer; keyHash: Buffer; serial: Buffer } {
  const parsedIssuer = AsnConvert.parse(issuer.der, Certificate);
  const tbs = kids(asn1js.fromBER(issuer.der).result as unknown as Block)[0];
  const fields = kids(tbs);
  const off = fields[0] && fields[0].idBlock.tagClass === 3 ? 1 : 0;
  const subjectDer = rawOf(fields[off + 4]!);
  const keyBits = Buffer.from(parsedIssuer.tbsCertificate.subjectPublicKeyInfo.subjectPublicKey);
  const serial = Buffer.from(AsnConvert.parse(cert.der, Certificate).tbsCertificate.serialNumber);
  // SHA-1 here names the certificate in the request; it protects nothing. RFC 5019 (the profile
  // the large OCSP responders run) requires SHA-1 in the CertID, and some responders answer only
  // that form. The response itself is verified with its own signature algorithm.
  return {
    nameHash: createHash('sha1').update(subjectDer).digest(),
    keyHash: createHash('sha1').update(keyBits).digest(),
    serial,
  };
}

function normSerial(b: ArrayBuffer | Buffer): string {
  return Buffer.from(b as ArrayBuffer).toString('hex').replace(/^(00)+/, '');
}

/**
 * A responder certificate the issuer did not sign may still be trusted: some providers run one
 * OCSP responder under a separate CA and list it on their trusted list. The caller decides, with
 * the responder's certificate and the others the response carried.
 */
export type ResponderTrust = (responder: CertInfo, pool: Buffer[]) => Promise<boolean>;

/** Read an OCSP response; verify its signature; find the answer for `cert`. */
async function readOcsp(der: Buffer, cert: CertInfo, issuer: CertInfo, trustResponder?: ResponderTrust): Promise<{ result: RevocationResult | null; note?: string }> {
  let basicDer: Buffer;
  try {
    const resp = AsnConvert.parse(der, OCSPResponse);
    if (resp.responseStatus !== OCSPResponseStatus.successful) return { result: null, note: `OCSP status ${resp.responseStatus}` };
    if (!resp.responseBytes || resp.responseBytes.responseType !== ID_PKIX_OCSP_BASIC) return { result: null, note: 'OCSP response is not a basic response' };
    basicDer = Buffer.from(resp.responseBytes.response.buffer);
  // eslint-disable-next-line aimeat/no-silent-catch -- not an OCSPResponse is a known shape (below), and the next parse surfaces a real failure as a note
  } catch {
    // adbe-revocationInfoArchival carries the whole OCSPResponse; some writers put the BasicOCSPResponse alone.
    basicDer = der;
  }
  let basic: BasicOCSPResponse;
  try { basic = AsnConvert.parse(basicDer, BasicOCSPResponse); } catch { return { result: null, note: 'OCSP response unreadable' }; }
  const rawBasic = kids(asn1js.fromBER(basicDer).result as unknown as Block);
  const tbsRaw = rawOf(rawBasic[0]!);
  const sig = Buffer.from(basic.signature);
  // eslint-disable-next-line aimeat/no-silent-catch -- a responder certificate that will not read cannot have signed the response; the signature check then reports it
  const responderCerts = (basic.certs ?? []).map((c) => { try { return readCert(Buffer.from(AsnConvert.serialize(c))); } catch { return null; } })
    .filter((c): c is CertInfo => !!c);
  // The responder is the issuer itself, or a certificate the issuer signed for OCSP signing.
  const responders = [issuer, ...responderCerts.filter((r) => r.x509.checkIssued(issuer.x509) && safeVerify(r.x509, issuer.x509)
    && (r.extKeyUsage.includes(OID.ekuOcspSigning)))];
  const verifiesWith = (r: CertInfo) => verifySignature(r.x509, basic.signatureAlgorithm.algorithm,
    basic.signatureAlgorithm.parameters, basic.signatureAlgorithm.algorithm, tbsRaw, sig).ok;
  let signedBy = responders.find(verifiesWith);
  if (!signedBy && trustResponder) {
    for (const r of responderCerts.filter((c) => c.extKeyUsage.includes(OID.ekuOcspSigning) && verifiesWith(c))) {
      if (await trustResponder(r, responderCerts.map((c) => c.der))) { signedBy = r; break; }
    }
  }
  if (!signedBy) return { result: null, note: 'OCSP response signature does not verify with the issuer or a delegated responder' };

  const want = certIdParts(cert, issuer);
  for (const single of basic.tbsResponseData.responses) {
    if (normSerial(single.certID.serialNumber) !== normSerial(want.serial)) continue;
    if (single.certID.hashAlgorithm.algorithm === SHA1
      && !Buffer.from(single.certID.issuerKeyHash.buffer).equals(want.keyHash)) continue;
    const producedAt = single.thisUpdate.toISOString();
    if (single.certStatus.good !== undefined) return { result: { status: 'good', source: 'ocsp', revokedAt: null, producedAt, notes: [] } };
    if (single.certStatus.revoked) {
      return { result: { status: 'revoked', source: 'ocsp', revokedAt: single.certStatus.revoked.revocationTime.toISOString(), producedAt, notes: [] } };
    }
    return { result: { status: 'unknown', source: 'ocsp', revokedAt: null, producedAt, notes: ['the OCSP responder does not know this certificate'] } };
  }
  return { result: null, note: 'the OCSP response is about other certificates' };
}

function buildOcspRequest(cert: CertInfo, issuer: CertInfo): Buffer {
  const p = certIdParts(cert, issuer);
  const req = new OCSPRequest({
    tbsRequest: new TBSRequest({
      requestList: [new Request({
        reqCert: new CertID({
          hashAlgorithm: new AlgorithmIdentifier({ algorithm: SHA1, parameters: null }),
          issuerNameHash: new OctetString(p.nameHash),
          issuerKeyHash: new OctetString(p.keyHash),
          serialNumber: new Uint8Array(p.serial).buffer,
        }),
      })],
    }),
  });
  return Buffer.from(AsnConvert.serialize(req));
}

// ── CRL: a flat DER walk ──
// A CA's CRL can list hundreds of thousands of serials. A full ASN.1 tree of that is too large to
// build (asn1js stops at 10 000 nodes, and rightly), so the CRL is walked as TLVs: only the
// tbsCertList bytes, the two times, and each entry's serial and date are read.

interface Tlv { tag: number; start: number; header: number; length: number; end: number }

function tlv(buf: Buffer, at: number): Tlv {
  const tag = buf[at]!;
  let len = buf[at + 1]!;
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('unsupported length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i]!;
    header += n;
  }
  const end = at + header + len;
  if (end > buf.length) throw new Error('truncated');
  return { tag, start: at, header, length: len, end };
}

function derTime(buf: Buffer, t: Tlv): Date {
  const s = buf.subarray(t.start + t.header, t.end).toString('latin1');
  if (t.tag === 0x17) { // UTCTime YYMMDDHHMMSSZ
    const y = Number(s.slice(0, 2));
    return new Date(Date.UTC(y < 50 ? 2000 + y : 1900 + y, Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)), Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12)) || 0));
  }
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12)) || 0, Number(s.slice(12, 14)) || 0));
}

const isTime = (tag: number) => tag === 0x17 || tag === 0x18;

function readCrl(der: Buffer, cert: CertInfo, issuer: CertInfo): { result: RevocationResult | null; note?: string; nextUpdate?: number } {
  let tbs: Tlv; let sigAlg: Tlv; let sigBits: Tlv;
  try {
    const outer = tlv(der, 0);
    tbs = tlv(der, outer.start + outer.header);
    sigAlg = tlv(der, tbs.end);
    sigBits = tlv(der, sigAlg.end);
  } catch { return { result: null, note: 'CRL unreadable' }; }
  const alg = AsnConvert.parse(der.subarray(sigAlg.start, sigAlg.end), AlgorithmIdentifier);
  const signature = der.subarray(sigBits.start + sigBits.header + 1, sigBits.end); // skip the unused-bits byte
  const ok = verifySignature(issuer.x509, alg.algorithm, alg.parameters, alg.algorithm, der.subarray(tbs.start, tbs.end), signature).ok;
  if (!ok) return { result: null, note: 'CRL signature does not verify with the issuer' };

  const serial = normSerial(AsnConvert.parse(cert.der, Certificate).tbsCertificate.serialNumber);
  let thisUpdate: Date | undefined;
  let nextUpdate: Date | undefined;
  try {
    let at = tbs.start + tbs.header;
    let field = tlv(der, at);
    if (field.tag === 0x02) { at = field.end; field = tlv(der, at); } // version
    at = field.end; // signature algorithm
    at = tlv(der, at).end; // issuer
    const tu = tlv(der, at); thisUpdate = derTime(der, tu); at = tu.end;
    if (at < tbs.end) {
      const maybe = tlv(der, at);
      if (isTime(maybe.tag)) { nextUpdate = derTime(der, maybe); at = maybe.end; }
    }
    if (at < tbs.end) {
      const revoked = tlv(der, at);
      if (revoked.tag === 0x30) {
        for (let e = revoked.start + revoked.header; e < revoked.end;) {
          const entry = tlv(der, e);
          const sn = tlv(der, entry.start + entry.header);
          if (normSerial(der.subarray(sn.start + sn.header, sn.end)) === serial) {
            const when = derTime(der, tlv(der, sn.end));
            return {
              result: { status: 'revoked', source: 'crl', revokedAt: when.toISOString(), producedAt: thisUpdate.toISOString(), notes: [] },
              nextUpdate: nextUpdate?.getTime(),
            };
          }
          e = entry.end;
        }
      }
    }
  } catch {
    return { result: null, note: 'CRL unreadable' };
  }
  return { result: { status: 'good', source: 'crl', revokedAt: null, producedAt: thisUpdate?.toISOString() ?? null, notes: [] }, nextUpdate: nextUpdate?.getTime() };
}

export async function checkRevocation(
  cert: CertInfo, issuer: CertInfo | null, opts: { embeddedOcsp?: Buffer[]; online: boolean; trustResponder?: ResponderTrust },
): Promise<RevocationResult> {
  const notes: string[] = [];
  if (!issuer) return { status: 'unchecked', source: null, revokedAt: null, producedAt: null, notes: ['the issuer certificate is missing'] };

  for (const der of opts.embeddedOcsp ?? []) {
    const r = await readOcsp(der, cert, issuer, opts.trustResponder);
    if (r.result) return { ...r.result, source: 'embedded-ocsp' };
  }
  if (!opts.online) return { status: 'unchecked', source: null, revokedAt: null, producedAt: null, notes: ['online checks are off on this node'] };

  for (const url of cert.ocspUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 2)) {
    try {
      const der = await fetchBytes(url, { body: buildOcspRequest(cert, issuer), contentType: 'application/ocsp-request', max: MAX_OCSP_BYTES });
      const r = await readOcsp(der, cert, issuer, opts.trustResponder);
      if (r.result && r.result.status !== 'unknown') return { ...r.result, notes };
      notes.push(`OCSP ${new URL(url).host}: ${r.note ?? 'unknown'}`);
    } catch (err) {
      notes.push(`OCSP ${safeHost(url)}: ${String((err as Error).message ?? err)}`);
    }
  }
  for (const url of cert.crlUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 2)) {
    try {
      const cached = crlCache.get(url);
      let der: Buffer;
      if (cached && cached.until > Date.now()) der = cached.crl;
      else {
        der = await fetchBytes(url, { max: MAX_CRL_BYTES });
        if (crlCache.size >= CRL_CACHE_MAX) crlCache.delete(crlCache.keys().next().value!);
      }
      const r = readCrl(der, cert, issuer);
      if (r.result) {
        crlCache.set(url, { until: Math.min(r.nextUpdate ?? 0, Date.now() + 3600_000), crl: der });
        return { ...r.result, notes };
      }
      notes.push(`CRL ${safeHost(url)}: ${r.note}`);
    } catch (err) {
      notes.push(`CRL ${safeHost(url)}: ${String((err as Error).message ?? err)}`);
    }
  }
  if (!cert.ocspUrls.length && !cert.crlUrls.length) notes.push('the certificate names no OCSP responder and no CRL');
  return { status: 'unknown', source: null, revokedAt: null, producedAt: null, notes };
}

function safeHost(url: string): string {
  try { return new URL(url).host; } catch { return url.slice(0, 60); }
}
