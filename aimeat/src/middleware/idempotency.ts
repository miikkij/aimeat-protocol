import type { Request, Response, NextFunction } from 'express';

interface CachedResponse {
    status: number;
    body: unknown;
    storedAt: number;
}

const cache = new Map<string, CachedResponse>();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

        // Check cache
        const cached = cache.get(idempotencyKey);
        if (cached) {
            res.status(cached.status).json(cached.body);
            return;
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
