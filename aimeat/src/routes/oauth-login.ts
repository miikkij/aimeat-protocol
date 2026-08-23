/**
 * @file oauth-login.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Social login (sign-in) via external OIDC providers — Google, Casdoor, and Microsoft
 *   Entra ID. A single generic, config-gated sign-in path for HUMAN owners that reuses the shared
 *   OIDC relying-party client (src/services/oidc-client.ts) via the provider registry
 *   (src/services/oidc-providers.ts). For every configured provider the SAME three routes are
 *   registered — authorize → callback → finalize — differing only by the provider's URL segment,
 *   nonce type, claim mapping, and optional tenant gate. The ACCOUNT-MAPPING TREE (returning user →
 *   verified-email link → one-time username choice via the pending cookie) lives in
 *   src/services/external-login.ts, shared with the SAML organisation sign-in (BR-04).
 * @structure oauthLoginRouter(config, storage, providers[]) registers, per provider `<id>`:
 *   GET /v1/ghii/login/<id> (authorize) + GET /v1/ghii/login/<id>/callback (exchange → map via
 *   mapExternalIdentity OR stash pending + redirect) + POST /v1/ghii/login/<id>/finalize
 *   (finalizeExternalSignup); plus shared-once: GET /v1/ghii/login/pending, GET
 *   /v1/ghii/username-available, GET /v1/auth/providers (OIDC providers + listed SSO connections).
 * @usage const providers = buildOidcProviders(config); app.use(oauthLoginRouter(config, storage, providers));
 * @version-history
 *   v3.0.0 — 2026-08-23 — Pure extraction (BR-04): the mapping tree, pending-cookie machinery and
 *     finalize body moved to services/external-login.ts, shared with SAML. Behaviour-preserving
 *     for every OIDC provider. GET /v1/auth/providers additionally lists the LISTED SAML
 *     connections when SSO is enabled, and both callback and finalize answer ACCOUNT_DISABLED for
 *     a deactivated account.
 *   v2.1.0 — 2026-07-10 — link_existing pending mode: when the IdP email matches an account whose
 *     email was never locally verified, the callback no longer dead-ends the user in the generic
 *     signup modal — the pending carries mode+masked hint so the SPA explains the
 *     password-sign-in-once path; finalize refuses it (409 EMAIL_IN_USE).
 *   v2.0.0 — 2026-07-01 — Generalised to a multi-provider registry (Google + Casdoor + Entra ID).
 *   v1.1.0 — 2026-06-25 — Brand-new users choose their username once (pending-signup cookie).
 *   v1.0.0 — 2026-06-20 — Initial implementation: Google sign-in.
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { OidcProvider } from '../services/oidc-providers.js';
import { success, error } from '../middleware/envelope.js';
import { AccountDisabledError } from '../auth/jwt.js';
import {
  mapExternalIdentity, finalizeExternalSignup, establishForGhii,
  signPendingToken, verifyPendingToken, readPendingCookie, setPendingCookie,
  safeRedirectPath, normalizeUsername,
} from '../services/external-login.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { validateOwnerName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

export function oauthLoginRouter(
  config: AimeatConfig,
  storage: Storage,
  providers: OidcProvider[],
): Router {
  const router = Router();

  const providerAvailable = (p: OidcProvider) => p.enabled && !!p.client?.initialized;

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

        // The shared account-mapping tree (services/external-login.ts).
        const result = await mapExternalIdentity(storage, {
          providerId: p.id,
          sub: mapped.sub,
          email: mapped.email,
          emailVerified: mapped.emailVerified,
          displayName: mapped.displayName,
          redirect: postLoginPath,
        });

        if (result.outcome === 'pending') {
          setPendingCookie(req, res, await signPendingToken(result.pending));
          const sep = postLoginPath.includes('?') ? '&' : '?';
          res.redirect(`${config.baseUrl}${postLoginPath}${sep}aimeat_signup=1`);
          return;
        }

        await establishForGhii(storage, config, req, res, result.ghii);
        // Redirect back to the SPA — it boots logged-in from the refresh cookie.
        res.redirect(`${config.baseUrl}${postLoginPath}`);
      } catch (err) {
        // Deactivated account (BR-04): the IdP authenticated the person, but this node's answer is
        // no — establishOwnerSession refused before writing anything. A named error, not a generic
        // failure, so the SPA can say what actually happened.
        if (err instanceof AccountDisabledError) { fail('ACCOUNT_DISABLED'); return; }
        logger.error(`${p.id} sign-in callback failed`, { error: String(err) });
        fail(`${PREFIX}_CALLBACK_FAILED`);
      }
    });

    // POST /v1/ghii/login/<id>/finalize — Complete a brand-new signup with the chosen username.
    router.post(`/v1/ghii/login/${p.id}/finalize`,
      rateLimit({ max: config.registrationRateLimitMax, windowMs: config.registrationRateLimitWindowMs }),
      async (req, res) => {
        try {
          const result = await finalizeExternalSignup(storage, config, req, res, { providerId: p.id, via: 'oauth' });
          if (!result.ok) {
            res.status(result.status).json(error(config.nodeId, result.code, result.message));
            return;
          }
          res.json(success(config.nodeId, {
            ghii: result.ghii.ghii,
            owner: result.ghii.ownerName,
            displayName: result.ghii.displayName,
            redirect: result.redirect,
          }));
        } catch (err) {
          if (err instanceof AccountDisabledError) {
            res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account has been deactivated'));
            return;
          }
          logger.error(`${p.id} sign-in finalize failed`, { error: String(err) });
          res.status(500).json(error(config.nodeId, 'FINALIZE_FAILED', 'Could not complete sign-up'));
        }
      });
  }

  for (const p of providers) registerProvider(p);

  // GET /v1/auth/providers — Discovery: which sign-in providers this node offers. OIDC providers
  // from config, plus the LISTED SSO connections (BR-04 R12) when the SSO doors are on — hidden
  // connections share a direct login link instead, so a shared node never publishes its customer
  // list through its sign-in modal.
  router.get('/v1/auth/providers', async (_req, res) => {
    const enabled: Array<{ id: string; label: string; loginUrl: string }> = providers
      .filter(p => p.enabled)
      .map(p => ({ id: p.id, label: p.label, loginUrl: `/v1/ghii/login/${p.id}` }));
    if (config.ssoEnabled) {
      try {
        for (const c of await storage.listSsoConnections()) {
          if (c.loginVisibility !== 'listed' || !c.saml) continue;
          enabled.push({ id: `saml:${c.id}`, label: c.name, loginUrl: `/v1/ghii/login/saml/${c.id}` });
        }
      } catch (err) {
        logger.warn('listing SSO connections for /v1/auth/providers failed', { error: String(err) });
      }
    }
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
