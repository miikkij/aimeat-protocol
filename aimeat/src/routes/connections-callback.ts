/**
 * @file src/routes/connections-callback.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/connections/callback, the provider's redirect back to this node at the end of
 *   an outbound connection's authorization round. Moved out of routes/connections.ts
 *   (max-file-lines) and changed in the same step: the callback now seals a credential only for the
 *   browser the round was bound to (secrets audit 2026-10-09, chapter 2).
 *
 *   UNAUTHENTICATED BY NECESSITY: the provider redirects a browser here and that browser may carry no
 *   session of ours. Its two gates are the single-use `state`, which names who the connection will
 *   belong to, and the round's cookie (middleware/oauth-round-cookie.ts), which names the one browser
 *   that may finish it. A callback without that cookie consumes the round and connects nothing, so
 *   an authorize address somebody handed on cannot put the approver's account under the starter.
 * @structure answerConnectCallback(config, storage, providers)
 * @usage const answer = answerConnectCallback(config, storage, providers); answer(req, res, { state, code, providerError });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Moved from routes/connections.ts; the round binding is checked and its
 *     cookie cleared; every refusal is text/plain (secrets audit 2026-10-09, chapter 2, and F5).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { requireEncryptionKey } from '../services/connections/credential.js';
import { completeAuthorization, callbackUrl } from '../services/connections/oauth.js';
import type { OutboundProvider } from '../services/connections/providers.js';
import { readRoundBinding, clearRoundBinding } from '../middleware/oauth-round-cookie.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { safeRedirectPath } from '../utils/same-origin-path.js';

/** The path the round cookie is scoped to: the callback's own, as the provider registration names it. */
export function connectCallbackPath(config: AimeatConfig): string {
  try {
    return new URL(callbackUrl(config)).pathname;
  } catch (err) {
    // An unparsable AIMEAT_CONNECT_REDIRECT_URI: the default path, and the operator is told.
    logger.warn('connections: the callback address does not parse; the round cookie uses the default path', { error: String(err) });
    return '/v1/connections/callback';
  }
}

/**
 * Answer one callback. The route registration (routes/connections.ts) reads the three query values
 * and hands them here, so the request's inputs are read where the route is declared.
 */
export function answerConnectCallback(
  config: AimeatConfig, storage: Storage, providers: OutboundProvider[],
): (req: Request, res: Response, query: { state: string; code: string; providerError: string }) => Promise<void> {
  return async (req, res, query) => {
    if (!config.connectionsEnabled) {
      res.status(503);
      sendPlainText(res, 'Outbound connections are not enabled on this node.');
      return;
    }
    const key = requireEncryptionKey(config);
    if (!key) {
      res.status(503);
      sendPlainText(res, 'This node has no encryption key configured.');
      return;
    }
    const { state, code, providerError } = query;
    if (state) clearRoundBinding(req, res, state, connectCallbackPath(config));

    if (providerError) {
      // The user pressed cancel, or the provider refused. Not our failure, and not an error page:
      // the state still needs consuming so a stale row does not sit until it expires.
      await storage.deleteVerificationNonce(state).catch((err: unknown) => {
        logger.warn('connections: could not clear the state after a provider-side refusal', { error: String(err) });
      });
      // text/plain, not the default text/html of res.send(string): providerError is unauthenticated
      // query input, and an HTML response would execute `?error=<img onerror=…>` on this node's own
      // origin (CodeQL js/reflected-xss, AI-triage 2026-08-23).
      res.status(400);
      sendPlainText(res, `The provider did not complete the connection: ${providerError}`);
      return;
    }
    if (!state || !code) {
      res.status(400);
      sendPlainText(res, 'This connection callback is missing its state or code.');
      return;
    }

    const result = await completeAuthorization(
      { config, storage, providers, key },
      { state, code, binding: readRoundBinding(req, state) },
    );
    if (!result.ok) {
      // 403 for a browser the round was not bound to: the request was well formed, and this caller
      // may not finish it. Everything else is a round that cannot be finished at all.
      res.status(result.code === 'NOT_THIS_BROWSER' ? 403 : 400);
      sendPlainText(res, `Could not finish connecting: ${result.reason}`);
      return;
    }
    // Back to wherever the flow started, when the starter said where that was. Same-origin only, as
    // safeRedirectPath reads it: an address from the request that a browser resolves to another
    // site would make this an open redirect, so it lands on the access page instead.
    res.redirect(safeRedirectPath(result.returnUrl, '/profile#access'));
  };
}
