/**
 * @file oauth-login.ts
 * @description Social login (sign-in) via external OIDC providers — currently Google.
 *   A generic, config-gated sign-in path for HUMAN owners that reuses the same OIDC
 *   relying-party client as FTN verification. On a successful Google login the user is
 *   mapped to a GHII: a returning Google user (matched by provider subject) or a verified
 *   email match link straight to their existing account + session. A BRAND-NEW user is NOT
 *   auto-created — instead they go through a one-time username-choice step: the callback
 *   stashes the verified Google identity in a short-lived signed cookie and bounces back to
 *   the SPA, which prompts the user to confirm or change the suggested username (warning
 *   that it is permanent) before POSTing to finalize, which creates the owner+GHII and
 *   establishes the session. This avoids silently minting a username from the email
 *   local-part (which leaks the address) and gives the user their one chance to pick it.
 * @structure oauthLoginRouter(config, storage, googleClient): GET /v1/ghii/login/google
 *   (authorize → redirect to Google) + GET /v1/ghii/login/google/callback (exchange → map
 *   returning/linked OR stash pending + redirect) + GET /v1/ghii/login/pending (read the
 *   pending cookie) + POST /v1/ghii/login/google/finalize (create with chosen username +
 *   session) + GET /v1/ghii/username-available (live validation). Helpers:
 *   deriveUniqueUsername(), normalizeUsername(), createOwnerForGoogle(), pending-token
 *   sign/verify + cookie read/set/clear.
 * @usage app.use(oauthLoginRouter(config, storage, googleOidcClient)) from routes-loader.
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial implementation: Google sign-in (link-by-verified-email or create).
 *   v1.1.0 — 2026-06-25 — Brand-new users choose their username once (pending-signup cookie +
 *     /login/pending + /login/google/finalize + /username-available); no more silent email-derived name.
 */

import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { GHIIRecord } from '../storage/interface.js';
import type { OidcClient } from '../services/oidc-client.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { generateKeyPair } from '../auth/keypair.js';
import { getNodeCryptoKeys } from '../auth/jwt.js';
import { establishOwnerSession } from '../services/owner-session.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateOwnerName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Name of the short-lived, signed cookie that carries a not-yet-finalized Google signup. */
const PENDING_COOKIE = 'aimeat_pending_signup';
/** Cookie path — covers both /v1/ghii/login/pending and /v1/ghii/login/google/finalize. */
const PENDING_COOKIE_PATH = '/v1/ghii';
/** Pending-signup token lifetime — long enough to pick a name, short enough to limit exposure. */
const PENDING_TTL_SECONDS = 30 * 60;
/** Discriminator claim so a pending-signup token can never be replayed as an auth token. */
const PENDING_PURPOSE = 'google_signup';

/** The verified Google identity we carry between the callback and finalize (signed, never trusted raw). */
interface PendingSignup {
  googleSub: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  suggested: string;
  redirect: string;
}

/** SHA-256 hex of a normalized email — matches the hashing used elsewhere for GHII.emailHash. */
function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/** Normalize a user-typed username the same way registration does: trim, lowercase, strip a same-node @suffix. */
function normalizeUsername(raw: unknown, nodeId: string): { username: string; remoteNode?: string } {
  let username = String(raw ?? '').trim().toLowerCase();
  if (username.includes('@')) {
    const atIdx = username.indexOf('@');
    const nodePart = username.substring(atIdx + 1);
    username = username.substring(0, atIdx);
    if (nodePart && nodePart !== nodeId) return { username, remoteNode: nodePart };
  }
  return { username };
}

/** Sign the verified Google identity into a short-lived EdDSA token (node key). */
async function signPendingToken(data: PendingSignup): Promise<string> {
  const { privateKey } = getNodeCryptoKeys();
  return new SignJWT({
    purpose: PENDING_PURPOSE,
    googleSub: data.googleSub,
    email: data.email,
    emailVerified: data.emailVerified,
    displayName: data.displayName,
    suggested: data.suggested,
    redirect: data.redirect,
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(privateKey);
}

/** Verify + decode a pending-signup token. Returns null on any tamper/expiry/wrong-purpose. */
async function verifyPendingToken(token: string): Promise<PendingSignup | null> {
  try {
    const { publicKey } = getNodeCryptoKeys();
    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['EdDSA'] });
    if (payload.purpose !== PENDING_PURPOSE || typeof payload.googleSub !== 'string') return null;
    return {
      googleSub: payload.googleSub,
      email: typeof payload.email === 'string' ? payload.email : null,
      emailVerified: payload.emailVerified === true,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : 'AIMEAT User',
      suggested: typeof payload.suggested === 'string' ? payload.suggested : 'user',
      redirect: typeof payload.redirect === 'string' ? payload.redirect : '/',
    };
  } catch {
    return null;
  }
}

/** Whether the pending cookie should carry Secure (https or proxied https) — mirrors owner-session. */
function cookieSecure(req: Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

/** Read the raw pending-signup token from the Cookie header (no cookie-parser dep). */
function readPendingCookie(req: Request): string | null {
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

/** Set the httpOnly, host-only pending-signup cookie (Lax so it survives the Google→callback redirect). */
function setPendingCookie(req: Request, res: Response, token: string): void {
  res.cookie(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'lax',
    path: PENDING_COOKIE_PATH,
    maxAge: PENDING_TTL_SECONDS * 1000,
  });
}

/** Clear the pending-signup cookie. */
function clearPendingCookie(req: Request, res: Response): void {
  res.clearCookie(PENDING_COOKIE, {
    httpOnly: true,
    secure: cookieSecure(req),
    sameSite: 'lax',
    path: PENDING_COOKIE_PATH,
  });
}

/**
 * Derive a valid, unique owner name from an email address (or display name fallback).
 * Owner names are `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$` (3-64 chars). We sanitize the email
 * local-part, then append a numeric suffix until the name is free + passes validation.
 */
async function deriveUniqueUsername(storage: Storage, email: string | undefined, fallback: string): Promise<string> {
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
 * Create a fresh owner + GHII linked to a Google account, with the welcome bonus.
 * Shared by the finalize route (the only path that mints a brand-new Google account).
 * Caller must have already validated the username is free + valid.
 */
async function createOwnerForGoogle(
  storage: Storage,
  config: AimeatConfig,
  opts: { username: string; displayName: string; sub: string; email: string | null; emailVerified: boolean },
): Promise<GHIIRecord> {
  const { username, displayName, sub, email, emailVerified } = opts;
  const now = new Date().toISOString();
  const keyPair = await generateKeyPair();

  // First real owner becomes operator (same self-heal logic as registration).
  const allOwners = await storage.listOwners();
  const realOwners = allOwners.filter(o => o.name !== 'anonymous');
  const hasOperator = allOwners.some(o => o.roles.includes('operator'));
  const roles: string[] = ['owner'];
  if (realOwners.length === 0 || !hasOperator) roles.push('operator');

  const owner = await storage.createOwner({
    name: username,
    displayName,
    publicKey: keyPair.publicKey,
    roles,
    createdAt: now,
  });

  const ghii = `${username}@${config.nodeId}`;
  const ghiiRecord = await storage.createGHII({
    username,
    nodeId: config.nodeId,
    ghii,
    displayName,
    googleSub: sub,
    // Google asserts the email; record it as a verified email (level 1).
    emailHash: emailVerified && email ? emailHashOf(email) : undefined,
    emailVerifiedAt: emailVerified && email ? now : undefined,
    notificationEmail: emailVerified && email ? email.toLowerCase().trim() : undefined,
    verificationLevel: emailVerified ? 1 : 0,
    verificationMethod: emailVerified ? 'email' : undefined,
    ownerName: owner.name,
    totpEnabled: false,
    morselBalance: config.welcomeBonus,
    loginCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  if (config.welcomeBonus > 0) {
    await storage.addTransaction({
      id: `tx-${randomUUID()}`,
      gaii: ghii,
      type: 'welcome_bonus',
      amount: config.welcomeBonus,
      timestamp: now,
    });
  }

  return ghiiRecord;
}

export function oauthLoginRouter(
  config: AimeatConfig,
  storage: Storage,
  googleClient: OidcClient | null,
): Router {
  const router = Router();

  const googleAvailable = () => config.googleOAuthEnabled && !!googleClient?.initialized;

  // Sanitize a post-login redirect target: only same-site absolute paths are allowed.
  function safeRedirectPath(raw: unknown): string {
    if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/';
  }

  // GET /v1/ghii/login/google — Begin Google sign-in (redirect to Google's consent screen)
  router.get('/v1/ghii/login/google', async (req, res) => {
    try {
      if (!googleAvailable()) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Google sign-in is not available on this node'));
        return;
      }

      const authRequest = googleClient!.createAuthRequest();
      const nonceTtl = config.nonceTtlSeconds * 1000;
      await storage.createVerificationNonce({
        id: randomUUID(),
        owner: '',                       // login flow — no authenticated owner yet
        type: 'google_login',
        state: authRequest.state,
        nonce: authRequest.nonce,
        redirectUri: safeRedirectPath(req.query.redirect),  // where to send the user after login
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + nonceTtl).toISOString(),
      });

      res.redirect(authRequest.authorizationUrl);
    } catch (err) {
      logger.error('Google sign-in authorize failed', { error: String(err) });
      res.redirect(`${config.baseUrl}/?auth_error=GOOGLE_START_FAILED`);
    }
  });

  // GET /v1/ghii/login/google/callback — Google redirects back here with code + state
  router.get('/v1/ghii/login/google/callback', async (req, res) => {
    const fail = (code: string) => res.redirect(`${config.baseUrl}/?auth_error=${encodeURIComponent(code)}`);
    try {
      if (!googleAvailable()) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Google sign-in is not available on this node'));
        return;
      }

      const code = req.query.code as string | undefined;
      const state = req.query.state as string | undefined;
      if (!code || !state) { fail('GOOGLE_MISSING_CODE'); return; }

      const nonceRecord = await storage.getVerificationNonce(state);
      if (!nonceRecord || nonceRecord.type !== 'google_login') { fail('GOOGLE_INVALID_STATE'); return; }
      if (new Date(nonceRecord.expiresAt) < new Date()) {
        await storage.deleteVerificationNonce(state);
        fail('GOOGLE_STATE_EXPIRED');
        return;
      }

      const tokenResult = await googleClient!.exchangeCode(code, state, nonceRecord.nonce);
      const postLoginPath = safeRedirectPath(nonceRecord.redirectUri);
      await storage.deleteVerificationNonce(state);

      if (!tokenResult.valid || !tokenResult.claims) { fail('GOOGLE_EXCHANGE_FAILED'); return; }

      const claims = tokenResult.claims;
      const sub = typeof claims.sub === 'string' ? claims.sub : undefined;
      const email = typeof claims.email === 'string' ? claims.email : undefined;
      const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
      const displayName = (typeof claims.name === 'string' && claims.name)
        || (typeof claims.given_name === 'string' && claims.given_name)
        || email?.split('@')[0]
        || 'AIMEAT User';
      if (!sub) { fail('GOOGLE_NO_SUBJECT'); return; }

      const now = new Date().toISOString();

      // ── Map the Google identity to a GHII ──
      // 1) Returning Google user — matched by stable provider subject.
      let ghiiRecord = await storage.getGHIIByGoogleSub(sub);

      // 2) Link to an existing account ONLY when Google's email is verified AND it matches
      //    a GHII whose email was already locally verified. Requiring the local side to be
      //    verified too prevents takeover of an account that merely *claimed* (never proved)
      //    this email at registration.
      if (!ghiiRecord && emailVerified && email) {
        const byEmail = await storage.getGHIIByEmailHash(emailHashOf(email));
        if (byEmail && byEmail.emailVerifiedAt) {
          ghiiRecord = await storage.updateGHII(byEmail.ghii, { googleSub: sub });
        }
      }

      // 3) No match — a brand-new user. Do NOT silently create an account with an
      //    email-derived username (that leaks the address and locks in a name the user
      //    never chose). Instead stash the verified Google identity in a short-lived signed
      //    cookie and bounce back to the SPA, which prompts for a one-time username choice;
      //    POST /v1/ghii/login/google/finalize then creates the account + session.
      if (!ghiiRecord) {
        const suggested = await deriveUniqueUsername(storage, email, String(displayName));
        const token = await signPendingToken({
          googleSub: sub,
          email: email ?? null,
          emailVerified,
          displayName: String(displayName),
          suggested,
          redirect: postLoginPath,
        });
        setPendingCookie(req, res, token);
        // Return them to where they started, flagged so the auth lib opens the choose-username step.
        const sep = postLoginPath.includes('?') ? '&' : '?';
        res.redirect(`${config.baseUrl}${postLoginPath}${sep}aimeat_signup=1`);
        return;
      }

      // ── Establish an owner session (httpOnly refresh cookie + access token) ──
      const ownerName = ghiiRecord!.ownerName;
      const ownerRecord = await storage.getOwner(ownerName);
      const roles: string[] = [];
      if (ownerRecord?.roles.includes('owner')) roles.push('owner');
      if (ownerRecord?.roles.includes('operator')) roles.push('operator');
      if (roles.length === 0) roles.push('owner');

      await storage.updateGHII(ghiiRecord!.ghii, {
        lastLoginAt: now,
        loginCount: (ghiiRecord!.loginCount ?? 0) + 1,
      });

      await establishOwnerSession(storage, config, req, res, { owner: ownerName, roles });

      emitChange('ghii');
      // Redirect back to the SPA — it boots logged-in from the refresh cookie.
      res.redirect(`${config.baseUrl}${postLoginPath}`);
    } catch (err) {
      logger.error('Google sign-in callback failed', { error: String(err) });
      fail('GOOGLE_CALLBACK_FAILED');
    }
  });

  // GET /v1/ghii/login/pending — Read the pending Google signup (suggested username + which
  // Google email it is for) so the SPA can render the one-time username-choice step. Reads the
  // signed httpOnly cookie set by the callback; returns NO_PENDING_SIGNUP when absent/expired.
  router.get('/v1/ghii/login/pending', async (req, res) => {
    const raw = readPendingCookie(req);
    const pending = raw ? await verifyPendingToken(raw) : null;
    if (!pending) {
      res.status(404).json(error(config.nodeId, 'NO_PENDING_SIGNUP', 'No pending Google sign-up'));
      return;
    }
    // The googleSub stays server-side; the client only needs what it must show + the redirect.
    res.json(success(config.nodeId, {
      suggested: pending.suggested,
      email: pending.email,
      displayName: pending.displayName,
      redirect: pending.redirect,
    }));
  });

  // GET /v1/ghii/username-available?name=foo — Live validation for the username-choice step.
  // Generic + unauthenticated (registration already exposes name-taken via 409), rate-limited.
  router.get('/v1/ghii/username-available',
    rateLimit({ max: 60, windowMs: 60 * 1000 }),
    async (req, res) => {
      const { username, remoteNode } = normalizeUsername(req.query.name, config.nodeId);
      if (remoteNode) {
        res.json(success(config.nodeId, { name: username, valid: false, available: false, reason: 'Remote node identity cannot be registered here' }));
        return;
      }
      const reason = validateOwnerName(username);
      if (reason) {
        res.json(success(config.nodeId, { name: username, valid: false, available: false, reason }));
        return;
      }
      const taken = !!(await storage.getOwner(username));
      res.json(success(config.nodeId, { name: username, valid: true, available: !taken, reason: taken ? 'Username is already taken' : null }));
    });

  // POST /v1/ghii/login/google/finalize — Complete a brand-new Google sign-up with the username
  // the user chose (or confirmed). Reads the signed pending cookie, validates the name, creates the
  // owner + GHII, and establishes the owner session. Idempotent: if the Google identity already
  // resolved to a GHII (double-submit / a parallel finalize), just establish that session.
  router.post('/v1/ghii/login/google/finalize',
    rateLimit({ max: config.registrationRateLimitMax, windowMs: config.registrationRateLimitWindowMs }),
    async (req, res) => {
      try {
        const raw = readPendingCookie(req);
        const pending = raw ? await verifyPendingToken(raw) : null;
        if (!pending) {
          res.status(400).json(error(config.nodeId, 'NO_PENDING_SIGNUP', 'No pending Google sign-up — start sign-in again'));
          return;
        }

        let ghiiRecord = await storage.getGHIIByGoogleSub(pending.googleSub);

        if (!ghiiRecord) {
          // Username: the user's choice, falling back to the suggested name if they left it blank.
          const chosenRaw = (req.body && typeof req.body.username === 'string' && req.body.username.trim())
            ? req.body.username
            : pending.suggested;
          const { username, remoteNode } = normalizeUsername(chosenRaw, config.nodeId);
          if (remoteNode) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `Cannot register here with a remote identity (node ${remoteNode})`));
            return;
          }
          const nameError = validateOwnerName(username);
          if (nameError) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
            return;
          }
          if (await storage.getOwner(username)) {
            res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Username "${username}" is already registered`));
            return;
          }

          ghiiRecord = await createOwnerForGoogle(storage, config, {
            username,
            displayName: pending.displayName,
            sub: pending.googleSub,
            email: pending.email,
            emailVerified: pending.emailVerified,
          });
        }

        // ── Establish an owner session (httpOnly refresh cookie + access token) ──
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
        clearPendingCookie(req, res);
        emitChange('ghii');

        res.json(success(config.nodeId, {
          ghii: ghiiRecord.ghii,
          owner: ownerName,
          displayName: ghiiRecord.displayName,
          redirect: safeRedirectPath(pending.redirect),
        }));
      } catch (err) {
        logger.error('Google sign-in finalize failed', { error: String(err) });
        res.status(500).json(error(config.nodeId, 'FINALIZE_FAILED', 'Could not complete sign-up'));
      }
    });

  return router;
}
