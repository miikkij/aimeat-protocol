/**
 * @file test/unit/production-lane.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The E2E runner's production-settings lane (test/run-e2e-production-lane.ts): with the
 *   lane on, a suite's node gets the settings a production node runs, a listed suite keeps only the
 *   groups it names, and the lane's copy of each production value is the value the code ships.
 *
 *   Fail-first: before the lane existed, pinnedEnv() handed every suite AIMEAT_DEFAULT_AGENT_SCOPES
 *   '*', a hundredfold rate limits and anonymous mode on, and nothing set test or dev mode off; the
 *   first describe block below fails on that tree (QA audit P1-01, P1-08, P7-03, F03a-02, S1-08, F7d).
 * @usage cd aimeat && pnpm exec vitest run test/unit/production-lane.test.ts
 * @version-history
 *   2026-10-16 — Initial (QA audit P1-01, P1-08, P7-03, P7-05, F03a-02, S1-08, F7d).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { adminSetupOpenFor, anonymousModeFor, pinnedEnv, type RunnerTarget } from '../run-e2e-server.js';
import {
    PRODUCTION_LANE_ENV, PRODUCTION_LANE_EXCEPTIONS, PRODUCTION_SETTINGS, SHIPPED_DEFAULT_AGENT_SCOPES_COPY,
    keptGroups, productionOverlay,
} from '../run-e2e-production-lane.js';
import { SHIPPED_DEFAULT_AGENT_SCOPES } from '../../src/config.js';

const target: RunnerTarget = {
    port: '40346', baseUrl: 'http://localhost:40346', dbType: 'sqlite',
    dbPath: resolve('data/unit-production-lane.db'), dbUrl: '', external: false,
};

/** The most suites that may keep a relaxed setting on the lane. Lower it when one leaves; never raise it. */
const EXCEPTION_CEILING = 26;

afterEach(() => { vi.unstubAllEnvs(); });

describe('with --production-settings, a suite runs against production settings', () => {
    it('test mode, dev mode and anonymous mode are off, the shipped scopes and admin setup closed', () => {
        vi.stubEnv(PRODUCTION_LANE_ENV, '1');
        vi.stubEnv('AIMEAT_TEST_MODE', 'true');
        vi.stubEnv('AIMEAT_DEV_MODE', 'true');
        vi.stubEnv('AIMEAT_RL_GLOBAL', '10000');
        const env = pinnedEnv(target, 'e2e-some-suite-not-listed');
        expect(env.AIMEAT_TEST_MODE).toBe('false');
        expect(env.AIMEAT_DEV_MODE).toBe('false');
        expect(env.AIMEAT_ANONYMOUS).toBe('false');
        expect(env.AIMEAT_DEFAULT_AGENT_SCOPES).toBe(SHIPPED_DEFAULT_AGENT_SCOPES);
        expect(env.AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR).toBe('false');
        expect(env.AIMEAT_RL_GLOBAL).toBe('300');
        expect(anonymousModeFor('e2e-some-suite-not-listed')).toBe('false');
        expect(adminSetupOpenFor('e2e-some-suite-not-listed')).toBe('false');
    });

    it('without the flag, the full sweep keeps its relaxed settings', () => {
        vi.stubEnv(PRODUCTION_LANE_ENV, '');
        vi.stubEnv('AIMEAT_ANONYMOUS', 'true');
        const env = pinnedEnv(target, 'e2e-some-suite-not-listed');
        expect(env.AIMEAT_DEFAULT_AGENT_SCOPES).toBe(process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? '*');
        expect(env.AIMEAT_ANONYMOUS).toBe('true');
        expect(productionOverlay('e2e-some-suite-not-listed')).toEqual({});
    });

    it('a listed suite keeps exactly the groups it names, and nothing else', () => {
        vi.stubEnv(PRODUCTION_LANE_ENV, '1');
        for (const [suite, { keep }] of Object.entries(PRODUCTION_LANE_EXCEPTIONS)) {
            const overlay = productionOverlay(suite);
            for (const group of Object.keys(PRODUCTION_SETTINGS) as (keyof typeof PRODUCTION_SETTINGS)[]) {
                const vars = Object.keys(PRODUCTION_SETTINGS[group]);
                if (keep.includes(group)) expect(vars.every(v => !(v in overlay))).toBe(true);
                else expect(vars.every(v => overlay[v] === PRODUCTION_SETTINGS[group][v])).toBe(true);
            }
            expect(keptGroups(suite)).toEqual(keep);
        }
    });
});

describe('the lane holds the values the code ships', () => {
    it('the default agent scopes copy is SHIPPED_DEFAULT_AGENT_SCOPES', () => {
        expect(SHIPPED_DEFAULT_AGENT_SCOPES_COPY).toBe(SHIPPED_DEFAULT_AGENT_SCOPES);
    });

    it('each production rate limit is the code default of loadConfig()', async () => {
        const saved = { ...process.env };
        try {
            for (const k of Object.keys(process.env)) if (k.startsWith('AIMEAT_RL_')) delete process.env[k];
            const { loadConfig } = await import('../../src/config.js');
            const { config } = loadConfig({ configPath: resolve('data/no-such-config.ini') });
            const rl = PRODUCTION_SETTINGS.rateLimits;
            expect(Number(rl.AIMEAT_RL_GLOBAL)).toBe(config.rateLimits.global.max);
            expect(Number(rl.AIMEAT_RL_WORK)).toBe(config.rateLimits.work.max);
            expect(Number(rl.AIMEAT_RL_MEMORY)).toBe(config.rateLimits.memory.max);
            expect(Number(rl.AIMEAT_RL_BOARDS)).toBe(config.rateLimits.boards.max);
            expect(Number(rl.AIMEAT_RL_REGISTRATION_INVITES)).toBe(config.rateLimits.registrationInvites.max);
        } finally {
            Object.assign(process.env, saved);
        }
    });
});

describe('the exception list', () => {
    it('gives every entry a reason and only known groups', () => {
        for (const [suite, entry] of Object.entries(PRODUCTION_LANE_EXCEPTIONS)) {
            expect(entry.reason.length, suite).toBeGreaterThan(20);
            expect(entry.keep.length, suite).toBeGreaterThan(0);
            for (const g of entry.keep) expect(Object.keys(PRODUCTION_SETTINGS), suite).toContain(g);
        }
    });

    it('may only shrink', () => {
        expect(Object.keys(PRODUCTION_LANE_EXCEPTIONS).length).toBeLessThanOrEqual(EXCEPTION_CEILING);
    });
});
