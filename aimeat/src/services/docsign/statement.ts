/**
 * @file src/services/docsign/statement.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an AIMEAT document signature IS, in bytes, so anyone can check one without
 *   this node: the signing intent a device or a key signs, the statement the node seals, and the
 *   checks that prove both.
 *
 *   THREE LAYERS, each checkable on its own:
 *   1. The document: its SHA-256. Whoever holds the file recomputes it.
 *   2. The signer's own act, one of:
 *      - passkey: a WebAuthn assertion whose challenge is the hash of the intent (request id,
 *        document hash, signer, nonce). The credential's public key travels with the signature, so
 *        the assertion re-verifies offline.
 *      - key: an Ed25519 signature with the principal's registered key over
 *        `aimeat-docsign:v1:{request}:{sha256}:{signer}`.
 *      - session: no device or key of the signer's own; the node's seal is the only evidence that
 *        this authenticated principal confirmed. The weakest of the three, and the report says so.
 *   3. The node's seal: an Ed25519 signature with the node key (published at /.well-known/aimeat)
 *      over the canonical statement (document, signer, time, method, assurance, and a hash of the
 *      evidence in 2). It fixes the time and the identity the node vouched for.
 *
 *   An AIMEAT signature is an electronic signature in the eIDAS sense (article 3(10)); with a
 *   passkey and a bank-verified identity it carries most of what an advanced one needs, but it is
 *   not a qualified signature, and nothing here says it is.
 * @structure SignIntent · SealedStatement · intentChallenge · keyMessage · sealStatement ·
 *   verifySeal · evidenceHash · canonicalJson
 * @usage const challenge = intentChallenge(intent);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — Method eudi-wallet (wish-allekirjoitus-eudi-lompakolla).
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../attestation.js';
import { sign, verify } from '../../auth/keypair.js';

export { canonicalJson };

/**
 * `eudi-wallet`: the person signed the PDF in an EU Digital Identity Wallet, which returned it with
 * a PAdES signature of its own (services/docsign/eudi.ts). The evidence names the signed file, the
 * certificate and the validation result; the signed file itself is the stronger proof.
 */
export type SignMethod = 'passkey' | 'key' | 'session' | 'eudi-wallet';

/** What a passkey ceremony signs: its hash is the WebAuthn challenge. */
export interface SignIntent {
  type: 'aimeat-docsign-intent/v1';
  request: string;
  document: string;
  signer: string;
  nonce: string;
}

export interface Assurance {
  /** The signer's identity check on this node: 0 none, 1 email, 2 bank ID or eIDAS, 3 EU wallet. */
  verificationLevel: number;
  /** The device checked the person (PIN, fingerprint, face). Passkey signatures only. */
  userVerified: boolean | null;
  /** The principal kind that signed: a person, an agent, an app. */
  principalKind: 'person' | 'agent' | 'app' | 'ecosystem';
}

/** What the node seals. Canonical JSON of exactly this object is what the seal signature covers. */
export interface SealedStatement {
  type: 'aimeat-docsign/v1';
  node: string;
  request: string;
  title: string;
  document: { sha256: string; name: string; size: number };
  signer: string;
  signerName: string | null;
  signedAt: string;
  method: SignMethod;
  assurance: Assurance;
  /** SHA-256 of the canonical evidence (the passkey assertion or the key signature); null for session. */
  evidence: string | null;
}

export interface Seal {
  alg: 'Ed25519';
  /** The node's public key, base64 (raw 32 bytes): the same value /.well-known/aimeat publishes. */
  publicKey: string;
  signature: string;
}

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** The WebAuthn challenge for an intent: the SHA-256 of its canonical JSON. */
export function intentChallenge(intent: SignIntent): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256').update(canonicalJson(intent)).digest();
  const out = new Uint8Array(new ArrayBuffer(digest.length));
  out.set(digest);
  return out;
}

/** The exact string an Ed25519 key signs. */
export const keyMessage = (request: string, sha256: string, signer: string): string =>
  `aimeat-docsign:v1:${request}:${sha256}:${signer}`;

export const evidenceHash = (evidence: unknown): string | null => (evidence ? sha256Hex(canonicalJson(evidence)) : null);

export async function sealStatement(statement: SealedStatement, nodeKey: { publicKey: string; privateKey: string }): Promise<Seal> {
  return { alg: 'Ed25519', publicKey: nodeKey.publicKey, signature: await sign(nodeKey.privateKey, canonicalJson(statement)) };
}

/** The seal verifies with the key it names. Whether that key is THE node's is the caller's question. */
export async function verifySeal(statement: SealedStatement, seal: Seal): Promise<boolean> {
  try {
    return await verify(seal.publicKey, canonicalJson(statement), seal.signature);
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- a seal whose key or signature will not decode does not verify; false is the answer
    return false;
  }
}
