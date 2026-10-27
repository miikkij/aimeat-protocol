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
 *   Deactivated accounts answer ACCOUNT_DISABLED at the ACS (a redirect with ?auth_error=, which
 *   opens the sign-in dialog with the reason) and at finalize (JSON 403); an IdP-initiated
 *   (unsolicited) Response is accepted only when the connection explicitly allows it.
 * @structure samlLoginRouter(config, storage): GET /v1/ghii/login/saml/:id (authorize),
 *   POST /v1/ghii/login/saml/:id/acs, POST /v1/ghii/login/saml/:id/finalize.
 * @usage app.use(samlLoginRouter(config, storage));
 * @version-history
 *   2026-10-27 — A sign-in that opens an adopted account with two-step sign-in through the adoption key
 *     tells the person in the bell (services/sso-adoption-notice.ts; secaudit2026oct26, adoption-skips-second-factor).
 *   2026-10-25 — An SP-initiated round finishes only in the browser that started it: authorize sets the
 *     round's cookie (SameSite=None; Secure, since the ACS is a cross-site form post) and stores its
 *     hash and the AuthnRequest id, and the ACS answers ?auth_error=SAML_OTHER_BROWSER to a Response
 *     whose round this request does not hold (middleware/login-round-binding.ts; secaudit2026oct22,
 *     oidc-saml-login-round-not-browser-bound). IdP-initiated sign-in and a plain-http node are unchanged.
 *   2026-10-25 — The IdP's address counts as verified only when it is in the connection's domains, so a
 *     JIT account gets no verified address outside them (secaudit2026oct22,
 *     sso-new-account-email-verified-outside-connection-domains).
 *   2026-10-24 — The ACS sends a first sign-in that matches an account with two-step sign-in by address
 *     to the code step (startLinkSecondFactor); it had linked and opened the session on the address
 *     alone (secaudit2026oct22, external-login-skips-second-factor).
 *   2026-10-15 — A refused SAML Response and a deactivated account at the ACS redirect to the front
 *     page with ?auth_error=SAML_INVALID_RESPONSE / ACCOUNT_DISABLED, as the OIDC callback does,
 *     instead of answering the browser with JSON 401/403 (feature-list audit #20, #22).
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 2).
 *   v1.1.0 — 2026-09-24 — safeRedirectPath comes from utils/same-origin-path.ts, its one home, where
 *     it also refuses a backslash and a control character in the post-login address.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, SsoConnectionRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { AccountDisabledError } from '../auth/jwt.js';
import { inflateRawSync } from 'node:zlib';
import { samlForConnection, spAcsUrl } from '../services/saml-sp.js';
import { bindLoginRound, endLoginRound, loginRoundHeldBy, loginRoundsBound } from '../middleware/login-round-binding.js';
import { ensureSsoMembership } from '../services/sso-membership.js';
import { emailInConnectionDomains } from '../services/sso-connections.js';
import {
  mapExternalIdentity, finalizeExternalSignup, establishForGhii,
  signPendingToken, setPendingCookie,
} from '../services/external-login.js';
import { startLinkSecondFactor } from './ghii/login-link-second-factor.js';
import { twoStepArmed } from '../services/passkeys.js';
import { tellSignedInPastCode } from '../services/sso-adoption-notice.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';
import { safeRedirectPath } from '../utils/same-origin-path.js';

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
  // login gives — that is what lets a provisioned or invited account link on first sign-in. It
  // vouches for the connection's own domains only: an address outside them is carried to the
  // username step but recorded on no new account as verified (secaudit2026oct22,
  // sso-new-account-email-verified-outside-connection-domains). Linking is fenced the same way.
  return { sub: nameID, email, emailVerified: emailInConnectionDomains(conn, email), displayName };
}

/**
 * The ID of the AuthnRequest in a redirect-binding authorize URL (deflated, base64 SAMLRequest), or
 * '' when it cannot be read; the ACS then checks the round's cookie without the request id.
 */
function authnRequestId(url: string): string {
  try {
    const raw = new URL(url).searchParams.get('SAMLRequest');
    if (!raw) return '';
    const xml = inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8');
    return /\sID="([^"]+)"/.exec(xml)?.[1] ?? '';
  } catch (err) {
    logger.warn('SAML authorize: the AuthnRequest id could not be read from the authorize URL', { error: String(err) });
    return '';
  }
}

export function samlLoginRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** The ACS path as the browser posts to it: the round cookie's path. */
  const spAcsPath = (id: string): string => new URL(spAcsUrl(config, id)).pathname;

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
      // correlation is node-saml's own request-id cache. The row also names the request it answers
      // (`nonce`) and the hash of this browser's round cookie (`payload`), which the ACS asks for
      // (middleware/login-round-binding.ts; secaudit2026oct22, oidc-saml-login-round-not-browser-bound).
      const ttlMs = config.nonceTtlSeconds * 1000;
      const binding = bindLoginRound(req, res, config, relayState, spAcsPath(conn.id), ttlMs, 'none');
      await storage.createVerificationNonce({
        id: randomUUID(),
        owner: '',                       // login flow — no authenticated owner yet
        type: 'saml_login',
        state: relayState,
        nonce: authnRequestId(url),
        redirectUri: safeRedirectPath(req.query.redirect),
        payload: binding,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
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
    rateLimit(() => ({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs, keyBy: 'ip' })),
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
          // A browser posts this form, so the answer is a redirect the SPA reads (auth_error), as
          // the OIDC callback does, not a JSON body the person would see as raw text.
          fail('SAML_INVALID_RESPONSE');
          return;
        }
        if (!profileRaw) { fail('SAML_NO_ASSERTION'); return; }

        // RelayState → the parked redirect. SP-initiated logins always carry one; an IdP-initiated
        // login has none and is only reachable when the connection allows it (validation above
        // already enforced InResponseTo accordingly).
        let postLoginPath = '/';
        const relayState = typeof req.body?.RelayState === 'string' ? req.body.RelayState : '';
        const nonceRecord = relayState ? await storage.getVerificationNonce(relayState) : null;
        const roundLive = !!nonceRecord && nonceRecord.type === 'saml_login' && new Date(nonceRecord.expiresAt) >= new Date();
        // A Response to a request this node sent (InResponseTo) finishes only in the browser that
        // started that round: the round's row must be the one the Response answers, and the request
        // must carry the round's cookie (middleware/login-round-binding.ts; secaudit2026oct22,
        // oidc-saml-login-round-not-browser-bound). IdP-initiated responses carry no InResponseTo and
        // stay the connection's explicit opt-in.
        const inResponseTo = typeof profileRaw.inResponseTo === 'string' ? profileRaw.inResponseTo : '';
        if (inResponseTo && loginRoundsBound(config)) {
          const held = roundLive && (!nonceRecord!.nonce || nonceRecord!.nonce === inResponseTo)
            && loginRoundHeldBy(req, relayState, nonceRecord!.payload);
          if (!held) {
            logger.warn('SAML response refused: the round was started in another browser', { connection: conn.id });
            fail('SAML_OTHER_BROWSER');
            return;
          }
          endLoginRound(req, res, config, relayState, spAcsPath(conn.id), 'none');
        }
        if (roundLive) postLoginPath = safeRedirectPath(nonceRecord!.redirectUri);
        if (nonceRecord) await storage.deleteVerificationNonce(relayState);

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

        // A first sign-in matched an account with two-step sign-in by its address: the code step
        // (routes/ghii/login-link-second-factor.ts) saves the link, opens the session and adds the
        // connection's membership after a correct code (secaudit2026oct22, external-login-skips-second-factor).
        if (result.outcome === 'second_factor') {
          await startLinkSecondFactor(storage, config, req, res, result.ghii, `${config.baseUrl}${postLoginPath}`,
            { ...result.link, sso: conn.id });
          return;
        }

        await establishForGhii(storage, config, req, res, result.ghii);
        await ensureSsoMembership(storage, conn, result.ghii.ownerName);
        // The organisation's sign-in opened an adopted account past its two-step code: the person
        // is told (services/sso-adoption-notice.ts; secaudit2026oct26).
        if (result.adoptedNow && twoStepArmed(result.ghii)) void tellSignedInPastCode(storage, result.ghii, conn);

        // Playbook evidence: the connection has seen a real login (throttled write).
        const now = Date.now();
        if (now - (lastLoginStamp.get(conn.id) ?? 0) > LOGIN_STAMP_THROTTLE_MS) {
          lastLoginStamp.set(conn.id, now);
          storage.updateSsoConnection(conn.id, { lastLoginAt: new Date(now).toISOString() })
            .catch(err => logger.warn('lastLoginAt stamp failed', { connection: conn.id, error: String(err) }));
        }

        res.redirect(`${config.baseUrl}${postLoginPath}`);
      } catch (err) {
        if (err instanceof AccountDisabledError) { fail('ACCOUNT_DISABLED'); return; }
        logger.error('SAML ACS failed', { connection: conn.id, error: String(err) });
        fail('SAML_CALLBACK_FAILED');
      }
    });

  // POST /v1/ghii/login/saml/:id/finalize — the one-time username choice for a brand-new account,
  // shared body with the OIDC providers. JIT accounts are `via: 'oauth'` (R9): the registration
  // mode decides, exactly as it does for a first Entra sign-in.
  router.post('/v1/ghii/login/saml/:id/finalize',
    rateLimit(() => ({ max: config.registrationRateLimitMax, windowMs: config.registrationRateLimitWindowMs })),
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
