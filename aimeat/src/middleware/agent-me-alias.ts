/**
 * @file agent-me-alias.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description URL-rewrite middleware that resolves `/v1/agents/me/...` paths to
 *   `/v1/agents/{agentName}/...` based on the authenticated agent's JWT.
 *
 * Why: the tier-1 handbook tells agents "All agent URLs use /v1/agents/me/ which
 * resolves to your name." Without this rewriter, only the handbook routes
 * (which read `req.auth.sub` directly) honour that promise -- every other agent
 * endpoint (`tasks`, `onboarding`, `inbox`, ...) 404s because they're registered
 * with the literal agent name. This middleware closes that gap so the
 * documentation is true everywhere.
 *
 * Scope: only rewrites when the caller has an agent-role JWT (a parseable GAII
 * in req.auth.sub). Owner sessions are NOT rewritten -- "me" is ambiguous for
 * an owner who has many agents; those requests fall through and 404, which is
 * the correct outcome.
 *
 * Exclusions: `/v1/agents/me/handbook` and `/v1/agents/me/handbook/...` are
 * served as literals by routes/prompts.ts and must NOT be rewritten.
 *
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Initial creation to fix F6 broken /me/ alias.
 */
import type { Request, Response, NextFunction } from 'express';
import { parseGAII } from '../utils/gaii.js';

const ME_PREFIX = '/v1/agents/me/';
const HANDBOOK_LITERAL_RE = /^\/v1\/agents\/me\/handbook(\/|$|\?)/;

export function agentMeAliasMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.url.startsWith(ME_PREFIX)) { next(); return; }
    if (HANDBOOK_LITERAL_RE.test(req.url)) { next(); return; }

    const sub = req.auth?.sub;
    if (!sub) { next(); return; } // unauthenticated -- let route 401/404 normally

    const parsed = parseGAII(sub);
    if (!parsed) { next(); return; } // not an agent JWT (owner session) -- leave as-is

    const rewritten = `/v1/agents/${encodeURIComponent(parsed.agent)}/` + req.url.slice(ME_PREFIX.length);
    req.url = rewritten;
    next();
  };
}
