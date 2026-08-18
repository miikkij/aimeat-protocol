/**
 * @file draft-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - generateDraftToken() / verifyDraftToken() — draft-preview read grant
 *   - generateFrameToken() / verifyFrameToken() — frame grant naming ONE allowed origin
 *   - DraftTokenError — typed error with code field
 * @usage import { generateDraftToken, verifyDraftToken } from '../services/draft-token.js';
 * @version-history
 *   v1.0.0 — 2026-07-11 — Initial implementation (app draft/staging feature).
 *   v1.1.0 — 2026-07-25 — Frame grants: a signed token naming ONE origin allowed to frame
 *     one app. Replaces enumerating allowed origins in frame-ancestors, which grew with the
 *     owner's app count and blew past the reverse proxy's header buffer in production.
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

// ── Frame grant ──────────────────────────────────────────────────────────────
// A frame grant answers one question for one response: MAY THIS ONE ORIGIN FRAME ME?
//
// The obvious alternative — listing every origin allowed to frame an app in its
// `frame-ancestors` — was tried and taken down production: the header grows with how many apps
// the owner has, and at 76 it exceeded the reverse proxy's header buffer, so every app subdomain
// answered 502. A grant carries exactly one origin, so the header is the same size whether you
// own two apps or two thousand. That property is asserted by a test, not assumed.
//
// It is also a real authorization rather than an enumeration: the owner mints it from the
// authenticated apex for their own app, it names the single origin that may frame, and it expires.

export interface FrameTokenPayload {
    /** Owner GHII of the app being framed. */
    sub: string;
    /** The app filename being framed. */
    filename: string;
    /** The ONE origin this grant allows to frame it, e.g. "https://origami.apps.aimeat.io". */
    origin: string;
}

export interface VerifiedFrameToken {
    sub: string;
    filename: string;
    origin: string;
}

/** Mint a frame grant. Default TTL is long enough for a board to stay open on a desk. */
export async function generateFrameToken(payload: FrameTokenPayload, ttlSeconds: number = 43200): Promise<string> {
    if (!_privateKey) throw new Error('Draft token keys not initialized');

    return new SignJWT({
        typ: 'frame-grant',
        filename: payload.filename,
        origin: payload.origin,
    })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setJti(randomUUID())
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(_privateKey);
}

/** Verify a frame grant. Throws DraftTokenError; callers fall back to the strict CSP. */
export async function verifyFrameToken(token: string): Promise<VerifiedFrameToken> {
    if (!_publicKey) throw new Error('Draft token keys not initialized');

    let payload;
    try {
        const result = await jwtVerify(token, _publicKey, { algorithms: ['EdDSA'] });
        payload = result.payload;
    } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('expired') || msg.includes('exp')) {
            throw new DraftTokenError('TOKEN_EXPIRED', 'Frame grant has expired');
        }
        throw new DraftTokenError('TOKEN_INVALID', `Invalid frame grant: ${msg}`);
    }

    if (payload.typ !== 'frame-grant') {
        throw new DraftTokenError('TOKEN_INVALID', 'Token is not a frame grant');
    }
    const origin = typeof payload.origin === 'string' ? payload.origin : '';
    // A CSP source expression must not contain whitespace or a semicolon: either would end the
    // directive early and silently rewrite the whole policy. Reject rather than sanitize.
    if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) {
        throw new DraftTokenError('TOKEN_INVALID', 'Frame grant carries an unusable origin');
    }

    return {
        sub: payload.sub as string,
        filename: payload.filename as string,
        origin,
    };
}

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
