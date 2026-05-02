/**
 * @file vc-issuer.ts
 * @description W3C Verifiable Credential issuer service. Issues AIMEATIdentityCredential
 *   as unsigned JSON or signed vc+ld+jwt using the node's Ed25519 keypair.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial unsigned JSON implementation
 *   v2.0.0 — 2026-05-02 — Add JWT signing with Ed25519
 */

import { SignJWT, importJWK, type JWK } from 'jose';
import type { AimeatConfig } from '../config.js';
import type { GHIIRecord } from '../storage/interface.js';

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
      '@context': [
        'https://www.w3.org/ns/credentials/v2',
        'https://aimeat.spechops.com/ns/credentials/v1',
      ],
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
