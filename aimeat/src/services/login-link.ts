/**
 * @file services/login-link.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The emailed sign-in link: issued, sent, and redeemed in a browser.
 *
 *   WHY. An install set creates accounts for a customer's users with the email verified and the login
 *   link on, and Jouni's decision 13 (2026-09-28) is that such a person signs in by the login link,
 *   Google, Entra or another method. The aimeat-apps end-to-end run on 2026-09-29 found neither half
 *   working: nobody told the new user their account existed, and the link a user could request
 *   answered a browser with raw JSON (the API's agent credentials), so the only way in was to set a
 *   password through "forgot password".
 *
 *   WHAT THIS DOES. issueLoginLink() stores a single-use token (the same email-verification record the
 *   link has always used, purpose `login`) and returns its address on this node's browser endpoint
 *   GET /v1/ghii/magic-link/open. redeemLoginLink() checks and spends it; the endpoint then opens an
 *   owner session exactly as a Google or Entra sign-in does (external-login.ts establishForGhii) and
 *   sends the browser to the app. sendLoginLink() mails it; install-set-people.ts uses it to welcome a
 *   user whose account the install created, with a link that lasts days rather than minutes.
 *
 *   The API endpoint GET /v1/ghii/magic-link/verify is unchanged for callers that want the JSON.
 *
 *   THE RETURN ADDRESS. A link asked for inside an app, or on a page of the node, returns the person
 *   there (loginReturnTarget). It is a path of this node, or an address on one of this node's own
 *   published app origins: the sign-in dialog runs on an app's own subdomain as well as on the node,
 *   and on an app origin the session reaches the app through the silent bridge once the node's
 *   cookie is set, so the app is the place to land. The allowlist is the one the bridge binds a
 *   token by (resolveAppOriginTarget), never a free URL. The address travels in the link, not in the
 *   token record, and is checked twice: when the link is asked for, so a foreign address is never
 *   mailed, and when it is opened, because a link in a mailbox can be edited. Anything that fails
 *   either check goes to the front page.
 * @structure LOGIN_LINK_TTL_MS · WELCOME_LINK_TTL_MS · loginReturnTarget() · issueLoginLink() ·
 *   sendLoginLink() · sendWelcomeLink() · redeemLoginLink()
 * @version-history
 *   v1.4.1 — 2026-10-10 — Comment: why the raw-token branch has no flag (secaudit 2026-10-10 I19).
 *   v1.4.0 — 2026-10-09 — The token is stored as its SHA-256 (the row id), never as itself; a row
 *     written before, keyed by the raw token, is still redeemed for one release (findLoginLinkRow)
 *     (secrets audit 2026-10-09, auth S3).
 *   v1.3.1 — 2026-10-06 — A link never lands on an app's draft origin (secaudit 2026-10 follow-up, A2).
 *   v1.3.0 — 2026-10-05 — redeemLoginLink() also refuses a link whose account turned the link off or
 *     changed the address it was mailed to (the seven-day welcome link included), and spends it with
 *     one conditional update; loginReturnTarget() takes the account on open, and an app address must
 *     be its own app or one it holds a grant for (secaudit 2026-10, AUTH-3 and WEB-3).
 *   v1.2.0 — 2026-10-04 — sendWelcomeLink() takes a `redirect` too: an install set's owner lands on
 *     the set's landing app.
 *   v1.1.0 — 2026-09-29 — The return address: loginReturnTarget(), and a `redirect` the link carries.
 *   v1.0.0 — 2026-09-29 — Initial (install packages: users created at install can sign in).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { getActiveEmailService, type EmailService } from './email.js';
import { appendMailLog } from './notification-settings.js';
import { welcomeEmail } from './email-template-welcome.js';
import { resolveAppOriginTarget } from './app-origin-target.js';
import { isSameOriginPath } from '../utils/same-origin-path.js';

/** A link a person asks for: fifteen minutes, as it always was. */
export const LOGIN_LINK_TTL_MS = 15 * 60 * 1000;
/** The link that welcomes a user whose account an install created: seven days. */
export const WELCOME_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const emailHashOf = (email: string): string => createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
const tokenHashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * The stored row a link's token names, and the id it is stored under. A row issued since 2026-10-09
 * is keyed by the token's hash. One issued before is keyed by the raw token, with its hash in
 * `code`; it is still found for one release, because a welcome link lasts seven days.
 * DEPRECATED: the raw-id branch below is removed in 3.27.0 (rows issued by 3.25.x have expired by then).
 * There is no config flag to turn it off before then, because it has nothing left to protect: every
 * raw-token row was issued before the hashing deploy and expires at most WELCOME_LINK_TTL_MS (seven
 * days) after it, and redeemLoginLink() checks the expiry before it reads the account or spends the row,
 * so from that day the branch can only answer EXPIRED (secaudit 2026-10-10 I19).
 */
async function findLoginLinkRow(storage: Storage, token: string) {
    const hashed = tokenHashOf(token);
    const row = await storage.getEmailVerification(hashed);
    if (row) return { id: hashed, record: row };
    // The raw form: the row's own `code` must be this token's hash, so the hash of a token (which is
    // what a reader of the table now holds) sent as a token finds nothing here.
    const legacy = await storage.getEmailVerification(token);
    if (legacy && legacy.id === token && legacy.code === hashed) return { id: token, record: legacy };
    return null;
}

// A backslash or a control character anywhere: a browser reads `\` as `/` and drops a tab or a line
// break, so such an address is not the one it appears to be (utils/same-origin-path.ts).
function hasUnsafeChar(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        // 0x5C is the backslash; below 0x20, and 0x7F, are the control characters.
        if (c === 0x5c || c < 0x20 || c === 0x7f) return true;
    }
    return false;
}

/**
 * Where a sign-in link may return the person: the absolute address to redirect to, or null for the
 * front page. `raw` is a path of this node (`/v1/profile?tab=x`), or an absolute address whose
 * origin is this node's own or one of its published app, portfolio or company origins, with the
 * node's scheme and port and no user name. Everything else is null.
 */
export async function loginReturnTarget(storage: Storage, config: AimeatConfig, raw: unknown, accountName?: string): Promise<string | null> {
    if (typeof raw !== 'string' || !raw || raw.length > 2048) return null;
    if (isSameOriginPath(raw)) return `${config.baseUrl}${raw}`;
    if (hasUnsafeChar(raw)) return null;
    let url: URL;
    let base: URL;
    try {
        url = new URL(raw);
        base = new URL(config.baseUrl);
    // eslint-disable-next-line aimeat/no-silent-catch -- an address that does not parse is the answer: none
    } catch { return null; }
    if (url.protocol !== base.protocol || url.port !== base.port || url.username || url.password) return null;
    const rest = `${url.pathname}${url.search}${url.hash}`;
    if (url.origin === base.origin) return isSameOriginPath(rest) ? `${config.baseUrl}${rest}` : null;
    const app = await resolveAppOriginTarget(config, storage, url.origin);
    // A draft origin runs unpublished code: a sign-in link never lands there (secaudit 2026-10 follow-up, A2).
    if (!app.ok || app.unpublished) return null;
    // On open, the account is known: it lands on an app of its own, or one it already holds a live
    // grant for. Anyone may ask for a link to somebody's address naming any app on this node, so
    // without this a link the victim did not ask for landed them, signed in, on a page the asker
    // wrote (secaudit 2026-10, WEB-3). A first visit to another person's app lands on the front page.
    if (accountName !== undefined && app.owner.toLowerCase() !== accountName.toLowerCase()) {
        const grants = await storage.listAppGrantsByOwner(accountName);
        if (!grants.some(g => !g.revoked && g.app === app.target)) return null;
    }
    return `${url.origin}${rest}`;
}

/**
 * A single-use sign-in link for `ghii`'s account, valid for `ttlMs`. `redirect` rides in the link as
 * it was given; the caller has checked it with loginReturnTarget(), and the open endpoint checks it
 * again.
 */
export async function issueLoginLink(
    storage: Storage, config: AimeatConfig, ghii: GHIIRecord, email: string, ttlMs: number, redirect?: string | null,
): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    // The row is keyed by the token's SHA-256, never by the token: a reader of the table or of a
    // backup would otherwise hold a live sign-in for everyone with a link outstanding (secrets
    // audit 2026-10-09, auth S3). The token itself is only in the mail.
    await storage.createEmailVerification({
        id: tokenHashOf(token),
        ownerName: ghii.ownerName,
        emailHash: emailHashOf(email),
        code: tokenHashOf(token),
        purpose: 'login',
        status: 'pending',
        attempts: 0,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        createdAt: now,
        verifiedAt: null,
    });
    const back = redirect ? `&redirect=${encodeURIComponent(redirect)}` : '';
    return `${config.baseUrl}/v1/ghii/magic-link/open?token=${token}${back}`;
}

/**
 * Mail a sign-in link. False, and nothing stored, when the account has the link off, the account is
 * deactivated, or this node sends no mail; the caller decides whether that is worth saying. A
 * `redirect` that loginReturnTarget() refuses is left out of the link, so a foreign address is never
 * mailed.
 */
export async function sendLoginLink(
    storage: Storage, config: AimeatConfig, ghii: GHIIRecord, email: string, ttlMs = LOGIN_LINK_TTL_MS,
    mail: EmailService | null | undefined = getActiveEmailService(), redirect?: unknown,
): Promise<boolean> {
    if (!mail?.enabled || !ghii.magicLinkEnabled) return false;
    const owner = await storage.getOwner(ghii.ownerName);
    if (!owner || owner.disabledAt) return false;
    const back = (await loginReturnTarget(storage, config, redirect)) ? redirect as string : null;
    const url = await issueLoginLink(storage, config, ghii, email, ttlMs, back);
    const sent = await mail.sendMagicLink(email, url, ghii.locale);
    if (sent) await appendMailLog(storage, ghii.ghii, { kind: 'magic_link', subject: 'login link' });
    return sent;
}

/**
 * Welcome a person whose account an install created: the account name and a sign-in link valid for
 * WELCOME_LINK_TTL_MS. False, and nothing stored, on the same conditions as sendLoginLink(). `redirect`
 * is where the link opens, checked by loginReturnTarget() as sendLoginLink() checks it; the front page
 * when it is absent or refused.
 */
export async function sendWelcomeLink(
    storage: Storage, config: AimeatConfig, ghii: GHIIRecord, email: string,
    mail: EmailService | null | undefined = getActiveEmailService(), redirect?: unknown,
): Promise<boolean> {
    if (!mail?.enabled || !ghii.magicLinkEnabled) return false;
    const owner = await storage.getOwner(ghii.ownerName);
    if (!owner || owner.disabledAt) return false;
    const back = (await loginReturnTarget(storage, config, redirect)) ? redirect as string : null;
    const loginUrl = await issueLoginLink(storage, config, ghii, email, WELCOME_LINK_TTL_MS, back);
    const site = config.baseUrl.replace(/^https?:\/\//, '');
    const m = welcomeEmail({ site, username: ghii.ownerName, loginUrl }, ghii.locale);
    const sent = await mail.sendRaw(email, m.subject, m.html, m.text);
    if (sent) await appendMailLog(storage, ghii.ghii, { kind: 'magic_link', subject: 'welcome sign-in link' });
    return sent;
}

export type RedeemResult =
    | { ok: true; ghii: GHIIRecord }
    | { ok: false; code: 'INVALID_TOKEN' | 'EXPIRED' | 'ACCOUNT_DISABLED' };

/**
 * Check and spend a sign-in link. Every refusal comes before the token is spent (invariant 14), so a
 * link for a deactivated account stays unspent and changes nothing. Both link endpoints run this one
 * check (the emailed GET /v1/ghii/magic-link/open and the JSON GET /v1/ghii/magic-link/verify).
 *
 * Since 2026-10-05 (secaudit 2026-10, AUTH-3) it also holds that the account still has the link on,
 * and that the address the link was mailed to is still the account's: a person who turned the link
 * off, or changed their address, ends the links already in a mailbox, the seven-day welcome link
 * included. The spend is one conditional update, so two concurrent clicks cannot both sign in.
 */
export async function redeemLoginLink(storage: Storage, config: AimeatConfig, token: string): Promise<RedeemResult> {
    const found = token ? await findLoginLinkRow(storage, token) : null;
    const record = found?.record ?? null;
    if (!found || !record || record.status !== 'pending' || record.purpose !== 'login') return { ok: false, code: 'INVALID_TOKEN' };
    const rowId = found.id;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
        await storage.updateEmailVerification(rowId, { status: 'expired' });
        return { ok: false, code: 'EXPIRED' };
    }
    const owner = await storage.getOwner(record.ownerName);
    if (!owner || owner.disabledAt) return { ok: false, code: 'ACCOUNT_DISABLED' };
    const ghii = await storage.getGHII(`${record.ownerName}@${config.nodeId}`);
    if (!ghii) return { ok: false, code: 'INVALID_TOKEN' };
    if (!ghii.magicLinkEnabled || !ghii.notificationEmail || emailHashOf(ghii.notificationEmail) !== record.emailHash) {
        return { ok: false, code: 'INVALID_TOKEN' };
    }
    if (!(await storage.spendEmailVerification(rowId, new Date().toISOString()))) return { ok: false, code: 'INVALID_TOKEN' };
    // Clicking the link proves the mailbox, as it always has.
    if ((ghii.verificationLevel ?? 0) < 1) await storage.updateGHII(ghii.ghii, { verificationLevel: 1 });
    return { ok: true, ghii };
}
