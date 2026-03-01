import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
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

export function createEudiwService(config: AimeatConfig, storage: Storage): EudiwService {
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
        // In a production implementation, this would:
        // 1. Parse the SD-JWT from vpToken
        // 2. Verify the issuer signature against trusted issuers
        // 3. Check credential expiry
        // 4. Extract selectively disclosed attributes

        // For the reference implementation, we validate the structure
        // and check against the trusted issuers list

        // Parse JWT header to extract issuer info
        const parts = vpToken.split('.');
        if (parts.length < 3) {
          return { valid: false, error: 'Invalid VP token format' };
        }

        // Decode payload (simplified — production would verify signatures)
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        } catch {
          return { valid: false, error: 'Invalid VP token payload' };
        }

        const issuer = (payload.iss as string) ?? '';
        if (!issuer) {
          return { valid: false, error: 'Missing issuer in VP token' };
        }

        // Check expiry
        const exp = payload.exp as number | undefined;
        if (exp && exp * 1000 < Date.now()) {
          return { valid: false, error: 'Credential expired' };
        }

        // Check trusted issuer
        const trustedIssuer = await storage.getTrustedIssuerByUrl(issuer);
        if (!trustedIssuer || !trustedIssuer.trusted) {
          return { valid: false, error: 'Untrusted issuer' };
        }

        // Extract credential subject attributes
        const vc = payload.vc as Record<string, unknown> | undefined;
        const subject = (vc?.credentialSubject ?? payload.credentialSubject ?? {}) as Record<string, unknown>;

        const attributes: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(subject)) {
          if (key !== 'id' && key !== 'type') {
            attributes[key] = value;
          }
        }

        return {
          valid: true,
          attributes,
          issuer,
        };
      } catch (err) {
        logger.error('EUDIW verification failed', { error: String(err) });
        return { valid: false, error: 'Verification failed' };
      }
    },
  };
}
