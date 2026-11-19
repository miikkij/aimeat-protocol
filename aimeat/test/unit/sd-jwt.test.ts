/**
 * @file sd-jwt.test.ts
 * @description Unit tests for SD-JWT decode and cryptographic verification
 * @version-history
 *   v1.1.0 — 2026-11-19 — The issuer signature's algorithm: HS256 and a mismatch with the key's alg are refused.
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as jose from 'jose';
import { createSdJwtVerifier } from '../../src/services/sd-jwt.js';
import { generateTestKeyPair, createTestSdJwt, type TestKeyPair } from '../helpers/test-sd-jwt.js';
import type { SdJwtVerifier } from '../../src/services/sd-jwt.js';

let verifier: SdJwtVerifier;
let eddsaKeyPair: TestKeyPair;
let es256KeyPair: TestKeyPair;
const ISSUER = 'https://trusted-issuer.example.com';

beforeAll(async () => {
  verifier = createSdJwtVerifier();
  eddsaKeyPair = await generateTestKeyPair('EdDSA');
  es256KeyPair = await generateTestKeyPair('ES256');
});

describe('SD-JWT Verifier', () => {
  it('verifies a valid EdDSA-signed SD-JWT', async () => {
    const keys = new Map<string, JsonWebKey>([[ISSUER, eddsaKeyPair.publicJwk]]);
    const token = await createTestSdJwt(
      { given_name: 'Alice', family_name: 'Smith', birthdate: '1990-01-01' },
      ISSUER,
      eddsaKeyPair,
    );
    const result = await verifier.verify(token, keys);
    expect(result.valid).toBe(true);
    expect(result.issuer).toBe(ISSUER);
    expect(result.disclosedClaims?.given_name).toBe('Alice');
    expect(result.disclosedClaims?.family_name).toBe('Smith');
    expect(result.disclosedClaims?.birthdate).toBe('1990-01-01');
  });

  it('verifies a valid ES256-signed SD-JWT', async () => {
    const keys = new Map<string, JsonWebKey>([[ISSUER, es256KeyPair.publicJwk]]);
    const token = await createTestSdJwt(
      { given_name: 'Bob' },
      ISSUER,
      es256KeyPair,
      { alg: 'ES256' },
    );
    const result = await verifier.verify(token, keys);
    expect(result.valid).toBe(true);
    expect(result.disclosedClaims?.given_name).toBe('Bob');
  });

  it('rejects invalid SD-JWT format', async () => {
    const keys = new Map<string, JsonWebKey>();
    const result = await verifier.verify('not-a-valid-token', keys);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('rejects token from untrusted issuer', async () => {
    const keys = new Map<string, JsonWebKey>();
    const token = await createTestSdJwt({ given_name: 'Eve' }, ISSUER, eddsaKeyPair);
    const result = await verifier.verify(token, keys);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Untrusted issuer');
  });

  it('refuses an issuer signature algorithm the token picks for itself (HS256 with the public key as secret)', async () => {
    const keys = new Map<string, JsonWebKey>([[ISSUER, es256KeyPair.publicJwk]]);
    const secret = new TextEncoder().encode(JSON.stringify(es256KeyPair.publicJwk));
    const jwt = await new jose.SignJWT({ iss: ISSUER, given_name: 'Eve' }).setProtectedHeader({ alg: 'HS256', typ: 'vc+sd-jwt' }).sign(secret);
    const result = await verifier.verify(`${jwt}~`, keys);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Issuer signature algorithm not accepted: HS256');
  });

  it('refuses a token whose algorithm differs from the one the trusted key names', async () => {
    const keys = new Map<string, JsonWebKey>([[ISSUER, { ...eddsaKeyPair.publicJwk, alg: 'ES256' }]]);
    const token = await createTestSdJwt({ given_name: 'Eve' }, ISSUER, eddsaKeyPair);
    const result = await verifier.verify(token, keys);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Issuer signature algorithm not accepted: EdDSA');
  });

  it('rejects token with wrong key', async () => {
    const wrongKeyPair = await generateTestKeyPair('EdDSA');
    const keys = new Map<string, JsonWebKey>([[ISSUER, wrongKeyPair.publicJwk]]);
    const token = await createTestSdJwt({ given_name: 'Eve' }, ISSUER, eddsaKeyPair);
    const result = await verifier.verify(token, keys);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Signature verification failed');
  });

  it('rejects token with missing issuer', async () => {
    const keys = new Map<string, JsonWebKey>();
    const token = await createTestSdJwt({ given_name: 'Alice' }, '', eddsaKeyPair);
    const result = await verifier.verify(token, keys);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Missing issuer in SD-JWT');
  });
});
