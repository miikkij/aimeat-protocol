/**
 * @file src/middleware/cors.ts
 * @description CORS middleware with per-entity origin resolution: picks the most specific
 *   allowedOrigins (memory key → agent → GHII → node default), sets/omits CORS headers accordingly,
 *   and short-circuits preflight OPTIONS with 204/403. Anonymous mode allows all origins.
 *
 * @structure
 *   - COOKIE_AUTHED_PATHS / isCookieAuthedPath(): the routes the wildcard must not reach
 *   - corsMiddleware(config, getStorage): the Express RequestHandler
 *   - resolveAllowedOrigins(): walks memory/agent/GHII/node scopes for the effective allowlist
 *   - extractMemoryKey(): parses /v1/memory[/cors]/:key paths for key-level origin overrides
 *   - setCorsHeaders(): writes Allow-Origin/Methods/Headers/Expose headers
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-08-10 — Security audit C-1: the wildcard no longer reaches the three routes that
 *     authenticate with the `aimeat_rt` cookie and return a credential. App origins are same-site
 *     with the apex, so the cookie is sent; reflecting their origin with credentials let a published
 *     app read a token minted for a visiting owner. An explicitly listed origin still passes.
 */

import type { RequestHandler, Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/**
 * Routes that authenticate with the host-only `aimeat_rt` cookie and return a usable credential.
 * They are same-origin calls from the apex SPA or from the apex silent-SSO bridge page, so no
 * legitimate caller needs a cross-origin CORS grant here. Kept as exact paths (not a `/v1/auth/`
 * prefix) so signature-authenticated doors like POST /v1/auth/token keep working from a browser.
 */
const COOKIE_AUTHED_PATHS = new Set([
    '/v1/auth/app-grant-silent',
    '/v1/auth/refresh',
    '/v1/auth/revoke',
]);

function isCookieAuthedPath(path: string): boolean {
    return COOKIE_AUTHED_PATHS.has(path.replace(/\/+$/, '') || path);
}

export function corsMiddleware(config: AimeatConfig, getStorage?: () => Storage | null): RequestHandler {
    return async (req, res, next) => {
        const origin = req.headers.origin;

        // No Origin header = same-origin or non-browser client → allow
        if (!origin) {
            next();
            return;
        }

        // Anonymous mode: when enabled and no JWT present, skip origin checks.
        // All anonymous users share one identity and memory space — CORS adds no value.
        if (config.anonymousMode && !req.headers.authorization) {
            setCorsHeaders(res, '*');
            if (req.method === 'OPTIONS') {
                res.status(204).end();
                return;
            }
            next();
            return;
        }

        // Resolve the most specific allowedOrigins for this request
        const storage = getStorage?.() ?? null;
        const allowed = await resolveAllowedOrigins(req, config, storage);

        // SECURITY (C-1): the wildcard is a protocol decision — AIMEAT accepts requests from any
        // origin because apps attach from arbitrary browser origins, and the API is Bearer-token
        // based. That reasoning does not extend to the handful of routes that authenticate with the
        // `aimeat_rt` COOKIE and hand back a token, because the app origin family is same-site with
        // the apex: `SameSite=Strict` sends the cookie, and reflecting the caller's origin with
        // credentials would then let any published app READ the response. Those routes require an
        // origin the operator listed explicitly; the wildcard does not reach them.
        const explicitlyAllowed = allowed.includes(origin);
        const permitted = explicitlyAllowed || (allowed.includes('*') && !isCookieAuthedPath(req.path));

        if (permitted) {
            setCorsHeaders(res, origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Vary', 'Origin');
        }
        // If origin not allowed, we omit CORS headers — browser will block the response

        if (req.method === 'OPTIONS') {
            if (permitted) {
                res.setHeader('Access-Control-Max-Age', '3600');
                res.status(204).end();
            } else {
                res.status(403).end();
            }
            return;
        }

        next();
    };
}

function setCorsHeaders(res: { setHeader(name: string, value: string): void }, origin: string): void {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}

/**
 * Resolve the effective allowedOrigins for a request.
 * Phase 2: GHII → node default.
 *
 * Full resolution chain (most specific wins):
 *   memory key → agent → GHII → node default
 */
async function resolveAllowedOrigins(
    req: Request,
    config: AimeatConfig,
    storage: Storage | null,
): Promise<string[]> {
    if (!req.auth?.owner || !storage) {
        return config.corsAllowedOrigins;
    }

    try {
        const sub = req.auth.sub;     // GAII (agent) or owner name
        const owner = req.auth.owner;

        // Phase 4: Memory-level — check if this is a memory request with a key
        const memoryKey = extractMemoryKey(req);
        if (memoryKey) {
            const record = await storage.getMemory(sub, memoryKey);
            if (record?.allowedOrigins?.length) {
                return record.allowedOrigins;
            }
        }

        // Phase 3: Agent-level — check agent's allowedOrigins
        if (sub !== owner) {
            const agent = await storage.getAgent(sub);
            if (agent?.allowedOrigins?.length) {
                return agent.allowedOrigins;
            }
        }

        // Phase 2: GHII-level — check owner's GHII allowedOrigins
        const ghii = await storage.getGHIIByOwner(owner);
        if (ghii?.allowedOrigins?.length) {
            return ghii.allowedOrigins;
        }
    } catch (err) {
        // Storage error — fall through to node default
      logger.warn('resolveAllowedOrigins: continuing after a suppressed failure', { error: String(err) });
    }

    // Node-level default
    return config.corsAllowedOrigins;
}

/**
 * Extract a memory key from the request path, if this is a memory endpoint.
 * Matches: /v1/memory/:key, /v1/memory/cors/:key
 */
function extractMemoryKey(req: Request): string | null {
    const path = req.path;
    // /v1/memory/cors/:key
    const corsMatch = path.match(/^\/v1\/memory\/cors\/(.+)$/);
    if (corsMatch) return decodeURIComponent(corsMatch[1]);
    // /v1/memory/:key (but not /v1/memory/search, /v1/memory/:gaii/:key)
    const keyMatch = path.match(/^\/v1\/memory\/([^/]+)$/);
    if (keyMatch && keyMatch[1] !== 'search') return decodeURIComponent(keyMatch[1]);
    return null;
}
