/**
 * @file src/auth/deny.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How this node refuses: the 401 with its RFC 9728 discovery hint, the 403, the
 *   envelope both send, and the one place that lifts a Request into what the refusal log needs.
 *   Extracted from auth/middleware.ts to satisfy max-file-lines; bodies verbatim.
 *
 *   ONE PLACE ON PURPOSE, and it already was before this move: the counter and the refusal log live
 *   inside deny401 rather than at each call site, because they used to be four lines copied in front
 *   of twelve of fourteen calls and two doors refused people without counting them. Extracting the
 *   pair to their own file keeps that property visible instead of buried in an 800-line module.
 *
 *   THE CONFIG ARRIVES BY SETTER. deny401 needs the base URL to build the discovery hint, and that
 *   was a module variable in middleware.ts. setDenyConfig() is called from initSessionAuth(), the
 *   same moment the old variable was assigned, so the behaviour is unchanged: no config wired (unit
 *   tests constructing middleware standalone) means the header is omitted and the body is the same.
 * @structure
 *   - setDenyConfig(config) — called by initSessionAuth()
 *   - auditContext(req) — the request, as the refusal log needs it
 *   - deny401 / deny403 — the two refusals
 * @usage
 *   import { deny401, deny403 } from './deny.js';
 * @version-history
 *   v1.0.0 — 2026-08-23 — Pure extraction from middleware.ts (BR-02 pushed it past 800 lines).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';
import { recordAuthFailure, type AuthFailureContext } from '../services/auth-audit.js';
import { resourceMetadataUrl } from '../services/protected-resource.js';

let _denyConfig: AimeatConfig | null = null;

/** Wired by initSessionAuth(), at the same moment middleware.ts used to assign its own copy. */
export function setDenyConfig(config: AimeatConfig | null): void {
  _denyConfig = config;
}

/**
 * What the refusal log needs, lifted off the request.
 *
 * This is the ONE place that reads a Request for the audit, which is why the service itself takes
 * plain data: a door hands over what it knows, and a surface that is not HTTP can hand over the
 * same shape without pretending to be one.
 */
export function auditContext(req: Request): AuthFailureContext {
  return {
    method: req.method,
    path: req.path,
    ip: req.ip ?? req.socket?.remoteAddress ?? '',
    host: String(req.headers.host ?? ''),
    userAgent: String(req.headers['user-agent'] ?? ''),
    authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    hasCookie: !!req.headers.cookie,
    principal: req.auth
      ? {
        sub: req.auth.sub, owner: req.auth.owner, roles: req.auth.roles,
        ...(req.auth.app ? { app: req.auth.app } : {}),
        ...(req.auth.anonymous ? { anonymous: true } : {}),
      }
      : undefined,
  };
}

/**
 * Refuse an unauthenticated request with 401 AND the RFC 9728 discovery hint. The
 * `resource_metadata` parameter names the protected-resource metadata of the ORIGIN the client
 * actually reached (apex, app origin, portfolio origin), which is how an MCP client learns where
 * to get a token without having been told out of band. Header omitted when the config was never
 * wired (unit tests constructing middleware standalone) — the 401 body is unchanged either way.
 */
/**
 * Refuse an unauthenticated request with 401 AND the RFC 9728 discovery hint.
 *
 * The counter and the refusal log live HERE rather than at each call site. They used to be four
 * lines copied in front of twelve of the fourteen `deny401` calls, which meant two doors refused
 * people without counting them: `aimeat_auth_failures_total` has been reading low, and the operator
 * reading it had no way to know by how much.
 */
export function deny401(req: Request, res: Response, message: string): void {
  const stats = getStats();
  if (stats) stats.increment('auth_failures_total');
  const prom = getPromMetrics();
  if (prom) prom.authFailuresTotal.inc();
  recordAuthFailure(auditContext(req), { status: 401, code: 'AUTH_REQUIRED', reason: message });
  if (_denyConfig && !res.headersSent) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl(req, _denyConfig)}"`);
  }
  res.status(401).json(errorEnvelope('AUTH_REQUIRED', message));
}

/**
 * Refuse an AUTHENTICATED request that lacks the authority: wrong role, missing scope, a principal
 * class the door does not serve.
 *
 * These are the most informative lines in the refusal log and the ones nothing was recording. A 401
 * is usually a stranger with nothing; a 403 is a real, named principal reaching for a door it may
 * not open, and that is either a misconfigured integration or somebody testing the fence.
 */
export function deny403(req: Request, res: Response, code: string, message: string): void {
  recordAuthFailure(auditContext(req), { status: 403, code, reason: message });
  res.status(403).json(errorEnvelope(code, message));
}

/**
 * A scope refusal a CLIENT can act on, not only a person reading the sentence.
 *
 * WHAT WAS MISSING. This node has always named the scope in the message — "Scope "memory:write"
 * required" — which is exactly right for a developer reading a log and useless to the agent that
 * hit it. An agent's only move was to stop, or to have its owner re-approve it from scratch, which
 * means re-granting every permission it already had in order to add one.
 *
 * RFC 6750 §3.1 defines the machine-readable form and MCP adopted it in 2025-11-25 (SEP-835) for
 * exactly this: `insufficient_scope` plus the scope that was needed, on a header a client already
 * parses because it is the same header that carries the OAuth challenge on a 401. A client can then
 * ask for that one word instead of starting again.
 *
 * `resource_metadata` rides along for the same reason it does on the 401: it is where a client
 * learns which authorization server to ask.
 *
 * WHAT THIS DOES NOT DO, said plainly rather than implied: granting the scope is still a separate
 * act by the owner, in Profile → Agents. This half tells the client precisely what to ask for; the
 * half that lets it ask for one word and be granted one word is not built.
 */
export function denyScope403(
  req: Request,
  res: Response,
  needed: string[],
  message: string,
  resourceMetadataUrl?: string,
): void {
  recordAuthFailure(auditContext(req), { status: 403, code: 'SCOPE_DENIED', reason: message });
  // Quoted and space-separated, which is the scope syntax RFC 6749 §3.3 defines and what a client
  // splits on. A comma-separated list here would parse as one scope with commas in it.
  const parts = [
    'Bearer error="insufficient_scope"',
    `error_description="${message.replace(/"/g, '\'')}"`,
    `scope="${needed.join(' ')}"`,
  ];
  if (resourceMetadataUrl) parts.push(`resource_metadata="${resourceMetadataUrl}"`);
  res.setHeader('WWW-Authenticate', parts.join(', '));
  res.status(403).json(errorEnvelope('SCOPE_DENIED', message));
}

function errorEnvelope(code: string, message: string) {
  return {
    ok: false,
    protocol: 'aimeat',
    version: 'v1',
    timestamp: new Date().toISOString(),
    error: { code, message },
    hints: {
      next_actions: [
        { description: 'Authenticate to get a JWT token', method: 'POST', url: '/v1/auth/token' },
      ],
    },
  };
}
