/**
 * @file src/services/docsign/eudi.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Signing a PDF with an EU Digital Identity Wallet: this node is the relying party,
 *   the wallet makes the signature through its own qualified trust service provider, and this node
 *   needs no account at any provider. The person confirms in their own wallet; what comes back is
 *   the PDF with a PAdES signature in it, which the node checks, stores in the signer's own files
 *   and seals into the signing request (records.ts, method `eudi-wallet`).
 *
 *   THE PROTOCOL IS PRE-STANDARD, AND KEPT TO THIS FILE. The released EU reference wallet
 *   (Android) speaks the "Document Retrieval" flow of the CSC rQES work: a deep link
 *   `eudi-rqes://<host>?client_id=<host>&request_uri=<url>` names a signed request object; the
 *   wallet fetches it, downloads the document from the address in it, signs, and posts the signed
 *   PDF to `response_uri` as a form. ETSI TS 119 432 (OpenID4VP with QES transaction data) is
 *   meant to replace it, and national wallets will speak that one; when they do, it is a second
 *   adapter beside this one, and records.ts does not change. Field names and checks follow
 *   eudi-lib-jvm-rqes-csc-kt (RequestObjectValidator, DefaultResponseDispatcher) as of 2026-10.
 *
 *   TRUST. The request object is a JWS signed with this node's access certificate (ES256/384/512,
 *   the chain in `x5c`). The wallet checks that the certificate names this node and chains to an
 *   anchor it holds. A certificate naming the host (DNS:) gives `client_id_scheme` x509_san_dns
 *   and a response address per session; one naming an address (URI:https://aimeat.io, what the EU
 *   test registrar at registry.serviceproviders.eudiw.dev issues) gives x509_san_uri, and then the
 *   wallet answers at exactly that address, where the session is found by its state
 *   (walletClient, receiveWalletResponseByState). The operator names the PEM file in
 *   docsign.eudi_rp_credential.
 *
 *   NOTHING IS KEPT THAT THE REQUEST DID NOT ALREADY HOLD. The PDF lives in this process's memory
 *   for one wallet session (15 minutes), so the wallet can download it, and is then dropped; the
 *   node keeps hashes, as it does for every other signature. The signed PDF goes to the signer's
 *   own files, under their quota, and the request records its place and hash.
 *
 *   THREE PUBLIC ENDPOINTS, because the wallet carries no AIMEAT credentials: the request object,
 *   the document and the response. Each needs the session id (128 random bits); the document also
 *   needs its own token, and the response its `state`. A session serves one signature and closes.
 * @structure WalletStatus · walletStatus · startWalletSignature · walletSessionStatus ·
 *   walletRequestObject · walletDocument · receiveWalletResponse · receiveWalletResponseByState ·
 *   walletClient · parseDocumentWithSignature
 * @usage const s = await startWalletSignature(ctx, caller, id, { bytes });
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-allekirjoitus-eudi-lompakolla).
 *   v1.1.0 — 2026-10-10 — x509_san_uri: the EU test registrar's access certificate for aimeat.io
 *     names URI:https://aimeat.io, and the wallet then requires response_uri to equal it, so the
 *     response arrives at that one address and the session is found by its state.
 *   v1.2.0 — 2026-10-10 — A refused wallet answer is logged, noted on the request
 *     (walletLastAttempt) and, when a PDF came back, that PDF is kept in the signer's files.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes, createPrivateKey, createPublicKey, timingSafeEqual, X509Certificate, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import type { CallerContext } from '../caller-context.js';
import { writeStorageFile } from '../storage-file-write.js';
import { logger } from '../../utils/logger.js';
import { docsignMaxBytes } from '../../config-docsign.js';
import { validatePdf } from './validate.js';
import {
  DocsignError, walletSigner, recordWalletSignature, noteWalletAttempt, documentHash,
  type DocsignCtx, type WalletEvidence,
} from './records.js';

// CJS-ESM interop for qrcode, as services/totp.ts does.
const QRCode = createRequire(import.meta.url)('qrcode') as { toDataURL: (text: string, opts?: Record<string, unknown>) => Promise<string> };

const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 100;
const MAX_HELD_BYTES = 256 * 1024 * 1024;
const SHA256_OID = '2.16.840.1.101.3.4.2.1';

// ── the relying-party credential ──

interface RpCredential { key: KeyObject; alg: 'ES256' | 'ES384' | 'ES512'; x5c: string[]; dnsNames: string[]; uris: string[] }

/**
 * How this node names itself to a wallet, read from what its access certificate says.
 * - x509_san_dns: the certificate names the host (DNS:aimeat.io). client_id is the host, and the
 *   wallet requires only that response_uri is on that host, so each session gets its own path.
 * - x509_san_uri: the certificate names an address (URI:https://aimeat.io), which is what the EU
 *   test registrar issues. client_id is that address, and the wallet requires response_uri to be
 *   EXACTLY it (eudi-lib-jvm-rqes-csc-kt RequestObjectValidator), so every session answers at the
 *   one address and is found by its `state`.
 */
export interface WalletClient { scheme: 'x509_san_dns' | 'x509_san_uri'; clientId: string; fixedResponseUri: string | null }

export function walletClient(baseUrl: string, dnsNames: string[], uris: string[]): WalletClient | { reason: string } {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (dnsNames.includes(host)) return { scheme: 'x509_san_dns', clientId: host, fixedResponseUri: null };
  const uri = uris.find((u) => {
    // eslint-disable-next-line aimeat/no-silent-catch -- a SAN entry that is not a URL names no host, so it is not this node
    try { return new URL(u).hostname.toLowerCase() === host; } catch { return false; }
  });
  if (uri) return { scheme: 'x509_san_uri', clientId: uri, fixedResponseUri: uri };
  const named = [...dnsNames, ...uris].join(', ') || 'nothing';
  return { reason: `The access certificate names ${named}, not ${host}; a wallet refuses it.` };
}

let credCache: { path: string; cred: RpCredential | null; reason: string | null } | null = null;

const ALG_BY_CURVE: Record<string, RpCredential['alg']> = { prime256v1: 'ES256', secp384r1: 'ES384', secp521r1: 'ES512' };

function readCredential(path: string): { cred: RpCredential | null; reason: string | null } {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { cred: null, reason: `The access certificate file ${path} could not be read: ${String(err)}` };
  }
  const keyPem = text.match(/-----BEGIN (?:EC )?PRIVATE KEY-----[\s\S]+?-----END (?:EC )?PRIVATE KEY-----/)?.[0];
  const certs = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g)].map((m) => m[1]!.replace(/\s+/g, ''));
  if (!keyPem || !certs.length) return { cred: null, reason: 'The access certificate file must hold the EC private key and the certificate, leaf first.' };
  const key = createPrivateKey(keyPem);
  const alg = ALG_BY_CURVE[key.asymmetricKeyDetails?.namedCurve ?? ''];
  if (key.asymmetricKeyType !== 'ec' || !alg) return { cred: null, reason: 'The access certificate key must be an EC key on P-256, P-384 or P-521.' };
  const leaf = new X509Certificate(Buffer.from(certs[0]!, 'base64'));
  const spki = (k: KeyObject) => k.export({ type: 'spki', format: 'der' });
  if (!spki(createPublicKey(key)).equals(spki(leaf.publicKey))) {
    return { cred: null, reason: 'The private key does not belong to the first certificate in the file.' };
  }
  const san = (leaf.subjectAltName ?? '').split(',').map((s) => s.trim());
  const dnsNames = san.filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4).toLowerCase());
  const uris = san.filter((s) => s.startsWith('URI:')).map((s) => s.slice(4));
  return { cred: { key, alg, x5c: certs, dnsNames, uris }, reason: null };
}

function credential(ctx: DocsignCtx): { cred: RpCredential | null; client: WalletClient | null; reason: string | null } {
  const path = ctx.config.docsignEudiRpCredentialPath;
  if (!path) return { cred: null, client: null, reason: 'No wallet access certificate is configured (docsign.eudi_rp_credential).' };
  if (credCache?.path !== path) {
    try {
      credCache = { path, ...readCredential(path) };
    } catch (err) {
      credCache = { path, cred: null, reason: `The access certificate file could not be used: ${String(err)}` };
    }
    if (credCache.reason) logger.warn('docsign: the wallet access certificate is not usable', { path, reason: credCache.reason });
  }
  const { cred, reason } = credCache;
  if (!cred) return { cred, client: null, reason };
  const client = walletClient(ctx.config.baseUrl, cred.dnsNames, cred.uris);
  if ('reason' in client) return { cred: null, client: null, reason: client.reason };
  return { cred, client, reason: null };
}

/** What the wallet will see as client_id, or this node's host when no certificate is usable yet. */
const clientIdOf = (ctx: DocsignCtx, client: WalletClient | null) => client?.clientId ?? new URL(ctx.config.baseUrl).hostname.toLowerCase();

export interface WalletStatus {
  enabled: boolean;
  ready: boolean;
  /** Why wallet signing is not ready, when it is not. */
  reason: string | null;
  client_id: string;
  /** x509_san_dns or x509_san_uri, from what the access certificate names; null until one is usable. */
  client_id_scheme: WalletClient['scheme'] | null;
  protocol: string;
  formats: string[];
  test_roots_trusted: boolean;
}

export function walletStatus(ctx: DocsignCtx): WalletStatus {
  const base = {
    protocol: 'eudi-rqes document retrieval (pre-standard; EU reference wallet on Android)',
    formats: ['application/pdf'], test_roots_trusted: ctx.config.docsignEudiTestRoots,
  };
  if (!ctx.config.docsignEnabled || !ctx.config.docsignEudiEnabled) {
    return { enabled: false, ready: false, reason: 'Wallet signing is switched off on this node (docsign.eudi_enabled).', client_id: clientIdOf(ctx, null), client_id_scheme: null, ...base };
  }
  const { cred, client, reason } = credential(ctx);
  return { enabled: true, ready: !!cred, reason, client_id: clientIdOf(ctx, client), client_id_scheme: client?.scheme ?? null, ...base };
}

// ── sessions ──

type SessionStatus = 'waiting' | 'fetched' | 'signed' | 'failed' | 'expired';

interface WalletSession {
  id: string;
  requestId: string;
  signer: string;
  startedBy: string;
  name: string;
  bytes: Buffer | null;
  sha256: string;
  docToken: string;
  nonce: string;
  state: string;
  expires: number;
  status: SessionStatus;
  error: { code: string; message: string } | null;
}

const sessions = new Map<string, WalletSession>();

function sweep(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expires < now) {
      s.bytes = null;
      if (s.status === 'waiting' || s.status === 'fetched') s.status = 'expired';
      // A closed session is kept as long again, so the page that started it can still read how it ended.
      if (s.expires + SESSION_TTL_MS < now) sessions.delete(id);
    }
  }
}

const heldBytes = () => [...sessions.values()].reduce((n, s) => n + (s.bytes?.length ?? 0), 0);

function openSession(id: string): WalletSession {
  sweep();
  const s = /^[0-9a-f]{32}$/.test(id) ? sessions.get(id) : undefined;
  if (!s) throw new DocsignError('NOT_FOUND', 404, 'No such wallet session. It may have expired: start the signature again.');
  return s;
}

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const urls = (ctx: DocsignCtx, s: WalletSession) => {
  const base = `${ctx.config.baseUrl.replace(/\/+$/, '')}/v1/docsign/wallet/${s.id}`;
  return { request: `${base}/request`, document: `${base}/document/${s.docToken}`, response: `${base}/response` };
};

export interface WalletStart {
  session_id: string;
  /** Open on the phone, or show as a QR code the wallet scans. */
  wallet_link: string;
  /** wallet_link as a QR code (PNG data URL), for a page on a computer: the wallet scans it. */
  wallet_qr: string;
  request_uri: string;
  expires_at: string;
  signer: string;
}

/**
 * Start a wallet signature on request `id`. `bytes` is the PDF the wallet signs: the request's own
 * document, or once a wallet has signed, the newest signed PDF (so every wallet signature lands in
 * one file). It is checked against the hash the request holds.
 */
export async function startWalletSignature(ctx: DocsignCtx, caller: CallerContext, id: string, doc: { bytes: Buffer; name?: string }): Promise<WalletStart> {
  const status = walletStatus(ctx);
  if (!status.enabled) throw new DocsignError('FEATURE_DISABLED', 404, status.reason!);
  if (!status.ready) throw new DocsignError('WALLET_NOT_READY', 503, status.reason!);
  const { rec, signer, expectedSha256 } = await walletSigner(ctx, caller, id);
  const sha = documentHash(doc.bytes);
  if (sha !== expectedSha256) {
    throw new DocsignError('DOCUMENT_MISMATCH', 409, rec.walletDocument
      ? 'This request already carries a wallet signature: sign the signed PDF (GET /v1/docsign/requests/{id}/signed-document), so every signature lands in one file.'
      : 'This file is not the document of the request: its SHA-256 differs.');
  }
  if (doc.bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new DocsignError('UNSUPPORTED_FORMAT', 415, 'A wallet signs a PDF. Make the document a PDF and create the request for that file.');
  }
  if (doc.bytes.length > docsignMaxBytes(ctx.config)) throw new DocsignError('TOO_LARGE', 413, 'The PDF is larger than this node checks (docsign.max_mb).');
  sweep();
  if (sessions.size >= MAX_SESSIONS || heldBytes() + doc.bytes.length > MAX_HELD_BYTES) {
    throw new DocsignError('BUSY', 503, 'Too many wallet signatures are waiting on this node. Try again in a few minutes.');
  }
  const s: WalletSession = {
    id: randomBytes(16).toString('hex'), requestId: rec.id, signer, startedBy: caller.principal,
    name: (doc.name || rec.walletDocument?.name || rec.document.name).slice(0, 200),
    bytes: doc.bytes, sha256: sha, docToken: randomBytes(24).toString('base64url'),
    nonce: randomBytes(16).toString('base64url'), state: randomBytes(16).toString('base64url'),
    expires: Date.now() + SESSION_TTL_MS, status: 'waiting', error: null,
  };
  sessions.set(s.id, s);
  const u = urls(ctx, s);
  const host = new URL(ctx.config.baseUrl).hostname.toLowerCase();
  const walletClientId = clientIdOf(ctx, credential(ctx).client);
  const link = `eudi-rqes://${host}?client_id=${encodeURIComponent(walletClientId)}&request_uri=${encodeURIComponent(u.request)}`;
  return {
    session_id: s.id, request_uri: u.request, signer, wallet_link: link,
    wallet_qr: await QRCode.toDataURL(link, { margin: 2, width: 320, errorCorrectionLevel: 'M' }),
    expires_at: new Date(s.expires).toISOString(),
  };
}

/** How a wallet session stands, for whoever started it or the signer. */
export function walletSessionStatus(caller: CallerContext, requestId: string, sessionId: string): {
  status: SessionStatus; error: { code: string; message: string } | null; expires_at: string; signer: string;
} {
  const s = openSession(sessionId);
  if (s.requestId !== requestId || (caller.principal !== s.startedBy && caller.principal !== s.signer && caller.ownerGhii !== s.signer)) {
    throw new DocsignError('NOT_FOUND', 404, 'No such wallet session.');
  }
  return { status: s.status, error: s.error, expires_at: new Date(s.expires).toISOString(), signer: s.signer };
}

// ── what the wallet calls ──

/** The signed request object the wallet fetches from request_uri. */
export async function walletRequestObject(ctx: DocsignCtx, sessionId: string): Promise<string> {
  const s = openSession(sessionId);
  if (s.status !== 'waiting' && s.status !== 'fetched') throw new DocsignError('NOT_OPEN', 409, `This wallet session is ${s.status}.`);
  const { cred, client, reason } = credential(ctx);
  if (!cred || !client) throw new DocsignError('WALLET_NOT_READY', 503, reason!);
  const u = urls(ctx, s);
  const claims = {
    response_type: 'sign_response',
    client_id: client.clientId,
    client_id_scheme: client.scheme,
    response_mode: 'direct_post',
    // x509_san_uri: the wallet answers at the certificate's own address, and the state finds the session.
    response_uri: client.fixedResponseUri ?? u.response,
    nonce: s.nonce,
    state: s.state,
    signatureQualifier: 'eu_eidas_qes',
    documentDigests: [{ hash: Buffer.from(s.sha256, 'hex').toString('base64'), label: s.name }],
    documentLocations: [{ uri: u.document, method: { type: 'public' } }],
    hashAlgorithmOID: SHA256_OID,
    clientData: s.requestId,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: cred.alg, typ: 'oauth-authz-req+jwt', x5c: cred.x5c })
    .setIssuedAt()
    .sign(cred.key);
}

/** The PDF the wallet downloads from the address in the request object. */
export function walletDocument(sessionId: string, token: string): { bytes: Buffer; name: string } {
  const s = openSession(sessionId);
  if (!s.bytes || (s.status !== 'waiting' && s.status !== 'fetched') || !sameSecret(token, s.docToken)) {
    throw new DocsignError('NOT_FOUND', 404, 'No such document.');
  }
  s.status = 'fetched';
  return { bytes: s.bytes, name: s.name };
}

/**
 * The signed PDFs in a wallet's response form. The reference wallet sends one field holding a JSON
 * array of base64 strings; other implementations repeat the field, index it, or separate the
 * values with commas, and each of those is read too.
 */
export function parseDocumentWithSignature(form: Record<string, unknown>): string[] {
  const out: string[] = [];
  const take = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(take); return; }
    if (typeof v !== 'string' || !v.trim()) return;
    const t = v.trim();
    if (t.startsWith('[')) {
      // eslint-disable-next-line aimeat/no-silent-catch -- a value that only looks like a JSON array is read as the plain or comma-separated form below
      try { take(JSON.parse(t)); return; } catch { /* not JSON after all */ }
    }
    t.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => out.push(x));
  };
  take(form.documentWithSignature);
  for (const [k, v] of Object.entries(form)) if (/^documentWithSignature\[\d*\]$/.test(k)) take(v);
  return out;
}

const fromBase64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** "Matti Meikäläinen" and "MEIKÄLÄINEN Matti" name the same person; anything else does not. */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const words = (s: string) => s.toLocaleLowerCase('fi').normalize('NFC').split(/[^\p{L}]+/u).filter((w) => w.length > 1).sort().join(' ');
  if (!a || !b) return null;
  const wa = words(a), wb = words(b);
  return wa.length && wb.length ? wa === wb : null;
}

/**
 * A wallet's answer at the certificate's own address (x509_san_uri), where the path names no
 * session: the session is the one whose `state` the form carries. Null when no open session has
 * it, so the caller answers as it would have without this route.
 */
export async function receiveWalletResponseByState(ctx: DocsignCtx, form: Record<string, unknown>): Promise<{ redirect_uri: string } | null> {
  if (typeof form.state !== 'string' || !form.state) return null;
  sweep();
  const state = form.state;
  const s = [...sessions.values()].find((x) => (x.status === 'waiting' || x.status === 'fetched') && sameSecret(state, x.state));
  return s ? receiveWalletResponse(ctx, s.id, form) : null;
}

/**
 * The wallet's answer at response_uri: the signed PDF, or an error such as user_cancelled.
 * Returns where the wallet should send the person next.
 */
export async function receiveWalletResponse(ctx: DocsignCtx, sessionId: string, form: Record<string, unknown>): Promise<{ redirect_uri: string }> {
  const s = openSession(sessionId);
  if (s.status !== 'waiting' && s.status !== 'fetched') throw new DocsignError('NOT_OPEN', 409, `This wallet session is ${s.status}.`);
  if (typeof form.state !== 'string' || !sameSecret(form.state, s.state)) throw new DocsignError('INVALID_STATE', 400, 'state does not match this session.');
  const appBase = ctx.config.docsignAppUrl || ctx.config.baseUrl.replace(/\/+$/, '');
  const redirect_uri = `${appBase}/?request=${encodeURIComponent(s.requestId)}`;
  const finish = (status: SessionStatus, error: WalletSession['error']) => { s.status = status; s.error = error; s.bytes = null; };
  /**
   * A refused answer leaves a trace that outlives the session: a log line, the reason on the
   * request (so the page and an AI can say why nothing was signed), and, when the wallet did
   * return a PDF, that PDF in the signer's own files so it can be looked at.
   */
  const refuse = async (code: string, message: string, returned?: Buffer) => {
    finish('failed', { code, message });
    let rejectedKey: string | undefined;
    if (returned?.length) {
      const k = `docsign/${s.requestId}/rejected-${documentHash(returned).slice(0, 8)}.pdf`;
      const kept = await writeStorageFile({ storage: ctx.storage, config: ctx.config }, s.signer, { key: k, data: returned, mimeType: 'application/pdf', visibility: 'private' });
      if (kept.ok) rejectedKey = k;
    }
    logger.warn('docsign: a wallet response was refused', { request: s.requestId, session: s.id.slice(0, 8), code, message, rejectedKey });
    try {
      await noteWalletAttempt(ctx, s.requestId, { at: new Date().toISOString(), signer: s.signer, code, message, ...(rejectedKey ? { rejectedKey } : {}) });
    } catch (err) {
      logger.warn('docsign: the refused wallet response could not be noted on the request', { request: s.requestId, error: String(err) });
    }
  };

  if (typeof form.error === 'string' && form.error) {
    const code = form.error.slice(0, 60);
    await refuse(code, code === 'user_cancelled' ? 'The person cancelled in the wallet.' : `The wallet answered ${code}${typeof form.error_description === 'string' ? `: ${form.error_description.slice(0, 300)}` : ''}.`);
    return { redirect_uri };
  }
  const original = s.bytes;
  if (!original) throw new DocsignError('NOT_OPEN', 409, 'This wallet session has expired.');
  const docs = parseDocumentWithSignature(form);
  if (docs.length !== 1) {
    const fields = Object.entries(form).map(([k, v]) => `${k}(${typeof v === 'string' ? v.length : Array.isArray(v) ? `${v.length} values` : typeof v})`).join(', ');
    await refuse('NO_SIGNED_DOCUMENT', `The wallet returned ${docs.length} documents; one signed PDF was expected. Form fields: ${fields.slice(0, 400) || 'none'}.`);
    throw new DocsignError('INVALID_INPUT', 400, 'documentWithSignature must hold the one signed PDF.');
  }
  const signed = fromBase64(docs[0]!);

  // The wallet appends its signature to the PDF it was given, so the given bytes come first,
  // unchanged. That is what proves the signed file is this request's document.
  if (signed.length <= original.length || !signed.subarray(0, original.length).equals(original)) {
    let at = 0;
    while (at < original.length && at < signed.length && original[at] === signed[at]) at++;
    await refuse('DOCUMENT_CHANGED', `The PDF the wallet returned does not start with the PDF it was given, so it cannot be shown to be the same document (sent ${original.length} bytes, returned ${signed.length}, first difference at byte ${at}).`, signed);
    throw new DocsignError('DOCUMENT_CHANGED', 422, 'The returned PDF is not an incremental update of the document that was sent.');
  }
  const report = await validatePdf(ctx.config, signed);
  const newest = report.signatures.filter((x) => x.kind === 'signature').sort((a, b) => b.index - a.index)[0];
  if (!newest || !newest.integrity.contentIntact || !newest.integrity.signatureValid || newest.verdict === 'invalid' || newest.coverage?.wholeFile === false) {
    const why = newest
      ? `${newest.verdict}: ${newest.summary} [reasons ${newest.reasons.join(',') || 'none'}; content intact ${newest.integrity.contentIntact}; signature valid ${newest.integrity.signatureValid}; algorithm ${newest.integrity.algorithm}; whole file ${newest.coverage?.wholeFile}]`
      : `no signature in the returned PDF (${report.signatures.length} fields)`;
    await refuse('SIGNATURE_NOT_VALID', `The wallet's signature did not check out (${why}).`, signed);
    throw new DocsignError('SIGNATURE_NOT_VALID', 422, `The returned signature did not check out: ${why}`);
  }

  const signedSha = documentHash(signed);
  const base = s.name.replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'document';
  const key = `docsign/${s.requestId}/${base}-signed-${signedSha.slice(0, 8)}.pdf`;
  const stored = await writeStorageFile({ storage: ctx.storage, config: ctx.config }, s.signer, { key, data: signed, mimeType: 'application/pdf', visibility: 'private' });
  if (!stored.ok) {
    await refuse(stored.code, `The signed PDF could not be stored in your files: ${stored.message}`);
    throw new DocsignError(stored.code, stored.status, stored.message);
  }
  const ghii = await ctx.storage.getGHII(s.signer);
  const wallet: WalletEvidence = {
    protocol: 'eudi-rqes-document-retrieval/1', clientId: clientIdOf(ctx, credential(ctx).client), signatureQualifier: 'eu_eidas_qes',
    input: { sha256: s.sha256, size: original.length },
    signed: { sha256: signedSha, size: signed.length, owner: s.signer, key },
    certificate: {
      subject: newest.signer?.subject ?? newest.signer?.name ?? 'unknown', issuer: newest.issuer?.name ?? null,
      serialNumber: newest.certificate?.serialNumber ?? null, sha256: newest.certificate?.sha256 ?? null,
    },
    validation: {
      verdict: newest.verdict, level: newest.level, reasons: newest.reasons, trustSource: newest.trust.source,
      test: newest.trust.source === 'eudi-test-anchor',
    },
    nameMatches: sameName(newest.signer?.name, ghii?.displayName),
  };
  try {
    await recordWalletSignature(ctx, s.requestId, s.signer, s.sha256, wallet, `${base}-signed.pdf`);
  } catch (err) {
    await refuse(err instanceof DocsignError ? err.code : 'DOCSIGN_ERROR', err instanceof Error ? err.message : String(err));
    throw err;
  }
  finish('signed', null);
  logger.info('docsign: a wallet signature was recorded', { request: s.requestId, session: s.id.slice(0, 8), verdict: newest.verdict, trust: newest.trust.source });
  return { redirect_uri };
}
