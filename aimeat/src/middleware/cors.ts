/**
 * CORS middleware — per-entity origin resolution.
 *
 * Phase 1: Node-level only (config.corsAllowedOrigins).
 * Phase 2: GHII-level — authenticated users can restrict their origins.
 *          Resolution: GHII.allowedOrigins → node default.
 */

import type { RequestHandler, Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

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

        if (allowed.includes('*') || allowed.includes(origin)) {
            setCorsHeaders(res, origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Vary', 'Origin');
        }
        // If origin not allowed, we omit CORS headers — browser will block the response

        if (req.method === 'OPTIONS') {
            if (allowed.includes('*') || allowed.includes(origin)) {
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
    } catch {
        // Storage error — fall through to node default
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
