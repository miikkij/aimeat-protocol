/**
 * @file sd-jwt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SD-JWT decode and cryptographic signature verification for EUDIW VP tokens.
 *   Uses @sd-jwt/core for token parsing and jose for signature validation.
 *
 *   WHAT A VALID RESULT MEANS. The issuer-signed JWT verifies against a trusted issuer key and is
 *   unexpired; every disclosure is referenced by a digest in that signed payload (an unreferenced
 *   disclosure is a claim the holder wrote, not the issuer); and, when a Key Binding JWT is present
 *   or `requireKeyBinding` is set, the KB-JWT (draft-ietf-oauth-selective-disclosure-jwt §4.3) is
 *   signed by the key in the credential's `cnf.jwk`, has typ `kb+jwt`, a fresh `iat`, a `nonce`, an
 *   `aud`, and an `sd_hash` over exactly the presented issuer JWT and disclosures.
 *
 *   WHAT IT LEAVES TO THE CALLER. The KB-JWT's `nonce` and `aud` are returned, not compared: the
 *   expected values belong to the verifier's own request (services/eudiw.ts compares them and spends
 *   the nonce).
 * @version-history
 *   v1.2.1 — 2026-11-19 — The issuer signature's algorithm is held to the asymmetric list and to the
 *     trusted key's own `alg`; the token header no longer chooses it (finding f-2026aug-crypto-secrets-3).
 *   v1.2.0 — 2026-11-19 — Key Binding JWT verified against `cnf.jwk` (typ, iat window, nonce, aud,
 *     sd_hash); `requireKeyBinding` option; `keyBinding` is true only for a verified KB-JWT and the
 *     result carries its nonce, aud and iat. Disclosures must be referenced by a digest in the signed
 *     payload (`unpack` from @sd-jwt/core): before, any disclosure appended by the presenter was
 *     returned as a disclosed claim. Only `_sd_alg` sha-256 is accepted, the one hasher here.
 *   v1.1.0 — 2026-08-31 — @sd-jwt/decode, /types and /utils were deprecated upstream and merged
 *     into @sd-jwt/core 0.20. Same three names, one import; nothing about the decoding changed.
 *   v1.0.0 — 2026-05-02 — Initial implementation
 */

import { decodeSdJwt, unpack, Disclosure, type Hasher } from '@sd-jwt/core';
import * as jose from 'jose';
import type { JWK } from 'jose';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface SdJwtVerificationResult {
  valid: boolean;
  payload?: Record<string, unknown>;
  disclosedClaims?: Record<string, unknown>;
  issuer?: string;
  /** True only when a Key Binding JWT was present and passed every check in verifyKeyBinding. */
  keyBinding?: boolean;
  /** The verified KB-JWT's `nonce` claim; the caller compares it with the nonce it issued. */
  keyBindingNonce?: string;
  /** The verified KB-JWT's `aud` claim; the caller compares it with its own client id. */
  keyBindingAudience?: string;
  /** The verified KB-JWT's `iat`, epoch seconds. */
  keyBindingIssuedAt?: number;
  /** Set on a refusal caused by the Key Binding JWT (missing, unsigned by `cnf.jwk`, stale, bad sd_hash). */
  failure?: 'holder_binding';
  error?: string;
}

export interface SdJwtVerifyOptions {
  /** Refuse a presentation that carries no Key Binding JWT. Default false. */
  requireKeyBinding?: boolean;
}

export interface SdJwtVerifier {
  verify(sdJwtToken: string, trustedIssuerKeys: Map<string, JWK>, options?: SdJwtVerifyOptions): Promise<SdJwtVerificationResult>;
}

/** How old a KB-JWT's `iat` may be, in seconds. */
export const KB_JWT_MAX_AGE_SECONDS = 300;
/** How far a KB-JWT's `iat` may lie in the future (clock skew), in seconds. */
export const KB_JWT_MAX_FUTURE_SECONDS = 60;

/** Asymmetric JWS algorithms a holder key may sign a KB-JWT with. `none` and HMAC are excluded. */
const KB_JWT_ALGORITHMS = ['ES256', 'ES384', 'ES512', 'EdDSA', 'Ed25519', 'PS256', 'PS384', 'PS512', 'RS256', 'RS384', 'RS512'];

const sha256Hasher: Hasher = (data: string | ArrayBuffer, _alg: string): Uint8Array => {
  const input = typeof data === 'string' ? data : Buffer.from(data);
  return new Uint8Array(createHash('sha256').update(input).digest());
};

type KeyBindingCheck =
  | { ok: true; nonce: string; aud: string; iat: number }
  | { ok: false; error: string };

/**
 * Verify a Key Binding JWT (draft-ietf-oauth-selective-disclosure-jwt §4.3, §7.3).
 *
 * @param kbJwt the compact KB-JWT, the last `~`-separated segment of the presentation
 * @param presented the presentation up to and including the `~` before the KB-JWT; `sd_hash` is
 *   computed over these exact ASCII bytes
 * @param payload the verified issuer JWT payload, which carries the holder key in `cnf.jwk`
 */
async function verifyKeyBinding(kbJwt: string, presented: string, payload: Record<string, unknown>): Promise<KeyBindingCheck> {
  const cnf = payload.cnf as { jwk?: unknown } | undefined;
  const holderJwk = cnf && typeof cnf === 'object' ? cnf.jwk : undefined;
  if (!holderJwk || typeof holderJwk !== 'object' || Array.isArray(holderJwk)) {
    return { ok: false, error: 'Credential has no cnf.jwk holder key' };
  }
  const jwk = holderJwk as JWK;
  if (jwk.kty === 'oct' || 'd' in jwk) {
    return { ok: false, error: 'cnf.jwk is not a public asymmetric key' };
  }

  let header: jose.ProtectedHeaderParameters;
  try {
    header = jose.decodeProtectedHeader(kbJwt);
  } catch {
    return { ok: false, error: 'Key Binding JWT is not a JWS' };
  }
  const alg = header.alg ?? '';
  if (!KB_JWT_ALGORITHMS.includes(alg)) {
    return { ok: false, error: `Key Binding JWT algorithm not accepted: ${alg || 'none'}` };
  }

  let kbPayload: jose.JWTPayload;
  try {
    const holderKey = await jose.importJWK(jwk, alg);
    const verified = await jose.jwtVerify(kbJwt, holderKey, { algorithms: [alg], typ: 'kb+jwt' });
    kbPayload = verified.payload;
  } catch (err) {
    return { ok: false, error: `Key Binding JWT not signed by the credential's holder key: ${String(err)}` };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const { iat, nonce, aud, sd_hash: sdHash } = kbPayload as { iat?: unknown; nonce?: unknown; aud?: unknown; sd_hash?: unknown };
  if (typeof iat !== 'number' || !Number.isFinite(iat)) {
    return { ok: false, error: 'Key Binding JWT has no iat' };
  }
  if (nowSeconds - iat > KB_JWT_MAX_AGE_SECONDS || iat - nowSeconds > KB_JWT_MAX_FUTURE_SECONDS) {
    return { ok: false, error: 'Key Binding JWT iat is outside the accepted window' };
  }
  if (typeof nonce !== 'string' || !nonce) {
    return { ok: false, error: 'Key Binding JWT has no nonce' };
  }
  if (typeof aud !== 'string' || !aud) {
    return { ok: false, error: 'Key Binding JWT has no single-valued aud' };
  }
  const expectedSdHash = createHash('sha256').update(presented, 'ascii').digest('base64url');
  if (typeof sdHash !== 'string' || sdHash !== expectedSdHash) {
    return { ok: false, error: 'Key Binding JWT sd_hash does not match the presented SD-JWT' };
  }
  return { ok: true, nonce, aud, iat };
}

export function createSdJwtVerifier(): SdJwtVerifier {
  return {
    async verify(sdJwtToken: string, trustedIssuerKeys: Map<string, JWK>, options: SdJwtVerifyOptions = {}): Promise<SdJwtVerificationResult> {
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
        //    The header names the algorithm, so it is held to the asymmetric list, and to the one the
        //    trusted key names when it names one: a token never picks HMAC or `none` for itself.
        const alg = typeof header.alg === 'string' ? header.alg : '';
        const keyAlg = (issuerJwk as { alg?: unknown }).alg;
        if (!KB_JWT_ALGORITHMS.includes(alg) || (typeof keyAlg === 'string' && keyAlg !== alg)) {
          return { valid: false, error: `Issuer signature algorithm not accepted: ${alg || 'none'}` };
        }
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

        // 6. Every disclosure must be referenced by a digest in the signed payload. `unpack` throws
        //    on an unreferenced, duplicated or conflicting disclosure. sha256Hasher ignores the
        //    algorithm name, so any other `_sd_alg` is refused here rather than mis-hashed.
        const disclosures = (decoded.disclosures ?? []) as Disclosure[];
        if (payload._sd_alg !== undefined && payload._sd_alg !== 'sha-256') {
          return { valid: false, error: 'Unsupported _sd_alg' };
        }
        try {
          await unpack(payload, disclosures, sha256Hasher);
        } catch (err) {
          return { valid: false, error: `Disclosures not bound to the issuer signature: ${String(err)}` };
        }

        // 7. Key Binding JWT: verified whenever present, required when the caller asks.
        const lastTilde = sdJwtToken.lastIndexOf('~');
        const kbJwt = sdJwtToken.slice(lastTilde + 1);
        let keyBinding: { nonce: string; aud: string; iat: number } | undefined;
        if (kbJwt) {
          const kb = await verifyKeyBinding(kbJwt, sdJwtToken.slice(0, lastTilde + 1), payload);
          if (!kb.ok) return { valid: false, failure: 'holder_binding', error: kb.error };
          keyBinding = kb;
        } else if (options.requireKeyBinding) {
          return { valid: false, failure: 'holder_binding', error: 'Key Binding JWT required' };
        }

        // 8. Reconstruct disclosed claims
        const disclosedClaims: Record<string, unknown> = {};

        for (const disclosure of disclosures) {
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
          keyBinding: !!keyBinding,
          keyBindingNonce: keyBinding?.nonce,
          keyBindingAudience: keyBinding?.aud,
          keyBindingIssuedAt: keyBinding?.iat,
        };
      } catch (err) {
        logger.error('SD-JWT verification failed', { error: String(err) });
        return { valid: false, error: 'Verification failed' };
      }
    },
  };
}
