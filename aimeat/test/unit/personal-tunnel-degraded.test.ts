/**
 * @file test/unit/personal-tunnel-degraded.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A late personal node is marked degraded before it is closed, whatever the phase of
 *   its last heartbeat against the monitor's checks.
 *
 *   THE DEFECT. The monitor checked at least every 10 s, and a node is degraded only between 60 %
 *   and 100 % of the offline threshold. With a 12 s threshold that window is 4.8 s wide, so a
 *   heartbeat 3 s after a check put the next checks at 7 s (not yet late) and 17 s (past the
 *   threshold): the node went from online to offline and degraded was never written. The guard
 *   tier's e2e-personal-tunnel phase 10 failed whenever its heartbeat fell that way.
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial, with the fix it holds.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager } from '../../src/services/personal-tunnel.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

class FakeWs extends EventEmitter {
    readyState = 1;
    closed: Array<{ code: number; reason: string }> = [];
    send(): void { /* the monitor sends nothing */ }
    close(code: number, reason: string): void { this.closed.push({ code, reason }); this.readyState = 3; }
}

afterEach(() => { vi.useRealTimers(); });

describe('the personal node heartbeat monitor', () => {
    it('writes degraded before offline when the last beat fell just after a check', async () => {
        vi.useFakeTimers();
        const writes: string[] = [];
        const storage = {
            updatePersonalNode: vi.fn(async (_id: string, patch: { status?: string }) => { if (patch.status) writes.push(patch.status); }),
        } as unknown as Storage;
        const config = { nodeId: 'node', personalNodeHeartbeatIntervalMs: 10_000, personalNodeOfflineThresholdMs: 12_000 } as unknown as AimeatConfig;
        const mgr = new TunnelManager(config, storage);
        mgr.startHeartbeatMonitor();
        // The node's last beat lands 3 s after the monitor started, as a connect does.
        await vi.advanceTimersByTimeAsync(3_000);
        const ws = new FakeWs();
        mgr.handleConnection(ws as never, 'home-1', 'alice', []);
        await vi.advanceTimersByTimeAsync(20_000);
        mgr.stopHeartbeatMonitor?.();
        expect(ws.closed[0]?.reason).toBe('heartbeat_timeout');
        const offlineAt = writes.indexOf('offline');
        expect(writes.slice(0, offlineAt)).toContain('degraded');
    });
});
