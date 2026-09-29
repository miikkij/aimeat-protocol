/**
 * @file test/unit/runner-anonymous-mode.test.ts
 * @description Unit tests for the E2E runner's anonymous-mode plan in test/run-e2e-server.ts: the
 *   credential suites get a node started with AIMEAT_ANONYMOUS=false, the setting production runs,
 *   and every other suite keeps the runner's default.
 *
 *   WHY. With anonymous mode on, a refused credential falls back to the anonymous identity, so a
 *   suite that asserts a refusal can pass against a credential check that does not refuse. The
 *   suites that prove the credential checks therefore run against the production setting.
 * @usage cd aimeat && pnpm exec vitest run test/unit/runner-anonymous-mode.test.ts
 * @version-history
 *   v1.0.0 -- 2026-09-26 -- Initial.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANONYMOUS_OFF_SUITES, anonymousModeFor, pinnedEnv, type RunnerTarget } from '../run-e2e-server.js';

const target: RunnerTarget = {
    port: '40345', baseUrl: 'http://localhost:40345', dbType: 'sqlite',
    dbPath: resolve('data/unit-runner-anonymous.db'), dbUrl: '', external: false,
};

afterEach(() => { vi.unstubAllEnvs(); });

describe('the runner plan for anonymous mode', () => {
    it('starts the node for e2e-security with anonymous mode off', () => {
        expect(pinnedEnv(target, 'e2e-security').AIMEAT_ANONYMOUS).toBe('false');
        expect(anonymousModeFor('e2e-security')).toBe('false');
    });

    it('keeps anonymous mode off for a listed suite when the caller environment says on', () => {
        vi.stubEnv('AIMEAT_ANONYMOUS', 'true');
        expect(pinnedEnv(target, 'e2e-security').AIMEAT_ANONYMOUS).toBe('false');
    });

    it('keeps the default for a suite that is not listed', () => {
        vi.stubEnv('AIMEAT_ANONYMOUS', undefined as unknown as string);
        delete process.env.AIMEAT_ANONYMOUS;
        expect(pinnedEnv(target, 'e2e-anonymous').AIMEAT_ANONYMOUS).toBe('true');
        expect(pinnedEnv(target).AIMEAT_ANONYMOUS).toBe('true');
    });

    it('lists only suites that exist', () => {
        expect(ANONYMOUS_OFF_SUITES.length).toBeGreaterThan(0);
        for (const name of ANONYMOUS_OFF_SUITES) {
            expect(existsSync(resolve('test', `${name}.ts`)), `test/${name}.ts`).toBe(true);
        }
    });
});
