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
 *   does not expire and is the same for everyone. The grant arrives in the query on the first request
 *   only: the origin moves it into a host-only cookie and redirects to the address without it
 *   (routes/origin-grant-cookie.ts), so the address a person copies carries no grant.
 *
 *   Modelled on services/draft-token.ts, which answers the same question for an unpublished draft.
 *   This one reads the node keypair at call time through getNodeCryptoKeys() instead of keeping its
 *   own copy, so no boot-sequence wiring is needed for it to work.
 * @structure
 *   - APP_ACCESS_TTL_SECONDS — the grant's lifetime
 *   - generateAppAccessToken() — mint, after the apex has authorized the viewer
 *   - appAccessGranted() — the app origin's whole check: signed by this node, unexpired, this app
 *   - PageRef · pageRefId() — the page a page grant names: a welcome page or a company front page
 *   - generatePageAccessToken() · pageAccessGranted() — the same grant for those two origins
 *   - grantExpiresAt() — the expiry of a grant already verified, for the origin cookie's Max-Age
 * @usage
 *   const grant = await generateAppAccessToken({ sub: app.ownerGaii, filename: app.filename });
 *   if (!(await appAccessGranted(req.query.access, app.ownerName, app.filename))) return notFound();
 *   if (!(await pageAccessGranted(req.query.access, { kind: 'company', id: company.id }))) → redirect or 404
 * @version-history
 *   v1.2.0 — 2026-10-18 — A grant minted for a signed-in person carries a `viewer` claim, that
 *     person's GHII (plan doc-mvcn6c7e4e5q, V2): the open routes set it, the access-code flow has no
 *     person and sets none. `sub` keeps its meaning (the app owner). grantExpiresAt() reads the
 *     expiry of a grant already verified, for the origin cookie's Max-Age (routes/origin-grant-cookie.ts).
 *   v1.1.0 — 2026-10-18 — Page grants (plan doc-mvcn6c7e4e5q, V3.10): `typ: 'page-access'` naming one
 *     welcome page or one company front page, for their session-less origins. The `typ` keeps the two
 *     kinds apart: an app grant opens no page, a page grant opens no app and no other page.
 *   v1.0.0 — 2026-08-11 — Initial. Audit H-19: gate the unlock rather than the app HTML, so a
 *     code-gated app stops being the exception to H-2 origin isolation.
 *   v1.0.1 — 2026-09-26 — bare() takes the account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 */
import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import { randomUUID } from 'node:crypto';
import { getNodeCryptoKeys } from '../auth/jwt.js';
import { localAccountName } from '../utils/gaii.js';
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
    /**
     * The GHII of the signed-in person the grant was minted for (POST /v1/apps/:owner/:filename/open).
     * Absent for the access-code flow, which knows no person. The origin does not authorize on it;
     * it names who the grant was handed to.
     */
    viewer?: string;
}

/** The owner's account name, with this node's `@node-id` removed; another node's identity stays whole. */
function bare(owner: string): string {
    return localAccountName(owner);
}

/**
 * Mint an app-access grant. Call it only where the caller has just been authorized for this app.
 * `viewer` names the signed-in person when there is one; the origin that consumes the grant cannot
 * establish a viewer itself, so the claim is the only record of who the grant was handed to.
 */
export async function generateAppAccessToken(
    payload: AppAccessTokenPayload,
    ttlSeconds: number = APP_ACCESS_TTL_SECONDS,
): Promise<string> {
    const { privateKey } = getNodeCryptoKeys();
    return new SignJWT({ typ: 'app-access', filename: payload.filename, ...(payload.viewer ? { viewer: payload.viewer } : {}) })
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

/** The page a page grant opens: one owner's welcome page, or one company's front page (by company id). */
export type PageRef = { kind: 'portfolio'; owner: string } | { kind: 'company'; id: string };

/** The one string a page grant carries for its page. The account name is compared lower-cased, as the origin label is. */
export function pageRefId(ref: PageRef): string {
    return ref.kind === 'portfolio' ? `portfolio:${bare(ref.owner).toLowerCase()}` : `company:${ref.id}`;
}

/**
 * Mint a grant for one welcome page or one company front page. Call it only after the caller was
 * authorized for that page (routes/page-open.ts). `viewer` is the signed-in person's GHII, as on the
 * app grant.
 */
export async function generatePageAccessToken(
    ref: PageRef, ttlSeconds: number = APP_ACCESS_TTL_SECONDS, viewer?: string,
): Promise<string> {
    const { privateKey } = getNodeCryptoKeys();
    return new SignJWT({ typ: 'page-access', page: pageRefId(ref), ...(viewer ? { viewer } : {}) })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(privateKey);
}

/**
 * Does this token open this page? True only for a page grant this node signed, inside its lifetime,
 * naming exactly this page. An app grant (`typ: 'app-access'`) is false here, and a page grant is
 * false in appAccessGranted, so neither kind opens the other.
 */
export async function pageAccessGranted(token: unknown, ref: PageRef): Promise<boolean> {
    if (typeof token !== 'string' || token === '') return false;
    try {
        const { publicKey } = getNodeCryptoKeys();
        const { payload } = await jwtVerify(token, publicKey, { algorithms: ['EdDSA'] });
        return payload.typ === 'page-access' && payload.page === pageRefId(ref);
    } catch (err) {
        logger.warn('page-access grant rejected → the page answers as unknown', { error: String(err) });
        return false;
    }
}

/**
 * The expiry of a grant, in seconds since the epoch, or null when it carries none. It reads the claim
 * WITHOUT verifying the signature, so call it only on a grant appAccessGranted() or
 * pageAccessGranted() has just accepted.
 */
export function grantExpiresAt(token: string): number | null {
    try {
        const { exp } = decodeJwt(token);
        return typeof exp === 'number' ? exp : null;
    } catch (err) {
        logger.warn('a grant\'s expiry could not be read', { error: String(err) });
        return null;
    }
}
