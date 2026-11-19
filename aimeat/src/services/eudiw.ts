/**
 * @file eudiw.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EUDIW (EU Digital Identity Wallet) service for OpenID4VP verification.
 *   Generates authorization requests and verifies VP tokens using real SD-JWT
 *   cryptographic verification against trusted issuer public keys.
 *
 *   HOLDER BINDING AND REPLAY. verifyPresentation requires a Key Binding JWT signed by the
 *   credential's `cnf.jwk` (services/sd-jwt.ts), compares its `nonce` with the nonce this node put in
 *   its own authorization request and its `aud` with this node's verifier client id, and then spends
 *   the nonce once through services/assertion-spend.ts. A presentation captured in transit or made
 *   for another verifier is refused, and the same presentation is accepted at most once.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial scaffold implementation
 *   v2.0.0 — 2026-05-02 — Real SD-JWT cryptographic verification
 *   v3.0.0 — 2026-11-19 — verifyPresentation takes the expected nonce and client id, verifies with
 *     requireKeyBinding, refuses a nonce or audience mismatch, and spends the nonce with
 *     spendAssertionIdentity so a replayed vp_token is refused. Refusals carry a `code`
 *     (EUDIW_HOLDER_BINDING, EUDIW_NONCE_MISMATCH, EUDIW_AUDIENCE_MISMATCH, EUDIW_REPLAY).
 */

import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, TrustedIssuerRecord } from '../storage/interface.js';
import { KB_JWT_MAX_AGE_SECONDS, KB_JWT_MAX_FUTURE_SECONDS, type SdJwtVerifier } from './sd-jwt.js';
import { spendAssertionIdentity } from './assertion-spend.js';
import type { JWK } from 'jose';
import { logger } from '../utils/logger.js';

/** The refusal codes a route answers 400 with. */
export type EudiwRefusalCode = 'EUDIW_HOLDER_BINDING' | 'EUDIW_NONCE_MISMATCH' | 'EUDIW_AUDIENCE_MISMATCH' | 'EUDIW_REPLAY';

export interface EudiwVerificationResult {
  valid: boolean;
  attributes?: Record<string, unknown>;
  issuer?: string;
  /** Set when the presentation was refused by holder binding, nonce, audience or replay. */
  code?: EudiwRefusalCode;
  error?: string;
}

/** What the presentation must answer: the round's own nonce and this node's verifier client id. */
export interface EudiwPresentationExpectation {
  /** The nonce stored on the verification round (state row) the wallet answers. */
  nonce: string;
  /** The `client_id` this node put in its authorization request (config.eudiwClientId). */
  clientId: string;
}

export interface EudiwService {
  readonly enabled: boolean;
  generateAuthorizationRequest(state: string): Record<string, unknown>;
  verifyPresentation(
    vpToken: string,
    presentationSubmission: Record<string, unknown>,
    expected: EudiwPresentationExpectation,
  ): Promise<EudiwVerificationResult>;
}

/**
 * The `issuer` field of the spend identity: keeps EUDIW nonces apart from agent assertions in the
 * shared spend namespace of services/assertion-spend.ts.
 */
const EUDIW_SPEND_ISSUER = 'eudiw-kb-jwt';

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

    async verifyPresentation(
      vpToken: string,
      _presentationSubmission: Record<string, unknown>,
      expected: EudiwPresentationExpectation,
    ): Promise<EudiwVerificationResult> {
      try {
        // An empty expectation would match an empty claim; sd-jwt.ts already refuses empty claims,
        // and this refuses the caller's side of the comparison.
        if (!expected?.nonce || !expected.clientId) {
          return { valid: false, code: 'EUDIW_NONCE_MISMATCH', error: 'No verification round to answer' };
        }

        const issuers = await storage.listTrustedIssuers({ type: 'eudiw' });
        const keyMap = buildIssuerKeyMap(issuers);

        const result = await sdJwtVerifier.verify(vpToken, keyMap, { requireKeyBinding: true });
        if (!result.valid) {
          return result.failure === 'holder_binding'
            ? { valid: false, code: 'EUDIW_HOLDER_BINDING', error: result.error }
            : { valid: false, error: result.error };
        }
        if (!result.keyBinding || !result.keyBindingNonce || !result.keyBindingAudience || result.keyBindingIssuedAt === undefined) {
          return { valid: false, code: 'EUDIW_HOLDER_BINDING', error: 'Key Binding JWT required' };
        }
        if (result.keyBindingNonce !== expected.nonce) {
          return { valid: false, code: 'EUDIW_NONCE_MISMATCH', error: 'The presentation answers a different request' };
        }
        if (result.keyBindingAudience !== expected.clientId) {
          return { valid: false, code: 'EUDIW_AUDIENCE_MISMATCH', error: 'The presentation was made for another verifier' };
        }

        // Spend the nonce after every signature check, so only the holder of the bound key can burn
        // it. The record lives until the KB-JWT's iat window has closed; after that the iat check
        // refuses the same KB-JWT anyway.
        const spendUntil = result.keyBindingIssuedAt + KB_JWT_MAX_AGE_SECONDS + KB_JWT_MAX_FUTURE_SECONDS;
        const spend = await spendAssertionIdentity(
          storage,
          { issuer: EUDIW_SPEND_ISSUER, audience: expected.clientId, jti: expected.nonce },
          spendUntil,
        );
        if (!spend.ok) {
          return { valid: false, code: 'EUDIW_REPLAY', error: 'This presentation has already been used' };
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
