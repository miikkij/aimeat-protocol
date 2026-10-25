/**
 * @file test/unit/metrics-enabled-restart.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description metrics.enabled takes effect only at start: server-bootstrap/routes-loader.ts reads
 *   config.metricsEnabled once, to mount the metrics middleware before any route. The setting was
 *   marked changeable at runtime, so the Config tab saved a change that did nothing until a restart
 *   (feature-list audit #181). It was made immutable for that; since 2026-10-25 it is a row that applies
 *   at the next start: PUT stores it without touching the running value, and the Config tab says the
 *   node runs with the old value until it restarts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/metrics-enabled-restart.test.ts
 * @version-history
 *   2026-10-25 — A row that applies at the next start (`applies: 'restart'`), stored, never written live.
 *   2026-10-15 — Initial (feature-list audit #181).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MUTABLE_CONFIG_MAP } from '../../src/services/config-schema.js';
import { applyConfigChanges } from '../../src/services/config-apply.js';
import type { AimeatConfig } from '../../src/config-types.js';
import type { Storage } from '../../src/storage/interface.js';

describe('metrics.enabled takes effect at the next start (feature-list audit #181)', () => {
    it('is stored and marked as applying at the next start', () => {
        expect(MUTABLE_CONFIG_MAP['metrics.enabled']?.applies).toBe('restart');
    });

    it('a save is stored and leaves the running value alone', async () => {
        const stored: Record<string, string> = {};
        const storage = { setConfigValue: async (p: string, v: string) => { stored[p] = v; } } as unknown as Storage;
        const config = { metricsEnabled: false } as unknown as AimeatConfig;
        const r = await applyConfigChanges({ config, storage }, [{ path: 'metrics.enabled', value: true }]);
        expect(r.applied).toEqual([{ path: 'metrics.enabled', old_value: false, new_value: true, applies: 'restart' }]);
        expect(stored['metrics.enabled']).toBe('true');
        expect(config.metricsEnabled).toBe(false);
    });

    it('is read once, where the routes are mounted at start', () => {
        const src = readFileSync(fileURLToPath(new URL('../../src/server-bootstrap/routes-loader.ts', import.meta.url)), 'utf8');
        expect(src).toMatch(/const metricsRegistry = config\.metricsEnabled/);
    });
});
