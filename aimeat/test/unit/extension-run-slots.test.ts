/**
 * @file test/unit/extension-run-slots.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-wide pool of request-driven extension runs and one account's share
 *   (services/extension-run-slots.ts; secaudit2026oct22, lead 817):
 *     - past the account's share the next run is refused with a retryable answer naming
 *       extensions.run_slots_per_account, while another account still gets a slot;
 *     - past the node's pool every account is refused, naming extensions.run_slots;
 *     - a released slot is free again, and releasing twice frees it once;
 *     - 0 is no limit on either number.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-run-slots.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, lead 817).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { takeExtensionRunSlot, runSlotsInUse, visitorRunShareKey } from '../../src/services/extension-run-slots.js';

const cfg = (node: number, perAccount: number) => ({ extensionRunSlots: node, extensionRunSlotsPerAccount: perAccount }) as unknown as AimeatConfig;
type Held = { ok: true; release: () => void };

describe('request-driven extension run slots', () => {
    it('refuses past the account\'s share, naming the setting, and another account still runs', () => {
        const c = cfg(10, 2);
        const a1 = takeExtensionRunSlot(c, 'alice@node-1'), a2 = takeExtensionRunSlot(c, 'alice@node-1');
        expect(a1.ok && a2.ok).toBe(true);
        const a3 = takeExtensionRunSlot(c, 'alice@node-1');
        expect(a3.ok).toBe(false);
        if (!a3.ok) {
            expect(a3.code).toBe('EXTENSION_RUNS_BUSY');
            expect(a3.message).toContain('extensions.run_slots_per_account');
            expect(a3.retryAfterSec).toBeGreaterThan(0);
        }
        const b1 = takeExtensionRunSlot(c, 'bob@node-1');
        expect(b1.ok).toBe(true);
        (a1 as Held).release(); (a2 as Held).release(); (b1 as Held).release();
        expect(runSlotsInUse()).toBe(0);
    });

    it('refuses everyone past the node\'s pool, naming extensions.run_slots', () => {
        const c = cfg(2, 0);
        const held = [takeExtensionRunSlot(c, 'a@n'), takeExtensionRunSlot(c, 'b@n')];
        const third = takeExtensionRunSlot(c, 'c@n');
        expect(third.ok).toBe(false);
        if (!third.ok) expect(third.message).toContain('extensions.run_slots');
        for (const h of held) (h as Held).release();
    });

    it('a released slot is free again, and a second release frees nothing more', () => {
        const c = cfg(1, 1);
        const one = takeExtensionRunSlot(c, 'a@n') as Held;
        one.release(); one.release();
        expect(runSlotsInUse()).toBe(0);
        const two = takeExtensionRunSlot(c, 'a@n');
        expect(two.ok).toBe(true);
        expect(takeExtensionRunSlot(c, 'a@n').ok).toBe(false);
        (two as Held).release();
    });

    it('a visitor\'s share is keyed by IPv6 /64, as the visitor rate limiter keys it (secaudit2026oct26)', () => {
        const c = cfg(10, 1);
        const first = takeExtensionRunSlot(c, visitorRunShareKey('2001:db8:aa:1::1'));
        expect(first.ok).toBe(true);
        // Another host address of the same /64 is the same client.
        expect(takeExtensionRunSlot(c, visitorRunShareKey('2001:db8:aa:1:ffff::2')).ok).toBe(false);
        // Another /64, another IPv4 address and an IPv4-mapped address each keep a share of their own.
        const held = [
            takeExtensionRunSlot(c, visitorRunShareKey('2001:db8:bb:2::1')),
            takeExtensionRunSlot(c, visitorRunShareKey('198.51.100.7')),
            takeExtensionRunSlot(c, visitorRunShareKey('198.51.100.8')),
            takeExtensionRunSlot(c, visitorRunShareKey('::ffff:203.0.113.9')),
        ];
        expect(held.every(h => h.ok)).toBe(true);
        (first as Held).release();
        for (const h of held) (h as Held).release();
        expect(runSlotsInUse()).toBe(0);
    });

    it('0 is no limit on both numbers', () => {
        const c = cfg(0, 0);
        const held = Array.from({ length: 500 }, () => takeExtensionRunSlot(c, 'busy@n'));
        expect(held.every(h => h.ok)).toBe(true);
        for (const h of held) (h as Held).release();
        expect(runSlotsInUse()).toBe(0);
    });
});
