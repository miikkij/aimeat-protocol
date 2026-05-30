/**
 * @file download-token.ts
 * @description Presigned download token generation and verification. Tokens are time-limited
 *   JWTs that authorize GET /v1/download/:token to stream ONE specific stored file (owner + key
 *   baked into the token) without the caller carrying an agent JWT. Mirrors upload-token.ts but
 *   is NOT single-use: a download handle may be fetched more than once within its TTL (e.g. HTTP
 *   Range requests, resumes, retries). Used by the MCP storage_download tool / REST handle mode so
 *   binary bytes never pass through the model context (MCP audit F11).
 * @structure
 *   - initDownloadTokenKeys() — wire the node signing keys (called from auth/node-keys.ts)
 *   - generateDownloadToken() — sign a download JWT for one file
 *   - verifyDownloadToken() — validate signature + expiry, return the file reference
 *   - DownloadTokenError — typed error with code field
 * @usage
 *   import { generateDownloadToken, verifyDownloadToken } from '../services/download-token.js';
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 2 (F11): presigned download handle for storage files
 */

import { SignJWT, jwtVerify } from 'jose';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

export function initDownloadTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
    _privateKey = privateKey;
    _publicKey = publicKey;
}

export interface DownloadTokenPayload {
    /** Owner GAII/GHII that owns the file (used to look it up server-side). */
    sub: string;
    /** Storage key of the file this token may fetch. */
    key: string;
    mimeType: string;
    size: number;
}

export interface VerifiedDownloadToken {
    sub: string;
    key: string;
    mimeType: string;
    size: number;
}

export type DownloadTokenErrorCode = 'TOKEN_EXPIRED' | 'TOKEN_INVALID';

export class DownloadTokenError extends Error {
    public readonly code: DownloadTokenErrorCode;
    constructor(code: DownloadTokenErrorCode, message: string) {
        super(message);
        this.name = 'DownloadTokenError';
        this.code = code;
    }
}

export async function generateDownloadToken(payload: DownloadTokenPayload, ttlSeconds: number = 3600): Promise<string> {
    if (!_privateKey) throw new Error('Download token keys not initialized');

    return new SignJWT({
        typ: 'download',
        key: payload.key,
        mimeType: payload.mimeType,
        size: payload.size,
    })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(_privateKey);
}

export async function verifyDownloadToken(token: string): Promise<VerifiedDownloadToken> {
    if (!_publicKey) throw new Error('Download token keys not initialized');

    let payload;
    try {
        const result = await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] });
        payload = result.payload;
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('expired') || msg.includes('exp')) {
            throw new DownloadTokenError('TOKEN_EXPIRED', 'Download token has expired');
        }
        throw new DownloadTokenError('TOKEN_INVALID', `Invalid download token: ${msg}`);
    }

    if (payload.typ !== 'download') {
        throw new DownloadTokenError('TOKEN_INVALID', 'Token is not a download token');
    }

    return {
        sub: payload.sub as string,
        key: payload.key as string,
        mimeType: payload.mimeType as string,
        size: payload.size as number,
    };
}
