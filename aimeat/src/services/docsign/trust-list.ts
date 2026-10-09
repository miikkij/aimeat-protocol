/**
 * @file src/services/docsign/trust-list.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The EU trusted lists (ETSI TS 119 612): the European Commission's List of Trusted
 *   Lists (LOTL) names every member state's trusted list and the certificates that sign it; each
 *   member state's list names its qualified trust service providers, their services, the CA
 *   certificates behind them, and the status history of each service. This file fetches, verifies
 *   and reads them, and answers one question: which listed service, if any, issued a given
 *   certificate chain, and what did the list say about it at a given time.
 *
 *   HOW THE LISTS ARE TRUSTED. A member state's list is accepted only when its XML signature
 *   verifies with one of the certificates the LOTL names for that territory. The LOTL itself is
 *   fetched over HTTPS from the address in AIMEAT_DOCSIGN_LOTL_URL (the Commission's by default) and
 *   its signature must verify with a certificate the LOTL lists for itself. That self-reference
 *   proves integrity, not origin, so the origin rests on TLS to ec.europa.eu; an operator who wants
 *   more pins the LOTL signer with AIMEAT_DOCSIGN_LOTL_SIGNER_SHA256 (the certificates are published
 *   in the Official Journal, series C).
 *
 *   LAZY AND CACHED. The LOTL is about 0.5 MB; a member state's list 0.1 to a few MB. A list is
 *   fetched the first time a chain from its territory is checked, kept in this process for
 *   TRUST_TTL_MS, and refetched after. A failed fetch is remembered for a few minutes so that a
 *   burst of checks does not hammer an unreachable host. Nothing is written to the database: the
 *   lists are public, reproducible, and change daily.
 *
 *   WHAT IS SIMPLIFIED. ETSI TS 119 615 defines the full procedure for reading a qualification
 *   from a list. This implements the parts a signature report needs: the service status at a time
 *   (current status plus history), the qualifiers in the Qualifications extension with policy-set
 *   and key-usage criteria, and the additional service information for e-signatures and e-seals.
 *   Criteria of other kinds are treated as not matching, which can only make a result less
 *   qualified, never more.
 * @structure TrustService · TrustMatch · loadLotl · loadTerritory · findIssuingService ·
 *   statusAt · qualifiersFor · _setTrustListFetcher (test seam)
 * @usage const match = await findIssuingService(config, chain, signingTime);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import { X509Certificate, createHash, createPublicKey, verify as cryptoVerify, type KeyLike } from 'node:crypto';
import { DOMParser, type Element as XmlElement, type Document as XmlDocument } from '@xmldom/xmldom';
import { SignedXml, type SignatureAlgorithm, type SignatureAlgorithmType } from 'xml-crypto';
import type { AimeatConfig } from '../../config.js';
import { safeFetch } from '../../utils/url-validator.js';
import { logger } from '../../utils/logger.js';
import { readCert, type CertInfo } from './x509-info.js';

const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const TRUST_TTL_MS = 12 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_LIST_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

const SVC = 'http://uri.etsi.org/TrstSvc/Svctype/';
const STATUS = 'http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/';
const LEGACY_STATUS = 'http://uri.etsi.org/TrstSvc/eSigDir-1999-93-EC-TrustedList/Svcstatus/';
const QUALIFIER = 'http://uri.etsi.org/TrstSvc/TrustedList/SvcInfoExt/';

export interface StatusPeriod {
  status: string;
  /** The status URI's last segment: granted, withdrawn, undersupervision, accredited, … */
  statusName: string;
  from: string;
  qualifications: QualificationRule[];
  additionalInfo: string[];
}

export interface QualificationRule {
  /** Qualifier names: QCWithSSCD, QCNoSSCD, QCWithQSCD, QCNoQSCD, QCStatement, NotQualified, QCForESig, QCForESeal, QCForWSA, QCQSCDStatusAsInCert, … */
  qualifiers: string[];
  assert: 'all' | 'atLeastOne' | 'none';
  policies: string[][];
  keyUsage: { name: string; value: boolean }[][];
  /** Criteria of a kind this reader does not evaluate. A rule with any is treated as not matching. */
  unsupported: boolean;
}

export interface TrustService {
  territory: string;
  tspName: string;
  serviceName: string;
  /** The service type's last segment: CA/QC, TSA/QTST, CA/PKC, OCSP/QC, … */
  type: string;
  /** DER of each certificate that identifies the service. */
  certificates: Buffer[];
  /** Current status first, then history, newest first. */
  periods: StatusPeriod[];
}

export interface TrustMatch {
  service: TrustService;
  /** The chain certificate the service is identified by (an issuing CA, or a root). */
  matchedCert: CertInfo;
  /** The period in force at the time asked about, or null when the service did not exist yet. */
  periodAt: StatusPeriod | null;
  /** Status at that time is one that grants trust (granted, or the pre-2016 positive statuses). */
  positiveAt: boolean;
}

interface TerritoryList {
  territory: string;
  fetchedAt: number;
  services: TrustService[];
  sequenceNumber: string | null;
  nextUpdate: string | null;
  error?: string;
}

interface LotlPointer { territory: string; url: string; certs: string[] }
interface Lotl { fetchedAt: number; pointers: LotlPointer[]; error?: string }

let lotlCache: Lotl | null = null;
const territories = new Map<string, TerritoryList>();

type Fetcher = (url: string) => Promise<string>;
let fetcher: Fetcher = async (url: string) => {
  const res = await safeFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_LIST_BYTES) throw new Error(`${url} is ${len} bytes, over the limit`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_LIST_BYTES) throw new Error(`${url} is over the size limit`);
  return buf.toString('utf8');
};

/** TEST SEAM: replace the network fetch, and forget every cached list. Never called by the server. */
export function _setTrustListFetcher(f: Fetcher | null): void {
  fetcher = f ?? fetcher;
  lotlCache = null;
  territories.clear();
}

/** Forget every cached list (tests, and an operator who changed the LOTL address). */
export function clearTrustListCache(): void {
  lotlCache = null;
  territories.clear();
}

const local = (el: XmlElement | XmlDocument, name: string): XmlElement[] =>
  Array.from(el.getElementsByTagNameNS('*', name)) as XmlElement[];
const firstText = (el: XmlElement, name: string): string | null => local(el, name)[0]?.textContent?.trim() ?? null;
/** Direct children by local name: nested ServiceHistory must not leak into the current status. */
const childrenNamed = (el: XmlElement, name: string): XmlElement[] =>
  Array.from(el.childNodes as unknown as ArrayLike<XmlElement>).filter((n) => n.nodeType === 1 && (n.localName === name));
const child = (el: XmlElement | undefined, name: string): XmlElement | undefined => el ? childrenNamed(el, name)[0] : undefined;

function pem(b64: string): string {
  const body = b64.replace(/\s+/g, '');
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * ECDSA for XML signatures (RFC 4051), which xml-crypto does not ship: Hungary signs its list with
 * it. XMLDSig carries the signature as r||s, which node calls ieee-p1363.
 */
function ecdsaAlgorithm(uri: string, hash: string): new () => SignatureAlgorithm {
  return class {
    getSignature(): string { throw new Error('signing is not supported'); }
    verifySignature(material: string, key: KeyLike, signatureValue: string): boolean {
      return cryptoVerify(hash, Buffer.from(material), { key: createPublicKey(key as string), dsaEncoding: 'ieee-p1363' }, Buffer.from(signatureValue, 'base64'));
    }
    getAlgorithmName(): SignatureAlgorithmType { return uri as SignatureAlgorithmType; }
  } as unknown as new () => SignatureAlgorithm;
}
const ECDSA_ALGORITHMS: Record<string, new () => SignatureAlgorithm> = {
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256': ecdsaAlgorithm('http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256', 'sha256'),
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384': ecdsaAlgorithm('http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384', 'sha384'),
  'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512': ecdsaAlgorithm('http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512', 'sha512'),
};

/** The XML's enveloped signature verifies with one of `certs` (base64 DER). Returns the cert that did. */
function verifyXmlSignature(xml: string, certs: string[]): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const sigNode = doc.getElementsByTagNameNS(DSIG_NS, 'Signature')[0];
  if (!sigNode) return null;
  for (const b64 of certs) {
    try {
      const sx = new SignedXml({ publicCert: pem(b64) });
      sx.SignatureAlgorithms = { ...sx.SignatureAlgorithms, ...ECDSA_ALGORITHMS };
      sx.loadSignature(sigNode as unknown as Node);
      if (sx.checkSignature(xml)) return b64;
    // eslint-disable-next-line aimeat/no-silent-catch -- xml-crypto throws for the wrong certificate; the caller logs when none of them verifies
    } catch {
      // Wrong certificate for this signature: try the next one.
    }
  }
  return null;
}

function parsePointers(doc: XmlDocument): LotlPointer[] {
  const out: LotlPointer[] = [];
  for (const p of local(doc, 'OtherTSLPointer')) {
    const url = firstText(p, 'TSLLocation');
    const territory = firstText(p, 'SchemeTerritory');
    const mime = firstText(p, 'MimeType');
    if (!url || !territory) continue;
    if (mime && !/xml/i.test(mime)) continue; // the PDF rendering of the same list
    const certs = local(p, 'X509Certificate').map((c) => (c.textContent ?? '').replace(/\s+/g, '')).filter(Boolean);
    out.push({ territory: territory.toUpperCase(), url, certs });
  }
  return out;
}

export async function loadLotl(config: AimeatConfig): Promise<Lotl> {
  const now = Date.now();
  if (lotlCache && !lotlCache.error && now - lotlCache.fetchedAt < TRUST_TTL_MS) return lotlCache;
  if (lotlCache?.error && now - lotlCache.fetchedAt < FAILURE_TTL_MS) return lotlCache;
  const url = config.docsignLotlUrl;
  try {
    const xml = await fetcher(url);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const pointers = parsePointers(doc);
    const self = pointers.find((p) => p.url === url || p.territory === 'EU');
    const signer = verifyXmlSignature(xml, self?.certs ?? []);
    if (!signer) throw new Error('the LOTL signature does not verify with a certificate the LOTL names for itself');
    if (config.docsignLotlSignerSha256.length) {
      const fp = createHash('sha256').update(Buffer.from(signer, 'base64')).digest('hex');
      if (!config.docsignLotlSignerSha256.includes(fp)) throw new Error(`the LOTL signer ${fp} is not one of the pinned certificates`);
    }
    lotlCache = { fetchedAt: now, pointers: pointers.filter((p) => p.territory !== 'EU') };
  } catch (err) {
    logger.warn('docsign: the EU List of Trusted Lists could not be loaded', { url, error: String(err) });
    lotlCache = { fetchedAt: now, pointers: [], error: String((err as Error).message ?? err) };
  }
  return lotlCache;
}

function readQualifications(ext: XmlElement): QualificationRule[] {
  const rules: QualificationRule[] = [];
  for (const el of local(ext, 'QualificationElement')) {
    const qualifiers = local(el, 'Qualifier').map((q) => (q.getAttribute('uri') ?? '').replace(QUALIFIER, '')).filter(Boolean);
    const criteria = local(el, 'CriteriaList')[0];
    const rule: QualificationRule = {
      qualifiers,
      assert: (criteria?.getAttribute('assert') as QualificationRule['assert']) ?? 'all',
      policies: [], keyUsage: [], unsupported: false,
    };
    if (criteria) {
      for (const c of Array.from(criteria.childNodes as unknown as ArrayLike<XmlElement>).filter((n) => n.nodeType === 1)) {
        if (c.localName === 'PolicySet') {
          rule.policies.push(local(c, 'Identifier').map((i) => (i.textContent ?? '').trim().replace(/^urn:oid:/, '')));
        } else if (c.localName === 'KeyUsage') {
          rule.keyUsage.push(local(c, 'KeyUsageBit').map((b) => ({ name: b.getAttribute('name') ?? '', value: (b.textContent ?? '').trim() === 'true' })));
        } else if (c.localName === 'Description') {
          // Text only.
        } else {
          rule.unsupported = true;
        }
      }
    }
    rules.push(rule);
  }
  return rules;
}

function readPeriod(info: XmlElement): StatusPeriod {
  const status = firstText(info, 'ServiceStatus') ?? '';
  const ext = local(info, 'ServiceInformationExtensions')[0];
  return {
    status,
    statusName: status.replace(STATUS, '').replace(LEGACY_STATUS, ''),
    from: firstText(info, 'StatusStartingTime') ?? '1970-01-01T00:00:00Z',
    qualifications: ext ? readQualifications(ext) : [],
    additionalInfo: ext ? local(ext, 'AdditionalServiceInformation').map((a) => firstText(a, 'URI') ?? '').filter(Boolean)
      .map((u) => u.replace('http://uri.etsi.org/TrstSvc/TrustedList/SvcInfoExt/', '')) : [],
  };
}

function parseTerritory(territory: string, xml: string): TrustService[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: TrustService[] = [];
  for (const tsp of local(doc, 'TrustServiceProvider')) {
    const tspName = firstText(local(tsp, 'TSPName')[0] ?? tsp, 'Name') ?? '';
    for (const svc of local(tsp, 'TSPService')) {
      const info = child(svc, 'ServiceInformation');
      if (!info) continue;
      const type = (firstText(info, 'ServiceTypeIdentifier') ?? '').replace(SVC, '');
      const certificates = local(child(info, 'ServiceDigitalIdentity') ?? info, 'X509Certificate')
        .map((c) => Buffer.from((c.textContent ?? '').replace(/\s+/g, ''), 'base64'))
        .filter((b) => b.length > 0);
      const name = firstText(local(info, 'ServiceName')[0] ?? info, 'Name') ?? '';
      const periods = [readPeriod(info)];
      const history = child(svc, 'ServiceHistory');
      for (const h of history ? childrenNamed(history, 'ServiceHistoryInstance') : []) periods.push(readPeriod(h));
      periods.sort((a, b) => Date.parse(b.from) - Date.parse(a.from));
      out.push({ territory, tspName, serviceName: name, type, certificates, periods });
    }
  }
  return out;
}

export async function loadTerritory(config: AimeatConfig, territory: string): Promise<TerritoryList> {
  const key = territory.toUpperCase();
  const now = Date.now();
  const cached = territories.get(key);
  if (cached && !cached.error && now - cached.fetchedAt < TRUST_TTL_MS) return cached;
  if (cached?.error && now - cached.fetchedAt < FAILURE_TTL_MS) return cached;
  const lotl = await loadLotl(config);
  const pointer = lotl.pointers.find((p) => p.territory === key);
  let list: TerritoryList;
  if (!pointer) {
    // A territory the LOTL does not name (a non-EU country) has no list: that is an answer, not an
    // error. Only a LOTL that could not be read makes it one.
    list = { territory: key, fetchedAt: now, services: [], sequenceNumber: null, nextUpdate: null,
      ...(lotl.error ? { error: `the EU list could not be loaded: ${lotl.error}` } : {}) };
  } else {
    try {
      const xml = await fetcher(pointer.url);
      if (!verifyXmlSignature(xml, pointer.certs)) throw new Error(`the ${key} trusted list signature does not verify with the certificates the EU list names`);
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      list = {
        territory: key, fetchedAt: now, services: parseTerritory(key, xml),
        sequenceNumber: firstText(doc.documentElement as unknown as XmlElement, 'TSLSequenceNumber'),
        nextUpdate: firstText(doc.documentElement as unknown as XmlElement, 'dateTime'),
      };
    } catch (err) {
      logger.warn('docsign: a trusted list could not be loaded', { territory: key, url: pointer.url, error: String(err) });
      list = { territory: key, fetchedAt: now, services: [], sequenceNumber: null, nextUpdate: null, error: String((err as Error).message ?? err) };
    }
  }
  territories.set(key, list);
  return list;
}

function sameKey(a: X509Certificate, b: X509Certificate): boolean {
  try {
    return a.subject === b.subject
      && a.publicKey.export({ format: 'der', type: 'spki' }).equals(b.publicKey.export({ format: 'der', type: 'spki' }));
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- a key that will not export is not the same key; false is the answer
    return false;
  }
}

/** The period in force at `at`: the newest whose start is not after it. */
export function statusAt(service: TrustService, at: Date): StatusPeriod | null {
  for (const p of service.periods) if (Date.parse(p.from) <= at.getTime()) return p;
  return null;
}

const POSITIVE = new Set(['granted', 'undersupervision', 'accredited', 'supervisionincessation', 'recognisedatnationallevel']);

/**
 * The listed service that a chain hangs from. `chain` runs from the end-entity certificate upward;
 * the first certificate that identifies a service of the wanted type wins. Territories are taken
 * from the chain's issuers' country attributes.
 */
export async function findIssuingService(
  config: AimeatConfig, chain: CertInfo[], at: Date, types: string[] = ['CA/QC'],
): Promise<{ match: TrustMatch | null; checked: string[]; errors: string[] }> {
  const wanted = new Set<string>();
  for (const c of chain) {
    for (const country of [c.issuer.country, c.subject.country]) {
      const code = country?.trim().toUpperCase();
      if (code && /^[A-Z]{2}$/.test(code)) wanted.add(code);
    }
  }
  // Greece writes EL on its list and GR in certificates.
  if (wanted.has('GR')) wanted.add('EL');
  const checked: string[] = [];
  const errors: string[] = [];
  let fallback: TrustMatch | null = null;
  for (const territory of wanted) {
    const list = await loadTerritory(config, territory);
    if (list.error) { errors.push(`${territory}: ${list.error}`); continue; }
    if (list.services.length) checked.push(territory);
    for (const cert of chain) {
      for (const service of list.services) {
        if (!types.includes(service.type)) continue;
        for (const sd of service.certificates) {
          let sx: X509Certificate;
          // eslint-disable-next-line aimeat/no-silent-catch -- one unreadable certificate on a national list must not hide the readable ones
          try { sx = new X509Certificate(sd); } catch { continue; }
          if (!sameKey(sx, cert.x509)) continue;
          const periodAt = statusAt(service, at);
          const m: TrustMatch = { service, matchedCert: cert, periodAt, positiveAt: !!periodAt && POSITIVE.has(periodAt.statusName) };
          if (m.positiveAt) return { match: m, checked, errors };
          fallback ??= m;
        }
      }
    }
  }
  return { match: fallback, checked, errors };
}

/** The qualifiers that apply to `cert` under `period`, after evaluating each rule's criteria. */
export function qualifiersFor(period: StatusPeriod | null, cert: CertInfo): string[] {
  if (!period) return [];
  const out = new Set<string>();
  for (const rule of period.qualifications) {
    if (rule.unsupported) continue;
    const results: boolean[] = [
      ...rule.policies.map((set) => set.every((oid) => cert.policies.includes(oid))),
      ...rule.keyUsage.map((bits) => bits.every((b) => cert.keyUsage.includes(b.name) === b.value)),
    ];
    const matches = rule.assert === 'none' ? results.every((r) => !r)
      : rule.assert === 'atLeastOne' ? results.some(Boolean)
        : results.every(Boolean);
    if (matches) for (const q of rule.qualifiers) out.add(q);
  }
  return [...out];
}

/** For tests and the report: read one certificate from base64 or DER without throwing. */
export function tryReadCert(der: Buffer): CertInfo | null {
  // eslint-disable-next-line aimeat/no-silent-catch -- the name says it: null is "not a readable certificate", the answer the caller asks for
  try { return readCert(der); } catch { return null; }
}
