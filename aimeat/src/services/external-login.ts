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
 *      the SPA can explain instead of dead-ending at "username taken".
 *   4. Brand-new — a signed pending cookie carries the verified identity to the one-time
 *      username-choice step; finalize creates owner + GHII and establishes the session.
 * @structure PendingSignup + cookie/token helpers; maskOwnerName/emailHashOf/normalizeUsername/
 *   deriveUniqueUsername; externalIdUpdate; createOwnerForProvider; establishForGhii;
 *   mapExternalIdentity; finalizeExternalSignup; safeRedirectPath.
 * @usage const mapped = await mapExternalIdentity(storage, { providerId: 'google', … });
 * @version-history
 *   v1.0.0 — 2026-08-23 — Extracted from routes/oauth-login.ts (BR-04 phase 2). Two widenings:
 *     provider ids are strings (`saml:<connection>` joins the union), and createOwnerForProvider
 *     carries managedBy. One addition: adoption keys and the email-domain restriction, both
 *     no-ops for the OIDC callers.
 */
import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord } from '../storage/interface.js';
import { getNodeCryptoKeys } from '../auth/jwt.js';
import { establishOwnerSession } from './owner-session.js';
import { provisionOwner, registrationRefusal, type RegistrationVia } from './owner-provisioning.js';
import { emitChange } from './event-bus.js';
import { validateOwnerName } from '../utils/gaii.js';

/** Name of the short-lived, signed cookie that carries a not-yet-finalized external signup. */
export const PENDING_COOKIE = 'aimeat_pending_signup';
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
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(privateKey);
}

/** Verify + decode a pending-signup token. Returns null on any tamper/expiry/wrong-purpose. */
export async function verifyPendingToken(token: string): Promise<PendingSignup | null> {
  try {
    const { publicKey } = getNodeCryptoKeys();
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['EdDSA'] });
    if (payload.purpose !== PENDING_PURPOSE || typeof payload.providerSub !== 'string' || typeof payload.provider !== 'string') return null;
    return {
      provider: payload.provider,
      providerSub: payload.providerSub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.emailVerified === true,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : 'AIMEAT User',
      suggested: typeof payload.suggested === 'string' ? payload.suggested : 'user',
      redirect: typeof payload.redirect === 'string' ? payload.redirect : '/',
      mode: payload.mode === 'link_existing' ? 'link_existing' : 'new',
      existingHint: typeof payload.existingHint === 'string' ? payload.existingHint : null,
    };
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    return null;
  }
}

/** Whether the pending cookie should carry Secure (https or proxied https) — mirrors owner-session. */
function cookieSecure(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** Read the raw pending-signup token from the Cookie header (no cookie-parser dep). */
export function readPendingCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === PENDING_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Set the httpOnly, host-only pending-signup cookie (Lax so it survives the IdP→callback redirect). */
export function setPendingCookie(req: Request, res: Response, token: string): void {
  res.cookie(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'lax',
    path: PENDING_COOKIE_PATH,
    maxAge: PENDING_TTL_SECONDS * 1000,
  });
}

/** Clear the pending-signup cookie. */
export function clearPendingCookie(req: Request, res: Response): void {
  res.clearCookie(PENDING_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'lax',
    path: PENDING_COOKIE_PATH,
  });
}

/** Sanitize a post-login redirect target: only same-site absolute paths are allowed. */
export function safeRedirectPath(raw: unknown): string {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
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
  },
): Promise<GHIIRecord> {
  const { providerId, username, displayName, sub, email, emailVerified } = opts;
  const { ghii } = await provisionOwner(storage, config, {
    via: opts.via ?? 'oauth',
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
  if (ownerRecord?.roles.includes('operator')) roles.push('operator');
  if (roles.length === 0) roles.push('owner');

  await storage.updateGHII(ghiiRecord.ghii, {
    lastLoginAt: now,
    loginCount: (ghiiRecord.loginCount ?? 0) + 1,
  });

  await establishOwnerSession(storage, config, req, res, { owner: ownerName, roles });
  emitChange('ghii');
}

export type ExternalMapResult =
  | { outcome: 'login'; ghii: GHIIRecord }
  | { outcome: 'pending'; pending: PendingSignup };

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
  //    NameID). Link the provider key so step 1 answers directly next time.
  if (!ghiiRecord && opts.adoptProviderKeys?.length) {
    for (const key of opts.adoptProviderKeys) {
      const adopted = await storage.getGHIIByExternalId(key, sub);
      if (adopted) {
        ghiiRecord = await storage.updateGHII(adopted.ghii, externalIdUpdate(adopted, providerId, sub));
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

  return { outcome: 'login', ghii: ghiiRecord };
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
  const raw = readPendingCookie(req);
  const pending = raw ? await verifyPendingToken(raw) : null;
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

    ghiiRecord = await createOwnerForProvider(storage, config, {
      providerId: opts.providerId,
      username,
      displayName: chosenDisplayName,
      sub: pending.providerSub,
      email: pending.email,
      emailVerified: pending.emailVerified,
      via: opts.via,
      managedBy: opts.managedBy ?? null,
    });
  }

  await establishForGhii(storage, config, req, res, ghiiRecord);
  if (opts.onLogin) await opts.onLogin(ghiiRecord);
  clearPendingCookie(req, res);
  return { ok: true, ghii: ghiiRecord, redirect: safeRedirectPath(pending.redirect) };
}
