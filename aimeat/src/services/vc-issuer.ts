/**
 * @file vc-issuer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description W3C Verifiable Credential issuer service. Issues AIMEATIdentityCredential
 *   as unsigned JSON or signed vc+ld+jwt using the node's Ed25519 keypair.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial unsigned JSON implementation
 *   v2.0.0 — 2026-05-02 — Add JWT signing with Ed25519
 *   v2.1.0 — 2026-10-11 — The credential's context is https://aimeat.io/ns/credentials/v1, the node's
 *     own namespace, served at /ns/credentials/v1 (services/vc-context.ts); it was a host this
 *     project does not serve. verifyIdentityCredential accepts both the new and the old context.
 */

import { SignJWT, importJWK, jwtVerify, type JWK } from 'jose';
import type { AimeatConfig } from '../config.js';
import type { GHIIRecord } from '../storage/interface.js';
import { ACCEPTED_CREDENTIALS_CONTEXTS, CREDENTIALS_CONTEXT, W3C_CREDENTIALS_CONTEXT } from './vc-context.js';

export interface VerifiableCredential {
  '@context': string[];
  type: string[];
  issuer: string;
  issuanceDate: string;
  credentialSubject: Record<string, unknown>;
}

export interface VcIssuerService {
  issueIdentityCredential(ghiiRecord: GHIIRecord): VerifiableCredential;
  issueSignedCredential(ghiiRecord: GHIIRecord): Promise<string>;
  /**
   * Check a signed credential this node issued: its signature against the node key, the issuer, the
   * type, and a context this node issues now or issued before (services/vc-context.ts). Returns the
   * credential, or throws with the reason.
   */
  verifyIdentityCredential(jwt: string): Promise<VerifiableCredential>;
  getIssuerDid(): string;
  getPublicJwk(): Promise<JWK>;
  setNodeKeyPair(kp: { publicKey: string; privateKey: string }): void;
}

export function createVcIssuerService(
  config: AimeatConfig,
  initialNodeKeyPair: { publicKey: string; privateKey: string } | null = null,
): VcIssuerService {
  const issuerDid = config.vcIssuerDid || `did:web:${config.nodeId}.aimeat.example`;
  let nodeKeyPair = initialNodeKeyPair;

  function buildCredentialPayload(ghiiRecord: GHIIRecord): VerifiableCredential {
    return {
      '@context': [W3C_CREDENTIALS_CONTEXT, CREDENTIALS_CONTEXT],
      type: ['VerifiableCredential', 'AIMEATIdentityCredential'],
      issuer: issuerDid,
      issuanceDate: new Date().toISOString(),
      credentialSubject: {
        id: `did:aimeat:${ghiiRecord.ghii}`,
        type: 'AIMEATUser',
        verificationLevel: ghiiRecord.verificationLevel,
        memberSince: ghiiRecord.createdAt.split('T')[0],
        displayName: ghiiRecord.displayName,
      },
    };
  }

  async function getPrivateKey() {
    if (!nodeKeyPair) throw new Error('Node keypair not available for VC signing');
    const privateKeyBytes = Buffer.from(nodeKeyPair.privateKey, 'base64');
    const publicKeyBytes = Buffer.from(nodeKeyPair.publicKey, 'base64');
    const jwk = {
      kty: 'OKP' as const,
      crv: 'Ed25519' as const,
      x: Buffer.from(publicKeyBytes).toString('base64url'),
      d: Buffer.from(privateKeyBytes).toString('base64url'),
    };
    return importJWK(jwk, 'EdDSA');
  }

  return {
    issueIdentityCredential(ghiiRecord: GHIIRecord): VerifiableCredential {
      return buildCredentialPayload(ghiiRecord);
    },

    async issueSignedCredential(ghiiRecord: GHIIRecord): Promise<string> {
      const credential = buildCredentialPayload(ghiiRecord);
      const privateKey = await getPrivateKey();

      const now = Math.floor(Date.now() / 1000);
      const validityDays = 365;

      return new SignJWT({ vc: credential })
        .setProtectedHeader({
          alg: 'EdDSA',
          typ: 'vc+ld+jwt',
          kid: `${issuerDid}#key-1`,
        })
        .setIssuer(issuerDid)
        .setSubject(`did:aimeat:${ghiiRecord.ghii}`)
        .setNotBefore(now)
        .setExpirationTime(now + validityDays * 86400)
        .setIssuedAt(now)
        .sign(privateKey);
    },

    async verifyIdentityCredential(jwt: string): Promise<VerifiableCredential> {
      if (!nodeKeyPair) throw new Error('Node keypair not available for VC verification');
      const publicKey = await importJWK({
        kty: 'OKP', crv: 'Ed25519', x: Buffer.from(nodeKeyPair.publicKey, 'base64').toString('base64url'),
      }, 'EdDSA');
      const { payload } = await jwtVerify(jwt, publicKey, { issuer: issuerDid, typ: 'vc+ld+jwt', algorithms: ['EdDSA'] });
      const vc = payload.vc as VerifiableCredential | undefined;
      const context = Array.isArray(vc?.['@context']) ? vc['@context'] : [];
      if (context[0] !== W3C_CREDENTIALS_CONTEXT || context.length !== 2 || !ACCEPTED_CREDENTIALS_CONTEXTS.includes(context[1] as string)) {
        throw new Error(`Credential context is not one this node issues: ${JSON.stringify(context)}`);
      }
      if (!vc!.type?.includes('AIMEATIdentityCredential')) throw new Error('Not an AIMEAT identity credential');
      return vc!;
    },

    getIssuerDid(): string {
      return issuerDid;
    },

    async getPublicJwk(): Promise<JWK> {
      if (!nodeKeyPair) throw new Error('Node keypair not available');
      const publicKeyBytes = Buffer.from(nodeKeyPair.publicKey, 'base64');
      return {
        kty: 'OKP',
        crv: 'Ed25519',
        x: Buffer.from(publicKeyBytes).toString('base64url'),
      };
    },

    setNodeKeyPair(kp: { publicKey: string; privateKey: string }): void {
      nodeKeyPair = kp;
    },
  };
}
