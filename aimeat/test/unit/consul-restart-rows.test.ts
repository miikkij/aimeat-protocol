/**
 * @file test/unit/consul-restart-rows.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A setting the code reads once at start (`applies: 'restart'`) that Consul brings while
 *   the node runs (the watch, POST /v1/admin/consul/import) waits for the next start: it is not written
 *   to the running config, which the Config tab would then show as the value the node runs with. At
 *   startup nothing has read the settings yet, so it is written like every other row.
 * @usage cd aimeat && pnpm exec vitest run test/unit/consul-restart-rows.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { applyConsulValues } from '../../src/services/consul-config.js';
import type { AimeatConfig } from '../../src/config-types.js';

/** usage.buffer_ms applies at the next start; usage.hot_days at once. */
const fresh = () => ({ usageBufferMs: 15_000, usageHotDays: 90, sealedConfigKeys: [], logLevel: 'info' }) as unknown as AimeatConfig;

describe('a Consul value for a row that applies at the next start', () => {
    it('waits for the restart on a running node, and the row read on every use applies at once', () => {
        const config = fresh();
        const r = applyConsulValues(config, { 'usage.buffer_ms': '30000', 'usage.hot_days': '45' }, { running: true });
        expect(r.atRestart).toEqual(['usage.buffer_ms']);
        expect(r.applied).toEqual(['usage.hot_days']);
        expect(config.usageBufferMs).toBe(15_000);
        expect(config.usageHotDays).toBe(45);
    });

    it('is written at startup, when nothing has read it yet', () => {
        const config = fresh();
        const r = applyConsulValues(config, { 'usage.buffer_ms': '30000' });
        expect(r.applied).toEqual(['usage.buffer_ms']);
        expect(r.atRestart).toEqual([]);
        expect(config.usageBufferMs).toBe(30_000);
    });
});
