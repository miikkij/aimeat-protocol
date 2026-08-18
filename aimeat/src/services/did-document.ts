/**
 * @file did-document.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description DID Document generation for the node's did:web identifier.
 *   Serves at /.well-known/did.json per the did:web specification.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import type { JWK } from 'jose';

export interface DidDocument {
  '@context': string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyJwk: JWK;
  }>;
  authentication: string[];
  assertionMethod: string[];
}

export interface DidDocumentService {
  getDocument(): DidDocument;
}

export function createDidDocumentService(
  issuerDid: string,
  publicJwk: JWK,
): DidDocumentService {
  const keyId = `${issuerDid}#key-1`;

  const document: DidDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/jwk/v1',
    ],
    id: issuerDid,
    verificationMethod: [{
      id: keyId,
      type: 'JsonWebKey',
      controller: issuerDid,
      publicKeyJwk: publicJwk,
    }],
    authentication: [keyId],
    assertionMethod: [keyId],
  };

  return {
    getDocument(): DidDocument {
      return document;
    },
  };
}
