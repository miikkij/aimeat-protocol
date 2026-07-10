/**
 * @file oauth-login.ts
 * @description Social login (sign-in) via external OIDC providers — Google, Casdoor, and Microsoft
 *   Entra ID. A single generic, config-gated sign-in path for HUMAN owners that reuses the shared
 *   OIDC relying-party client (src/services/oidc-client.ts) via the provider registry
 *   (src/services/oidc-providers.ts). For every configured provider the SAME three routes are
 *   registered — authorize → callback → finalize — differing only by the provider's URL segment,
 *   nonce type, claim mapping, and optional tenant gate. On a successful login the user is mapped to
 *   a GHII: a returning user (matched by the provider's stable subject) or a verified-email match
 *   links straight to their existing account + session. A BRAND-NEW user is NOT auto-created —
 *   instead they go through a one-time username-choice step: the callback stashes the verified
 *   identity in a short-lived signed cookie and bounces back to the SPA, which prompts the user to
 *   confirm or change the suggested username (permanent) before POSTing to finalize, which creates
 *   the owner+GHII and establishes the session.
 * @structure oauthLoginRouter(config, storage, providers[]) registers, per provider `<id>`:
 *   GET /v1/ghii/login/<id> (authorize) + GET /v1/ghii/login/<id>/callback (exchange → map
 *   returning/linked OR stash pending + redirect) + POST /v1/ghii/login/<id>/finalize (create with
 *   chosen username + session); plus shared-once: GET /v1/ghii/login/pending (read the pending
 *   cookie), GET /v1/ghii/username-available (live validation), GET /v1/auth/providers (discovery).
 *   Account linking is generic via storage.getGHIIByExternalId + GHIIRecord.externalIdentities
 *   (google also mirrors GHIIRecord.googleSub for the fast/indexed path).
 * @usage const providers = buildOidcProviders(config); app.use(oauthLoginRouter(config, storage, providers));
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial implementation: Google sign-in (link-by-verified-email or create).
 *   v1.1.0 — 2026-06-25 — Brand-new users choose their username once (pending-signup cookie +
 *     /login/pending + /login/google/finalize + /username-available); no more silent email-derived name.
 *   v2.0.0 — 2026-07-01 — Generalised to a multi-provider registry (Google + Casdoor + Entra ID):
 *     provider-parameterised routes, generic externalIdentities linking, per-provider claim mapping +
 *     Entra tenant gating, and a GET /v1/auth/providers discovery endpoint. Google routes/behaviour
 *     are unchanged (its id is 'google', so it emits the exact same paths + error codes).
 *   v2.1.0 — 2026-07-10 — link_existing pending mode: when the IdP email matches an account whose
 *     email was never locally verified, the callback no longer dead-ends the user in the generic
 *     signup modal ("username taken", no explanation) — the pending carries mode+masked hint so the
 *     SPA explains the password-sign-in-once path; finalize refuses it (409 EMAIL_IN_USE) so no
 *     duplicate account can claim the same email. Anti-takeover no-link rule itself is unchanged.
 */

import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { GHIIRecord } from '../storage/interface.js';
import type { OidcProvider, ProviderId } from '../services/oidc-providers.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { getNodeCryptoKeys } from '../auth/jwt.js';
import { establishOwnerSession } from '../services/owner-session.js';
import { provisionOwner } from '../services/owner-provisioning.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateOwnerName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Name of the short-lived, signed cookie that carries a not-yet-finalized OIDC signup. */
const PENDING_COOKIE = 'aimeat_pending_signup';
/** Cookie path — covers both /v1/ghii/login/pending and /v1/ghii/login/<id>/finalize. */
const PENDING_COOKIE_PATH = '/v1/ghii';
/** Pending-signup token lifetime — long enough to pick a name, short enough to limit exposure. */
const PENDING_TTL_SECONDS = 30 * 60;
/** Discriminator claim so a pending-signup token can never be replayed as an auth token. */
const PENDING_PURPOSE = 'oauth_signup';

/** The verified external identity we carry between the callback and finalize (signed, never trusted raw). */
interface PendingSignup {
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
function maskOwnerName(name: string): string {
  return name.length <= 2 ? name[0] + '***' : name[0] + '***' + name[name.length - 1];
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

/** Sign the verified external identity into a short-lived EdDSA token (node key). */
async function signPendingToken(data: PendingSignup): Promise<string> {
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
async function verifyPendingToken(token: string): Promise<PendingSignup | null> {
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

/** Set the httpOnly, host-only pending-signup cookie (Lax so it survives the IdP→callback redirect). */
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
 * The partial GHII update that links a provider identity onto a record: writes the generic
 * externalIdentities map entry and, for google, keeps the indexed googleSub mirror in sync.
 */
function externalIdUpdate(existing: GHIIRecord | null, providerId: ProviderId, sub: string): Partial<GHIIRecord> {
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
 * Create a fresh owner + GHII linked to an external OIDC identity, with the welcome bonus.
 * Shared by the finalize routes (the only path that mints a brand-new social account).
 * Caller must have already validated the username is free + valid.
 */
async function createOwnerForProvider(
  storage: Storage,
  config: AimeatConfig,
  opts: { providerId: ProviderId; username: string; displayName: string; sub: string; email: string | null; emailVerified: boolean },
): Promise<GHIIRecord> {
  const { providerId, username, displayName, sub, email, emailVerified } = opts;
  const { ghii } = await provisionOwner(storage, config, {
    username,
    displayName,
    // The IdP asserts the email; record it as a verified email (level 1) when trusted.
    verifiedEmail: emailVerified && email ? email : null,
    externalIdentities: { [providerId]: sub },
    // Keep the indexed googleSub mirror for the google provider (fast returning-user lookup).
    googleSub: providerId === 'google' ? sub : undefined,
  });
  return ghii;
}

export function oauthLoginRouter(
  config: AimeatConfig,
  storage: Storage,
  providers: OidcProvider[],
): Router {
  const router = Router();

  const providerAvailable = (p: OidcProvider) => p.enabled && !!p.client?.initialized;

  // Sanitize a post-login redirect target: only same-site absolute paths are allowed.
  function safeRedirectPath(raw: unknown): string {
    if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return '/';
  }

  // Shared: establish an owner session (httpOnly refresh cookie + access token) for a resolved GHII.
  async function establishForGhii(req: Request, res: Response, ghiiRecord: GHIIRecord): Promise<void> {
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

  // Register the authorize/callback/finalize trio for one provider.
  function registerProvider(p: OidcProvider): void {
    const PREFIX = p.id.toUpperCase();

    // GET /v1/ghii/login/<id> — Begin sign-in (redirect to the IdP's consent screen)
    router.get(`/v1/ghii/login/${p.id}`, async (req, res) => {
      try {
        if (!providerAvailable(p)) {
          res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', `${p.label} is not available on this node`));
          return;
        }

        const authRequest = p.client!.createAuthRequest();
        const nonceTtl = config.nonceTtlSeconds * 1000;
        await storage.createVerificationNonce({
          id: randomUUID(),
          owner: '',                       // login flow — no authenticated owner yet
          type: p.nonceType as 'google_login' | 'casdoor_login' | 'entra_login',
          state: authRequest.state,
          nonce: authRequest.nonce,
          redirectUri: safeRedirectPath(req.query.redirect),  // where to send the user after login
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + nonceTtl).toISOString(),
        });

        res.redirect(authRequest.authorizationUrl);
      } catch (err) {
        logger.error(`${p.id} sign-in authorize failed`, { error: String(err) });
        res.redirect(`${config.baseUrl}/?auth_error=${PREFIX}_START_FAILED`);
      }
    });

    // GET /v1/ghii/login/<id>/callback — IdP redirects back here with code + state
    router.get(`/v1/ghii/login/${p.id}/callback`, async (req, res) => {
      const fail = (code: string) => res.redirect(`${config.baseUrl}/?auth_error=${encodeURIComponent(code)}`);
      try {
        if (!providerAvailable(p)) {
          res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', `${p.label} is not available on this node`));
          return;
        }

        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;
        if (!code || !state) { fail(`${PREFIX}_MISSING_CODE`); return; }

        const nonceRecord = await storage.getVerificationNonce(state);
        if (!nonceRecord || nonceRecord.type !== p.nonceType) { fail(`${PREFIX}_INVALID_STATE`); return; }
        if (new Date(nonceRecord.expiresAt) < new Date()) {
          await storage.deleteVerificationNonce(state);
          fail(`${PREFIX}_STATE_EXPIRED`);
          return;
        }

        const tokenResult = await p.client!.exchangeCode(code, state, nonceRecord.nonce);
        const postLoginPath = safeRedirectPath(nonceRecord.redirectUri);
        await storage.deleteVerificationNonce(state);

        if (!tokenResult.valid || !tokenResult.claims) { fail(`${PREFIX}_EXCHANGE_FAILED`); return; }

        // Optional pre-mapping gate (e.g. Entra single-tenant enforcement via the `tid` claim).
        if (p.validateClaims) {
          const verr = p.validateClaims(tokenResult.claims);
          if (verr) { fail(verr); return; }
        }

        const mapped = p.mapClaims(tokenResult.claims);
        if (!mapped) { fail(`${PREFIX}_NO_SUBJECT`); return; }
        const { sub, email, emailVerified, displayName } = mapped;

        // ── Map the external identity to a GHII ──
        // 1) Returning user — matched by this provider's stable subject.
        let ghiiRecord = await storage.getGHIIByExternalId(p.id, sub);

        // 2) Link to an existing account ONLY when the IdP's email is verified AND it matches a GHII
        //    whose email was already locally verified. Requiring the local side to be verified too
        //    prevents takeover of an account that merely *claimed* (never proved) this email.
        if (!ghiiRecord && emailVerified && email) {
          const byEmail = await storage.getGHIIByEmailHash(emailHashOf(email));
          if (byEmail && byEmail.emailVerifiedAt) {
            ghiiRecord = await storage.updateGHII(byEmail.ghii, externalIdUpdate(byEmail, p.id, sub));
          } else if (byEmail) {
            // An account claims this email but never verified it locally. Linking here would allow
            // takeover of a typo'd/squatted email, and the generic signup modal would dead-end the
            // account's real owner at "username taken" with no explanation. Bounce to the SPA with a
            // link_existing pending so the modal can explain: sign in with your password once (that
            // verifies the email), after which this provider links automatically.
            const token = await signPendingToken({
              provider: p.id,
              providerSub: sub,
              email,
              emailVerified,
              displayName,
              suggested: '',
              redirect: postLoginPath,
              mode: 'link_existing',
              existingHint: maskOwnerName(byEmail.ownerName),
            });
            setPendingCookie(req, res, token);
            const sep = postLoginPath.includes('?') ? '&' : '?';
            res.redirect(`${config.baseUrl}${postLoginPath}${sep}aimeat_signup=1`);
            return;
          }
        }

        // 3) No match — a brand-new user. Do NOT silently create an account with an email-derived
        //    username. Stash the verified identity in a short-lived signed cookie and bounce back to
        //    the SPA for a one-time username choice; POST .../finalize then creates account + session.
        if (!ghiiRecord) {
          const suggested = await deriveUniqueUsername(storage, email ?? undefined, displayName);
          const token = await signPendingToken({
            provider: p.id,
            providerSub: sub,
            email: email ?? null,
            emailVerified,
            displayName,
            suggested,
            redirect: postLoginPath,
            mode: 'new',
            existingHint: null,
          });
          setPendingCookie(req, res, token);
          const sep = postLoginPath.includes('?') ? '&' : '?';
          res.redirect(`${config.baseUrl}${postLoginPath}${sep}aimeat_signup=1`);
          return;
        }

        await establishForGhii(req, res, ghiiRecord);
        // Redirect back to the SPA — it boots logged-in from the refresh cookie.
        res.redirect(`${config.baseUrl}${postLoginPath}`);
      } catch (err) {
        logger.error(`${p.id} sign-in callback failed`, { error: String(err) });
        fail(`${PREFIX}_CALLBACK_FAILED`);
      }
    });

    // POST /v1/ghii/login/<id>/finalize — Complete a brand-new signup with the chosen username.
    // Reads the signed pending cookie (must be for THIS provider), validates the name, creates the
    // owner + GHII, and establishes the session. Idempotent on double-submit.
    router.post(`/v1/ghii/login/${p.id}/finalize`,
      rateLimit({ max: config.registrationRateLimitMax, windowMs: config.registrationRateLimitWindowMs }),
      async (req, res) => {
        try {
          const raw = readPendingCookie(req);
          const pending = raw ? await verifyPendingToken(raw) : null;
          if (!pending || pending.provider !== p.id) {
            res.status(400).json(error(config.nodeId, 'NO_PENDING_SIGNUP', 'No pending sign-up — start sign-in again'));
            return;
          }
          if (pending.mode === 'link_existing') {
            // Creating a fresh account here would mint a duplicate GHII claiming the same email.
            res.status(409).json(error(config.nodeId, 'EMAIL_IN_USE',
              'An existing account already uses this email — sign in with your username and password once to verify it, then this sign-in links automatically'));
            return;
          }

          let ghiiRecord = await storage.getGHIIByExternalId(p.id, pending.providerSub);

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

            // Display name: the user's choice from the signup modal, falling back to the
            // provider-supplied name when left blank. Unlike the username, it is editable later.
            const chosenDisplayName = (req.body && typeof req.body.displayName === 'string' && req.body.displayName.trim())
              ? req.body.displayName.trim()
              : pending.displayName;

            ghiiRecord = await createOwnerForProvider(storage, config, {
              providerId: p.id,
              username,
              displayName: chosenDisplayName,
              sub: pending.providerSub,
              email: pending.email,
              emailVerified: pending.emailVerified,
            });
          }

          await establishForGhii(req, res, ghiiRecord);
          clearPendingCookie(req, res);

          res.json(success(config.nodeId, {
            ghii: ghiiRecord.ghii,
            owner: ghiiRecord.ownerName,
            displayName: ghiiRecord.displayName,
            redirect: safeRedirectPath(pending.redirect),
          }));
        } catch (err) {
          logger.error(`${p.id} sign-in finalize failed`, { error: String(err) });
          res.status(500).json(error(config.nodeId, 'FINALIZE_FAILED', 'Could not complete sign-up'));
        }
      });
  }

  for (const p of providers) registerProvider(p);

  // GET /v1/auth/providers — Discovery: which social-login providers this node offers. Lets any SPA
  // render the right sign-in buttons instead of hard-coding provider availability.
  router.get('/v1/auth/providers', (_req, res) => {
    const enabled = providers.filter(p => p.enabled).map(p => ({
      id: p.id,
      label: p.label,
      loginUrl: `/v1/ghii/login/${p.id}`,
    }));
    res.json(success(config.nodeId, { providers: enabled }));
  });

  // GET /v1/ghii/login/pending — Read the pending signup (suggested username, which email, and which
  // provider) so the SPA can render the one-time username-choice step + finalize to the right route.
  // Reads the signed httpOnly cookie set by the callback; 404s when absent/expired.
  router.get('/v1/ghii/login/pending', async (req, res) => {
    const raw = readPendingCookie(req);
    const pending = raw ? await verifyPendingToken(raw) : null;
    if (!pending) {
      res.status(404).json(error(config.nodeId, 'NO_PENDING_SIGNUP', 'No pending sign-up'));
      return;
    }
    // The provider subject stays server-side; the client only needs what it must show + the redirect.
    res.json(success(config.nodeId, {
      provider: pending.provider,
      suggested: pending.suggested,
      email: pending.email,
      displayName: pending.displayName,
      redirect: pending.redirect,
      mode: pending.mode,
      existing_hint: pending.existingHint,
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

  return router;
}
