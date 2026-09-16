/**
 * @file src/middleware/idempotency.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Express middleware implementing idempotent POST/PUT requests via an Idempotency-Key
 *   header: reserves a key before work starts, refuses concurrent duplicates, then replays the JSON
 *   response. Process-local, 24h TTL, bounded cache; active reservations are never evicted for space.
 *
 * @structure
 *   - idempotency(): middleware factory; skips non-POST/PUT and keyless requests, validates + caches
 *   - cache / TTL_MS / MAX_CACHE_SIZE: in-memory store with periodic expiry sweep
 *
 * @version-history
 *   v1.2.0 -- 2026-09-16 -- Reserve before next(), retain interrupted/non-JSON work, expire on
 *     lookup, and let a refused credential be refreshed without caching its 401.
 *   v1.1.0 — 2026-08-15 — The cache key is principal + method + path + UUID, not the UUID alone.
 *     This middleware is mounted app-wide, so the key was a global address: a second principal
 *     replaying another's key was served that principal's response body while its own write was
 *     silently dropped, and one client reusing a request-id across two routes got the wrong route's
 *     answer with the second call never executed. Tightening a key can only turn a HIT into a MISS,
 *     which is the request actually running. E2E test-quality audit finding A2.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';

interface CachedResponse {
    state: 'pending' | 'complete' | 'unavailable';
    status?: number;
    body?: unknown;
    storedAt: number;
}

const cache = new Map<string, CachedResponse>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 10_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cleanup expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now - entry.storedAt > TTL_MS) cache.delete(key);
    }
}, 300_000).unref();

/**
 * What a replay has to match before it is answered from the cache. A client's key says "this is the
 * same request I already sent"; it does not say whose request it was, or which one.
 *
 * The key alone was the whole cache key, and this middleware is mounted app-wide (src/server.ts), so
 * a UUID is a global address. Two consequences, and the first is the serious one. A second principal
 * presenting a key another principal has used was SERVED THAT PRINCIPAL'S RESPONSE BODY — the
 * record id, the version, the whole envelope — while its own POST never reached the handler. And
 * because method and path were ignored too, one client reusing a single request-id across
 * POST /v1/memory and POST /v1/tasks got the memory response back for the task call, and the task
 * was silently never created.
 *
 * `req.auth` is populated by the globally mounted optionalAuth(), so it is available here. An
 * unauthenticated caller keys on 'anon', which is correct: the routes that accept one are the ones
 * where a replay carries no cross-principal meaning.
 */
function cacheKeyFor(req: Request, idempotencyKey: string): string {
    const principal = req.auth?.sub ?? 'anon';
    return `${principal}|${req.method}|${req.originalUrl}|${idempotencyKey}`;
}

export function idempotency() {
    return (req: Request, res: Response, next: NextFunction) => {
        // Only applies to POST/PUT methods
        if (req.method !== 'POST' && req.method !== 'PUT') {
            next();
            return;
        }

        const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
        if (!idempotencyKey) {
            next();
            return;
        }

        // SECURITY: Validate key format to prevent cache key abuse
        if (!UUID_REGEX.test(idempotencyKey)) {
            res.status(400).json({
                ok: false,
                error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be a valid UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)' },
            });
            return;
        }

        // Check cache
        const cacheKey = cacheKeyFor(req, idempotencyKey);
        let cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.storedAt >= TTL_MS) {
            cache.delete(cacheKey);
            cached = undefined;
        }
        if (cached) {
            if (cached.state === 'complete') {
                res.status(cached.status!).json(cached.body);
            } else {
                const running = cached.state === 'pending';
                res.status(409).json({ ok: false, error: {
                    code: running ? 'IDEMPOTENCY_IN_PROGRESS' : 'IDEMPOTENCY_RESULT_UNAVAILABLE',
                    message: running ? 'This request is still running. Check its result before sending it again.'
                        : 'This request was already accepted, but its response is unavailable. Check its result before sending it again.',
                } });
            }
            return;
        }

        // SECURITY: Evict oldest entry if cache is full (prevent unbounded memory growth)
        if (cache.size >= MAX_CACHE_SIZE) {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            for (const [key, entry] of cache) {
                if (entry.state === 'complete' && entry.storedAt < oldestTime) {
                    oldestTime = entry.storedAt;
                    oldestKey = key;
                }
            }
            if (oldestKey) cache.delete(oldestKey);
            else {
                res.status(503).json({ ok: false, error: {
                    code: 'IDEMPOTENCY_CAPACITY',
                    message: 'The server cannot accept another protected request yet. Try again later.',
                } });
                return;
            }
        }

        // This must happen synchronously before next(): a browser timeout does not stop the work.
        const entry: CachedResponse = { state: 'pending', storedAt: Date.now() };
        cache.set(cacheKey, entry);
        const unavailable = () => {
            if (entry.state === 'pending') entry.state = 'unavailable';
        };
        res.once('finish', unavailable);
        res.once('close', unavailable);

        // Intercept response to cache it
        const originalJson = res.json.bind(res);
        res.json = function (body: unknown) {
            if (cache.get(cacheKey) === entry) {
                // A 401 means the credential was refused, so a refresh may try the same key.
                if (res.statusCode === 401) cache.delete(cacheKey);
                else Object.assign(entry, { state: 'complete', status: res.statusCode, body, storedAt: Date.now() });
            }
            return originalJson(body);
        };

        next();
    };
}
