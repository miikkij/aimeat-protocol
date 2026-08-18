/**
 * @file rate-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Per-instance, in-memory request rate limiter. Keys by GAII when
 *   authenticated, else by client IP (IPv6 aggregated to /64 so host-bit rotation
 *   can't mint fresh buckets). Role-based multipliers widen limits for owners/operators.
 * @usage app.use(rateLimit({ windowMs, max }, roleMultipliers))
 * @version-history
 *   v1.2.0 — 2026-07-10 — keyBy:'ip' option: always key by client IP, never by GAII.
 *     Needed for no-auth brute-forceable endpoints (share-password unlock) where anonymous
 *     mode would otherwise collapse every visitor into one shared anonymous-GAII bucket.
 *   v1.1.0 — 2026-06-20 — Security (H-6): aggregate IPv6 keys to /64. NOTE: the
 *     bucket store is still per-process — needs a shared store before multi-replica deploy.
 */
import type { Request, Response, NextFunction } from 'express';
import type { RateLimitTier, RoleMultipliers } from '../config.js';
import { getStats } from '../services/stats.js';
import { getPromMetrics } from '../services/prometheus.js';

interface RateBucket {
    count: number;
    resetAt: number;
}

/**
 * Normalise an IP into a rate-limit key. IPv6 addresses are aggregated to their
 * /64 network — providers hand out whole /64 (or larger) blocks to a single
 * customer, so without this an attacker rotates the 64 host bits to get an
 * unlimited supply of fresh buckets. IPv4 is keyed by the full address.
 */
export function ipRateKey(ip: string | undefined): string {
    if (!ip) return 'unknown';
    if (!ip.includes(':')) return ip; // IPv4
    // Expand any `::` compression, then keep the first 4 hextets (the /64 network).
    const [head, tail = ''] = ip.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
    const full = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
    return full.slice(0, 4).map(g => g || '0').join(':') + '::/64';
}

export function rateLimit(opts: Partial<RateLimitTier> & { keyBy?: 'auto' | 'ip' } = {}, roleMultipliers?: RoleMultipliers) {
    const windowMs = opts.windowMs ?? 60_000;
    const baseMax = opts.max ?? 100;
    const keyBy = opts.keyBy ?? 'auto';

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
        // Key by GAII if authenticated, otherwise by IP (IPv6 aggregated to /64).
        // keyBy:'ip' skips the GAII path entirely — anonymous mode injects one shared
        // identity for every visitor, which would collapse a brute-force limiter into
        // a single global bucket.
        const rawIp = req.ip ?? req.socket.remoteAddress;
        const resolvedKey = keyBy === 'ip' ? ipRateKey(rawIp) : (req.auth?.sub ?? ipRateKey(rawIp));
        const key = resolvedKey || 'unknown';
        if ((keyBy === 'ip' || !req.auth?.sub) && !rawIp) getStats()?.increment('rate_limit.unknown_key');
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
