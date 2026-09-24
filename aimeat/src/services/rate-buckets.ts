/**
 * @file src/services/rate-buckets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fixed-window counting per key, the arithmetic every limiter on this node shares. The
 *   request middleware (middleware/rate-limit.ts) keys it by the caller or the address; a service
 *   that limits something no single route owns keys it by what it limits (services/message-send-limit.ts
 *   keys it by the sending account). A refusal counts in the same metrics either way, so the security
 *   overview sees both.
 *
 *   PER PROCESS. The buckets live in this process's memory, as the middleware's always have, so a node
 *   run as several replicas needs a shared store before these limits hold across them.
 * @structure RateTake · rateBuckets(windowMs) → take(key, max)
 * @usage
 *   const take = rateBuckets(60_000);
 *   const counted = take(key, 30);
 *   if (!counted.ok) refuse(counted.retryAfterSec);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Extracted from middleware/rate-limit.ts, so the per-account message limit
 *     (services/message-send-limit.ts) counts the way every other limiter here does.
 */
import { getStats } from './stats.js';
import { getPromMetrics } from './prometheus.js';

/** What one count against a key answers. */
export interface RateTake {
    /** Whether this call fits inside the key's window. */
    ok: boolean;
    /** The most the key may make in one window. */
    limit: number;
    /** How many more fit in this window after this call. */
    remaining: number;
    /** When the key's window ends, in epoch milliseconds. */
    resetAt: number;
    /** Whole seconds until then: the value a Retry-After carries. */
    retryAfterSec: number;
}

interface RateBucket {
    count: number;
    resetAt: number;
}

/**
 * One store of buckets with one window length. Each call of the function it returns counts one call
 * against `key` and answers whether it fits under `max`. The caller passes `max` on every call,
 * because the middleware widens it by the caller's role.
 */
export function rateBuckets(windowMs: number): (key: string, max: number) => RateTake {
    const buckets = new Map<string, RateBucket>();

    // Cleanup expired buckets every 60 seconds
    const cleanup = setInterval(() => {
        const now = Date.now();
        for (const [key, bucket] of buckets) {
            if (now > bucket.resetAt) buckets.delete(key);
        }
    }, 60_000);
    cleanup.unref();

    return (key: string, max: number): RateTake => {
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }

        bucket.count++;

        const ok = bucket.count <= max;
        if (!ok) {
            getStats()?.increment('rate_limit_hits_total');
            getPromMetrics()?.rateLimitHitsTotal.inc();
        }
        return {
            ok,
            limit: max,
            remaining: Math.max(0, max - bucket.count),
            resetAt: bucket.resetAt,
            retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
        };
    };
}
