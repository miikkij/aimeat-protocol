/**
 * @file oauth-login.ts
 * @description Social login (sign-in) via external OIDC providers — currently Google.
 *   A generic, config-gated sign-in path for HUMAN owners that reuses the same OIDC
 *   relying-party client as FTN verification. On a successful Google login the user is
 *   mapped to a GHII (link an existing account by verified email, else create a new one)
 *   and an owner session (httpOnly refresh cookie + short-lived access token) is
 *   established — the same session machinery as password login — before redirecting back
 *   to the SPA, which boots logged-in from the cookie.
 * @structure oauthLoginRouter(config, storage, googleClient): GET /v1/ghii/login/google
 *   (authorize → redirect to Google) + GET /v1/ghii/login/google/callback (exchange →
 *   map to GHII → establish session → redirect). deriveUniqueUsername() helper.
 * @usage app.use(oauthLoginRouter(config, storage, googleOidcClient)) from routes-loader.
 * @version-history
 *   v1.0.0 — 2026-06-20 — Initial implementation: Google sign-in (link-by-verified-email or create).
 */

import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { OidcClient } from '../services/oidc-client.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { generateKeyPair } from '../auth/keypair.js';
import { establishOwnerSession } from '../services/owner-session.js';
import { validateOwnerName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** SHA-256 hex of a normalized email — matches the hashing used elsewhere for GHII.emailHash. */
function emailHashOf(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
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

      // 3) No match — create a fresh owner + GHII linked to this Google account.
      if (!ghiiRecord) {
        const username = await deriveUniqueUsername(storage, email, String(displayName));
        const keyPair = await generateKeyPair();

        // First real owner becomes operator (same self-heal logic as registration).
        const allOwners = await storage.listOwners();
        const realOwners = allOwners.filter(o => o.name !== 'anonymous');
        const hasOperator = allOwners.some(o => o.roles.includes('operator'));
        const roles: string[] = ['owner'];
        if (realOwners.length === 0 || !hasOperator) roles.push('operator');

        const owner = await storage.createOwner({
          name: username,
          displayName: String(displayName),
          publicKey: keyPair.publicKey,
          roles,
          createdAt: now,
        });

        const ghii = `${username}@${config.nodeId}`;
        ghiiRecord = await storage.createGHII({
          username,
          nodeId: config.nodeId,
          ghii,
          displayName: String(displayName),
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

  return router;
}
