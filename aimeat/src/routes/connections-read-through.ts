/**
 * @file src/routes/connections-read-through.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The refusal an app or an agent gets at POST /v1/connections/:id/read/:resource when
 *   it lacks connections:read-through: what it lacks and how it gets it. A pure move out of
 *   routes/connections.ts (max-file-lines), unchanged.
 * @structure explainReadThrough
 * @usage router.post('/v1/connections/:id/read/:resource', requireAuth(), explainReadThrough, requireScope('connections:read-through'), …)
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved from routes/connections.ts, unchanged.
 */
import type { RequestHandler } from 'express';
import { denyScope403 } from '../auth/deny.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { READ_THROUGH_SCOPE } from '../services/app-grant-scopes.js';

/**
 * An APP or an AGENT that may not read through a connection is told what it lacks and how it gets
 * it, where requireScope would only name the word. An app adds the word to its
 * `<meta name="aimeat-scopes">`, and its owner approves it in the consent window (routes/app-grants.ts,
 * consent_required with reason app_updated). An agent's owner gives it on the agent's page. Anything
 * else, or a caller that holds the word, goes on to requireScope, which stays the door's gate.
 */
export const explainReadThrough: RequestHandler = (req, res, next) => {
  const auth = req.auth;
  if (auth?.roles.includes('app') && !scopeIsCovered(auth.scopes ?? [], READ_THROUGH_SCOPE)) {
    denyScope403(req, res, [READ_THROUGH_SCOPE],
      'This app may not read what is in the accounts its owner connected: that takes the "connections:read-through" permission, which the owner has not given it. '
      + 'The app asks for it by adding connections:read-through to its <meta name="aimeat-scopes">, and the owner approves it in the consent window that opens the next time the app signs in.');
    return;
  }
  if (auth?.roles.includes('agent') && !scopeIsCovered(auth.scopes ?? [], READ_THROUGH_SCOPE)) {
    denyScope403(req, res, [READ_THROUGH_SCOPE],
      'This agent may not read what is in its connected accounts: that takes the "connections:read-through" permission, which its owner has not given it. '
      + 'Its owner gives it on this agent\'s page under Agents.');
    return;
  }
  next();
};
