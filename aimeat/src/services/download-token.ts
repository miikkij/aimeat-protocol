/**
 * @file download-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - servesFileVersion() — does the stored file still match the version the token was minted for?
 *   - DownloadTokenError — typed error with code field
 * @usage
 *   import { generateDownloadToken, verifyDownloadToken } from '../services/download-token.js';
 * @version-history
 *   v1.2.1 -- 2026-10-21 -- A token minted before v1.2.0 (no `ver`) is served as before until it
 *     expires, so a download URL handed out before the upgrade keeps working for its hour. Every
 *     token minted from v1.2.0 on carries `ver` and keeps the version check.
 *   v1.2.0 -- 2026-10-20 -- A token names the file VERSION it was minted for: the file's createdAt,
 *     which every write under a key rewrites, signed as `ver` beside the size. GET /v1/download/:token
 *     serves the stored file only while servesFileVersion() holds, so a handle minted for a public
 *     file no longer serves a private re-upload under the same key (secaudit 2026-10,
 *     GET-v1-download:token-not-bound-to-file-version). A token minted before this change carries no
 *     `ver` and is refused TOKEN_INVALID: it costs at most one TTL (an hour) of asking for a new URL,
 *     and a token whose version cannot be checked is the defect itself.
 *   v1.1.0 -- 2026-09-08 -- A token may carry the name the file is saved as. The key is an address,
 *     and for a DM attachment its last segment is an id, so the browser saved a file called
 *     `23ea6d2c`. Whoever mints the handle knows the real name; the token carries it to the door.
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
    /**
     * The stored file's `createdAt` at the mint. Every write under a key rewrites it, so it names
     * the one version the minter was allowed to read; the download route refuses any other.
     */
    version: string;
    /** The name the file should be SAVED as, when the caller knows it and the key does not. */
    filename?: string;
}

export interface VerifiedDownloadToken {
    sub: string;
    key: string;
    mimeType: string;
    size: number;
    /**
     * The file version (its createdAt at the mint) this token may fetch. Absent on a token minted
     * before 2026-10-20, which names no version and is served as it was then until it expires.
     */
    version?: string;
    filename?: string;
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
        ver: payload.version,
        ...(payload.filename ? { filename: payload.filename } : {}),
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
    // Only a token minted before 2026-10-20 lacks `ver`. It is served as it was then, for the rest of
    // its own life (an hour at most), so a download URL handed out before the upgrade keeps working.
    // A `ver` that is present but not a string is not something this node signed, and is refused.
    if (payload.ver !== undefined && (typeof payload.ver !== 'string' || !payload.ver)) {
        throw new DownloadTokenError('TOKEN_INVALID', 'Token names no valid file version');
    }

    return {
        sub: payload.sub as string,
        key: payload.key as string,
        mimeType: payload.mimeType as string,
        size: payload.size as number,
        ...(typeof payload.ver === 'string' ? { version: payload.ver } : {}),
        filename: typeof payload.filename === 'string' ? payload.filename : undefined,
    };
}

/**
 * Does the stored file still hold the version the token was minted for? Its createdAt (compared as a
 * time, so the two backends' spellings of one instant agree) and its size must both match. A file
 * written again under the same key, at any visibility, is a different version and is not served.
 * A token minted before 2026-10-20 names no version and is served whatever the key holds, as it was
 * then; it expires within the hour it was minted for.
 */
export function servesFileVersion(
    verified: Pick<VerifiedDownloadToken, 'version' | 'size'>,
    file: { createdAt: string; size: number },
): boolean {
    if (verified.version === undefined) return true;
    if (file.size !== verified.size) return false;
    if (file.createdAt === verified.version) return true;
    const a = Date.parse(file.createdAt), b = Date.parse(verified.version);
    return Number.isFinite(a) && a === b;
}
