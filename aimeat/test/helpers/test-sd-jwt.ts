/**
 * @file test-sd-jwt.ts
 * @description Test helper for creating signed SD-JWT tokens with known keys.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial helper
 */

import * as jose from 'jose';

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

  const payload: Record<string, unknown> = {
    iss: issuer,
    iat: now,
    exp,
    vc: {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      credentialSubject: {
        id: 'did:example:subject',
        type: 'Person',
        ...claims,
      },
    },
  };

  const jwt = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg, typ: 'vc+sd-jwt' })
    .sign(keyPair.privateKey);

  // Build disclosure entries for specified keys
  const disclosures: string[] = [];
  const disclosedKeys = opts.disclosedKeys ?? Object.keys(claims);
  for (const key of disclosedKeys) {
    if (key in claims) {
      const salt = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));
      const disclosure = jose.base64url.encode(
        new TextEncoder().encode(JSON.stringify([salt, key, claims[key]]))
      );
      disclosures.push(disclosure);
    }
  }

  // SD-JWT format: <jwt>~<disclosure1>~<disclosure2>~
  return jwt + '~' + disclosures.join('~') + '~';
}
