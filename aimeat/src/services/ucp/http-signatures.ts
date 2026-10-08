/**
 * @file src/services/ucp/http-signatures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HTTP Message Signatures (RFC 9421) the way UCP 2026-08-25 uses them
 *   (docs/specification/signatures.md): signing the order webhooks this node sends, and verifying a
 *   platform's signed request against the keys in its own profile.
 *
 *   WHAT IS SIGNED. The signature base is the covered components, one per line as
 *   `"<name>": <value>`, then `"@signature-params": <the inner list and its parameters>`. A request
 *   covers `@method`, `@authority`, `@path`, `@query` when there is one, `ucp-agent` when the header
 *   is sent, `idempotency-key` when sent, and `content-digest` and `content-type` when there is a
 *   body. `Content-Digest` is `sha-256=:<base64>:` over the raw bytes (RFC 9530). The label is
 *   `sig1`; `alg` is never a parameter, because the key's `kty`/`crv` names it.
 *
 *   ECDSA signatures are the raw 64 bytes `r||s` (RFC 9421 §3.3.1), not DER; node:crypto gives that
 *   with `dsaEncoding: 'ieee-p1363'`.
 * @structure contentDigest · signatureBase · signMessage · verifyMessage · parseSignatureInput
 * @usage const headers = signMessage({ method: 'POST', url, headers: { 'content-type': ... }, body }, key);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E: the own UCP checkout).
 */
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import type { PublicJwk } from './ucp-keys.js';
import { logger } from '../../utils/logger.js';

export function contentDigest(body: Buffer | string): string {
  return `sha-256=:${createHash('sha256').update(body).digest('base64')}:`;
}

export interface MessageParts {
  method: string;
  /** The absolute URL the message is sent to. */
  url: string;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
}

/** The value of one covered component, or null when the message does not have it. */
function componentValue(name: string, parts: MessageParts): string | null {
  const u = URL.parse(parts.url);
  if (!u) return null;
  switch (name) {
    case '@method': return parts.method.toUpperCase();
    case '@authority': return u.host.toLowerCase();
    case '@path': return u.pathname;
    case '@query': return u.search || '?';
    default: {
      const v = parts.headers[name];
      return v === undefined ? null : v.trim();
    }
  }
}

/** The signature base of RFC 9421 §2.5. Null when a covered component is missing. */
export function signatureBase(components: string[], params: string, parts: MessageParts): string | null {
  const lines: string[] = [];
  for (const c of components) {
    const v = componentValue(c, parts);
    if (v === null) return null;
    lines.push(`"${c}": ${v}`);
  }
  lines.push(`"@signature-params": ${params}`);
  return lines.join('\n');
}

/** The components UCP requires a message of this shape to cover. */
export function requiredComponents(parts: MessageParts, hasBody: boolean): string[] {
  const u = URL.parse(parts.url);
  const out = ['@method', '@authority', '@path'];
  if (u?.search) out.push('@query');
  if (parts.headers['ucp-agent'] !== undefined) out.push('ucp-agent');
  if (parts.headers['idempotency-key'] !== undefined) out.push('idempotency-key');
  if (hasBody) out.push('content-digest', 'content-type');
  return out;
}

/** Sign a message: returns the Content-Digest (with a body), Signature-Input and Signature headers. */
export function signMessage(
  parts: MessageParts, body: Buffer | string | null, key: { kid: string; privateKey: KeyObject },
  created = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const headers: Record<string, string | undefined> = { ...parts.headers };
  const out: Record<string, string> = {};
  if (body !== null) {
    out['Content-Digest'] = contentDigest(body);
    headers['content-digest'] = out['Content-Digest'];
  }
  const components = requiredComponents({ ...parts, headers }, body !== null);
  const params = `(${components.map((c) => `"${c}"`).join(' ')});created=${created};keyid="${key.kid}"`;
  const base = signatureBase(components, params, { ...parts, headers });
  if (base === null) throw new Error('A covered component is missing from the message.');
  const isEc = key.privateKey.asymmetricKeyType === 'ec';
  const sig = sign(isEc ? 'sha256' : null, Buffer.from(base), isEc ? { key: key.privateKey, dsaEncoding: 'ieee-p1363' } : key.privateKey);
  out['Signature-Input'] = `sig1=${params}`;
  out.Signature = `sig1=:${sig.toString('base64')}:`;
  return out;
}

/** The parts of `Signature-Input: sig1=(...);created=..;keyid=".."`, or null. */
export function parseSignatureInput(header: string | undefined): { label: string; components: string[]; params: string; keyid: string | null } | null {
  if (!header) return null;
  const m = /^\s*([a-zA-Z0-9_-]+)=(\(([^)]*)\)(?:;[^,]*)?)/.exec(header);
  if (!m) return null;
  const components = (m[3] ?? '').match(/"[^"]+"/g)?.map((s) => s.slice(1, -1)) ?? [];
  const keyid = /;keyid="([^"]+)"/.exec(m[2] ?? '')?.[1] ?? null;
  return { label: m[1]!, components, params: m[2]!, keyid };
}

export type VerifyResult = { ok: true; kid: string } | { ok: false; code: 'signature_missing' | 'signature_invalid' | 'key_not_found' | 'digest_mismatch' | 'algorithm_unsupported' };

/** Verify a signed message against a key set (a profile's `keys[]`). */
export function verifyMessage(parts: MessageParts, body: Buffer | null, keys: PublicJwk[]): VerifyResult {
  const input = parseSignatureInput(parts.headers['signature-input']);
  const sigHeader = parts.headers.signature;
  if (!input || !sigHeader) return { ok: false, code: 'signature_missing' };
  const sigMatch = new RegExp(`${input.label}=:([A-Za-z0-9+/=]+):`).exec(sigHeader);
  if (!sigMatch) return { ok: false, code: 'signature_invalid' };
  const required = requiredComponents(parts, !!body && body.length > 0);
  if (!required.every((c) => input.components.includes(c))) return { ok: false, code: 'signature_invalid' };
  if (body && body.length > 0 && parts.headers['content-digest'] !== contentDigest(body)) return { ok: false, code: 'digest_mismatch' };
  const jwk = keys.find((k) => k.kid === input.keyid);
  if (!jwk) return { ok: false, code: 'key_not_found' };
  const isEc = jwk.kty === 'EC' && jwk.crv === 'P-256';
  const isEd = jwk.kty === 'OKP' && jwk.crv === 'Ed25519';
  if (!isEc && !isEd) return { ok: false, code: 'algorithm_unsupported' };
  const base = signatureBase(input.components, input.params, parts);
  if (base === null) return { ok: false, code: 'signature_invalid' };
  try {
    const pub = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, ...(jwk.y ? { y: jwk.y } : {}) }, format: 'jwk' });
    const sig = Buffer.from(sigMatch[1]!, 'base64');
    const good = verify(isEc ? 'sha256' : null, Buffer.from(base), isEc ? { key: pub, dsaEncoding: 'ieee-p1363' } : pub, sig);
    return good ? { ok: true, kid: jwk.kid } : { ok: false, code: 'signature_invalid' };
  } catch (e) {
    // A key that does not import, or a signature of the wrong length, is an invalid signature.
    logger.warn('ucp: a signature could not be checked', { kid: jwk.kid, error: String(e) });
    return { ok: false, code: 'signature_invalid' };
  }
}
