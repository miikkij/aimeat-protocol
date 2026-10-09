/**
 * @file src/services/docsign/chain.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds the certificate chain of a signer: from the end-entity certificate up
 *   through the certificates the signature carried, fetching a missing issuer from the address in
 *   the certificate's Authority Information Access (caIssuers) when it is not there. Every link is
 *   a verified signature, not a name match.
 *
 *   The chain stops at a self-signed root, at a certificate the operator lists as a trust anchor
 *   (AIMEAT_DOCSIGN_TRUST_ANCHORS, a PEM bundle for a company CA or a non-EU scheme), or when no
 *   issuer can be found. Whether the chain is TRUSTED is not decided here: the EU lists decide that
 *   for a qualified service (trust-list.ts), the operator's anchors for everything else.
 * @structure BuiltChain · buildChain · operatorAnchors · _setCaIssuerFetcher (test seam)
 * @usage const chain = await buildChain(config, signerDer, poolDers);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — The EU reference wallet's test CAs are anchors too while
 *     docsign.eudi_test_roots is on; isEudiTestRoot() tells the report so (wish-allekirjoitus-eudi-lompakolla).
 */
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import * as asn1js from 'asn1js';
import type { AimeatConfig } from '../../config.js';
import { safeFetch } from '../../utils/url-validator.js';
import { readBodyCapped } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';
import { readCert, safeVerify, type CertInfo } from './x509-info.js';
import { EUDI_TEST_ROOTS_B64 } from '../../data/eudi-test-roots.js';

const MAX_DEPTH = 8;
const MAX_FETCHES = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_CERT_BYTES = 256 * 1024;

export interface BuiltChain {
  /** End entity first, then each issuer. */
  certs: CertInfo[];
  /** The last certificate is self-signed. */
  reachesRoot: boolean;
  /** A certificate in the chain is one of the operator's trust anchors. */
  operatorAnchor: CertInfo | null;
  /** Issuers fetched from caIssuers addresses on the way. */
  fetched: string[];
  /** Why the chain stopped short, when it did. */
  gap: string | null;
}

type CaFetcher = (url: string) => Promise<Buffer>;
let caFetcher: CaFetcher = async (url) => {
  const res = await safeFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await readBodyCapped(res, MAX_CERT_BYTES);
  if (!buf) throw new Error('too large');
  return buf;
};

/** TEST SEAM: replace the caIssuers fetch. Never called by the server. */
export function _setCaIssuerFetcher(f: CaFetcher | null): void {
  if (f) caFetcher = f;
}

let anchorCache: { path: string; certs: CertInfo[] } | null = null;

/** The operator's own trust anchors, from the PEM bundle AIMEAT_DOCSIGN_TRUST_ANCHORS names. */
export function operatorAnchors(config: AimeatConfig): CertInfo[] {
  const path = config.docsignTrustAnchorsPath;
  if (!path) return [];
  if (anchorCache?.path === path) return anchorCache.certs;
  const certs: CertInfo[] = [];
  try {
    const text = readFileSync(path, 'utf8');
    for (const m of text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)) {
      // eslint-disable-next-line aimeat/no-silent-catch -- one unreadable entry in the operator's bundle must not drop the readable ones; the count shows in the report's chain
      try { certs.push(readCert(Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64'))); } catch { /* skip an unreadable entry */ }
    }
  } catch (err) {
    logger.warn('docsign: the trust anchor bundle could not be read', { path, error: String(err) });
  }
  anchorCache = { path, certs };
  return certs;
}

let testRoots: CertInfo[] | null = null;

/** The EU reference wallet's test CAs (data/eudi-test-roots.ts), parsed once. */
function eudiTestRoots(): CertInfo[] {
  testRoots ??= EUDI_TEST_ROOTS_B64.map((b64) => readCert(Buffer.from(b64, 'base64')));
  return testRoots;
}

/** A certificate is one of the EU reference wallet's test CAs: a signature under it has no legal effect. */
export function isEudiTestRoot(sha256: string): boolean {
  return eudiTestRoots().some((c) => c.sha256 === sha256);
}

/** Every anchor a chain may stop at: the operator's, and the wallet test CAs while they are trusted. */
function trustAnchors(config: AimeatConfig): CertInfo[] {
  const own = operatorAnchors(config);
  return config.docsignEudiTestRoots ? [...own, ...eudiTestRoots()] : own;
}

/** A caIssuers response is a DER certificate, a PEM one, or a PKCS#7 "certs-only" bundle. */
function certsFromCaIssuers(buf: Buffer): Buffer[] {
  const text = buf.toString('latin1');
  if (text.includes('-----BEGIN CERTIFICATE-----')) {
    return [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)]
      .map((m) => Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64'));
  }
  try {
    new X509Certificate(buf);
    return [buf];
  } catch {
    // PKCS#7 SignedData with only certificates: ContentInfo → [0] → SignedData → [0] certificates.
    const parsed = asn1js.fromBER(buf);
    if (parsed.offset === -1) return [];
    const ci = parsed.result as asn1js.Sequence;
    const sd = ((ci.valueBlock.value[1] as asn1js.Constructed)?.valueBlock.value[0] as asn1js.Sequence | undefined);
    const certSet = sd?.valueBlock.value.find((b) => b.idBlock.tagClass === 3 && b.idBlock.tagNumber === 0) as asn1js.Constructed | undefined;
    return (certSet?.valueBlock.value ?? []).map((b) => Buffer.from(b.valueBeforeDecodeView));
  }
}

export async function buildChain(config: AimeatConfig, signer: Buffer, pool: Buffer[], online = true): Promise<BuiltChain> {
  const anchors = trustAnchors(config);
  const candidates: CertInfo[] = [];
  const seen = new Set<string>();
  const add = (der: Buffer) => {
    try {
      const c = readCert(der);
      if (seen.has(c.sha256)) return;
      seen.add(c.sha256);
      candidates.push(c);
    // eslint-disable-next-line aimeat/no-silent-catch -- the pool comes from an uploaded signature; bytes that are not a certificate are not a link of any chain
    } catch { /* not a certificate */ }
  };
  pool.forEach(add);
  anchors.forEach((a) => add(a.der));

  const first = readCert(signer);
  const out: BuiltChain = { certs: [first], reachesRoot: false, operatorAnchor: null, fetched: [], gap: null };
  let fetches = 0;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const cur = out.certs[out.certs.length - 1]!;
    const anchor = anchors.find((a) => a.sha256 === cur.sha256);
    if (anchor) { out.operatorAnchor = anchor; break; }
    if (cur.selfSigned) { out.reachesRoot = true; break; }
    let issuer = candidates.find((c) => c.sha256 !== cur.sha256 && cur.x509.checkIssued(c.x509) && safeVerify(cur.x509, c.x509));
    if (!issuer && online) {
      // The certificate's own caIssuers first; then the ones below it in the chain, because some
      // issuers (Belgium's eID among them) put the root's address in the end-entity certificate.
      const urls = [...new Set([...cur.caIssuerUrls, ...out.certs.flatMap((c) => c.caIssuerUrls)])];
      for (const url of urls) {
        if (fetches >= MAX_FETCHES || !/^https?:\/\//i.test(url)) continue;
        fetches++;
        try {
          for (const der of certsFromCaIssuers(await caFetcher(url))) add(der);
          out.fetched.push(url);
        } catch (err) {
          logger.debug?.('docsign: caIssuers fetch failed', { url, error: String(err) });
        }
        issuer = candidates.find((c) => c.sha256 !== cur.sha256 && cur.x509.checkIssued(c.x509) && safeVerify(cur.x509, c.x509));
        if (issuer) break;
      }
    }
    if (!issuer) { out.gap = `no issuer found for ${cur.subject.commonName ?? cur.subject.text}`; break; }
    out.certs.push(issuer);
  }
  if (!out.operatorAnchor) {
    // An anchor may be the issuer of the last link without being in the chain yet.
    const last = out.certs[out.certs.length - 1]!;
    out.operatorAnchor = anchors.find((a) => a.sha256 === last.sha256) ?? null;
  }
  return out;
}
