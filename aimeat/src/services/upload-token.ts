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
 *   v1.3.0 — 2026-07-31 — storage meta carries `tags` and `workspace_refs`, so the presigned path can
 *     express everything the inline /v1/memory/files body can. Without them a presigned upload of a
 *     workspace-shared or tagged file silently landed as an untagged private file.
 *   v1.2.0 — 2026-07-26 — PRESIGNED_META_KEYS + buildUploadMeta(): the options each upload type must
 *     carry are declared once, next to the token, instead of a hand-written meta at every minting
 *     site. Hand-written metas is how aimeat_extension_install's `update` flag was accepted and then
 *     dropped (meta: {}), so a requested upsert failed ALREADY_EXISTS with nothing pointing at the
 *     flag. Covered by test/e2e-presigned-meta.ts.
 *   v1.4.0 — 2026-08-01 — TARGET-058 Phase 5: the token carries `actor`, the principal that asked for
 *     the URL, alongside `sub`, the owner bucket it lands in. For an app publish those differ — `sub`
 *     is always the owner — so an agent publishing through the recommended presigned route arrived
 *     with the agent erased, and the node had nothing left to infer provenance from.
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
    /**
     * WHO IS ACTUALLY UPLOADING, when that is not the same principal as `sub`.
     *
     * `sub` is the OWNER bucket the upload lands in — for an app that is always the owner's GHII, so
     * a presigned publish requested by an agent arrived with the agent erased. That is not a
     * bookkeeping detail: the node's rule is that silence from a NON-HUMAN principal must not read as
     * "a human wrote it" (TARGET-058 MINT-3), and with the agent gone there was nothing left to infer
     * from, so the recommended publish route produced apps with no provenance at all.
     *
     * Set server-side at mint time from resolveIdentity(), NEVER from anything a client sends.
     */
    actor?: string;
    utype: 'app' | 'storage' | 'extension' | 'cortex' | 'skill';
    meta: Record<string, unknown>;
    maxBytes: number;
    contentType: string;
}

export interface VerifiedUploadToken {
    sub: string;
    /** The principal that requested the URL — the GAII of an agent, or `sub` when they are the same. */
    actor: string;
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

// ── Presigned option carry-over ──

/**
 * The options each presigned upload type MUST carry into its token `meta`.
 *
 * The trap this closes: a tool accepts an option, destructures it, and then mints the token with a
 * hand-written `meta` that forgets it. The option is silently ignored and the failure surfaces far
 * away — `aimeat_extension_install({ update: true })` returned an upload URL and then failed
 * ALREADY_EXISTS, because `meta: {}` dropped the flag. The same shape of bug is on record for app
 * publishing (cortex_agents). Declaring the carry-over list HERE, next to the token, means a new
 * option is one edit away from being covered, and {@link buildUploadMeta} + its test make a
 * forgotten key a test failure instead of a support ticket.
 */
export const PRESIGNED_META_KEYS = {
    app: ['filename', 'name', 'description', 'category', 'tags', 'icon', 'version'],
    storage: ['key', 'mime_type', 'visibility', 'group_id', 'tags', 'workspace_refs'],
    extension: ['update', 'activate'],
    cortex: ['update', 'activate'],
    skill: ['scope', 'visibility', 'organism_id', 'workspace_id'],
} as const satisfies Record<UploadTokenPayload['utype'], readonly string[]>;

/**
 * Build a token `meta` for `utype` by picking exactly the declared keys off the tool's own input.
 * Undefined values are dropped so an omitted option stays omitted (the upload handlers treat
 * "absent" as "unchanged"). Use this instead of writing a meta object by hand.
 */
export function buildUploadMeta(
    utype: UploadTokenPayload['utype'],
    input: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of PRESIGNED_META_KEYS[utype] as readonly string[]) {
        if (input[key] !== undefined) out[key] = input[key];
    }
    return out;
}

// ── Token generation ──

export async function generateUploadToken(payload: UploadTokenPayload, ttlSeconds: number = 3600): Promise<string> {
    if (!_privateKey) throw new Error('Upload token keys not initialized');

    return new SignJWT({
        typ: 'upload',
        utype: payload.utype,
        ...(payload.actor && payload.actor !== payload.sub ? { actor: payload.actor } : {}),
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
        // Falls back to `sub`, so a token minted before this field existed still resolves to a
        // principal rather than to undefined.
        actor: (payload.actor as string | undefined) ?? (payload.sub as string),
        utype: payload.utype as VerifiedUploadToken['utype'],
        meta: payload.meta as Record<string, unknown>,
        maxBytes: payload.maxBytes as number,
        contentType: payload.contentType as string,
    };
}
