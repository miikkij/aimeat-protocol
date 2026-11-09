/**
 * @file operator-confirm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.1.0 -- 2026-11-04 -- Signed with the confirm purpose's own key (auth/node-signer.ts); a token
 *     signed before, with the node key, verifies as before until it expires (codebase analysis
 *     2026-11-03, item B9).
 *   v1.2.0 -- 2026-11-08 -- A confirm token is spent once under its id (jti) in the node's storage, not
 *     under its text in one process's memory: a second process, or a second spelling of the signature,
 *     no longer applies it again (secaudit2026nov08 round 14).
 */
import { SignJWT } from 'jose';
import { signFor, verifyFor, TokenPurposeError } from '../auth/node-signer.js';
import { createHash, randomUUID } from 'node:crypto';
import { spendOnce } from './ephemeral-claims.js';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

/** jti -> expiry epoch-seconds: this process's tokens already applied, pruned lazily. The spend that
 *  decides is the storage row (spendOnce 'confirm-token'). */
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
    return signFor('confirm', new SignJWT({ typ: 'confirm', action, phash: payloadHash(payload) })
        .setJti(randomUUID())
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime(`${CONFIRM_TTL_SECONDS}s`), _privateKey);
}

/** Verify a confirm token against the caller + action + the payload being applied. */
export async function verifyConfirmToken(token: string, sub: string, action: string, payload: unknown): Promise<void> {
    if (!_publicKey || !_privateKey) throw new Error('Confirm token keys not initialized');

    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of usedTokens) {
        if (exp < now) usedTokens.delete(jti);
    }

    let claims;
    try {
        claims = (await verifyFor('confirm', token, { privateKey: _privateKey, publicKey: _publicKey }, { algorithms: ['EdDSA'] })).payload;
    } catch (err) {
        // A token this node signed for another purpose gets the answer a token of another type always got.
        if (err instanceof TokenPurposeError) throw new ConfirmTokenError('TOKEN_INVALID', 'Confirm token does not match this caller/action');
        const msg = (err as Error).message;
        if (msg.includes('exp')) throw new ConfirmTokenError('TOKEN_EXPIRED', 'Confirm token expired (10 min TTL) — propose again');
        throw new ConfirmTokenError('TOKEN_INVALID', `Invalid confirm token: ${msg}`);
    }
    // A token is spent under its id (jti), which the signature covers. The whole token text was the key
    // before, and one signature segment has several base64url spellings that verify alike.
    const jti = typeof claims.jti === 'string' ? claims.jti : '';
    const used = () => new ConfirmTokenError('TOKEN_USED', 'This confirm token was already used — propose again');
    if (jti && usedTokens.has(jti)) throw used();
    if (claims.typ !== 'confirm' || claims.sub !== sub || claims.action !== action || !jti) {
        throw new ConfirmTokenError('TOKEN_INVALID', 'Confirm token does not match this caller/action');
    }
    if (claims.phash !== payloadHash(payload)) {
        throw new ConfirmTokenError('PAYLOAD_MISMATCH',
            'The payload changed since it was proposed — the token binds to the exact approved change; propose again');
    }
    // Spent in the node's storage (services/ephemeral-claims.ts), so another process of the node refuses
    // it too; the Map above answers this process's repeat before the binding check, as it did.
    const expMs = (claims.exp as number) * 1000;
    if (!await spendOnce('confirm-token', jti, Math.max(expMs, Date.now() + 1000))) throw used();
    usedTokens.set(jti, claims.exp as number);
}
