/**
 * @file test-sd-jwt.ts
 * @description Test helper for creating signed SD-JWT tokens with known keys.
 * @version-history
 *   v1.1.0 — 2026-11-19 — Disclosures are referenced by `_sd` digests in the signed payload and left
 *     out of the plain claims; the verifier now refuses a disclosure the issuer did not sign a digest for.
 *   v1.0.0 — 2026-05-02 — Initial helper
 */

import * as jose from 'jose';
import { createHash } from 'node:crypto';

export interface TestKeyPair {
  publicJwk: JsonWebKey;
  privateKey: CryptoKey;
}

export async function generateTestKeyPair(alg: 'ES256' | 'EdDSA' = 'EdDSA'): Promise<TestKeyPair> {
  const { publicKey, privateKey } = await jose.generateKeyPair(alg);
  const publicJwk = await jose.exportJWK(publicKey);
  return { publicJwk, privateKey };
}

export async function createTestSdJwt(
  claims: Record<string, unknown>,
  issuer: string,
  keyPair: TestKeyPair,
  opts: {
    alg?: 'ES256' | 'EdDSA';
    expiresInSeconds?: number;
    disclosedKeys?: string[];
  } = {},
): Promise<string> {
  const alg = opts.alg ?? 'EdDSA';
  const now = Math.floor(Date.now() / 1000);
  const exp = opts.expiresInSeconds ? now + opts.expiresInSeconds : now + 3600;

  // Disclosures for the selectively disclosable keys; their digests go into the signed payload's
  // `_sd`, and the keys are left out of the plain claims, as an issuer does (SD-JWT §4.2).
  const disclosedKeys = (opts.disclosedKeys ?? Object.keys(claims)).filter((key) => key in claims);
  const disclosures = disclosedKeys.map((key) => {
    const salt = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));
    return jose.base64url.encode(new TextEncoder().encode(JSON.stringify([salt, key, claims[key]])));
  });
  const digests = disclosures.map((d) => createHash('sha256').update(d, 'ascii').digest('base64url'));
  const plainClaims = Object.fromEntries(Object.entries(claims).filter(([key]) => !disclosedKeys.includes(key)));

  const payload: Record<string, unknown> = {
    iss: issuer,
    iat: now,
    exp,
    _sd_alg: 'sha-256',
    vc: {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      credentialSubject: {
        id: 'did:example:subject',
        type: 'Person',
        ...plainClaims,
        _sd: digests,
      },
    },
  };

  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg, typ: 'vc+sd-jwt' })
    .sign(keyPair.privateKey);

  // SD-JWT format: <jwt>~<disclosure1>~<disclosure2>~
  return jwt + '~' + disclosures.join('~') + '~';
}
