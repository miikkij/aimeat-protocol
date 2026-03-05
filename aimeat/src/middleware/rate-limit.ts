import type { Request, Response, NextFunction } from 'express';
import type { RateLimitTier, RoleMultipliers } from '../config.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';

interface RateBucket {
    count: number;
    resetAt: number;
}

export function rateLimit(opts: Partial<RateLimitTier> = {}, roleMultipliers?: RoleMultipliers) {
    const windowMs = opts.windowMs ?? 60_000;
    const baseMax = opts.max ?? 100;

    // Each rate limiter instance has its own bucket store
    const buckets = new Map<string, RateBucket>();

    // Cleanup expired buckets every 60 seconds
    const cleanup = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets) {
            if (now > bucket.resetAt) buckets.delete(key);
        }
    }, 60_000);
    cleanup.unref();

    return (req: Request, res: Response, next: NextFunction) => {
        // Key by GAII if authenticated, otherwise by IP
        const key = req.auth?.sub ?? req.ip ?? 'unknown';
        const now = Date.now();

        // Determine role-based multiplier
        let multiplier = 1;
        if (roleMultipliers) {
            const roles = req.auth?.roles as string[] | undefined;
            if (roles?.includes('operator')) multiplier = roleMultipliers.operator;
            else if (roles?.includes('owner')) multiplier = roleMultipliers.owner;
            else if (req.auth) multiplier = roleMultipliers.agent;
            else multiplier = roleMultipliers.anonymous;
        }
        const max = Math.ceil(baseMax * multiplier);

        let bucket = buckets.get(key);
        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }

        bucket.count++;

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.count));
        res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

        if (bucket.count > max) {
            const stats = getStats();
            if (stats) stats.increment('rate_limit_hits_total');
            const prom = getPromMetrics();
            if (prom) prom.rateLimitHitsTotal.inc();
            const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfterSec);
            res.status(429).json({
                ok: false,
                protocol: 'aimeat',
                version: 'v1',
                timestamp: new Date().toISOString(),
                error: {
                    code: 'RATE_LIMITED',
                    message: `Too many requests. Limit: ${max} per ${windowMs / 1000}s. Try again at ${new Date(bucket.resetAt).toISOString()}`,
                },
                hints: {
                    next_actions: [
                        { description: 'Wait and retry', method: 'GET', url: '/' },
                    ],
                },
            });
            return;
        }

        next();
    };
}
