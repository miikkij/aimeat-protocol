/**
 * @file draft-token.ts
 * @description Draft-preview token generation and verification. A draft-preview token is a
 *   short-lived signed JWT that authorizes READING an app's unpublished draft for preview on
 *   the isolated app origin (which carries no session/cookie — see H-2). The owner mints one
 *   from the authenticated apex, then opens the app-origin preview URL carrying the token; the
 *   app-serving handler validates it and serves the draft bytes instead of the live version.
 *
 *   Unlike an upload token, a preview token is a READ grant and is intentionally REUSABLE
 *   within its short TTL (a browser may fetch/reload the preview document more than once), so
 *   there is no single-use guard. The short TTL (default 10 min) is the whole containment.
 *   Uses the existing node JWT signing infrastructure (no separate key management).
 * @structure
 *   - generateDraftToken() — mint a signed draft-preview JWT scoped to (owner GHII, filename)
 *   - verifyDraftToken() — validate signature, expiry, and typ; return the scope
 *   - DraftTokenError — typed error with code field
 * @usage import { generateDraftToken, verifyDraftToken } from '../services/draft-token.js';
 * @version-history
 *   v1.0.0 — 2026-07-11 — Initial implementation (app draft/staging feature).
 */

import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';

// ── Key management (initialized from jwt.ts node keys) ──

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

export function initDraftTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
    _privateKey = privateKey;
    _publicKey = publicKey;
}

// ── Types ──

export interface DraftTokenPayload {
    /** Owner GHII whose draft this token grants preview access to. */
    sub: string;
    /** The app filename (identity) the draft belongs to. */
    filename: string;
}

export interface VerifiedDraftToken {
    sub: string;
    filename: string;
}

export type DraftTokenErrorCode = 'TOKEN_EXPIRED' | 'TOKEN_INVALID';

export class DraftTokenError extends Error {
    public readonly code: DraftTokenErrorCode;
    constructor(code: DraftTokenErrorCode, message: string) {
        super(message);
        this.name = 'DraftTokenError';
        this.code = code;
    }
}

// ── Token generation ──

export async function generateDraftToken(payload: DraftTokenPayload, ttlSeconds: number = 600): Promise<string> {
    if (!_privateKey) throw new Error('Draft token keys not initialized');

    return new SignJWT({
        typ: 'draft-preview',
        filename: payload.filename,
    })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        // EdDSA signing is deterministic: a jti nonce makes every mint a distinct token even
        // when two are minted in the same second with an identical payload.
        .setJti(randomUUID())
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(_privateKey);
}

// ── Token verification ──

export async function verifyDraftToken(token: string): Promise<VerifiedDraftToken> {
    if (!_publicKey) throw new Error('Draft token keys not initialized');

    let payload;
    try {
        const result = await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] });
        payload = result.payload;
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('expired') || msg.includes('exp')) {
            throw new DraftTokenError('TOKEN_EXPIRED', 'Draft preview token has expired');
        }
        throw new DraftTokenError('TOKEN_INVALID', `Invalid draft preview token: ${msg}`);
    }

    if (payload.typ !== 'draft-preview') {
        throw new DraftTokenError('TOKEN_INVALID', 'Token is not a draft-preview token');
    }

    return {
        sub: payload.sub as string,
        filename: payload.filename as string,
    };
}
