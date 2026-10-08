/**
 * @file src/services/ucp/ucp-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The keys this node signs Universal Commerce Protocol messages with, and publishes in
 *   its business profile (`keys[]` in /.well-known/ucp).
 *
 *   ES256 IS THE KEY THAT SIGNS. UCP 2026-08-25 makes ES256 (P-256) the one algorithm every
 *   verifier MUST support; Ed25519 is optional for them (docs/specification/signatures.md). The
 *   node's own key is Ed25519, so the P-256 key is DERIVED from it: HMAC-SHA256 of the node's
 *   private key under a fixed label gives the private scalar. Nothing new is stored, the key is
 *   stable across restarts, and it changes exactly when the node key does. The Ed25519 key is
 *   published beside it, unchanged, for a verifier that prefers it.
 *
 *   `kid` is the RFC 7638 JWK thumbprint of the public key, which Web Bot Auth verifiers expect and
 *   UCP verifiers accept.
 * @structure UcpSigningKey · ucpSigningKey · ucpPublicKeys · jwkThumbprint · resetUcpKeyCache (tests)
 * @usage const key = await ucpSigningKey(storage); sign(..., key.privateKey)
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E: the own UCP checkout).
 */
import { createECDH, createHash, createHmac, createPrivateKey, type KeyObject } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';

export interface PublicJwk {
  kty: string; crv: string; x: string; y?: string; kid: string; use: 'sig'; alg: string;
}

export interface UcpSigningKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: PublicJwk;
}

/** The order of the P-256 group: a private scalar must lie in [1, n-1]. */
const P256_N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const LABEL = 'aimeat-ucp-es256/v1';

const b64u = (buf: Buffer): string => buf.toString('base64url');

/** RFC 7638: SHA-256 over the required members, in lexical order, with no whitespace. */
export function jwkThumbprint(jwk: { kty: string; crv: string; x: string; y?: string }): string {
  const members = jwk.kty === 'EC'
    ? `{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`
    : `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return b64u(createHash('sha256').update(members).digest());
}

let cached: { from: string; key: UcpSigningKey } | null = null;

/** Test seam. */
export function resetUcpKeyCache(): void { cached = null; }

/** The P-256 signing key derived from the node key, or null on a node with no key yet. */
export async function ucpSigningKey(storage: Storage): Promise<UcpSigningKey | null> {
  const nodeKey = await storage.getNodeKey();
  if (!nodeKey?.privateKey) return null;
  if (cached && cached.from === nodeKey.publicKey) return cached.key;
  let d: Buffer | null = null;
  for (let counter = 0; counter < 16 && !d; counter++) {
    const candidate = createHmac('sha256', Buffer.from(nodeKey.privateKey, 'base64')).update(`${LABEL}/${counter}`).digest();
    const n = BigInt(`0x${candidate.toString('hex')}`);
    if (n > 0n && n < P256_N) d = candidate;
  }
  if (!d) return null;
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const x = b64u(pub.subarray(1, 33));
  const y = b64u(pub.subarray(33, 65));
  const kid = jwkThumbprint({ kty: 'EC', crv: 'P-256', x, y });
  const privateKey = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x, y, d: b64u(d) }, format: 'jwk' });
  const key: UcpSigningKey = { kid, privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x, y, kid, use: 'sig', alg: 'ES256' } };
  cached = { from: nodeKey.publicKey, key };
  return key;
}

/** The public keys the business profile publishes: the ES256 signing key, then the node's Ed25519 key. */
export async function ucpPublicKeys(storage: Storage): Promise<PublicJwk[]> {
  const out: PublicJwk[] = [];
  const signing = await ucpSigningKey(storage);
  if (signing) out.push(signing.publicJwk);
  const nodeKey = await storage.getNodeKey();
  if (nodeKey?.publicKey) {
    const x = Buffer.from(nodeKey.publicKey, 'base64').toString('base64url');
    out.push({ kty: 'OKP', crv: 'Ed25519', x, kid: jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x }), use: 'sig', alg: 'EdDSA' });
  }
  return out;
}
