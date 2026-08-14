/**
 * @file src/middleware/idempotency.ts
 * @description Express middleware implementing idempotent POST/PUT requests via an Idempotency-Key
 *   header: caches the first response (24h TTL, bounded LRU-style eviction) and replays it for repeat
 *   keys. Validates the key is a UUID to prevent cache-key abuse.
 *
 * @structure
 *   - idempotency(): middleware factory; skips non-POST/PUT and keyless requests, validates + caches
 *   - cache / TTL_MS / MAX_CACHE_SIZE: in-memory store with periodic expiry sweep
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { Request, Response, NextFunction } from 'express';

interface CachedResponse {
    status: number;
    body: unknown;
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
}, 300_000);

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
                error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be a valid UUID (e.g., 550e8400-e29b-41d4-a716-446655440000)' },
            });
            return;
        }

        // Check cache
        const cached = cache.get(idempotencyKey);
        if (cached) {
            res.status(cached.status).json(cached.body);
            return;
        }

        // SECURITY: Evict oldest entry if cache is full (prevent unbounded memory growth)
        if (cache.size >= MAX_CACHE_SIZE) {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            for (const [key, entry] of cache) {
                if (entry.storedAt < oldestTime) {
                    oldestTime = entry.storedAt;
                    oldestKey = key;
                }
            }
            if (oldestKey) cache.delete(oldestKey);
        }

        // Intercept response to cache it
        const originalJson = res.json.bind(res);
        res.json = function (body: unknown) {
            cache.set(idempotencyKey, {
                status: res.statusCode,
                body,
                storedAt: Date.now(),
            });
            return originalJson(body);
        };

        next();
    };
}
