/**
 * @file src/services/external-login.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account-mapping tree shared by every EXTERNAL sign-in — OIDC social login
 *   (Google, Casdoor, Entra) and SAML organisation sign-in (BR-04). Moved out of
 *   routes/oauth-login.ts as a pure extraction when SAML became the second caller; the mapping
 *   rules are unchanged and are the point of sharing them: a fix here fixes every provider.
 *
 *   THE TREE, in order:
 *   1. Returning user — the provider's stable subject in externalIdentities.
 *   2. Adoption keys (SAML only) — the SAME subject under a sibling key, e.g. a SCIM-provisioned
 *      account whose externalId equals the SAML NameID. Linking writes the provider key so step 1
 *      answers next time. Without this, SCIM-first-then-SAML would mint a duplicate account.
 *   3. Link by verified email — only when the IdP vouches for the address AND the local account
 *      verified it too (anti-takeover), AND — when the caller restricts it — the address is in the
 *      organisation's own domains. An unverified local match becomes a `link_existing` pending so
 *      the SPA can explain instead of dead-ending at "username taken". A match on an account with
 *      two-step sign-in armed becomes `second_factor`: nothing is linked until the code is given.
 *   4. Brand-new — a signed pending cookie carries the verified identity to the one-time
 *      username-choice step; finalize creates owner + GHII and establishes the session.
 * @structure PendingSignup + cookie/token helpers; maskOwnerName/emailHashOf/normalizeUsername/
 *   deriveUniqueUsername; externalIdUpdate; createOwnerForProvider; establishForGhii;
 *   mapExternalIdentity; finalizeExternalSignup. (safeRedirectPath is utils/same-origin-path.ts.)
 * @usage const mapped = await mapExternalIdentity(storage, { providerId: 'google', … });
 * @version-history
 *   2026-10-27 — The account an identity provider's sign-in makes reads fromNodeMachine(req) for the setup code (secaudit2026oct26).
 *   2026-10-27 — mapExternalIdentity answers `adoptedNow` when step 2 linked the provider through the
 *     adoption key, so the SAML ACS can tell the person (secaudit2026oct26, adoption-skips-second-factor).
 *   2026-10-27 — finalizeExternalSignup reads fromLoopback through requestFromThisMachine (no forwarding header, a loopback Host) (secaudit2026oct26).
 *   2026-10-27 — Over https the pending sign-up cookie is `__Host-aimeat_pending_signup` (Secure,
 *     Path=/), and readPendingSignup reads the old name only for a token signed before this change:
 *     an app, portfolio or company page could write the old name for the apex (secaudit2026oct26,
 *     login-round-binding-cookie-settable-from-same-site-author-origin).
 *   2026-10-24 — Step 3 on an account with two-step sign-in armed answers `second_factor` and saves no
 *     link; the code step saves it after a correct code (secaudit2026oct22, external-login-skips-second-factor).
 *   2026-10-23 — finalizeExternalSignup passes whether the sign-up request came in on a loopback socket,
 *     so a loopback node's first identity-provider sign-up still needs no setup code from this machine
 *     and needs it from any other (secaudit2026oct22).
 *   2026-10-15 — A refusal from an extension bound to pre_owner_registration answers 403 HOOK_REJECTED
 *     instead of a 500 (feature-list audit 89).
 *   v1.0.1 — 2026-10-05 — The account's operator role is read with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-08-23 — Extracted from routes/oauth-login.ts (BR-04 phase 2). Two widenings:
 *     provider ids are strings (`saml:<connection>` joins the union), and createOwnerForProvider
 *     carries managedBy. One addition: adoption keys and the email-domain restriction, both
 *     no-ops for the OIDC callers.
 *   v1.1.0 — 2026-09-24 — safeRedirectPath moved to utils/same-origin-path.ts, hardened there, so
 *     every door that sends a browser to an address a request named asks one function.
 */
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { getNodeCryptoKeys } from '../auth/jwt.js';
import { fromNodeMachine } from '../auth/loopback-pass.js';
import { establishOwnerSession } from './owner-session.js';
import { provisionOwner, registrationRefusal, RegistrationClosedError, type RegistrationVia } from './owner-provisioning.js';
import { emitChange } from './event-bus.js';
import { validateOwnerName } from '../utils/gaii.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { safeRedirectPath } from '../utils/same-origin-path.js';
import { twoStepArmed } from './passkeys.js';
import { logger } from '../utils/logger.js';

/** Name of the short-lived, signed cookie that carries a not-yet-finalized external signup. */
export const PENDING_COOKIE = 'aimeat_pending_signup';
/** Its name over https: Secure, Path=/, no Domain, so a same-site page of another host cannot write it. */
export const HOST_PENDING_COOKIE = '__Host-aimeat_pending_signup';
/** Cookie path — covers /v1/ghii/login/pending and every /v1/ghii/login/<provider>/finalize. */
const PENDING_COOKIE_PATH = '/v1/ghii';
/** Pending-signup token lifetime — long enough to pick a name, short enough to limit exposure. */
const PENDING_TTL_SECONDS = 30 * 60;
/** Discriminator claim so a pending-signup token can never be replayed as an auth token. */
const PENDING_PURPOSE = 'oauth_signup';

/** The verified external identity carried between the callback/ACS and finalize (signed, never trusted raw). */
export interface PendingSignup {
  provider: string;
  providerSub: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  suggested: string;
  redirect: string;
  /** 'new' = first-time signup (username choice). 'link_existing' = an account already claims this
   *  email but never verified it locally — linking is refused (anti-takeover), so the SPA explains
   *  the password-sign-in-once path instead of offering to create a duplicate account. */
  mode: 'new' | 'link_existing';
  /** Masked username of the unverified-email account ('a***e') — enough for its real owner to
   *  recognise it, not enough to disclose the name to a stranger who owns the email. */
  existingHint: string | null;
}

/** Mask an owner name for the link_existing hint: first + last character survive. */
export function maskOwnerName(name: string): string {
  return name.length <= 2 ? name[0] + '***' : name[0] + '***' + name[name.length - 1];
}

/** SHA-256 hex of a normalized email — matches the hashing used elsewhere for GHII.emailHash. */
export function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/** Normalize a user-typed username the same way registration does: trim, lowercase, strip a same-node @suffix. */
export function normalizeUsername(raw: unknown, nodeId: string): { username: string; remoteNode?: string } {
  let username = String(raw ?? '').trim().toLowerCase();
  if (username.includes('@')) {
    const atIdx = username.indexOf('@');
    const nodePart = username.substring(atIdx + 1);
    username = username.substring(0, atIdx);
    if (nodePart && nodePart !== nodeId) return { username, remoteNode: nodePart };
  }
  return { username };
}

/** Sign the verified external identity into a short-lived EdDSA token (node key). */
export async function signPendingToken(data: PendingSignup): Promise<string> {
  const { privateKey } = getNodeCryptoKeys();
  return new SignJWT({
    purpose: PENDING_PURPOSE,
    provider: data.provider,
    providerSub: data.providerSub,
    email: data.email,
    emailVerified: data.emailVerified,
    displayName: data.displayName,
    suggested: data.suggested,
    redirect: data.redirect,
    mode: data.mode,
    existingHint: data.existingHint,
    // Signed since 2026-10-27: over https it goes out under the `__Host-` cookie only (readPendingSignup).
    hc: 1,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(privateKey);
}

/** Verify + decode a pending-signup token. Returns null on any tamper/expiry/wrong-purpose. */
export async function verifyPendingToken(token: string): Promise<PendingSignup | null> {
  return (await verifyPendingPayload(token))?.pending ?? null;
}

/**
 * Verify + decode a pending-signup token, and say whether it was signed since 2026-10-27, when every
 * new token went out under the `__Host-` cookie on https (claim `hc`).
 */
async function verifyPendingPayload(token: string): Promise<{ pending: PendingSignup; hostCookie: boolean } | null> {
  try {
    const { publicKey } = getNodeCryptoKeys();
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['EdDSA'] });
    if (payload.purpose !== PENDING_PURPOSE || typeof payload.providerSub !== 'string' || typeof payload.provider !== 'string') return null;
    return { hostCookie: payload.hc === 1, pending: {
      provider: payload.provider,
      providerSub: payload.providerSub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.emailVerified === true,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : 'AIMEAT User',
      suggested: typeof payload.suggested === 'string' ? payload.suggested : 'user',
      redirect: typeof payload.redirect === 'string' ? payload.redirect : '/',
      mode: payload.mode === 'link_existing' ? 'link_existing' : 'new',
      existingHint: typeof payload.existingHint === 'string' ? payload.existingHint : null,
    } };
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    return null;
  }
}

/** Whether the pending cookie should carry Secure (https or proxied https) — mirrors owner-session. */
function cookieSecure(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** The first value of one cookie name in the Cookie header, decoded, or null. */
function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        // A value that is not valid percent-encoding is no token of ours; the sign-up step then
        // answers as for a missing cookie.
        logger.warn('external-login: a pending sign-up cookie could not be decoded and was ignored');
        return null;
      }
    }
  }
  return null;
}

/**
 * Read the raw pending-signup token from the Cookie header (no cookie-parser dep). Over https the
 * `__Host-` cookie is read first, and the old name only for a token signed before 2026-10-27 (it
 * lives 30 minutes): an app, portfolio or company page can write the old name for the apex, and a
 * token the node signed since went out under the new name only (secaudit2026oct26).
 */
export async function readPendingSignup(req: Request): Promise<PendingSignup | null> {
  if (cookieSecure(req)) {
    const host = cookieValue(req, HOST_PENDING_COOKIE);
    if (host) return verifyPendingToken(host);
    const legacy = cookieValue(req, PENDING_COOKIE);
    const read = legacy ? await verifyPendingPayload(legacy) : null;
    return read && !read.hostCookie ? read.pending : null;
  }
  const raw = cookieValue(req, PENDING_COOKIE);
  return raw ? verifyPendingToken(raw) : null;
}

/**
 * Set the httpOnly, host-only pending-signup cookie (Lax so it survives the IdP→callback redirect).
 * Over https it is `__Host-aimeat_pending_signup`, Secure with Path=/, which a same-site page of
 * another host cannot write (secaudit2026oct26).
 */
export function setPendingCookie(req: Request, res: Response, token: string): void {
  const host = cookieSecure(req);
  res.cookie(host ? HOST_PENDING_COOKIE : PENDING_COOKIE, token, {
    httpOnly: true,
    secure: host,
    sameSite: 'lax',
    path: host ? '/' : PENDING_COOKIE_PATH,
    maxAge: PENDING_TTL_SECONDS * 1000,
  });
}

/** Clear the pending-signup cookie: both names over https. */
export function clearPendingCookie(req: Request, res: Response): void {
  if (cookieSecure(req)) res.clearCookie(HOST_PENDING_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.clearCookie(PENDING_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'lax',
    path: PENDING_COOKIE_PATH,
  });
}

/**
 * The partial GHII update that links a provider identity onto a record: writes the generic
 * externalIdentities map entry and, for google, keeps the indexed googleSub mirror in sync.
 * Provider ids are plain strings now (`saml:<connection>` joined the original union).
 */
export function externalIdUpdate(existing: GHIIRecord | null, providerId: string, sub: string): Partial<GHIIRecord> {
  const externalIdentities = { ...(existing?.externalIdentities ?? {}), [providerId]: sub };
  const update: Partial<GHIIRecord> = { externalIdentities };
  if (providerId === 'google') update.googleSub = sub;
  return update;
}

/**
 * Derive a valid, unique owner name from an email address (or display name fallback).
 * Owner names are `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` (3-64 chars). We sanitize the email
 * local-part, then append a numeric suffix until the name is free + passes validation.
 */
export async function deriveUniqueUsername(storage: Storage, email: string | undefined, fallback: string): Promise<string> {
  const base = (email?.split('@')[0] || fallback || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  let stem = base.length >= 3 ? base.slice(0, 60) : `${base || 'user'}-acct`;
  // Ensure the bare stem itself is valid; if not, fall back to a generic stem.
  if (validateOwnerName(stem)) stem = 'user';

  let candidate = stem;
  let n = 1;
  // Append a numeric suffix until the name is both free and valid.
  while (await storage.getOwner(candidate) || validateOwnerName(candidate)) {
    n += 1;
    candidate = `${stem}-${n}`;
  }
  return candidate;
}

/**
 * Create a fresh owner + GHII linked to an external identity, with the welcome bonus.
 * Callers must have already validated the username is free + valid. `via` names the door for the
 * registration-mode gate; `managedBy` marks a SCIM-managed account's lifecycle owner.
 */
export async function createOwnerForProvider(
  storage: Storage,
  config: AimeatConfig,
  opts: {
    providerId: string; username: string; displayName: string; sub: string;
    email: string | null; emailVerified: boolean; via?: RegistrationVia; managedBy?: string | null;
    /** The sign-up request came in on a loopback socket (provisionOwner's `fromLoopback`). */
    fromLoopback?: boolean;
  },
): Promise<GHIIRecord> {
  const { providerId, username, displayName, sub, email, emailVerified } = opts;
  const { ghii } = await provisionOwner(storage, config, {
    via: opts.via ?? 'oauth',
    fromLoopback: opts.fromLoopback,
    username,
    displayName,
    // The IdP asserts the email; record it as a verified email (level 1) when trusted.
    verifiedEmail: emailVerified && email ? email : null,
    externalIdentities: { [providerId]: sub },
    // Keep the indexed googleSub mirror for the google provider (fast returning-user lookup).
    googleSub: providerId === 'google' ? sub : undefined,
  });
  if (opts.managedBy) {
    await storage.updateOwner(username, { managedBy: opts.managedBy });
  }
  return ghii;
}

/**
 * Establish an owner session for a resolved GHII after an external login: roles are read from the
 * OWNER record (never copied from anywhere else), the login counters bump, the cookie + access
 * token land. Throws AccountDisabledError from establishOwnerSession for a deactivated account.
 */
export async function establishForGhii(
  storage: Storage,
  config: AimeatConfig,
  req: Request,
  res: Response,
  ghiiRecord: GHIIRecord,
): Promise<void> {
  const now = new Date().toISOString();
  const ownerName = ghiiRecord.ownerName;
  const ownerRecord = await storage.getOwner(ownerName);
  const roles: string[] = [];
  if (ownerRecord?.roles.includes('owner')) roles.push('owner');
  if (isOperatorAccount(ownerRecord)) roles.push('operator');
  if (roles.length === 0) roles.push('owner');

  await storage.updateGHII(ghiiRecord.ghii, {
    lastLoginAt: now,
    loginCount: (ghiiRecord.loginCount ?? 0) + 1,
  });

  await establishOwnerSession(storage, config, req, res, { owner: ownerName, roles });
  emitChange('ghii');
}

/** A provider identity to save on an account once its second factor is given. */
export interface PendingExternalLink { providerId: string; sub: string }

export type ExternalMapResult =
  /** `adoptedNow`: this sign-in linked the provider through the adoption key (step 2). */
  | { outcome: 'login'; ghii: GHIIRecord; adoptedNow?: boolean }
  | { outcome: 'pending'; pending: PendingSignup }
  /** Step 3 matched an account with two-step sign-in armed: nothing is linked yet. The caller starts
   *  the code step (routes/ghii/login-link-second-factor.ts startLinkSecondFactor) with `link`, and
   *  the code step saves the link only after a correct code. */
  | { outcome: 'second_factor'; ghii: GHIIRecord; link: PendingExternalLink };

/**
 * Map a verified external identity to a GHII — the tree in the file header. Pure decision plus the
 * linking writes; the caller turns 'pending' into the signed cookie + SPA redirect.
 */
export async function mapExternalIdentity(
  storage: Storage,
  opts: {
    providerId: string;
    sub: string;
    email: string | null;
    emailVerified: boolean;
    displayName: string;
    redirect: string;
    /** Sibling externalIdentities keys that count as "already this organisation's account" —
     *  SAML passes its connection's `scim:<id>` so a provisioned account is adopted, not duplicated. */
    adoptProviderKeys?: string[];
    /** Restrict step 3 (link by verified email) to these domains (BR-04 R5). Null/absent = any. */
    emailLinkDomains?: string[] | null;
  },
): Promise<ExternalMapResult> {
  const { providerId, sub, email, emailVerified, displayName, redirect } = opts;

  // 1) Returning user — matched by this provider's stable subject.
  let ghiiRecord = await storage.getGHIIByExternalId(providerId, sub);

  // 2) Adoption: the same subject under a sibling key (a SCIM externalId equal to the SAML
  //    NameID). Link the provider key so step 1 answers directly next time. The organisation's
  //    directory vouches for the account here, so no second factor is asked; the caller tells the
  //    person when the account has one (secaudit2026oct26).
  let adoptedNow = false;
  if (!ghiiRecord && opts.adoptProviderKeys?.length) {
    for (const key of opts.adoptProviderKeys) {
      const adopted = await storage.getGHIIByExternalId(key, sub);
      if (adopted) {
        ghiiRecord = await storage.updateGHII(adopted.ghii, externalIdUpdate(adopted, providerId, sub));
        adoptedNow = !!ghiiRecord;
        break;
      }
    }
  }

  // 3) Link to an existing account ONLY when the IdP's email is verified AND it matches a GHII
  //    whose email was already locally verified. Requiring the local side to be verified too
  //    prevents takeover of an account that merely *claimed* (never proved) this email. When the
  //    caller restricts linking to an organisation's own domains, a foreign-domain match is
  //    treated as no match at all.
  if (!ghiiRecord && emailVerified && email) {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    const domainAllowed = !opts.emailLinkDomains || opts.emailLinkDomains.includes(domain);
    if (domainAllowed) {
      const byEmail = await storage.getGHIIByEmailHash(emailHashOf(email));
      if (byEmail && byEmail.emailVerifiedAt && twoStepArmed(byEmail)) {
        // The address match is the only proof that this new subject is the account's person. On an
        // account with two-step sign-in the password sign-in and the sign-in link also ask for the
        // code, so the link is not saved and no session opens until the code is given
        // (secaudit2026oct22, external-login-skips-second-factor). An identity already linked
        // (step 1) signs in without the code, as before.
        return { outcome: 'second_factor', ghii: byEmail, link: { providerId, sub } };
      }
      if (byEmail && byEmail.emailVerifiedAt) {
        ghiiRecord = await storage.updateGHII(byEmail.ghii, externalIdUpdate(byEmail, providerId, sub));
      } else if (byEmail) {
        // An account claims this email but never verified it locally. Linking here would allow
        // takeover of a typo'd/squatted email, and the generic signup modal would dead-end the
        // account's real owner at "username taken" with no explanation. A link_existing pending
        // lets the modal explain: sign in with your password once (that verifies the email),
        // after which this provider links automatically.
        return {
          outcome: 'pending',
          pending: {
            provider: providerId, providerSub: sub, email, emailVerified, displayName,
            suggested: '', redirect, mode: 'link_existing', existingHint: maskOwnerName(byEmail.ownerName),
          },
        };
      }
    }
  }

  // 4) No match — a brand-new user. Do NOT silently create an account with an email-derived
  //    username: the pending cookie carries the identity to the one-time username choice.
  if (!ghiiRecord) {
    const suggested = await deriveUniqueUsername(storage, email ?? undefined, displayName);
    return {
      outcome: 'pending',
      pending: {
        provider: providerId, providerSub: sub, email: email ?? null, emailVerified, displayName,
        suggested, redirect, mode: 'new', existingHint: null,
      },
    };
  }

  return { outcome: 'login', ghii: ghiiRecord, ...(adoptedNow ? { adoptedNow } : {}) };
}

export type FinalizeResult =
  | { ok: true; ghii: GHIIRecord; redirect: string }
  | { ok: false; status: number; code: string; message: string };

/**
 * Complete a brand-new external signup with the chosen username — the shared body of every
 * /v1/ghii/login/<provider>/finalize. Reads and validates the pending cookie (must be for THIS
 * provider), applies the registration-mode gate, creates owner + GHII, establishes the session.
 * Idempotent on double-submit. The caller sends the HTTP response.
 */
export async function finalizeExternalSignup(
  storage: Storage,
  config: AimeatConfig,
  req: Request,
  res: Response,
  opts: { providerId: string; via: RegistrationVia; managedBy?: string | null; onLogin?: (ghii: GHIIRecord) => Promise<void> },
): Promise<FinalizeResult> {
  const pending = await readPendingSignup(req);
  if (!pending || pending.provider !== opts.providerId) {
    return { ok: false, status: 400, code: 'NO_PENDING_SIGNUP', message: 'No pending sign-up — start sign-in again' };
  }
  if (pending.mode === 'link_existing') {
    // Creating a fresh account here would mint a duplicate GHII claiming the same email.
    return {
      ok: false, status: 409, code: 'EMAIL_IN_USE',
      message: 'An existing account already uses this email — sign in with your username and password once to verify it, then this sign-in links automatically',
    };
  }

  let ghiiRecord = await storage.getGHIIByExternalId(opts.providerId, pending.providerSub);

  if (!ghiiRecord) {
    // Registration mode: an existing linked account is a LOGIN and is never gated; only this
    // branch — a brand-new account from a first sign-in — is refused on a gated node.
    const modeRefusal = registrationRefusal(config, opts.via);
    if (modeRefusal) {
      return { ok: false, status: 403, code: 'REGISTRATION_CLOSED', message: modeRefusal };
    }
    // Username: the user's choice, falling back to the suggested name if they left it blank.
    const chosenRaw = (req.body && typeof req.body.username === 'string' && req.body.username.trim())
      ? req.body.username
      : pending.suggested;
    const { username, remoteNode } = normalizeUsername(chosenRaw, config.nodeId);
    if (remoteNode) {
      return { ok: false, status: 400, code: 'INVALID_INPUT', message: `Cannot register here with a remote identity (node ${remoteNode})` };
    }
    const nameError = validateOwnerName(username);
    if (nameError) {
      return { ok: false, status: 400, code: 'INVALID_INPUT', message: nameError };
    }
    if (await storage.getOwner(username)) {
      return { ok: false, status: 409, code: 'NAME_TAKEN', message: `Username "${username}" is already registered` };
    }

    // Display name: the user's choice from the signup modal, falling back to the
    // provider-supplied name when left blank. Unlike the username, it is editable later.
    const chosenDisplayName = (req.body && typeof req.body.displayName === 'string' && req.body.displayName.trim())
      ? req.body.displayName.trim()
      : pending.displayName;

    try {
      ghiiRecord = await createOwnerForProvider(storage, config, {
        providerId: opts.providerId,
        username,
        displayName: chosenDisplayName,
        sub: pending.providerSub,
        email: pending.email,
        emailVerified: pending.emailVerified,
        via: opts.via,
        managedBy: opts.managedBy ?? null,
        fromLoopback: fromNodeMachine(req),
      });
    } catch (e) {
      // An extension bound to pre_owner_registration refused the account (feature-list audit 89).
      if (e instanceof RegistrationClosedError) return { ok: false, status: 403, code: e.code, message: e.message };
      throw e;
    }
  }

  await establishForGhii(storage, config, req, res, ghiiRecord);
  if (opts.onLogin) await opts.onLogin(ghiiRecord);
  clearPendingCookie(req, res);
  return { ok: true, ghii: ghiiRecord, redirect: safeRedirectPath(pending.redirect) };
}
