/**
 * @file owner-login.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How a suite makes an owner and signs them in: POST /v1/ghii with a password, then
 *   POST /v1/ghii/login. The one sign-in every suite uses.
 *
 *   WHY. Until 2026-10-12 most suites signed an owner in with the account key: they signed
 *   `name + NODE_ID + timestamp` with the private key the registration returned and sent it to
 *   POST /v1/auth/token. That owner-key sign-in is deprecated (AIMEAT_OWNER_KEY_LOGIN) and node
 *   4.0.0 removes it (OWNER_KEY_LOGIN_REMOVED_IN, src/config-security.ts), so those suites would all
 *   have stopped at their first line on 4.0.0. The password sign-in is the one a person uses and the
 *   one 4.0.0 keeps. An agent still signs in with its own key (`gaii` + signature on the same route);
 *   that is not removed and is not here.
 *
 *   THE ANSWER HAS THE SHAPE OF A SUITE'S OWN json(). ownerSignIn returns `{ status, body }`, so a
 *   line that read `tok.body.data.token` after the old call reads the same after this one. The key
 *   pair the registration returned is still the owner's key (a password sign-in does not replace it
 *   unless asked), so a suite that signs something else with it keeps doing so.
 *
 *   A guard keeps it this way: test/unit/no-owner-key-sign-in.test.ts refuses a test file that sends
 *   an owner signature to POST /v1/auth/token, except the files named there, which test the
 *   owner-key sign-in itself.
 * @structure OWNER_PASSWORD · OwnerAnswer · ownerSignIn · ownerToken · tokenRoles · RegisteredOwner · setupOperator · registerOwner
 * @usage
 *   import { registerOwner, ownerSignIn, ownerToken, OWNER_PASSWORD } from './helpers/owner-login.js';
 *   const alice = await registerOwner(BASE, `alice${Date.now()}`);      // { name, ghii, token, privateKey, ... }
 *   const tok = await ownerSignIn(BASE, name, 'TheSuitesOwnPw1');        // { status, body } like json()
 *   const token = await ownerToken(BASE, name);                          // the token, or a throw naming why
 * @version-history
 *   v1.1.0 — 2026-10-23 — setupOperator: an operator from POST /v1/admin/setup/register with a password,
 *     signed in with it; POST /v1/admin/setup/token answers 410 from 4.0.0 (secaudit2026oct22).
 *   v1.0.0 — 2026-10-12 — Initial (wish-e2e-testit-ja-sandbox-kirjautuvat-omistaja-avaimella-joka-po).
 */

/** The password every helper-made owner gets, unless the suite names its own. Passes the strength rule. */
export const OWNER_PASSWORD = 'E2eOwnerPass-2026';

/** What a suite's own json() helper returns: the HTTP status and the parsed body. */
export interface OwnerAnswer { status: number; body: any }

async function post(base: string, path: string, body: unknown): Promise<OwnerAnswer & { retryAfterS: number }> {
    const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed, retryAfterS: Number(res.headers.get('retry-after')) || 0 };
}

/**
 * POST once, and again while the node answers 429: a limiter is not what the suite tests. Waits
 * what Retry-After says (1.5 s when it says nothing), up to 90 s in all, because a suite that
 * starts its own node without the runner's limits meets the shipped 5 registrations a minute.
 */
async function postPatiently(base: string, path: string, body: unknown): Promise<OwnerAnswer> {
    let answer = await post(base, path, body);
    let waitedMs = 0;
    while (answer.status === 429 && waitedMs < 90_000) {
        const ms = Math.min(Math.max(answer.retryAfterS * 1000, 1500), 30_000);
        await new Promise(r => setTimeout(r, ms));
        waitedMs += ms;
        answer = await post(base, path, body);
    }
    return { status: answer.status, body: answer.body };
}

/**
 * Sign an owner in with the password: POST /v1/ghii/login. Returns the answer as it came, so the
 * suite asserts on it as it did before (`body.ok`, `body.data.token`, `status`). `extra` carries a
 * second factor (`totp_code`, `backup_code`) or `request_owner_key`.
 */
export async function ownerSignIn(base: string, username: string, password: string = OWNER_PASSWORD, extra: Record<string, unknown> = {}): Promise<OwnerAnswer> {
    return postPatiently(base, '/v1/ghii/login', { username, password, ...extra });
}

/** The session token for an owner, or an error naming the status and the refusal. */
export async function ownerToken(base: string, username: string, password: string = OWNER_PASSWORD): Promise<string> {
    const answer = await ownerSignIn(base, username, password);
    const token = answer.body?.data?.token;
    if (answer.status !== 200 || typeof token !== 'string') {
        throw new Error(`sign-in ${username}: ${answer.status} ${JSON.stringify(answer.body?.error ?? answer.body)}`);
    }
    return token;
}

/**
 * The roles a session token carries, read from its payload. The password sign-in answers without a
 * `roles` field (the owner-key sign-in had one), so a suite that asks whether an owner is an
 * operator reads the token.
 */
export function tokenRoles(token: string): string[] {
    const payload = token.split('.')[1] ?? '';
    try {
        const roles = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).roles;
        return Array.isArray(roles) ? roles : [];
    } catch {
        return [];
    }
}

/** An owner made by registerOwner, signed in. */
export interface RegisteredOwner {
    /** The bare owner name. */
    name: string;
    /** `name@node`, as the registration answered it. */
    ghii: string;
    /** The session token from POST /v1/ghii/login. */
    token: string;
    password: string;
    /** The owner's Ed25519 key pair from the registration, for a suite that signs something else with it. */
    privateKey: string;
    publicKey: string;
    /** The roles the registration gave the owner (the first owner on a node is also its operator). */
    roles: string[];
    /** The registration answer, for a suite that reads more of it. */
    registration: OwnerAnswer;
}

/**
 * Make an operator through the admin setup route (POST /v1/admin/setup/register with the admin
 * password, which grants the operator role) and sign them in with the password. The way a suite gets
 * an operator token: POST /v1/admin/setup/token, the account-key sign-in it used before, answers 410
 * from 4.0.0 (secaudit2026oct22). Throws unless the registration answers 200 and the sign-in gives a
 * token. `displayName` is sent as display_name.
 */
export async function setupOperator(
    base: string,
    adminPassword: string,
    username: string,
    opts: { password?: string; displayName?: string } = {},
): Promise<RegisteredOwner> {
    const password = opts.password ?? OWNER_PASSWORD;
    const send = () => fetch(`${base}/v1/admin/setup/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Password': adminPassword },
        body: JSON.stringify({ name: username, password, ...(opts.displayName ? { display_name: opts.displayName } : {}) }),
    });
    // The setup routes share a limiter of five a minute per address; a suite is not testing it.
    let res = await send();
    for (let waited = 0; res.status === 429 && waited < 90_000;) {
        const ms = Math.min(Math.max((Number(res.headers.get('retry-after')) || 0) * 1000, 1500), 30_000);
        await new Promise(r => setTimeout(r, ms));
        waited += ms;
        res = await send();
    }
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    if (res.status !== 200 || body?.ok !== true) {
        throw new Error(`setup register ${username}: ${res.status} ${JSON.stringify(body?.error ?? body)}`);
    }
    const token = await ownerToken(base, body.owner.name, password);
    return {
        name: body.owner.name,
        ghii: `${body.owner.name}@${JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')).node ?? ''}`,
        token,
        password,
        privateKey: body.private_key,
        publicKey: body.public_key,
        roles: body.owner.roles ?? [],
        registration: { status: res.status, body },
    };
}

/**
 * Register an owner with a password (POST /v1/ghii) and sign them in. Throws unless the
 * registration answers 201 and the sign-in gives a token. `body` adds fields to the registration
 * (email, locale, ...).
 */
export async function registerOwner(
    base: string,
    username: string,
    opts: { password?: string; displayName?: string; body?: Record<string, unknown> } = {},
): Promise<RegisteredOwner> {
    const password = opts.password ?? OWNER_PASSWORD;
    const registration = await postPatiently(base, '/v1/ghii', {
        username, display_name: opts.displayName ?? username, password, ...(opts.body ?? {}),
    });
    if (registration.status !== 201) {
        throw new Error(`register ${username}: ${registration.status} ${JSON.stringify(registration.body?.error ?? registration.body)}`);
    }
    const data = registration.body.data;
    const token = await ownerToken(base, data.owner.name, password);
    return {
        name: data.owner.name,
        ghii: data.ghii.ghii,
        token,
        password,
        privateKey: data.private_key,
        publicKey: data.public_key,
        roles: data.owner.roles ?? [],
        registration,
    };
}
