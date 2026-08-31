/**
 * @file src/services/agent-card.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The crypto half of the Agent v2 card: read a compact JWS, verify it against the key
 *   it carries, and publish that key as a JWKS.
 *
 *   TWO VERIFICATIONS THAT LOOK ALIKE AND ARE NOT.
 *     - At ENROLMENT the node has no key yet, so the card is verified against the key INSIDE it.
 *       That proves possession of the private half and nothing else: it says "whoever wrote this
 *       document holds this key", which is exactly what TOFU pinning needs and exactly what it is
 *       worth. The owner's button press is the authority; the signature is the binding.
 *     - AFTERWARDS the node has the pinned key, and that is the one to verify against. Verifying a
 *       later card against its own embedded key again would let anyone with a keypair replace the
 *       agent's identity, which is the whole hole this file exists to keep shut.
 *   `verifyCardJws` therefore takes the expected key explicitly, and the caller says which case it
 *   is in. There is no default, because the default would be the wrong one half the time.
 *
 *   WHY THE RAW JWS IS KEPT. What is served at /v1/agents/:name/card is the exact bytes that were
 *   verified. A re-serialisation of a parse of them is a different document with the same meaning,
 *   and a signature is over bytes.
 *
 * @structure
 *   - jwkThumbprint / ed25519Jwk / jwkFromBase64Key — key shapes
 *   - readCardJws — parse a compact JWS without trusting it
 *   - verifyCardJws — verify against a NAMED key
 *   - buildJwks — the published key set
 * @usage
 *   const read = readCardJws(jws);
 *   const ok = await verifyCardJws(jws, read.card.publicKey);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import { compactVerify, importJWK, calculateJwkThumbprint, decodeProtectedHeader, type JWK } from 'jose';
import { validateAgentCard, type AgentCard, type AgentCardKey, type CardDefect } from '../models/agent-card.js';

/** The RFC 7638 thumbprint of an Ed25519 public key given as raw base64url. */
export async function jwkThumbprint(xBase64Url: string): Promise<string> {
  return calculateJwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: xBase64Url }, 'sha256');
}

/** An Ed25519 verification JWK from the raw public key, base64url. */
export function ed25519Jwk(xBase64Url: string, kid: string): JWK {
  return { kty: 'OKP', crv: 'Ed25519', x: xBase64Url, kid, use: 'sig', alg: 'EdDSA' };
}

/**
 * The base64 an AgentRecord.publicKey holds, as the base64url a JWK wants. Agent and owner keys have
 * been stored base64 since the first release; the JWK encoding is base64url. One conversion, in one
 * place, so no route has to remember which of the two it is holding.
 */
export function base64KeyToJwkX(publicKeyBase64: string): string {
  return Buffer.from(publicKeyBase64, 'base64').toString('base64url');
}

export interface ReadCardResult {
  ok: boolean;
  /** Present only when the JWS parsed AND the payload is a well-formed card. */
  card?: AgentCard;
  /** Everything wrong, in the machine-readable shape the enrolment route returns verbatim. */
  defects: CardDefect[];
  /** The JWS protected header's `kid`, when the header parsed. */
  kid?: string;
}

/**
 * Parse a compact JWS and validate its payload as a card. NOTHING here is trusted: no signature is
 * checked, so the result is "what this document claims", to be verified next.
 */
export function readCardJws(jws: unknown): ReadCardResult {
  if (typeof jws !== 'string' || jws.trim() === '') {
    return { ok: false, defects: [{ field: 'card', reason: 'Required: the card as a compact JWS string.' }] };
  }
  const parts = jws.split('.');
  if (parts.length !== 3) {
    return { ok: false, defects: [{ field: 'card', reason: 'Not a compact JWS: expected three dot-separated segments.' }] };
  }
  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(jws) as { alg?: string; kid?: string };
  } catch {
    // The exception IS the answer: an unreadable header means this is not a card.
    return { ok: false, defects: [{ field: 'card', reason: 'The JWS protected header is not readable.' }] };
  }
  if (header.alg !== 'EdDSA') {
    return { ok: false, defects: [{ field: 'card.alg', reason: 'The JWS must be signed with EdDSA (Ed25519).' }], kid: header.kid };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    // The exception IS the answer: a payload that is not JSON cannot be a card.
    return { ok: false, defects: [{ field: 'card', reason: 'The JWS payload is not JSON.' }], kid: header.kid };
  }
  const validated = validateAgentCard(payload);
  if (!validated.ok) return { ok: false, defects: validated.defects, kid: header.kid };
  if (header.kid && header.kid !== validated.card!.publicKey.kid) {
    return {
      ok: false,
      defects: [{ field: 'card.kid', reason: 'The JWS header names a different key than the card carries.' }],
      kid: header.kid,
    };
  }
  return { ok: true, card: validated.card, defects: [], kid: header.kid };
}

/**
 * Verify a compact JWS against a NAMED Ed25519 key. False on anything at all — a bad signature, a
 * key that will not import, an algorithm that is not EdDSA. A verification failure is not an
 * exceptional condition here; it is one of the two answers, and the caller has a refusal for it.
 */
export async function verifyCardJws(jws: string, key: Pick<AgentCardKey, 'x'>): Promise<boolean> {
  try {
    const publicKey = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: key.x }, 'EdDSA');
    await compactVerify(jws, publicKey, { algorithms: ['EdDSA'] });
    return true;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- false here means "did not verify", which is an answer
    return false;
  }
}

/** The published key set for one agent: exactly the key its card is signed with. */
export function buildJwks(xBase64Url: string, kid: string): { keys: JWK[] } {
  return { keys: [ed25519Jwk(xBase64Url, kid)] };
}
