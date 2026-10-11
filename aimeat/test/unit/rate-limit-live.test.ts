/**
 * @file test/unit/rate-limit-live.test.ts
 * @description A rate limit changed while the node runs reaches the limiter on the next request.
 *   The limiter read its numbers when it was built, and the rate-limit settings were copied into the
 *   limiter tiers only at boot, so a saved limit waited for a restart (measured 2026-10-11 on a
 *   running node: the limit saved as 1 per second, twelve requests at once all answered 200).
 * @usage pnpm test -- rate-limit-live
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Request, Response } from 'express';
import { rateLimit } from '../../src/middleware/rate-limit.js';
import { syncRateLimitTiers, RATE_LIMIT_KEYS } from '../../src/services/config-rate-limit-sync.js';
import { applyConfigChanges } from '../../src/services/config-apply.js';
import type { AimeatConfig } from '../../src/config-types.js';
import type { Storage } from '../../src/storage/interface.js';

/** Send one request from `ip` through a limiter; answers the status it set, or 200 when it called next. */
function hit(limiter: ReturnType<typeof rateLimit>, ip = '203.0.113.7'): number {
    let status = 200;
    const res = {
        setHeader: () => undefined,
        status: (s: number) => { status = s; return res; },
        json: () => res,
    } as unknown as Response;
    limiter({ ip, socket: {}, path: '/x' } as unknown as Request, res, () => undefined);
    return status;
}

describe('rateLimit reads its numbers on every request', () => {
    it('follows a tier object whose max changes after the limiter was built', () => {
        const tier = { windowMs: 60_000, max: 100 };
        const limiter = rateLimit(tier);
        expect(hit(limiter)).toBe(200);
        tier.max = 2;
        expect(hit(limiter)).toBe(200);   // the second request of this window
        expect(hit(limiter)).toBe(429);   // the third is over the new limit of 2
    });

    it('follows a function that answers the numbers', () => {
        const config = { loginRateLimitMax: 50, loginRateLimitWindowMs: 60_000 };
        const limiter = rateLimit(() => ({ max: config.loginRateLimitMax, windowMs: config.loginRateLimitWindowMs }));
        expect(hit(limiter)).toBe(200);
        config.loginRateLimitMax = 1;
        expect(hit(limiter)).toBe(429);
    });

    it('starts a new count when the window length changes', () => {
        const config = { max: 1, windowMs: 60_000 };
        const limiter = rateLimit(() => config);
        expect(hit(limiter)).toBe(200);
        expect(hit(limiter)).toBe(429);
        config.windowMs = 30_000;
        expect(hit(limiter)).toBe(200);
    });
});

describe('the rate-limit settings reach the limiter tiers', () => {
    /** A config with every rl* setting at 300 and every tier at 300. */
    function config300(): AimeatConfig {
        const c: Record<string, unknown> = { nodeId: 'test', sealedConfigKeys: [], rateLimits: {} };
        for (const { key, tier } of RATE_LIMIT_KEYS) {
            c[key as string] = 300;
            (c.rateLimits as Record<string, unknown>)[tier] = { windowMs: 1_000, max: 300 };
        }
        return c as unknown as AimeatConfig;
    }

    it('syncRateLimitTiers copies each setting into its tier and keeps the tier object', () => {
        const config = config300();
        const boards = config.rateLimits.boards;
        (config as unknown as Record<string, number>).rlBoards = 7;
        syncRateLimitTiers(config);
        expect(config.rateLimits.boards).toBe(boards);
        expect(config.rateLimits.boards.max).toBe(7);
        expect(config.rateLimits.global.max).toBe(300);
    });

    it('a save through applyConfigChanges changes what a limiter built before the save enforces', async () => {
        const config = config300();
        const storage = { setConfigValue: async () => undefined } as unknown as Storage;
        const limiter = rateLimit(config.rateLimits.boards);
        expect(hit(limiter)).toBe(200);

        const r = await applyConfigChanges({ config, storage }, [{ path: 'rate_limits.boards', value: 1 }]);
        expect(r.errors).toEqual([]);
        expect(config.rateLimits.boards.max).toBe(1);
        expect(hit(limiter)).toBe(429);   // the second request of the window, over the saved limit of 1
    });
});
