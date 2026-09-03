/**
 * @file agent-me-alias.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `/v1/agents/me` and `/v1/agents/me/...` become the caller's OWN agent URL.
 *
 *   WHY IT EXISTS. The tier-1 handbook tells every agent "all agent URLs use /v1/agents/me/, which
 *   resolves to you". Without this, only the handbook routes honour that promise — they read
 *   `req.auth.sub` themselves — and every other agent endpoint 404s, because the routes are
 *   registered against an identifier and `me` is not one.
 *
 *   WHAT IT USED TO DO WRONG, AND WHAT IT COST. It sliced the agent's BARE NAME out of the
 *   credential (`sub.slice(0, sub.indexOf('#'))`) and rewrote to that. Most sub-routes survived by
 *   accident: they do `identifier.includes('#') ? identifier : buildGAII(identifier, owner, node)`,
 *   so they rebuilt what had just been taken apart. `GET /v1/agents/:gaii` does not — it is PUBLIC,
 *   it looks the identifier up verbatim, and a bare name is not a key anything is stored under. So
 *   `GET /v1/agents/me` answered 404 for every agent that ever asked, and had always done so.
 *
 *   That 404 is why `aimeat connect acp` had never started for anyone: ACP reads the node's answer
 *   to "who am I" before it can announce itself to the editor. The ACP work was verified against
 *   the SDK's own client, which never asks the node that question, so the gap survived being
 *   tested.
 *
 *   THE FIX IS TO STOP ASSEMBLING A NAME. An agent credential's `sub` IS the GAII — the identity is
 *   already there, whole, and taking it apart to put it back together is the failure. This is the
 *   same rule as `resolveIdentity()`, which every route that stores or retrieves by identity
 *   already follows: an owner session resolves to `owner@node`, and everything else is `sub` as it
 *   stands.
 *
 *   IT RUNS BEFORE AUTH, so it reads the token without verifying it. That is safe because it
 *   decides a PATH and nothing else: the route it lands on runs `requireAuth()` and its own
 *   ownership check, so a forged token buys a rewrite to an identity it then fails to authenticate
 *   as. Nothing is read, written or revealed on the strength of this parse.
 *
 *   An OWNER session is deliberately not rewritten: `me` is ambiguous for someone with forty
 *   agents, and 404 is the honest answer to an ambiguous question.
 *
 * @structure agentMeAliasMiddleware() — one rewrite, mounted once in server.ts
 * @usage app.use(agentMeAliasMiddleware());
 * @version-history
 *   v2.0.0 -- 2026-09-03 -- Rewrites to the GAII rather than to a bare name, and covers the bare
 *     `/v1/agents/me` as well as `/v1/agents/me/...`. Replaces a SECOND copy of this rewrite that
 *     lived inline in server-bootstrap/routes-loader.ts: two implementations of one rule, and the
 *     inline one was the one that fired for the path ACP uses.
 *   v1.0.0 -- 2026-05-28 -- Initial creation to fix F6 broken /me/ alias.
 */
import type { Request, Response, NextFunction } from 'express';
import { parseGAII } from '../utils/gaii.js';

const ME = '/v1/agents/me';
/** Served as literals by routes/prompts.ts, and must not be rewritten. */
const HANDBOOK_LITERAL_RE = /^\/v1\/agents\/me\/handbook(\/|$|\?)/;

/**
 * The caller's identity, read from the bearer without verifying it.
 *
 * `req.auth` is not set yet — `requireAuth()` runs per route, and this has to decide the path
 * before any router sees it. The answer is the credential's `sub` VERBATIM when that is a GAII,
 * which is the same thing `resolveIdentity()` returns for every non-owner principal. Null for an
 * owner session, an unparseable token, or no token at all.
 */
function callerIdentity(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
        const payload = JSON.parse(Buffer.from(header.split('.')[1], 'base64url').toString()) as { sub?: unknown };
        const sub = typeof payload.sub === 'string' ? payload.sub : '';
        return sub && parseGAII(sub) ? sub : null;
    } catch {
        // Not our problem to report: requireAuth() rejects a bad token with a message written for
        // the caller, and this only decides whether a path is rewritten.
        // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: not a token we can route on
        return null;
    }
}

export function agentMeAliasMiddleware() {
    return (req: Request, _res: Response, next: NextFunction) => {
        const url = req.url.startsWith(ME) ? req.url : (req.originalUrl.startsWith(ME) ? req.originalUrl : null);
        if (!url) { next(); return; }
        const tail = url.slice(ME.length);
        // `/v1/agents/memory`, `/v1/agents/mercury` — the prefix matched a longer name, not `me`.
        if (tail && !tail.startsWith('/') && !tail.startsWith('?')) { next(); return; }
        if (HANDBOOK_LITERAL_RE.test(url)) { next(); return; }

        const identity = callerIdentity(req);
        if (!identity) { next(); return; }

        const rewritten = `/v1/agents/${encodeURIComponent(identity)}${tail}`;
        req.url = rewritten;
        req.originalUrl = rewritten;
        next();
    };
}
