/**
 * @file test/unit/vitest-timeout.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Both vitest projects carry a test timeout above vitest's 5 s default. `pnpm gate` runs
 *   the unit files in parallel beside other sessions' suites, and tests that take a second alone
 *   crossed 5 s there (docs/pitfalls.md §72, retired with this). A project does not inherit the root's
 *   test options, so each one is read here.
 * @usage cd aimeat && pnpm exec vitest run test/unit/vitest-timeout.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial.
 */
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.js';

type Project = { test?: { name?: string; testTimeout?: number } };

describe('vitest.config.ts test timeout', () => {
    const projects = ((config as { test?: { projects?: Project[] } }).test?.projects ?? []);

    it('names both projects, so a third added later is read too', () => {
        expect(projects.map(p => p.test?.name)).toEqual(['unit', 'tree-mutating']);
    });

    it.each(['unit', 'tree-mutating'])('%s waits 20 s or more, and still has a limit', (name) => {
        const timeout = projects.find(p => p.test?.name === name)?.test?.testTimeout;
        expect(timeout).toBeGreaterThanOrEqual(20_000);
        expect(timeout).toBeLessThanOrEqual(60_000);
    });
});
