/**
 * @file src/services/app-parties/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The party's side of an app's own users (plan doc-mvwxcas3dom3, D4.2): sign up with an
 *   e-mail address, open the mailed link (verify), sign in again with a new link, read "me", sign out.
 *   The routes /v1/apps/:owner/:filename/parties/... and the browser library AIMEAT.parties reach these.
 *
 *   THE SIGNUP. Refused unless the node's setting and the app's own signup allow it (./store.ts): 403
 *   PARTY_REGISTRATION_OFF or PARTY_REGISTRATION_CLOSED, and 503 MAIL_NOT_CONFIGURED on a node that
 *   sends no mail, since nobody could open the link. A new address makes a `pending` person party of the
 *   app's owner bound to the app and mails a verify link; an address already there gets a new link
 *   (verify while pending, sign-in once active). The answer is the same 202 for each, so it does not say
 *   which addresses are registered.
 *
 *   THE LINK is 32 random bytes, mailed to the app's own address as `?aimeat_party_link=`, kept as its
 *   SHA-256 on the party, good for 30 minutes and once, and mailed at most once a minute to one person.
 *   Opening it activates a pending party, puts it on
 *   the app's roster with the registration's role (services/app-members.ts; no exchange grant, since a
 *   party has no account to carry), and answers the session: a purpose token naming the app and the
 *   party's epoch. A password-free passkey sign-in can join here later as a second way to answer
 *   verifyLink with a session (EXTENSION POINT: signInWith); nothing of it is built.
 *
 *   EVERY REQUEST RE-READS THE PARTY (appPartyFromRequest): the token must name this app, the party
 *   must be active with the token's epoch, the node's setting must not be off, and an Origin header,
 *   when the browser sends one, must be the app's own address or the node's.
 * @structure AppPartyCtx · signUp · signIn · verifyLink · partyMe · signOut · appPartyFromRequest · signInWith
 * @usage const out = await signUp(deps, { owner, filename }, body);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.2; lead decisions L1 to L3).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { UNCHANGED } from '../record-cas.js';
import { isValidEmail } from '../../utils/email-validator.js';
import { escapeHtml } from '../../utils/html-escape.js';
import { getActiveEmailService } from '../email.js';
import { resolveAppUrls } from '../app-urls.js';
import { resolveGhii } from '../../utils/ghii-resolver.js';
import { logger } from '../../utils/logger.js';
import { getMember, putMember } from '../app-members.js';
import { newPartyUid } from '../parties/keys.js';
import { partyRefOf, PARTY_TOKEN_PREFIX } from '../parties/contract.js';
import { mintPartyToken, verifyPartyToken } from '../parties/token.js';
import {
    APP_PARTY_PREFIX, APP_PARTY_SESSION_SECONDS, LINK_TTL_MS, MAX_APP_PARTIES, appPartyView, emailHashOf,
    type AppPartyRecord,
} from './contract.js';
import { appIdOf, changeAppParties, readAppParties, registrationMode, signupOpen } from './store.js';

export type AppPartyAnswer<T> = { ok: true; status?: number; data: T } | { ok: false; status: number; code: string; message: string };
type Refusal = Extract<AppPartyAnswer<never>, { ok: false }>;
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });
type Deps = { storage: Storage; config: AimeatConfig };
export interface AppRef { owner: string; filename: string }

/** A verified app party on this request. */
export interface AppPartyCtx {
    owner: string; ownerGhii: string; appId: string; filename: string;
    party: AppPartyRecord; partyRef: string;
}

/** The least time between two links mailed to one person. */
const RESEND_MS = 60_000;
const OWNER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The app's owner GHII, or the refusal for a malformed name or an app that does not exist. */
async function appOf(deps: Deps, ref: AppRef): Promise<{ ok: true; ownerGhii: string; appId: string } | Refusal> {
    if (!OWNER_RE.test(ref.owner) || !FILENAME_RE.test(ref.filename)) return refuse(400, 'INVALID_INPUT', 'Invalid app.');
    const ownerGhii = await resolveGhii(deps.storage, ref.owner, deps.config);
    if (!(await deps.storage.getApp(ownerGhii, ref.filename))) return refuse(404, 'NOT_FOUND', 'No such app.');
    return { ok: true, ownerGhii, appId: appIdOf(ref.owner, ref.filename) };
}

/** The link mail, in the party's language when the app names one. */
function linkMail(lang: string, app: string, url: string, signin: boolean): { subject: string; html: string; text: string } {
    const t = lang === 'fi'
        ? { subject: signin ? `Kirjaudu sovellukseen ${app}` : `Vahvista rekisteröitymisesi sovellukseen ${app}`, line: signin ? 'Kirjaudu sisään tästä linkistä:' : 'Vahvista sähköpostiosoitteesi ja kirjaudu sisään tästä linkistä:', note: 'Linkki toimii 30 minuuttia ja kerran. Jos et pyytänyt tätä, voit jättää viestin huomiotta.' }
        : lang === 'es'
            ? { subject: signin ? `Inicia sesión en ${app}` : `Confirma tu registro en ${app}`, line: signin ? 'Inicia sesión con este enlace:' : 'Confirma tu dirección y entra con este enlace:', note: 'El enlace sirve durante 30 minutos y una sola vez. Si no lo pediste, ignora este mensaje.' }
            : { subject: signin ? `Sign in to ${app}` : `Confirm your registration to ${app}`, line: signin ? 'Sign in with this link:' : 'Confirm your address and sign in with this link:', note: 'The link works for 30 minutes and once. If you did not ask for it, ignore this message.' };
    return {
        subject: t.subject,
        html: `<p>${escapeHtml(t.line)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p>${escapeHtml(t.note)}</p>`,
        text: `${t.line}\n\n${url}\n\n${t.note}\n`,
    };
}

/** Mail a fresh link to `email` for `party` and store its hash. False when the mail did not leave. */
async function sendLink(deps: Deps, ref: AppRef, ownerGhii: string, appId: string, party: AppPartyRecord, email: string, lang: string): Promise<boolean> {
    const mail = getActiveEmailService();
    if (!mail?.enabled) return false;
    // One mail a minute per person: a signup repeated for somebody else's address does not flood it.
    if (party.link && Date.parse(party.link.expiresAt) - LINK_TTL_MS + RESEND_MS > Date.now()) return false;
    const token = randomBytes(32).toString('base64url');
    const purpose = party.status === 'pending' ? 'verify' as const : 'signin' as const;
    await changeAppParties(deps.storage, ownerGhii, appId, cur => {
        const i = cur.parties.findIndex(p => p.uid === party.uid);
        if (i < 0) return UNCHANGED;
        const parties = [...cur.parties];
        parties[i] = { ...parties[i]!, link: { hash: sha(token), purpose, expiresAt: new Date(Date.now() + LINK_TTL_MS).toISOString() } };
        return { ...cur, parties };
    });
    const appUrl = Object.values(await resolveAppUrls(deps.config, deps.storage, [{ owner: ref.owner, filename: ref.filename }]))[0]
        ?? `${deps.config.baseUrl.replace(/\/+$/, '')}/v1/apps/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.filename)}`;
    const url = `${appUrl}${appUrl.includes('?') ? '&' : '?'}aimeat_party_link=${encodeURIComponent(token)}`;
    const m = linkMail(lang, ref.filename.replace(/\.html?$/i, ''), url, purpose === 'signin');
    try { return await mail.sendRaw(email, m.subject, m.html, m.text); }
    catch (err) {
        logger.warn('app-parties: the sign-in link mail was not sent', { app: appId, error: String(err) });
        return false;
    }
}

const SENT = (purpose: 'signup' | 'signin'): AppPartyAnswer<Record<string, unknown>> => ({
    ok: true, status: 202,
    data: { sent: true, note: purpose === 'signup'
        ? 'If the address can register, a link is on its way to it. Open it within 30 minutes to finish.'
        : 'If the address is registered, a sign-in link is on its way to it. Open it within 30 minutes.' },
});

/** Sign up to an app with an e-mail address (see the file header). */
export async function signUp(deps: Deps, ref: AppRef, body: Record<string, unknown>): Promise<AppPartyAnswer<Record<string, unknown>>> {
    const app = await appOf(deps, ref);
    if (!app.ok) return app;
    const { ownerGhii, appId } = app;
    const record = await readAppParties(deps.storage, ownerGhii, appId);
    if (registrationMode(deps.config) === 'off') return refuse(403, 'PARTY_REGISTRATION_OFF', 'This server does not let people register to its apps without an account.');
    if (!signupOpen(deps.config, record.registration)) return refuse(403, 'PARTY_REGISTRATION_CLOSED', 'This app does not take new registrations now.');
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!isValidEmail(email)) return refuse(400, 'INVALID_INPUT', 'Give the e-mail address the sign-in link goes to.');
    if (!getActiveEmailService()?.enabled) return refuse(503, 'MAIL_NOT_CONFIGURED', 'This server sends no mail, so the sign-in link cannot reach you. Ask the app\'s owner.');
    const lang = typeof body.lang === 'string' ? body.lang.slice(0, 2) : 'en';
    const hash = emailHashOf(email);
    let party = record.parties.find(p => p.emailHash === hash);
    if (!party) {
        if (record.parties.length >= MAX_APP_PARTIES) return refuse(429, 'TOO_MANY_PARTIES', 'This app has as many registered people as it may hold. Ask its owner.');
        const at = new Date().toISOString();
        const displayName = typeof body.display_name === 'string' && body.display_name.trim() ? body.display_name.trim().slice(0, 120) : email.slice(0, email.indexOf('@')).slice(0, 120);
        const made: AppPartyRecord = {
            uid: newPartyUid(), name: `${APP_PARTY_PREFIX}${randomBytes(6).toString('hex')}`, displayName, kind: 'person', contact: email,
            status: 'pending', createdAt: at, createdBy: `app:${appId}`, keys: [], failedAttempts: 0, lastSeenAt: null,
            app: appId, emailHash: hash, verifiedAt: null, link: null, epoch: 0,
        };
        let full = false;
        await changeAppParties(deps.storage, ownerGhii, appId, cur => {
            if (cur.parties.some(p => p.emailHash === hash)) return UNCHANGED;
            if (cur.parties.length >= MAX_APP_PARTIES) { full = true; return UNCHANGED; }
            return { ...cur, parties: [...cur.parties, made] };
        });
        if (full) return refuse(429, 'TOO_MANY_PARTIES', 'This app has as many registered people as it may hold. Ask its owner.');
        party = (await readAppParties(deps.storage, ownerGhii, appId)).parties.find(p => p.emailHash === hash);
    }
    if (party && party.status !== 'stopped') await sendLink(deps, ref, ownerGhii, appId, party, email, lang);
    return SENT('signup');
}

/** Ask for a sign-in link. The same answer whether or not the address is registered. */
export async function signIn(deps: Deps, ref: AppRef, body: Record<string, unknown>): Promise<AppPartyAnswer<Record<string, unknown>>> {
    const app = await appOf(deps, ref);
    if (!app.ok) return app;
    if (registrationMode(deps.config) === 'off') return refuse(403, 'PARTY_REGISTRATION_OFF', 'This server does not let people sign in to its apps without an account.');
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!isValidEmail(email)) return refuse(400, 'INVALID_INPUT', 'Give the e-mail address you registered with.');
    if (!getActiveEmailService()?.enabled) return refuse(503, 'MAIL_NOT_CONFIGURED', 'This server sends no mail, so the sign-in link cannot reach you. Ask the app\'s owner.');
    const party = (await readAppParties(deps.storage, app.ownerGhii, app.appId)).parties.find(p => p.emailHash === emailHashOf(email));
    if (party && party.status !== 'stopped') await sendLink(deps, ref, app.ownerGhii, app.appId, party, email, typeof body.lang === 'string' ? body.lang.slice(0, 2) : 'en');
    return SENT('signin');
}

/**
 * EXTENSION POINT for a later sign-in method (a passkey): a verified party answered with a session.
 * The link is the only method today; a passkey ceremony would find the party and call this.
 */
export async function signInWith(deps: Deps, ref: AppRef, ownerGhii: string, party: AppPartyRecord): Promise<Record<string, unknown>> {
    const appId = appIdOf(ref.owner, ref.filename);
    const token = await mintPartyToken({ owner: ref.owner, uid: party.uid, kid: 'app', app: appId, ep: party.epoch }, APP_PARTY_SESSION_SECONDS);
    const membership = await getMember(deps.storage, appId, partyRefOf(ref.owner, party.name, deps.config.nodeId));
    return {
        token, token_type: 'Bearer', expires_in: APP_PARTY_SESSION_SECONDS,
        party: appPartyView(party, partyRefOf(ref.owner, party.name, deps.config.nodeId)),
        role: membership?.role ?? null,
    };
}

/** Open a mailed link: activate a pending party, put it on the roster, answer the session. */
export async function verifyLink(deps: Deps, ref: AppRef, body: Record<string, unknown>): Promise<AppPartyAnswer<Record<string, unknown>>> {
    const app = await appOf(deps, ref);
    if (!app.ok) return app;
    if (registrationMode(deps.config) === 'off') return refuse(403, 'PARTY_REGISTRATION_OFF', 'This server does not let people sign in to its apps without an account.');
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > 200) return refuse(400, 'INVALID_INPUT', 'token is the value of aimeat_party_link in the link you opened.');
    const hash = sha(token);
    const now = Date.now();
    let opened: AppPartyRecord | undefined;
    await changeAppParties(deps.storage, app.ownerGhii, app.appId, cur => {
        const i = cur.parties.findIndex(p => !!p.link && same(p.link.hash, hash) && Date.parse(p.link.expiresAt) > now && p.status !== 'stopped');
        if (i < 0) { opened = undefined; return UNCHANGED; }
        const p = cur.parties[i]!;
        const at = new Date(now).toISOString();
        opened = { ...p, link: null, status: 'active', verifiedAt: p.verifiedAt ?? at, lastSeenAt: at };
        const parties = [...cur.parties];
        parties[i] = opened;
        return { ...cur, parties };
    });
    if (!opened) return refuse(401, 'LINK_INVALID', 'This link has been used, has expired, or is not one this app sent. Ask for a new one.');
    const record = await readAppParties(deps.storage, app.ownerGhii, app.appId);
    const memberRef = partyRefOf(ref.owner, opened.name, deps.config.nodeId);
    if (!(await getMember(deps.storage, app.appId, memberRef))) {
        await putMember(deps.storage, { appId: app.appId, account: memberRef, role: record.registration.role || 'member', approvedBy: `app:${app.appId}`, offerings: [], note: 'Registered to the app.' });
    }
    return { ok: true, data: await signInWith(deps, ref, app.ownerGhii, opened) };
}

/**
 * The app party a request names with its token, or the refusal. Re-reads the party on every request
 * (invariant 19): the token's app, the party's status and epoch, the node's setting and the origin.
 */
export async function appPartyFromRequest(
    deps: Deps, ref: AppRef, req: { headers: Record<string, string | string[] | undefined> },
): Promise<{ ok: true; ctx: AppPartyCtx } | Refusal> {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header !== 'string' || !header.startsWith(`Bearer ${PARTY_TOKEN_PREFIX}`)) return refuse(401, 'AUTH_REQUIRED', 'Sign in to this app first.');
    const claims = await verifyPartyToken(header.slice('Bearer '.length).trim());
    const appId = appIdOf(ref.owner, ref.filename);
    if (!claims?.app || claims.app !== appId || claims.owner !== ref.owner) return refuse(401, 'INVALID_PARTY_CREDENTIAL', 'This sign-in is not for this app. Sign in to it again.');
    if (registrationMode(deps.config) === 'off') return refuse(403, 'PARTY_REGISTRATION_OFF', 'This server does not let people sign in to its apps without an account.');
    const app = await appOf(deps, ref);
    if (!app.ok) return app;
    const party = (await readAppParties(deps.storage, app.ownerGhii, appId)).parties.find(p => p.uid === claims.uid);
    if (!party || party.epoch !== claims.ep) return refuse(401, 'INVALID_PARTY_CREDENTIAL', 'This sign-in has ended. Sign in again.');
    if (party.status !== 'active') return refuse(403, 'PARTY_STOPPED', 'Your registration to this app is stopped. Ask the app\'s owner.');
    const originRaw = req.headers.origin;
    const origin = Array.isArray(originRaw) ? originRaw[0] : originRaw;
    if (origin) {
        const urls = Object.values(await resolveAppUrls(deps.config, deps.storage, [{ owner: ref.owner, filename: ref.filename }]));
        const allowed = new Set([...urls, deps.config.baseUrl].filter(u => u && URL.canParse(u)).map(u => new URL(u).origin));
        if (!allowed.has(origin)) return refuse(403, 'ORIGIN_MISMATCH', 'This sign-in works only in the app it was made for.');
    }
    return { ok: true, ctx: { owner: ref.owner, ownerGhii: app.ownerGhii, appId, filename: ref.filename, party, partyRef: partyRefOf(ref.owner, party.name, deps.config.nodeId) } };
}

/** The party's own standing in the app: who it is and its role. */
export async function partyMe(deps: Deps, ctx: AppPartyCtx): Promise<AppPartyAnswer<Record<string, unknown>>> {
    const member = await getMember(deps.storage, ctx.appId, ctx.partyRef);
    return { ok: true, data: { party: appPartyView(ctx.party, ctx.partyRef), role: member?.role ?? null, app: ctx.appId } };
}

/** Sign out: the epoch moves, so this token and every other one of the party ends. */
export async function signOut(deps: Deps, ctx: AppPartyCtx): Promise<AppPartyAnswer<Record<string, unknown>>> {
    await changeAppParties(deps.storage, ctx.ownerGhii, ctx.appId, cur => {
        const i = cur.parties.findIndex(p => p.uid === ctx.party.uid);
        if (i < 0) return UNCHANGED;
        const parties = [...cur.parties];
        parties[i] = { ...parties[i]!, epoch: (parties[i]!.epoch ?? 0) + 1 };
        return { ...cur, parties };
    });
    return { ok: true, data: { signed_out: true } };
}
