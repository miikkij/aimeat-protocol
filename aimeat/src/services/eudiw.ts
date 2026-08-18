/**
 * @file eudiw.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EUDIW (EU Digital Identity Wallet) service for OpenID4VP verification.
 *   Generates authorization requests and verifies VP tokens using real SD-JWT
 *   cryptographic verification against trusted issuer public keys.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial scaffold implementation
 *   v2.0.0 — 2026-05-02 — Real SD-JWT cryptographic verification
 */

import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, TrustedIssuerRecord } from '../storage/interface.js';
import type { SdJwtVerifier } from './sd-jwt.js';
import type { JWK } from 'jose';
import { logger } from '../utils/logger.js';

export interface EudiwVerificationResult {
  valid: boolean;
  attributes?: Record<string, unknown>;
  issuer?: string;
  error?: string;
}

export interface EudiwService {
  readonly enabled: boolean;
  generateAuthorizationRequest(state: string): Record<string, unknown>;
  verifyPresentation(vpToken: string, presentationSubmission: Record<string, unknown>): Promise<EudiwVerificationResult>;
}

function buildIssuerKeyMap(issuers: TrustedIssuerRecord[]): Map<string, JWK> {
  const map = new Map<string, JWK>();
  for (const issuer of issuers) {
    if (!issuer.trusted) continue;
    try {
      const jwk = JSON.parse(issuer.publicKey) as JWK;
      map.set(issuer.url, jwk);
    } catch {
      logger.warn(`Trusted issuer ${issuer.name} has invalid JWK in publicKey field`);
    }
  }
  return map;
}

function extractIdentityAttributes(claims?: Record<string, unknown>): Record<string, unknown> {
  if (!claims) return {};
  const attributes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(claims)) {
    if (key !== 'id' && key !== 'type') {
      attributes[key] = value;
    }
  }
  return attributes;
}

export function createEudiwService(
  config: AimeatConfig,
  storage: Storage,
  sdJwtVerifier: SdJwtVerifier,
): EudiwService {
  return {
    get enabled() { return config.eudiwEnabled; },

    generateAuthorizationRequest(state: string) {
      return {
        response_type: 'vp_token',
        response_mode: 'direct_post',
        client_id: config.eudiwClientId,
        redirect_uri: config.eudiwRedirectUri || `${config.baseUrl}/v1/ghii/verify/eudiw/callback`,
        state,
        nonce: randomUUID(),
        presentation_definition: {
          id: 'aimeat-identity-verification',
          input_descriptors: [{
            id: 'identity-credential',
            format: { 'vc+sd-jwt': { alg: ['ES256', 'EdDSA'] } },
            constraints: {
              fields: [
                { path: ['$.vc.credentialSubject.given_name'], purpose: 'Identity verification' },
                { path: ['$.vc.credentialSubject.family_name'], purpose: 'Identity verification' },
                { path: ['$.vc.credentialSubject.birthdate'], purpose: 'Age verification' },
                { path: ['$.vc.credentialSubject.nationality'], purpose: 'Nationality' },
              ],
            },
          }],
        },
      };
    },

    async verifyPresentation(vpToken: string, _presentationSubmission: Record<string, unknown>): Promise<EudiwVerificationResult> {
      try {
        const issuers = await storage.listTrustedIssuers({ type: 'eudiw' });
        const keyMap = buildIssuerKeyMap(issuers);

        const result = await sdJwtVerifier.verify(vpToken, keyMap);
        if (!result.valid) {
          return { valid: false, error: result.error };
        }

        const attributes = extractIdentityAttributes(result.disclosedClaims);
        return { valid: true, attributes, issuer: result.issuer };
      } catch (err) {
        logger.error('EUDIW verification failed', { error: String(err) });
        return { valid: false, error: 'Verification failed' };
      }
    },
  };
}
