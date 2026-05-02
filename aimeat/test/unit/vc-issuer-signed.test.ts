/**
 * @file vc-issuer-signed.test.ts
 * @description Unit tests for VC JWT signing and round-trip verification
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createVcIssuerService } from '../../src/services/vc-issuer.js';
import { jwtVerify, importJWK } from 'jose';
import type { AimeatConfig } from '../../src/config.js';
import type { GHIIRecord } from '../../src/storage/interface.js';

let testKeyPair: { publicKey: string; privateKey: string };

beforeAll(async () => {
  const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  testKeyPair = {
    publicKey: Buffer.from(pubJwk.x!, 'base64url').toString('base64'),
    privateKey: Buffer.from(privJwk.d!, 'base64url').toString('base64'),
  };
});

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    nodeId: 'test-node-001',
    vcIssuerDid: 'did:web:test-node-001.aimeat.example',
    ...overrides,
  } as AimeatConfig;
}

function makeGhiiRecord(): GHIIRecord {
  return {
    ghii: 'testuser@test-node-001',
    ownerName: 'testuser',
    displayName: 'Test User',
    verificationLevel: 2,
    createdAt: '2026-01-15T10:00:00Z',
  } as GHIIRecord;
}

describe('VC Issuer -- Signed Credentials', () => {
  it('issues unsigned JSON credential (backward compatible)', () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const credential = service.issueIdentityCredential(makeGhiiRecord());
    expect(credential['@context']).toContain('https://www.w3.org/ns/credentials/v2');
    expect(credential.type).toContain('AIMEATIdentityCredential');
    expect(credential.issuer).toBe('did:web:test-node-001.aimeat.example');
    expect(credential.credentialSubject.displayName).toBe('Test User');
  });

  it('issues signed vc+ld+jwt credential', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwt = await service.issueSignedCredential(makeGhiiRecord());
    expect(typeof jwt).toBe('string');
    expect(jwt.split('.').length).toBe(3);
  });

  it('signed JWT has correct header', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwt = await service.issueSignedCredential(makeGhiiRecord());
    const [headerB64] = jwt.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    expect(header.alg).toBe('EdDSA');
    expect(header.typ).toBe('vc+ld+jwt');
    expect(header.kid).toBe('did:web:test-node-001.aimeat.example#key-1');
  });

  it('signed JWT round-trips: verify with public key', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwt = await service.issueSignedCredential(makeGhiiRecord());
    const publicJwk = await service.getPublicJwk();
    const key = await importJWK(publicJwk, 'EdDSA');
    const { payload } = await jwtVerify(jwt, key, { algorithms: ['EdDSA'] });
    expect(payload.iss).toBe('did:web:test-node-001.aimeat.example');
    expect(payload.sub).toBe('did:aimeat:testuser@test-node-001');
    expect((payload as Record<string, unknown>).vc).toBeDefined();
  });

  it('getIssuerDid returns configured DID', () => {
    const service = createVcIssuerService(makeConfig({ vcIssuerDid: 'did:web:custom.example' } as AimeatConfig), testKeyPair);
    expect(service.getIssuerDid()).toBe('did:web:custom.example');
  });

  it('getPublicJwk returns valid Ed25519 JWK without private key', async () => {
    const service = createVcIssuerService(makeConfig(), testKeyPair);
    const jwk = await service.getPublicJwk();
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
    expect(jwk.x).toBeTruthy();
    expect(jwk.d).toBeUndefined();
  });

  it('throws when node keypair is null', async () => {
    const service = createVcIssuerService(makeConfig());
    await expect(service.issueSignedCredential(makeGhiiRecord())).rejects.toThrow('Node keypair not available');
  });

  it('setNodeKeyPair enables signing on a service created without keypair', async () => {
    const service = createVcIssuerService(makeConfig());
    await expect(service.issueSignedCredential(makeGhiiRecord())).rejects.toThrow();
    service.setNodeKeyPair(testKeyPair);
    const jwt = await service.issueSignedCredential(makeGhiiRecord());
    expect(jwt.split('.').length).toBe(3);
  });
});
