/**
 * @file rate-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Per-instance, in-memory request rate limiter. Keys by GAII when
 *   authenticated, else by client IP (IPv6 aggregated to /64 so host-bit rotation
 *   can't mint fresh buckets). Role-based multipliers widen limits for owners/operators.
 * @usage app.use(rateLimit({ windowMs, max }, roleMultipliers))
 * @version-history
 *   v1.3.0 — 2026-09-24 — The bucket counting moved to services/rate-buckets.ts, unchanged, so the
 *     per-account message limit (services/message-send-limit.ts) counts the same way. What a
 *     request is answered, its headers included, is the same.
 *   v1.2.0 — 2026-07-10 — keyBy:'ip' option: always key by client IP, never by GAII.
 *     Needed for no-auth brute-forceable endpoints (share-password unlock) where anonymous
 *     mode would otherwise collapse every visitor into one shared anonymous-GAII bucket.
 *   v1.1.0 — 2026-06-20 — Security (H-6): aggregate IPv6 keys to /64. NOTE: the
 *     bucket store is still per-process — needs a shared store before multi-replica deploy.
 */
import type { Request, Response, NextFunction } from 'express';
import type { RateLimitTier, RoleMultipliers } from '../config.js';
import { getStats } from '../services/stats.js';
import { rateBuckets } from '../services/rate-buckets.js';

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
    const take = rateBuckets(windowMs);

    return (req: Request, res: Response, next: NextFunction) => {
        // Key by GAII if authenticated, otherwise by IP (IPv6 aggregated to /64).
        // keyBy:'ip' skips the GAII path entirely — anonymous mode injects one shared
        // identity for every visitor, which would collapse a brute-force limiter into
        // a single global bucket.
        const rawIp = req.ip ?? req.socket.remoteAddress;
        const resolvedKey = keyBy === 'ip' ? ipRateKey(rawIp) : (req.auth?.sub ?? ipRateKey(rawIp));
        const key = resolvedKey || 'unknown';
        if ((keyBy === 'ip' || !req.auth?.sub) && !rawIp) getStats()?.increment('rate_limit.unknown_key');

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

        // Counts this request, and counts a refusal in the hit metrics (services/rate-buckets.ts).
        const counted = take(key, max);

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', counted.remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(counted.resetAt / 1000));

        if (!counted.ok) {
            res.setHeader('Retry-After', counted.retryAfterSec);
            res.status(429).json({
                ok: false,
                protocol: 'aimeat',
                version: 'v1',
                timestamp: new Date().toISOString(),
                error: {
                    code: 'RATE_LIMITED',
                    message: `Too many requests. Limit: ${max} per ${windowMs / 1000}s. Try again at ${new Date(counted.resetAt).toISOString()}`,
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
