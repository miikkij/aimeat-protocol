/**
 * @file src/auth/keypair.ts
 * @description Ed25519 keypair primitives (@noble/ed25519) used across the node for signing:
 *   generates base64 keypairs and signs/verifies UTF-8 messages (federation advisories, JWT-adjacent
 *   signatures, personal-node anchoring).
 *
 * @structure
 *   - KeyPair: base64 public/private key pair shape
 *   - generateKeyPair: create a random Ed25519 keypair
 *   - sign: sign a string message with a base64 private key
 *   - verify: verify a base64 signature against a message and base64 public key (false on any error)
 *
 * @version-history
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
