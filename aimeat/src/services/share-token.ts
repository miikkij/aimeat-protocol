/**
 * @file share-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workspace-share session tokens. When a workspace's public share is in
 *   'password' access mode, a successful POST /workspace/share/unlock mints one of these
 *   time-limited EdDSA JWTs (org + ws baked in). The client then presents it on the NO-AUTH
 *   public-document reads via the X-Share-Token header — the password itself never travels
 *   more than once. Mirrors download-token.ts: reusable within its TTL, NOT single-use, and
 *   deliberately NOT carried in Authorization (the global auth middleware must never mistake
 *   it for a session token). Grants nothing beyond public-document reads of that one workspace.
 * @structure
 *   - initShareTokenKeys() — wire the node signing keys (called from auth/node-keys.ts)
 *   - generateShareToken() — sign a share JWT for one workspace
 *   - verifyShareToken() — validate signature + expiry, return { org, ws }
 *   - ShareTokenError — typed error with code field
 * @usage
 *   import { generateShareToken, verifyShareToken } from '../services/share-token.js';
 * @version-history
 *   v1.1.0 -- 2026-10-09 -- The token carries `pwv`, the version of the password it was unlocked with
 *     (shareTokenVersionOf), and the gate compares it with the current one, so a password change ends
 *     every token minted under the old password (secrets audit 2026-10-09, S-6).
 *   v1.0.0 -- 2026-07-10 -- TARGET-025: password-protected workspace shares (SESSIO 008)
 */

import { SignJWT, jwtVerify } from 'jose';
import { createHmac } from 'node:crypto';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

export function initShareTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
    _privateKey = privateKey;
    _publicKey = publicKey;
}

export interface ShareTokenPayload {
    /** Organism id the share belongs to. */
    org: string;
    /** Workspace id the share belongs to. */
    ws: string;
    /**
     * The version of the share password the token was unlocked with: shareTokenVersionOf() of the
     * stored hash. A new password has a new salt and so a new hash, so changing it ends every token
     * minted under the old one. A token without it (minted before 2026-10-09) opens nothing.
     */
    pwv: string;
}

/**
 * The password version a share token carries: the first 16 hex characters of an HMAC-SHA256 of the
 * stored scrypt hash, keyed with a fixed label. It names one password without saying anything about
 * it: the hash carries a random salt, so equal passwords set twice give two versions, and the token
 * holder learns nothing they could test a guess against.
 */
export function shareTokenVersionOf(passwordHash: string): string {
    return createHmac('sha256', 'aimeat-share-token-pwv').update(passwordHash).digest('hex').slice(0, 16);
}

export type ShareTokenErrorCode = 'TOKEN_EXPIRED' | 'TOKEN_INVALID';

export class ShareTokenError extends Error {
    public readonly code: ShareTokenErrorCode;
    constructor(code: ShareTokenErrorCode, message: string) {
        super(message);
        this.name = 'ShareTokenError';
        this.code = code;
    }
}

export const SHARE_TOKEN_TTL_SECONDS = 24 * 3600;

export async function generateShareToken(payload: ShareTokenPayload, ttlSeconds: number = SHARE_TOKEN_TTL_SECONDS): Promise<string> {
    if (!_privateKey) throw new Error('Share token keys not initialized');

    return new SignJWT({
        typ: 'share',
        org: payload.org,
        ws: payload.ws,
        pwv: payload.pwv,
    })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(_privateKey);
}

export async function verifyShareToken(token: string): Promise<ShareTokenPayload> {
    if (!_publicKey) throw new Error('Share token keys not initialized');

    let payload;
    try {
        const result = await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] });
        payload = result.payload;
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('expired') || msg.includes('exp')) {
            throw new ShareTokenError('TOKEN_EXPIRED', 'Share token has expired');
        }
        throw new ShareTokenError('TOKEN_INVALID', `Invalid share token: ${msg}`);
    }

    if (payload.typ !== 'share' || typeof payload.org !== 'string' || typeof payload.ws !== 'string') {
        throw new ShareTokenError('TOKEN_INVALID', 'Token is not a share token');
    }
    // A token minted before the password version existed names no password, so it opens nothing:
    // its holder unlocks again, at most once, instead of keeping a token a password change cannot end.
    if (typeof payload.pwv !== 'string' || !payload.pwv) {
        throw new ShareTokenError('TOKEN_INVALID', 'This share token predates the current password check. Unlock again.');
    }

    return { org: payload.org, ws: payload.ws, pwv: payload.pwv };
}
