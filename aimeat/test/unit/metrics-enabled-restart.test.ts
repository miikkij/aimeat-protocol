/**
 * @file test/unit/metrics-enabled-restart.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description metrics.enabled takes effect only at start: server-bootstrap/routes-loader.ts reads
 *   config.metricsEnabled once, to mount the metrics middleware before any route. The setting was
 *   marked changeable at runtime, so the Config tab saved a change that did nothing until a restart
 *   (feature-list audit #181). It is restart-required (immutable) now, so PUT /v1/admin/config refuses
 *   it and the Config tab shows it read-only.
 * @usage cd aimeat && pnpm exec vitest run test/unit/metrics-enabled-restart.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #181).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isImmutable, MUTABLE_CONFIG_MAP } from '../../src/services/config-schema.js';

describe('metrics.enabled is restart-required (feature-list audit #181)', () => {
    it('is immutable and not in the runtime-mutable map', () => {
        expect(isImmutable('metrics.enabled')).toBe(true);
        expect(MUTABLE_CONFIG_MAP['metrics.enabled']).toBeUndefined();
    });

    it('is read once, where the routes are mounted at start', () => {
        const src = readFileSync(fileURLToPath(new URL('../../src/server-bootstrap/routes-loader.ts', import.meta.url)), 'utf8');
        expect(src).toMatch(/const metricsRegistry = config\.metricsEnabled/);
    });
});
