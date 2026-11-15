/**
 * @file src/auth/keypair.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Ed25519 keypair primitives (@noble/ed25519) used across the node for signing:
 *   generates base64 keypairs and signs/verifies UTF-8 messages (federation advisories, JWT-adjacent
 *   signatures, personal-node anchoring).
 *
 * @structure
 *   - KeyPair: base64 public/private key pair shape
 *   - generateKeyPair: create a random Ed25519 keypair
 *   - sign: sign a string message with a base64 private key
 *   - verify: verify a base64 signature against a message and base64 public key (false on any error)
 *   - ed25519PublicKeyProblem: why a text is not a usable Ed25519 public key in the encoding verify reads, or null
 *
 * @version-history
 *   2026-11-15 — ed25519PublicKeyProblem: a peer key must be 32 bytes of base64 that decode to a
 *     point on the curve outside the small-order subgroup. A small-order key verifies a forged
 *     signature over any message under the ZIP-215 rules verify uses (audit 2026-11 L056).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import * as ed from '@noble/ed25519';

export interface KeyPair {
  publicKey: string;   // base64
  privateKey: string;  // base64
}

export async function generateKeyPair(): Promise<KeyPair> {
  const privateKeyBytes = ed.utils.randomSecretKey();
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);
  return {
    publicKey: Buffer.from(publicKeyBytes).toString('base64'),
    privateKey: Buffer.from(privateKeyBytes).toString('base64'),
  };
}

export async function sign(privateKeyBase64: string, message: string): Promise<string> {
  const privateKey = Buffer.from(privateKeyBase64, 'base64');
  const msgBytes = new TextEncoder().encode(message);
  const signature = await ed.signAsync(msgBytes, privateKey);
  return Buffer.from(signature).toString('base64');
}

/** Base64 as Buffer.from(x, 'base64') reads it (standard or URL alphabet, padding optional), 32 bytes. */
const BASE64_32_BYTES = /^[A-Za-z0-9+/_-]{43}=?$/;

/**
 * Why `key` is not a usable Ed25519 public key in the encoding `verify` reads (base64 of the raw
 * 32 bytes), or null when it is one. Three refusals: not text of that shape; 32 bytes that are not a
 * point on the curve, which can never verify anything; and a small-order point, which under ZIP-215
 * (verify's default) verifies a forged signature over ANY message, so a peer admitted under it would
 * have every forged federation message from anyone accepted as its own.
 */
export function ed25519PublicKeyProblem(key: unknown): string | null {
  if (typeof key !== 'string' || !BASE64_32_BYTES.test(key)) {
    return 'The key must be an Ed25519 public key: the 32 raw bytes in base64 (44 characters), as a node publishes it at /.well-known/aimeat.';
  }
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) {
    return 'The key must be an Ed25519 public key: the 32 raw bytes in base64 (44 characters), as a node publishes it at /.well-known/aimeat.';
  }
  let point: ed.Point;
  try {
    point = ed.Point.fromBytes(bytes, true);
  } catch (err) {
    // The decode failure is the answer, and the refusal carries its text.
    return `These 32 bytes are not an Ed25519 public key (they are not a point on the curve: ${err instanceof Error ? err.message : String(err)}), so no signature could ever be checked against them.`;
  }
  if (point.isSmallOrder()) {
    return 'This is a weak Ed25519 key (a small-order point) that a forged signature passes for, so it cannot identify a node.';
  }
  return null;
}

export async function verify(publicKeyBase64: string, message: string, signatureBase64: string): Promise<boolean> {
  try {
    const publicKey = Buffer.from(publicKeyBase64, 'base64');
    const msgBytes = new TextEncoder().encode(message);
    const signature = Buffer.from(signatureBase64, 'base64');
    return await ed.verifyAsync(signature, msgBytes, publicKey);
  } catch {
    // Fail-closed by design: a malformed key or signature means the signature does NOT verify.
    // Logging every bad signature on a public endpoint is a flooding vector.
    // eslint-disable-next-line aimeat/no-silent-catch -- false here means "did not verify"
    return false;
  }
}
