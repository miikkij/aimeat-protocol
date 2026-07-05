/**
 * @file operator-confirm.ts
 * @description Propose-then-confirm tokens for operator config-enactment MCP tools.
 *   A config-WRITE tool called without a confirm token returns a structured proposal
 *   (current state, proposed state, diff) plus a short-lived single-use token bound to
 *   the EXACT proposed payload. Called again with the token, the tool verifies the
 *   binding and applies. Changing the payload between propose and confirm invalidates
 *   the token, so what the human approved is what gets applied.
 * @structure
 *   - initConfirmTokenKeys() — wired from auth/node-keys.ts (same EdDSA node keys)
 *   - mintConfirmToken(sub, action, payload) — 10 min TTL, jti, payload sha256 binding
 *   - verifyConfirmToken(token, sub, action, payload) — signature/expiry/single-use/binding
 *   - ConfirmTokenError — typed error with code
 * @usage
 *   import { mintConfirmToken, verifyConfirmToken } from '../services/operator-confirm.js';
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial (Skills feature Phase 3 — operator enactment)
 */
import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomUUID } from 'node:crypto';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

/** token-hash -> expiry epoch-seconds; single-use guard, pruned lazily. */
const usedTokens = new Map<string, number>();

export function initConfirmTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
    _privateKey = privateKey;
    _publicKey = publicKey;
}

export type ConfirmTokenErrorCode = 'TOKEN_EXPIRED' | 'TOKEN_USED' | 'TOKEN_INVALID' | 'PAYLOAD_MISMATCH';

export class ConfirmTokenError extends Error {
    constructor(public readonly code: ConfirmTokenErrorCode, message: string) {
        super(message);
        this.name = 'ConfirmTokenError';
    }
}

const CONFIRM_TTL_SECONDS = 600;

function payloadHash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Mint a confirm token bound to (caller, action, exact payload). */
export async function mintConfirmToken(sub: string, action: string, payload: unknown): Promise<string> {
    if (!_privateKey) throw new Error('Confirm token keys not initialized');
    return new SignJWT({ typ: 'confirm', action, phash: payloadHash(payload) })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setJti(randomUUID())
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime(`${CONFIRM_TTL_SECONDS}s`)
        .sign(_privateKey);
}

/** Verify a confirm token against the caller + action + the payload being applied. */
export async function verifyConfirmToken(token: string, sub: string, action: string, payload: unknown): Promise<void> {
    if (!_publicKey) throw new Error('Confirm token keys not initialized');

    const now = Math.floor(Date.now() / 1000);
    for (const [hash, exp] of usedTokens) {
        if (exp < now) usedTokens.delete(hash);
    }
    const hash = createHash('sha256').update(token).digest('hex');
    if (usedTokens.has(hash)) {
        throw new ConfirmTokenError('TOKEN_USED', 'This confirm token was already used — propose again');
    }

    let claims;
    try {
        claims = (await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] })).payload;
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('exp')) throw new ConfirmTokenError('TOKEN_EXPIRED', 'Confirm token expired (10 min TTL) — propose again');
        throw new ConfirmTokenError('TOKEN_INVALID', `Invalid confirm token: ${msg}`);
    }
    if (claims.typ !== 'confirm' || claims.sub !== sub || claims.action !== action) {
        throw new ConfirmTokenError('TOKEN_INVALID', 'Confirm token does not match this caller/action');
    }
    if (claims.phash !== payloadHash(payload)) {
        throw new ConfirmTokenError('PAYLOAD_MISMATCH',
            'The payload changed since it was proposed — the token binds to the exact approved change; propose again');
    }
    usedTokens.set(hash, claims.exp as number);
}
