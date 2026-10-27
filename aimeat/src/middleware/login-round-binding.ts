/**
 * @file src/middleware/login-round-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An external sign-in round (Google, Casdoor, Entra; SAML started here) finishes only in
 *   the browser that started it (secaudit2026oct22, oidc-saml-login-round-not-browser-bound).
 *
 *   The round was bound only to a server-side row, so a party could start a round with its own
 *   identity at the provider and have another person's browser finish it: that browser then got the
 *   party's owner session cookie, or the username step that creates an account the party can sign in
 *   to. Now the authorize response sets a per-round cookie (./oauth-round-cookie.ts, one value per
 *   round, httpOnly, path = the callback's, lifetime = the round's) and the row stores its hash
 *   (payload `{ binding }`); the callback or ACS completes only when the request carries the cookie.
 *
 *   Nobody is signed in at the start, so unlike the outside-account rounds the binding is given on
 *   the authorize response to whatever browser follows the link: the node's own sign-in pages, the
 *   SDK sign-in dialog on an app origin and the invitation page all navigate there in the person's
 *   own browser, and the provider sends that same browser back.
 *
 *   WHICH COOKIE. The OIDC callback is a cross-site top-level GET, which SameSite=Lax carries. The
 *   SAML ACS is a cross-site form POST, which Lax does not carry, so its cookie is SameSite=None,
 *   and None requires Secure. Rounds are bound on a node whose base URL is https (every node a
 *   provider will send people back to on the internet); a plain-http node (local development) is
 *   left unbound, as before.
 *
 *   A row written before this change carries no binding and completes as before, so a round in
 *   flight across a deploy is not refused. IdP-initiated SAML has no round and stays the
 *   connection's explicit opt-in.
 * @structure loginRoundsBound · bindLoginRound · loginRoundHeldBy · endLoginRound
 * @usage const payload = bindLoginRound(req, res, config, state, callbackPath, ttlMs, 'lax');
 *        if (!loginRoundHeldBy(req, config, state, row.payload)) { refuse }
 * @version-history
 *   2026-10-27 — Over https the round's cookie is `__Host-aimeat_oauth_<hash>` (Secure, Path=/), and the
 *     row records which cookie it set: an app, portfolio or company page could write the old name for
 *     the apex and finish its author's round in a visitor's browser. A row written before this change
 *     reads the old name (secaudit2026oct26, login-round-binding-cookie-settable-from-same-site-author-origin).
 *   2026-10-25 — Initial (secaudit2026oct22, oidc-saml-login-round-not-browser-bound).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import { bindingMatches } from '../services/oauth-round-secrets.js';
import { clearRoundBinding, cookieSecure, newRoundBinding, readRoundBinding, setRoundBinding } from './oauth-round-cookie.js';
import { logger } from '../utils/logger.js';

export type LoginRoundSameSite = 'lax' | 'none';

/** Rounds are bound on a node served over https; see the file header. */
export function loginRoundsBound(config: Pick<AimeatConfig, 'baseUrl'>): boolean {
  return /^https:\/\//i.test(config.baseUrl);
}

/**
 * Give this browser the round's cookie and answer the payload the round's row stores, or null when
 * this node does not bind rounds.
 */
export function bindLoginRound(
  req: Request, res: Response, config: Pick<AimeatConfig, 'baseUrl'>,
  state: string, callbackPath: string, ttlMs: number, sameSite: LoginRoundSameSite,
): string | null {
  if (!loginRoundsBound(config)) return null;
  const binding = newRoundBinding();
  // Over https the cookie is the `__Host-` one, which an app, portfolio or company page (a same-site
  // host that runs its author's script) cannot write for the apex; the row says which was set.
  const host = cookieSecure(req);
  setRoundBinding(req, res, state, callbackPath, ttlMs, binding.value, sameSite, host);
  return JSON.stringify({ binding: binding.hash, cookie: host ? 'host' : 'plain' });
}

/** The binding hash a round's row holds and which cookie carries it, or null for a row without one. */
function storedBinding(payload: string | null | undefined): { hash: string; cookie: 'host' | 'plain' | null } | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { binding?: unknown; cookie?: unknown };
    if (typeof parsed.binding !== 'string') return null;
    return { hash: parsed.binding, cookie: parsed.cookie === 'host' || parsed.cookie === 'plain' ? parsed.cookie : null };
  } catch {
    // Not a binding payload: the row was written by a flow that stores something else.
    logger.warn('login round: a sign-in round row carries a payload that is not JSON; read as unbound');
    return null;
  }
}

/**
 * Does this request belong to the browser that started the round? True for a row with no binding
 * (written before this change, or on a node that does not bind); otherwise the request must carry
 * the round's cookie: the `__Host-` one for a round started over https. A round started over plain
 * http finishes only over plain http, and a row written before 2026-10-27 names no cookie and reads
 * the old one, so a round in flight across the deploy finishes (secaudit2026oct26).
 */
export function loginRoundHeldBy(req: Request, state: string, payload: string | null | undefined): boolean {
  const want = storedBinding(payload);
  if (!want) return true;
  if (want.cookie === 'host') return bindingMatches(readRoundBinding(req, state, true), want.hash);
  if (want.cookie === 'plain' && cookieSecure(req)) return false;
  return bindingMatches(readRoundBinding(req, state), want.hash);
}

/** Remove the round's cookie: the round is finished or refused either way. */
export function endLoginRound(req: Request, res: Response, config: Pick<AimeatConfig, 'baseUrl'>,
  state: string, callbackPath: string, sameSite: LoginRoundSameSite): void {
  if (!loginRoundsBound(config)) return;
  clearRoundBinding(req, res, state, callbackPath, sameSite);
  if (cookieSecure(req)) clearRoundBinding(req, res, state, callbackPath, sameSite, true);
}
