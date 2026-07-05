/**
 * @file upload-token.ts
 * @description Presigned upload token generation and verification. Tokens are single-use,
 *   time-limited JWTs that authorize a single file upload to PUT /v1/upload/:token.
 *   Uses the existing node JWT signing infrastructure (no separate key management).
 * @structure
 *   - generateUploadToken() — creates a signed upload JWT with metadata
 *   - verifyUploadToken() — validates signature, expiry, and single-use
 *   - UploadTokenError — typed error with code field
 * @usage
 *   import { generateUploadToken, verifyUploadToken } from '../services/upload-token.js';
 * @version-history
 *   v1.0.0 — 2026-05-02 — Initial implementation
 *   v1.1.0 — 2026-07-05 — Add 'skill' upload type; add a jti nonce (deterministic EdDSA made
 *     same-second identical mints collide with the single-use guard).
 */

import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomUUID } from 'node:crypto';

// ── Key management (initialized from jwt.ts node keys) ──

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

// Single-use tracking: token hash -> expiry timestamp
const usedTokens = new Map<string, number>();

let _cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function initUploadTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
    _privateKey = privateKey;
    _publicKey = publicKey;

    if (_cleanupInterval) clearInterval(_cleanupInterval);
    _cleanupInterval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        for (const [hash, exp] of usedTokens) {
            if (exp < now) usedTokens.delete(hash);
        }
    }, 5 * 60 * 1000);
}

// ── Types ──

export interface UploadTokenPayload {
    sub: string;
    utype: 'app' | 'storage' | 'extension' | 'cortex' | 'skill';
    meta: Record<string, unknown>;
    maxBytes: number;
    contentType: string;
}

export interface VerifiedUploadToken {
    sub: string;
    utype: 'app' | 'storage' | 'extension' | 'cortex' | 'skill';
    meta: Record<string, unknown>;
    maxBytes: number;
    contentType: string;
}

export type UploadTokenErrorCode = 'TOKEN_EXPIRED' | 'TOKEN_USED' | 'TOKEN_INVALID';

export class UploadTokenError extends Error {
    public readonly code: UploadTokenErrorCode;
    constructor(code: UploadTokenErrorCode, message: string) {
        super(message);
        this.name = 'UploadTokenError';
        this.code = code;
    }
}

// ── Token generation ──

export async function generateUploadToken(payload: UploadTokenPayload, ttlSeconds: number = 3600): Promise<string> {
    if (!_privateKey) throw new Error('Upload token keys not initialized');

    return new SignJWT({
        typ: 'upload',
        utype: payload.utype,
        meta: payload.meta,
        maxBytes: payload.maxBytes,
        contentType: payload.contentType,
    })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        // EdDSA signing is deterministic: without a nonce, two tokens minted in the same
        // second with identical payloads are the SAME JWT — the second upload then trips
        // the single-use guard (TOKEN_USED). jti makes every mint unique.
        .setJti(randomUUID())
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(_privateKey);
}

// ── Token verification ──

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export async function verifyUploadToken(token: string): Promise<VerifiedUploadToken> {
    if (!_publicKey) throw new Error('Upload token keys not initialized');

    // Single-use check
    const hash = hashToken(token);
    if (usedTokens.has(hash)) {
        throw new UploadTokenError('TOKEN_USED', 'Upload token has already been used (single-use)');
    }

    let payload;
    try {
        const result = await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] });
        payload = result.payload;
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('expired') || msg.includes('exp')) {
            throw new UploadTokenError('TOKEN_EXPIRED', 'Upload token has expired (60 min TTL)');
        }
        throw new UploadTokenError('TOKEN_INVALID', `Invalid upload token: ${msg}`);
    }

    if (payload.typ !== 'upload') {
        throw new UploadTokenError('TOKEN_INVALID', 'Token is not an upload token');
    }

    // Mark as used (store until token expiry for dedup)
    usedTokens.set(hash, payload.exp as number);

    return {
        sub: payload.sub as string,
        utype: payload.utype as VerifiedUploadToken['utype'],
        meta: payload.meta as Record<string, unknown>,
        maxBytes: payload.maxBytes as number,
        contentType: payload.contentType as string,
    };
}
