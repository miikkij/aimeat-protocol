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
}

export function createVcIssuerService(config: AimeatConfig): VcIssuerService {
  const issuerDid = config.vcIssuerDid || `did:web:${config.nodeId}.aimeat.example`;

  return {
    issueIdentityCredential(ghiiRecord: GHIIRecord): VerifiableCredential {
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
    },
  };
}
