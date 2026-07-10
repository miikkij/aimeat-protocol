/**
 * @file share-token.ts
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
 *   v1.0.0 -- 2026-07-10 -- TARGET-025: password-protected workspace shares (SESSIO 008)
 */

import { SignJWT, jwtVerify } from 'jose';

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

    return { org: payload.org, ws: payload.ws };
}
