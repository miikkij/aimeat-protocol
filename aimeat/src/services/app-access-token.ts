/**
 * @file src/services/app-access-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The short-lived signed grant that lets the session-less app origin serve an app
 *   whose delivery is gated: one carrying an access code, or a price the caller has already paid.
 *   The apex checks the code or the licence, mints one of these, and redirects; the app origin
 *   verifies the grant and nothing else, so it never has to know WHY the app was gated.
 *
 *   Why it exists. Runnable app HTML must not execute on the origin that holds the user's session
 *   (H-2), and the apex redirect that enforces that used to carve gated apps out — so the one class
 *   of app whose author had asked for protection was the class still running beside the session.
 *   The carve-out was there for a reason: an app origin carries no cookie and no Bearer, so it had
 *   no way to tell an unlocked visitor from a stranger and answered both with 404. This grant is
 *   that way, and it is what moves the gate from the app HTML to the unlock.
 *
 *   Shape and lifetime. It names one owner and one filename, and it expires within the hour: long
 *   enough that a reload during a working session does not dead-end, short enough that a copied
 *   address is not a lasting substitute for the code. That is already stricter than what it
 *   replaces, since the apex URL a visitor holds today carries the access code itself, and the code
 *   does not expire and is the same for everyone.
 *
 *   Modelled on services/draft-token.ts, which answers the same question for an unpublished draft.
 *   This one reads the node keypair at call time through getNodeCryptoKeys() instead of keeping its
 *   own copy, so no boot-sequence wiring is needed for it to work.
 * @structure
 *   - APP_ACCESS_TTL_SECONDS — the grant's lifetime
 *   - generateAppAccessToken() — mint, after the apex has authorized the viewer
 *   - appAccessGranted() — the app origin's whole check: signed by this node, unexpired, this app
 * @usage
 *   const grant = await generateAppAccessToken({ sub: app.ownerGaii, filename: app.filename });
 *   if (!(await appAccessGranted(req.query.access, app.ownerName, app.filename))) return notFound();
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial. Audit H-19: gate the unlock rather than the app HTML, so a
 *     code-gated app stops being the exception to H-2 origin isolation.
 */
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { getNodeCryptoKeys } from '../auth/jwt.js';
import { logger } from '../utils/logger.js';

/**
 * One hour. A person who unlocked an app keeps working in it, reloads it, and follows links inside
 * it; a grant shorter than that turns a normal session into a dead end the user cannot explain.
 * Anything longer starts to behave like the credential it replaced.
 */
export const APP_ACCESS_TTL_SECONDS = 3600;

export interface AppAccessTokenPayload {
    /** The app owner's GHII (or bare name — the node-id suffix is ignored on both sides). */
    sub: string;
    /** The app filename this grant opens, extension included. */
    filename: string;
}

/** The bare owner name, with any `@node-id` suffix removed. */
function bare(owner: string): string {
    return owner.includes('@') ? owner.split('@')[0] : owner;
}

/**
 * Mint an app-access grant. Call it only where the caller has just been authorized for this app:
 * the grant carries no viewer identity, because the origin that consumes it cannot establish one.
 */
export async function generateAppAccessToken(
    payload: AppAccessTokenPayload,
    ttlSeconds: number = APP_ACCESS_TTL_SECONDS,
): Promise<string> {
    const { privateKey } = getNodeCryptoKeys();
    return new SignJWT({ typ: 'app-access', filename: payload.filename })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        // EdDSA signing is deterministic: without a nonce two grants minted in the same second for
        // the same app would be the same string, which makes one leaked address indistinguishable
        // from another in a log.
        .setJti(randomUUID())
        .setSubject(payload.sub)
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(privateKey);
}

/**
 * Does this token open this app? True only for a grant this node signed, still inside its lifetime,
 * naming this owner and this filename. Every other outcome is false: a missing token, a garbage
 * one, an expired one, a token of some other type, and a valid grant for a different app or a
 * different owner. The caller answers false with whatever it answers an unknown app with, so a
 * failed grant never tells a stranger that the app exists.
 */
export async function appAccessGranted(token: unknown, ownerBare: string, filename: string): Promise<boolean> {
    if (typeof token !== 'string' || token === '') return false;
    try {
        // Inside the try on purpose: on a node whose key init failed, every gated app must answer
        // 404 like an unknown one rather than 500 and announce that it is there.
        const { publicKey } = getNodeCryptoKeys();
        const { payload } = await jwtVerify(token, publicKey, { algorithms: ['EdDSA'] });
        if (payload.typ !== 'app-access') return false;
        if (payload.filename !== filename) return false;
        return bare(String(payload.sub ?? '')) === bare(ownerBare);
    } catch (err) {
        // Fails closed, and says so once: a grant that stopped verifying is the difference between
        // "this app is gone" and "your link expired", and only the log can tell them apart.
        logger.warn('app-access grant rejected → the app answers as unknown', { error: String(err) });
        return false;
    }
}
