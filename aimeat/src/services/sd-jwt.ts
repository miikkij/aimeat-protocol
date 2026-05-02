/**
 * @file sd-jwt.ts
 * @description SD-JWT decode and cryptographic signature verification for EUDIW VP tokens.
 *   Uses @sd-jwt/decode for token parsing and jose for signature validation.
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import { decodeSdJwt } from '@sd-jwt/decode';
import type { Hasher } from '@sd-jwt/types';
import { Disclosure } from '@sd-jwt/utils';
import * as jose from 'jose';
import type { JWK } from 'jose';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface SdJwtVerificationResult {
  valid: boolean;
  payload?: Record<string, unknown>;
  disclosedClaims?: Record<string, unknown>;
  issuer?: string;
  keyBinding?: boolean;
  error?: string;
}

export interface SdJwtVerifier {
  verify(sdJwtToken: string, trustedIssuerKeys: Map<string, JWK>): Promise<SdJwtVerificationResult>;
}

const sha256Hasher: Hasher = (data: string | ArrayBuffer, _alg: string): Uint8Array => {
  const input = typeof data === 'string' ? data : Buffer.from(data);
  return new Uint8Array(createHash('sha256').update(input).digest());
};

export function createSdJwtVerifier(): SdJwtVerifier {
  return {
    async verify(sdJwtToken: string, trustedIssuerKeys: Map<string, JWK>): Promise<SdJwtVerificationResult> {
      try {
        // 1. Decode the SD-JWT
        let decoded: Awaited<ReturnType<typeof decodeSdJwt>>;
        try {
          decoded = await decodeSdJwt(sdJwtToken, sha256Hasher);
        } catch {
          return { valid: false, error: 'Invalid SD-JWT format' };
        }

        const payload = decoded.jwt.payload as Record<string, unknown>;
        const header = decoded.jwt.header as Record<string, unknown>;

        // 2. Extract issuer
        const issuer = (payload.iss as string) ?? '';
        if (!issuer) {
          return { valid: false, error: 'Missing issuer in SD-JWT' };
        }

        // 3. Look up trusted issuer key
        const issuerJwk = trustedIssuerKeys.get(issuer);
        if (!issuerJwk) {
          return { valid: false, error: 'Untrusted issuer' };
        }

        // 4. Verify the issuer signature on the JWT portion
        const alg = (header.alg as string) ?? 'ES256';
        try {
          const publicKey = await jose.importJWK(issuerJwk, alg);
          const jwtPart = sdJwtToken.split('~')[0];
          await jose.jwtVerify(jwtPart, publicKey, { algorithms: [alg] });
        } catch (err) {
          return { valid: false, error: `Signature verification failed: ${String(err)}` };
        }

        // 5. Check expiry
        const exp = payload.exp as number | undefined;
        if (exp && exp * 1000 < Date.now()) {
          return { valid: false, error: 'Credential expired' };
        }

        // 6. Reconstruct disclosed claims
        const disclosedClaims: Record<string, unknown> = {};

        for (const disclosure of (decoded.disclosures ?? []) as Disclosure[]) {
          if (disclosure.key) {
            disclosedClaims[disclosure.key] = disclosure.value;
          }
        }

        // Include direct payload claims (non-selective)
        const vc = payload.vc as Record<string, unknown> | undefined;
        const subject = (vc?.credentialSubject ?? payload.credentialSubject ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(subject)) {
          if (key !== 'id' && key !== 'type' && key !== '_sd' && key !== '_sd_alg') {
            if (!(key in disclosedClaims)) {
              disclosedClaims[key] = value;
            }
          }
        }

        return {
          valid: true,
          payload,
          disclosedClaims,
          issuer,
          keyBinding: !!decoded.kbJwt,
        };
      } catch (err) {
        logger.error('SD-JWT verification failed', { error: String(err) });
        return { valid: false, error: 'Verification failed' };
      }
    },
  };
}
