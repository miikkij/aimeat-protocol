/**
 * @file did-document.test.ts
 * @description Unit tests for DID Document generation
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial test suite
 */

import { describe, it, expect } from 'vitest';
import { createDidDocumentService } from '../../src/services/did-document.js';
import type { JWK } from 'jose';

const TEST_DID = 'did:web:test-node-001.aimeat.example';
const TEST_JWK: JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'test-base64url-public-key',
};

describe('DID Document Service', () => {
  it('returns a valid DID Document structure', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc['@context']).toContain('https://w3id.org/security/jwk/v1');
    expect(doc.id).toBe(TEST_DID);
  });

  it('contains one verification method with the correct key', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    expect(doc.verificationMethod).toHaveLength(1);
    const vm = doc.verificationMethod[0];
    expect(vm.id).toBe(`${TEST_DID}#key-1`);
    expect(vm.type).toBe('JsonWebKey');
    expect(vm.controller).toBe(TEST_DID);
    expect(vm.publicKeyJwk).toEqual(TEST_JWK);
  });

  it('references the key in authentication and assertionMethod', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    expect(doc.authentication).toContain(`${TEST_DID}#key-1`);
    expect(doc.assertionMethod).toContain(`${TEST_DID}#key-1`);
  });

  it('does not include private key material', () => {
    const service = createDidDocumentService(TEST_DID, TEST_JWK);
    const doc = service.getDocument();
    const jwk = doc.verificationMethod[0].publicKeyJwk;
    expect(jwk.d).toBeUndefined();
  });

  it('uses custom DID when provided', () => {
    const customDid = 'did:web:my-custom-node.example.com';
    const service = createDidDocumentService(customDid, TEST_JWK);
    const doc = service.getDocument();
    expect(doc.id).toBe(customDid);
    expect(doc.verificationMethod[0].id).toBe(`${customDid}#key-1`);
  });
});
