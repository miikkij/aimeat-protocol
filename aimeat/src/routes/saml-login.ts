/**
 * @file src/routes/saml-login.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SAML 2.0 organisation sign-in (BR-04): per-connection authorize → ACS → finalize,
 *   the same three-door shape as the OIDC providers and the same shared account-mapping tree
 *   (services/external-login.ts). Signature, Audience, InResponseTo and validity-window checks are
 *   node-saml's (services/saml-sp.ts) — validation happens BEFORE any account is read or written.
 *
 *   THE MAPPING ORDER is R11: (1) `saml:<id>` = NameID, (2) `scim:<id>` = NameID — a
 *   SCIM-provisioned account whose externalId equals the NameID is adopted and linked, which is
 *   what stops the standard enterprise rollout (provision first, sign in later, opaque NameID)
 *   from minting duplicates — (3) verified email restricted to the connection's own domains,
 *   (4) a brand-new account through the username-choice step, gated by the registration mode.
 *
 *   Deactivated accounts answer ACCOUNT_DISABLED at the ACS and at finalize; an IdP-initiated
 *   (unsolicited) Response is accepted only when the connection explicitly allows it.
 * @structure samlLoginRouter(config, storage): GET /v1/ghii/login/saml/:id (authorize),
 *   POST /v1/ghii/login/saml/:id/acs, POST /v1/ghii/login/saml/:id/finalize.
 * @usage app.use(samlLoginRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 2).
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, SsoConnectionRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { AccountDisabledError } from '../auth/jwt.js';
import { samlForConnection } from '../services/saml-sp.js';
import { ensureSsoMembership } from '../services/sso-membership.js';
import {
  mapExternalIdentity, finalizeExternalSignup, establishForGhii,
  signPendingToken, setPendingCookie, safeRedirectPath,
} from '../services/external-login.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';

/** How often lastLoginAt on the connection is worth a write — playbook evidence, not analytics. */
const LOGIN_STAMP_THROTTLE_MS = 60_000;
const lastLoginStamp = new Map<string, number>();

/** A SAML assertion profile, reduced to the four fields the mapping tree works with. */
function mapProfile(conn: SsoConnectionRecord, profile: Record<string, unknown>): {
  sub: string; email: string | null; emailVerified: boolean; displayName: string;
} | null {
  const nameID = typeof profile.nameID === 'string' && profile.nameID ? profile.nameID : null;
  if (!nameID) return null;

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const attr = (name: string | undefined): string | null => (name ? str(profile[name]) : null);

  // Email: the connection's attribute map wins; then the common claim names (Entra's WS-Fed URI
  // included); then a NameID that already is an address.
  const email = attr(conn.saml?.attributeMap?.email)
    ?? str(profile.email)
    ?? str(profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'])
    ?? str(profile.mail)
    ?? (nameID.includes('@') ? nameID : null);

  const given = str(profile.givenName) ?? str(profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname']);
  const surname = str(profile.surname) ?? str(profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname']);
  const displayName = attr(conn.saml?.attributeMap?.displayName)
    ?? str(profile.displayName)
    ?? str(profile['http://schemas.microsoft.com/identity/claims/displayname'])
    ?? str(profile.cn)
    ?? (given && surname ? `${given} ${surname}` : null)
    ?? email?.split('@')[0]
    ?? nameID;

  // The organisation's own IdP asserts the address, the same vouching a tenant-gated Entra OIDC
  // login gives — that is what lets a provisioned or invited account link on first sign-in.
  return { sub: nameID, email, emailVerified: !!email, displayName };
}

export function samlLoginRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Resolve the connection behind a request, answering the shared refusals. Null = answered. */
  async function connectionFor(req: Request, res: Response): Promise<SsoConnectionRecord | null> {
    if (!config.ssoEnabled) {
      res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Organisation sign-in is not enabled on this node'));
      return null;
    }
    const conn = await storage.getSsoConnection(req.params.id as string);
    if (!conn || !conn.saml) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such sign-in connection'));
      return null;
    }
    return conn;
  }

  // GET /v1/ghii/login/saml/:id — begin sign-in: park the redirect under a RelayState nonce, send
  // the browser to the IdP with a signed-in AuthnRequest URL.
  router.get('/v1/ghii/login/saml/:id', async (req, res) => {
    const conn = await connectionFor(req, res);
    if (!conn) return;
    try {
      const saml = samlForConnection(config, conn);
      const relayState = randomUUID();
      const url = await saml.getAuthorizeUrlAsync(relayState, undefined, {});
      // The nonce row carries the post-login redirect across the IdP round-trip; InResponseTo
      // correlation is node-saml's own request-id cache.
      await storage.createVerificationNonce({
        id: randomUUID(),
        owner: '',                       // login flow — no authenticated owner yet
        type: 'saml_login',
        state: relayState,
        nonce: '',
        redirectUri: safeRedirectPath(req.query.redirect),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + config.nonceTtlSeconds * 1000).toISOString(),
      });
      res.redirect(url);
    } catch (err) {
      logger.error('SAML authorize failed', { connection: conn.id, error: String(err) });
      res.redirect(`${config.baseUrl}/?auth_error=SAML_START_FAILED`);
    }
  });

  // POST /v1/ghii/login/saml/:id/acs — the IdP posts the Response here. Validation first
  // (signature, Audience, InResponseTo, NotBefore/NotOnOrAfter — all node-saml's), account
  // reads and writes only after it holds.
  router.post('/v1/ghii/login/saml/:id/acs',
    rateLimit({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs, keyBy: 'ip' }),
    async (req, res) => {
      const fail = (code: string) => res.redirect(`${config.baseUrl}/?auth_error=${encodeURIComponent(code)}`);
      const conn = await connectionFor(req, res);
      if (!conn) return;
      try {
        const samlResponse = req.body?.SAMLResponse;
        if (typeof samlResponse !== 'string' || !samlResponse) { fail('SAML_MISSING_RESPONSE'); return; }

        // The whole cryptographic question, answered before anything else happens.
        const saml = samlForConnection(config, conn);
        let profileRaw: Record<string, unknown> | null = null;
        try {
          const { profile, loggedOut } = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
          if (!loggedOut && profile) profileRaw = profile as unknown as Record<string, unknown>;
        } catch (err) {
          logger.warn('SAML response refused', { connection: conn.id, error: String(err) });
          res.status(401).json(error(config.nodeId, 'SAML_INVALID_RESPONSE', 'The sign-in response did not validate'));
          return;
        }
        if (!profileRaw) { fail('SAML_NO_ASSERTION'); return; }

        // RelayState → the parked redirect. SP-initiated logins always carry one; an IdP-initiated
        // login has none and is only reachable when the connection allows it (validation above
        // already enforced InResponseTo accordingly).
        let postLoginPath = '/';
        const relayState = typeof req.body?.RelayState === 'string' ? req.body.RelayState : '';
        if (relayState) {
          const nonceRecord = await storage.getVerificationNonce(relayState);
          if (nonceRecord && nonceRecord.type === 'saml_login' && new Date(nonceRecord.expiresAt) >= new Date()) {
            postLoginPath = safeRedirectPath(nonceRecord.redirectUri);
          }
          if (nonceRecord) await storage.deleteVerificationNonce(relayState);
        }

        const mapped = mapProfile(conn, profileRaw);
        if (!mapped) { fail('SAML_NO_SUBJECT'); return; }

        // The shared mapping tree, with this connection's adoption key and domain fence (R11, R5).
        const result = await mapExternalIdentity(storage, {
          providerId: `saml:${conn.id}`,
          sub: mapped.sub,
          email: mapped.email,
          emailVerified: mapped.emailVerified,
          displayName: mapped.displayName,
          redirect: postLoginPath,
          adoptProviderKeys: [`scim:${conn.id}`],
          emailLinkDomains: conn.domains,
        });

        if (result.outcome === 'pending') {
          setPendingCookie(req, res, await signPendingToken(result.pending));
          const sep = postLoginPath.includes('?') ? '&' : '?';
          res.redirect(`${config.baseUrl}${postLoginPath}${sep}aimeat_signup=1`);
          return;
        }

        await establishForGhii(storage, config, req, res, result.ghii);
        await ensureSsoMembership(storage, conn, result.ghii.ownerName);

        // Playbook evidence: the connection has seen a real login (throttled write).
        const now = Date.now();
        if (now - (lastLoginStamp.get(conn.id) ?? 0) > LOGIN_STAMP_THROTTLE_MS) {
          lastLoginStamp.set(conn.id, now);
          storage.updateSsoConnection(conn.id, { lastLoginAt: new Date(now).toISOString() })
            .catch(err => logger.warn('lastLoginAt stamp failed', { connection: conn.id, error: String(err) }));
        }

        res.redirect(`${config.baseUrl}${postLoginPath}`);
      } catch (err) {
        if (err instanceof AccountDisabledError) {
          res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account has been deactivated'));
          return;
        }
        logger.error('SAML ACS failed', { connection: conn.id, error: String(err) });
        fail('SAML_CALLBACK_FAILED');
      }
    });

  // POST /v1/ghii/login/saml/:id/finalize — the one-time username choice for a brand-new account,
  // shared body with the OIDC providers. JIT accounts are `via: 'oauth'` (R9): the registration
  // mode decides, exactly as it does for a first Entra sign-in.
  router.post('/v1/ghii/login/saml/:id/finalize',
    rateLimit({ max: config.registrationRateLimitMax, windowMs: config.registrationRateLimitWindowMs }),
    async (req, res) => {
      const conn = await connectionFor(req, res);
      if (!conn) return;
      try {
        const result = await finalizeExternalSignup(storage, config, req, res, {
          providerId: `saml:${conn.id}`,
          via: 'oauth',
          onLogin: async (ghii) => { await ensureSsoMembership(storage, conn, ghii.ownerName); },
        });
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
        logger.error('SAML finalize failed', { connection: conn.id, error: String(err) });
        res.status(500).json(error(config.nodeId, 'FINALIZE_FAILED', 'Could not complete sign-up'));
      }
    });

  return router;
}
