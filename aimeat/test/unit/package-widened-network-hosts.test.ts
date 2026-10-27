/**
 * @file test/unit/package-widened-network-hosts.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description widenedItems (services/packages/install/package-capabilities.ts) counts the loss of an
 *   extension's host allowlist as a widening. The owner approved "only these hosts"; a version that
 *   drops the list reaches any public address, and it yields only items the approval already held, so
 *   a plain set difference let the daily auto-update install it unattended (secaudit2026oct26,
 *   packages/package-capabilities:widenedItems:network-hosts-removal-not-widening).
 *
 *   Usage kept: a version within the same hosts, a narrower host list, or an extension that never had
 *   a host list is not a widening; a new host still is.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-widened-network-hosts.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { widenedItems } from '../../src/services/packages/install/package-capabilities.js';

const base = ['extension:sync', 'extension:sync:action:run', 'extension:sync:network'];
const host = (h: string) => `extension:sync:network-host:${h}`;
const field = (f: string) => `extension:sync:network-host-field:${f}`;

describe('widenedItems and the host allowlist', () => {
    it('a version that drops the host list is a widening', () => {
        expect(widenedItems([...base, host('api.example.test')], base)).toEqual(['extension:sync:network-any-host']);
    });

    it('a version that drops the installer-given host field is a widening', () => {
        expect(widenedItems([...base, field('server')], base)).toEqual(['extension:sync:network-any-host']);
    });

    it('the same hosts, or fewer, is not a widening', () => {
        expect(widenedItems([...base, host('a.example.test'), host('b.example.test')], [...base, host('a.example.test'), host('b.example.test')])).toEqual([]);
        expect(widenedItems([...base, host('a.example.test'), host('b.example.test')], [...base, host('a.example.test')])).toEqual([]);
    });

    it('an extension that never had a host list is not a widening', () => {
        expect(widenedItems(base, base)).toEqual([]);
    });

    it('a version without network access at all is not a widening', () => {
        expect(widenedItems([...base, host('api.example.test')], ['extension:sync', 'extension:sync:action:run'])).toEqual([]);
    });

    it('a new host is still a widening, as before', () => {
        expect(widenedItems([...base, host('a.example.test')], [...base, host('a.example.test'), host('c.example.test')])).toEqual([host('c.example.test')]);
    });
});
