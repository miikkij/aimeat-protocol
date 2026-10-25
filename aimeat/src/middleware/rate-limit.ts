/**
 * @file rate-limit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Per-instance, in-memory request rate limiter. Keys by GAII when
 *   authenticated, else by client IP (IPv6 aggregated to /64 so host-bit rotation
 *   can't mint fresh buckets). Role-based multipliers widen limits for owners/operators.
 * @usage app.use(rateLimit({ windowMs, max }, roleMultipliers))
 *        const loginLimit = rateLimit(() => ({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }))
 * @version-history
 *   v1.5.0 — 2026-10-25 — secaudit2026oct22: the shared anonymous identity is keyed by address with
 *     the visitor multiplier, as a request without a credential is, so each visitor has a count of
 *     its own in anonymous mode.
 *   v1.4.0 — 2026-10-11 — The numbers are read on every request, from the object passed or from a
 *     function that answers them, so a rate limit saved while the node runs takes effect at once. A
 *     changed window starts a new bucket store.
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
import { isAnonymousPrincipal } from '../auth/anonymous-principal.js';

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

/** What a limiter is built from: the window, the most requests in it, and what a request is keyed by. */
export type RateLimitOptions = Partial<RateLimitTier> & { keyBy?: 'auto' | 'ip' };

/**
 * @param opts The limiter's numbers, or a function that answers them. They are read on EVERY
 *   request: a tier of `config.rateLimits` is passed as the object it is, and a limiter whose numbers
 *   are settings of their own is passed a function (`() => ({ max: config.loginRateLimitMax, … })`),
 *   so a setting saved on the Config endpoint takes effect on the next request. The numbers were
 *   copied when the limiter was built, so a saved limit waited for a restart (2026-10-11).
 */
export function rateLimit(opts: RateLimitOptions | (() => RateLimitOptions) = {}, roleMultipliers?: RoleMultipliers) {
    const read = typeof opts === 'function' ? opts : () => opts;
    const keyBy = read().keyBy ?? 'auto';

    // Each rate limiter instance has its own bucket store. A store counts in one window length, so a
    // changed window starts a new store; the old one is dropped with its counts.
    let windowMs = read().windowMs ?? 60_000;
    let take = rateBuckets(windowMs);

    return (req: Request, res: Response, next: NextFunction) => {
        const now = read();
        const liveWindowMs = now.windowMs ?? 60_000;
        if (liveWindowMs !== windowMs) {
            windowMs = liveWindowMs;
            take = rateBuckets(windowMs);
        }
        const baseMax = now.max ?? 100;
        // Key by GAII if authenticated, otherwise by IP (IPv6 aggregated to /64).
        // keyBy:'ip' skips the GAII path entirely — anonymous mode injects one shared
        // identity for every visitor, which would collapse a brute-force limiter into
        // a single global bucket.
        const rawIp = req.ip ?? req.socket.remoteAddress;
        // The shared anonymous identity is one sub for every visitor without a credential (injected by
        // optionalAuth in anonymous mode, or minted by POST /v1/auth/anonymous), so it is counted as
        // no identity: by address, with the visitor multiplier. Keyed by its sub, one visitor used up
        // the limit of all of them, password sign-in included (secaudit2026oct22).
        const identified = req.auth?.sub && !isAnonymousPrincipal(req.auth) ? req.auth : undefined;
        const resolvedKey = keyBy === 'ip' ? ipRateKey(rawIp) : (identified?.sub ?? ipRateKey(rawIp));
        const key = resolvedKey || 'unknown';
        if ((keyBy === 'ip' || !identified) && !rawIp) getStats()?.increment('rate_limit.unknown_key');

        // Determine role-based multiplier
        let multiplier = 1;
        if (roleMultipliers) {
            const roles = identified?.roles as string[] | undefined;
            if (roles?.includes('operator')) multiplier = roleMultipliers.operator;
            else if (roles?.includes('owner')) multiplier = roleMultipliers.owner;
            else if (identified) multiplier = roleMultipliers.agent;
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
