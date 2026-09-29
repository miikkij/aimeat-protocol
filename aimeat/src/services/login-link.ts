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
 * @structure LOGIN_LINK_TTL_MS · WELCOME_LINK_TTL_MS · issueLoginLink() · sendLoginLink() · sendWelcomeLink() · redeemLoginLink()
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial (install packages: users created at install can sign in).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { getActiveEmailService, type EmailService } from './email.js';
import { appendMailLog } from './notification-settings.js';
import { welcomeEmail } from './email-template-welcome.js';

/** A link a person asks for: fifteen minutes, as it always was. */
export const LOGIN_LINK_TTL_MS = 15 * 60 * 1000;
/** The link that welcomes a user whose account an install created: seven days. */
export const WELCOME_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const emailHashOf = (email: string): string => createHash('sha256').update(email.toLowerCase().trim()).digest('hex');

/** A single-use sign-in link for `ghii`'s account, valid for `ttlMs`. */
export async function issueLoginLink(
    storage: Storage, config: AimeatConfig, ghii: GHIIRecord, email: string, ttlMs: number,
): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    await storage.createEmailVerification({
        id: token,
        ownerName: ghii.ownerName,
        emailHash: emailHashOf(email),
        code: createHash('sha256').update(token).digest('hex'),
        purpose: 'login',
        status: 'pending',
        attempts: 0,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        createdAt: now,
        verifiedAt: null,
    });
    return `${config.baseUrl}/v1/ghii/magic-link/open?token=${token}`;
}

/**
 * Mail a sign-in link. False, and nothing stored, when the account has the link off, the account is
 * deactivated, or this node sends no mail; the caller decides whether that is worth saying.
 */
export async function sendLoginLink(
    storage: Storage, config: AimeatConfig, ghii: GHIIRecord, email: string, ttlMs = LOGIN_LINK_TTL_MS,
    mail: EmailService | null | undefined = getActiveEmailService(),
): Promise<boolean> {
    if (!mail?.enabled || !ghii.magicLinkEnabled) return false;
    const owner = await storage.getOwner(ghii.ownerName);
    if (!owner || owner.disabledAt) return false;
    const url = await issueLoginLink(storage, config, ghii, email, ttlMs);
    const sent = await mail.sendMagicLink(email, url, ghii.locale);
    if (sent) await appendMailLog(storage, ghii.ghii, { kind: 'magic_link', subject: 'login link' });
    return sent;
}

/**
 * Welcome a person whose account an install created: the account name and a sign-in link valid for
 * WELCOME_LINK_TTL_MS. False, and nothing stored, on the same conditions as sendLoginLink().
 */
export async function sendWelcomeLink(
    storage: Storage, config: AimeatConfig, ghii: GHIIRecord, email: string,
    mail: EmailService | null | undefined = getActiveEmailService(),
): Promise<boolean> {
    if (!mail?.enabled || !ghii.magicLinkEnabled) return false;
    const owner = await storage.getOwner(ghii.ownerName);
    if (!owner || owner.disabledAt) return false;
    const loginUrl = await issueLoginLink(storage, config, ghii, email, WELCOME_LINK_TTL_MS);
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
 * link for a deactivated account stays unspent and changes nothing.
 */
export async function redeemLoginLink(storage: Storage, config: AimeatConfig, token: string): Promise<RedeemResult> {
    const record = token ? await storage.getEmailVerification(token) : null;
    if (!record || record.status !== 'pending' || record.purpose !== 'login') return { ok: false, code: 'INVALID_TOKEN' };
    if (new Date(record.expiresAt).getTime() < Date.now()) {
        await storage.updateEmailVerification(token, { status: 'expired' });
        return { ok: false, code: 'EXPIRED' };
    }
    const owner = await storage.getOwner(record.ownerName);
    if (!owner || owner.disabledAt) return { ok: false, code: 'ACCOUNT_DISABLED' };
    const ghii = await storage.getGHII(`${record.ownerName}@${config.nodeId}`);
    if (!ghii) return { ok: false, code: 'INVALID_TOKEN' };
    await storage.updateEmailVerification(token, { status: 'verified', verifiedAt: new Date().toISOString() });
    // Clicking the link proves the mailbox, as it always has.
    if ((ghii.verificationLevel ?? 0) < 1) await storage.updateGHII(ghii.ghii, { verificationLevel: 1 });
    return { ok: true, ghii };
}
