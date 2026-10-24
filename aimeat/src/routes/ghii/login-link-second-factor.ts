/**
 * @file src/routes/ghii/login-link-second-factor.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The second factor of an emailed sign-in link. A link proves the mailbox; on an account
 *   with two-step sign-in (TOTP armed) the password sign-in also asks for the code, and until
 *   2026-10-09 the link did not: GET /v1/ghii/magic-link/open opened a full owner session, operator
 *   role included, on the mailbox alone (secaudit 2026-10-09, S1, ruled by the developer: "a sign-in
 *   link and attaching an email respect two-step sign-in").
 *
 *   THE FLOW. The open route spends the link, and for an account with TOTP armed it calls
 *   startLinkSecondFactor() instead of opening a session: a ticket of 32 random bytes, stored as its
 *   SHA-256 in the verification-nonce table (type `login_second_factor`, five minutes, the owner name
 *   and the checked return address in its payload), set as an httpOnly SameSite=Lax cookie scoped to
 *   /v1/ghii/magic-link, and a redirect to the front page with `?auth_step=second_factor`, where the
 *   SDK's sign-in dialog opens on its code view. That view POSTs the code here.
 *
 *   POST /v1/ghii/magic-link/second-factor { totp_code? | backup_code? } reads the ticket and runs
 *   checkSecondFactor() (services/password-check.ts, the check the password sign-in runs: the TOTP
 *   lock, replay protection, backup codes, the failed-attempt count). A refusal keeps the ticket for
 *   another try, except that five wrong codes, or the TOTP lock tripping, delete it. Success deletes
 *   the ticket before the session is written (single use), clears the cookie, opens the session the
 *   way the open route does for an account without TOTP, and answers `{ redirect }`.
 *
 *   EXTERNAL SIGN-IN. The OIDC callback (routes/oauth-login.ts) and the SAML ACS (routes/saml-login.ts)
 *   start the same step when a first sign-in matches an account with TOTP armed by its verified
 *   address (services/external-login.ts, outcome `second_factor`). Their ticket also carries the
 *   provider identity (`link`), and the SAML connection when there is one. A correct code saves the
 *   identity on the account, opens the session and, for SAML, adds the connection's organism
 *   membership. Until then nothing is linked, so the next external sign-in asks again.
 * @structure LINK_SECOND_FACTOR_COOKIE · TicketLink · startLinkSecondFactor(storage, config, req, res,
 *   ghii, back, link?) · registerLoginLinkSecondFactorRoute(router, config, storage)
 * @usage registerLoginLinkSecondFactorRoute(router, config, storage);
 * @version-history
 *   2026-10-24 — The SECOND_FACTOR_EXPIRED message says to sign in again, which fits every way the step
 *     starts (secaudit2026oct22, external-login-skips-second-factor).
 *   2026-10-24 — The ticket can carry an external sign-in's provider identity (`link`), saved on the
 *     account only after a correct code (secaudit2026oct22, external-login-skips-second-factor).
 *   v1.0.2 — 2026-10-09 — The LOGIN_LINK_FAILED sentence passes the 500 text filter through
 *     keepErrorMessage (middleware/internal-error-text.ts; secrets audit d4).
 *   v1.0.1 — 2026-10-09 — The ticket is consumed by the request whose delete removed it; a second
 *     request racing with the same ticket is refused.
 *   v1.0.0 — 2026-10-09 — Initial (secaudit 2026-10-09, S1).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, GHIIRecord } from '../../storage/interface.js';
import { AccountDisabledError } from '../../auth/jwt.js';
import { establishForGhii, externalIdUpdate } from '../../services/external-login.js';
import { ensureSsoMembership } from '../../services/sso-membership.js';
import { checkSecondFactor } from '../../services/password-check.js';
import { success, error } from '../../middleware/envelope.js';
import { keepErrorMessage } from '../../middleware/internal-error-text.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { logger } from '../../utils/logger.js';

/** The httpOnly cookie that carries the raw ticket between the open route and this one. */
export const LINK_SECOND_FACTOR_COOKIE = 'aimeat_link_2fa';
/** Sent only to the magic-link routes: the open route sets it, the second-factor route reads it. */
const COOKIE_PATH = '/v1/ghii/magic-link';
const TICKET_TYPE = 'login_second_factor';
const TICKET_TTL_MS = 5 * 60 * 1000;
/** Wrong codes one ticket takes before it is deleted. The account's TOTP lock counts as well. */
const MAX_WRONG = 5;

/**
 * A provider identity that an external sign-in matched to this account by its verified address
 * (services/external-login.ts, outcome `second_factor`). It is saved on the account only after a
 * correct code. `sso` names the SAML connection whose organism membership the sign-in also grants.
 */
export interface TicketLink { providerId: string; sub: string; sso?: string }

interface TicketPayload { owner: string; back: string | null; wrong: number; link?: TicketLink }

function parseLink(raw: unknown): TicketLink | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const l = raw as Partial<TicketLink>;
    if (typeof l.providerId !== 'string' || !l.providerId || typeof l.sub !== 'string' || !l.sub) return undefined;
    return { providerId: l.providerId, sub: l.sub, ...(typeof l.sso === 'string' && l.sso ? { sso: l.sso } : {}) };
}

/** Only the hash is stored, so a read of the table does not give a usable ticket. */
const ticketKey = (raw: string): string => createHash('sha256').update(raw).digest('hex');

function cookieSecure(req: Request): boolean {
    return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function readTicketCookie(req: Request): string | null {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === LINK_SECOND_FACTOR_COOKIE) {
            const value = decodeURIComponent(part.slice(eq + 1).trim());
            return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
        }
    }
    return null;
}

function clearTicketCookie(req: Request, res: Response): void {
    res.clearCookie(LINK_SECOND_FACTOR_COOKIE, { httpOnly: true, secure: cookieSecure(req), sameSite: 'lax', path: COOKIE_PATH });
}

function parsePayload(raw: string | null | undefined): TicketPayload | null {
    try {
        const p = JSON.parse(raw ?? '') as Partial<TicketPayload>;
        if (typeof p.owner !== 'string' || !p.owner) return null;
        const link = parseLink(p.link);
        return {
            owner: p.owner, back: typeof p.back === 'string' ? p.back : null, wrong: typeof p.wrong === 'number' ? p.wrong : 0,
            ...(link ? { link } : {}),
        };
    } catch {
        // eslint-disable-next-line aimeat/no-silent-catch -- a payload that does not parse is a ticket that does not exist
        return null;
    }
}

/**
 * The link was good and the account has TOTP armed: store a ticket, set its cookie and send the
 * browser to the front page's code view. `back` is the return address loginReturnTarget() already
 * accepted, or null for the front page; it stays on the server. An external sign-in (OIDC callback,
 * SAML ACS) passes `link`, the provider identity it matched by address; the code step saves it.
 */
export async function startLinkSecondFactor(
    storage: Storage, config: AimeatConfig, req: Request, res: Response, ghii: GHIIRecord, back: string | null,
    link?: TicketLink,
): Promise<void> {
    const raw = randomBytes(32).toString('base64url');
    const now = Date.now();
    const payload: TicketPayload = { owner: ghii.ownerName, back, wrong: 0, ...(link ? { link } : {}) };
    await storage.createVerificationNonce({
        id: randomUUID(),
        owner: ghii.ownerName,
        type: TICKET_TYPE,
        state: ticketKey(raw),
        nonce: '',
        redirectUri: '',
        payload: JSON.stringify(payload),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TICKET_TTL_MS).toISOString(),
    });
    res.cookie(LINK_SECOND_FACTOR_COOKIE, raw, {
        httpOnly: true, secure: cookieSecure(req), sameSite: 'lax', path: COOKIE_PATH, maxAge: TICKET_TTL_MS,
    });
    res.redirect(`${config.baseUrl}/?auth_step=second_factor`);
}

export function registerLoginLinkSecondFactorRoute(router: Router, config: AimeatConfig, storage: Storage): void {
    router.post('/v1/ghii/magic-link/second-factor', rateLimit({ max: 20, windowMs: 10 * 60 * 1000, keyBy: 'ip' }), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        // One sentence for every way the code step starts: a sign-in link, or a first Google, Entra,
        // Casdoor or SAML sign-in. Signing in again starts a new step from any of them.
        const EXPIRED_TEXT = 'The time to enter the code has run out, or this step has already ended. Sign in again.';
        const expired = () => {
            clearTicketCookie(req, res);
            res.status(401).json(error(config.nodeId, 'SECOND_FACTOR_EXPIRED', EXPIRED_TEXT));
        };

        const raw = readTicketCookie(req);
        if (!raw) { expired(); return; }
        const key = ticketKey(raw);
        const ticket = await storage.getVerificationNonce(key);
        const payload = ticket?.type === TICKET_TYPE ? parsePayload(ticket.payload) : null;
        if (!ticket || !payload) { expired(); return; }
        if (new Date(ticket.expiresAt).getTime() < Date.now()) {
            await storage.deleteVerificationNonce(key);
            expired();
            return;
        }
        const ghii = await storage.getGHII(`${payload.owner}@${config.nodeId}`);
        if (!ghii) {
            await storage.deleteVerificationNonce(key);
            expired();
            return;
        }

        const body = req.body ?? {};
        const check = await checkSecondFactor(storage, config, ghii, { totp_code: body.totp_code, backup_code: body.backup_code });
        if (!check.ok) {
            if (check.code === 'TOTP_LOCKED') {
                // The account is paused; this ticket ends with it. A new link after the pause.
                await storage.deleteVerificationNonce(key);
                clearTicketCookie(req, res);
            } else if (check.code !== 'TOTP_REQUIRED') {
                // A wrong or replayed code counts against the ticket as well as the account. The
                // nonce table has no update, so the ticket is written again under the same key with
                // its original expiry.
                const wrong = payload.wrong + 1;
                await storage.deleteVerificationNonce(key);
                if (wrong < MAX_WRONG) {
                    await storage.createVerificationNonce({ ...ticket, id: randomUUID(), payload: JSON.stringify({ ...payload, wrong }) });
                } else {
                    clearTicketCookie(req, res);
                }
            }
            res.status(check.status).json(error(config.nodeId, check.code, check.message));
            return;
        }

        // Single use: the ticket is gone before the session is written, and only the request whose
        // delete removed the row goes on. Two requests racing with the same ticket and a good code
        // both passed the read above; the second finds nothing to delete and is refused.
        const consumed = await storage.deleteVerificationNonce(key);
        clearTicketCookie(req, res);
        if (!consumed) {
            res.status(401).json(error(config.nodeId, 'SECOND_FACTOR_EXPIRED', EXPIRED_TEXT));
            return;
        }
        try {
            let account = ghii;
            if (payload.link) {
                // The external sign-in's link is saved only now, after the code. Refusals come
                // before the write (invariant 14): a deactivated account, and a subject another
                // account linked while the code was pending, which step 1 would sign in there.
                const owner = await storage.getOwner(ghii.ownerName);
                if (owner?.disabledAt) {
                    res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account has been deactivated.'));
                    return;
                }
                const holder = await storage.getGHIIByExternalId(payload.link.providerId, payload.link.sub);
                if (holder && holder.ghii !== ghii.ghii) {
                    res.status(409).json(error(config.nodeId, 'EXTERNAL_IDENTITY_TAKEN',
                        'This sign-in is already linked to another account. Sign in again.'));
                    return;
                }
                account = (await storage.updateGHII(ghii.ghii, externalIdUpdate(ghii, payload.link.providerId, payload.link.sub))) ?? ghii;
            }
            await establishForGhii(storage, config, req, res, account);
            if (payload.link?.sso) {
                const conn = await storage.getSsoConnection(payload.link.sso);
                if (conn) await ensureSsoMembership(storage, conn, account.ownerName);
            }
        } catch (err) {
            if (err instanceof AccountDisabledError) {
                res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account has been deactivated.'));
                return;
            }
            logger.error('login link second factor failed', { error: String(err) });
            res.status(500).json(keepErrorMessage(error(config.nodeId, 'LOGIN_LINK_FAILED', 'Sign-in did not go through. Ask for a new sign-in link.')));
            return;
        }
        res.json(success(config.nodeId, { redirect: payload.back ?? `${config.baseUrl}/` }));
    });
}
