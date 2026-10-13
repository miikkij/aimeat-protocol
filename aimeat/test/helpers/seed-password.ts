/**
 * @file seed-password.ts
 * @description Give an account that was made WITHOUT a password one, behind the server's back, so a
 *   suite can sign it in with POST /v1/ghii/login.
 *
 *   WHY. Two registration routes make an account with no password: POST /v1/ghii/register-web (email
 *   first, the person signs in by an emailed link) and POST /v1/owners (the programmatic route, which
 *   hands back a key pair). Suites whose subject is one of those routes, or an account made by one,
 *   used to sign the account in with that key on POST /v1/auth/token. Node 4.0.0 removes the owner-key
 *   sign-in (OWNER_KEY_LOGIN_REMOVED_IN), and on a runner's node the emailed link cannot be read, so
 *   those suites write the password hash into the server's database the way verified-email.ts writes a
 *   verified address: through the storage layer the server runs, with the server's own hash function.
 *   The account is then the same account with a password, and the suite signs in as a person would.
 *   What these routes should offer from 4.0.0 is a decision of its own (see the 2026-10-12 report of
 *   wish-e2e-testit-ja-sandbox-kirjautuvat-omistaja-avaimella-joka-po).
 *
 *   signInByLink() is for a suite whose subject is an account that HAS no password (setting the
 *   first one, NO_PASSWORD): it signs the account in by an emailed sign-in link, the way such an
 *   account signs in from 4.0.0, and leaves it without a password.
 * @structure seedPassword · seedSignInLink · signInByLink
 * @usage
 *   import { seedPassword, seedSignInLink, signInByLink } from './helpers/seed-password.js';
 *   const token = await signInByLink(BASE, name, `${name}@example.test`);
 *   const link = await seedSignInLink(BASE, name, `${name}@example.test`);   // unspent, for magic-link/verify
 *   await seedPassword(name);                              // the runner's server, OWNER_PASSWORD
 *   const token = await ownerToken(BASE, name);
 *   await seedPassword(name, 'Pw12345678', { sqlitePath }); // a suite's own node
 * @version-history
 *   v1.1.0 — 2026-10-13 — seedSignInLink(), the first half of signInByLink, for a suite whose subject
 *     is what GET /v1/ghii/magic-link/verify hands out (e2e-agent-token-revocation).
 *   v1.0.0 — 2026-10-12 — Initial (wish-e2e-testit-ja-sandbox-kirjautuvat-omistaja-avaimella-joka-po).
 */
import { hashPassword } from '../../src/services/password.js';
import { issueLoginLink } from '../../src/services/login-link.js';
import { storageFor, markEmailVerified } from './verified-email.js';
import { OWNER_PASSWORD } from './owner-login.js';

/**
 * An unspent sign-in link for `username`, as the node mails one: the address is marked verified and
 * the link turned on behind the server's back (as markEmailVerified does), and the link is issued
 * through the node's own issueLoginLink. Returns the link (GET /v1/ghii/magic-link/open?token=…); its
 * `token` query parameter is what GET /v1/ghii/magic-link/verify takes.
 */
export async function seedSignInLink(base: string, username: string, email: string, opts: { sqlitePath?: string; nodeId?: string } = {}): Promise<string> {
    const nodeId = opts.nodeId ?? process.env.E2E_NODE_ID ?? process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
    await markEmailVerified(username, email, opts);
    const storage = await storageFor(opts.sqlitePath);
    const ghii = await storage.updateGHII(`${username}@${nodeId}`, { magicLinkEnabled: true });
    if (!ghii) throw new Error(`seedSignInLink: no account ${username}@${nodeId}`);
    return issueLoginLink(storage, { baseUrl: base } as Parameters<typeof issueLoginLink>[1], ghii, email.trim().toLowerCase(), 15 * 60 * 1000);
}

/**
 * A session for an account WITHOUT a password, the way such an account signs in from 4.0.0: by an
 * emailed sign-in link. The address is marked verified and the link turned on behind the server's
 * back (as markEmailVerified does), a link is issued through the node's own issueLoginLink, opened
 * as a browser opens it (GET /v1/ghii/magic-link/open sets the refresh cookie), and the cookie is
 * spent on POST /v1/auth/refresh for the access token. The account keeps no password, so a suite
 * whose subject is a password-less account stays about one.
 */
export async function signInByLink(base: string, username: string, email: string, opts: { sqlitePath?: string; nodeId?: string } = {}): Promise<string> {
    const link = await seedSignInLink(base, username, email, opts);
    const opened = await fetch(link, { redirect: 'manual' });
    const rt = /(?:^|;\s*)aimeat_rt=([^;]*)/.exec(opened.headers.getSetCookie().join('\n'))?.[1];
    if (opened.status !== 302 || !rt) throw new Error(`signInByLink ${username}: the link opened no session (${opened.status} ${opened.headers.get('location')})`);
    const refreshed = await fetch(`${base}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `aimeat_rt=${rt}`, 'X-AIMEAT-Refresh': '1' },
    });
    const body = await refreshed.json() as { data?: { token?: string }; error?: unknown };
    if (refreshed.status !== 200 || typeof body.data?.token !== 'string') {
        throw new Error(`signInByLink ${username}: refresh ${refreshed.status} ${JSON.stringify(body.error ?? body)}`);
    }
    return body.data.token;
}

/** Write `password` (OWNER_PASSWORD by default) as `username`'s password, so POST /v1/ghii/login accepts it. */
export async function seedPassword(username: string, password: string = OWNER_PASSWORD, opts: { sqlitePath?: string; nodeId?: string } = {}): Promise<void> {
    const nodeId = opts.nodeId ?? process.env.E2E_NODE_ID ?? process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
    const ghii = `${username}@${nodeId}`;
    const storage = await storageFor(opts.sqlitePath);
    const updated = await storage.updateGHII(ghii, { passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() });
    if (!updated) throw new Error(`seedPassword: no account ${ghii}`);
}
