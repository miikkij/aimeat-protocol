/**
 * @file test/unit/surface-signage-presence.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The front page's signage example exists only where the operator names a screen
 *   (AIMEAT_SITE_SIGNAGE_URL). It was 'always', with aimeat.io's own screen as its default, so a
 *   customer's node showed aimeat.io's example on its front page (aimeat-apps wish
 *   wish-a-customer-node-does-not-show-aimeat-io-s-own-badge-and-fron, 2026-09-29). The e2e suite
 *   runs with the address set and proves the block is offered; this is the fresh node's half. The
 *   node-wide badge switch (AIMEAT_APP_BADGE) is checked here too.
 * @usage pnpm exec vitest run test/unit/surface-signage-presence.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { blockById, blocksForSurface, defaultLayout } from '../../src/services/surface-layout/registry.js';
import { servedBadgeOn } from '../../src/services/app-marks.js';
import type { AimeatConfig } from '../../src/config.js';

function configWith(signageEnabled: boolean): AimeatConfig {
    return { signageEnabled, storeEnabled: false, commerceEnabled: true, coOriginEnabled: false, portfolioEnabled: true, siteEnabled: true } as unknown as AimeatConfig;
}

describe('the signage example on the front page', () => {
    it('is gated on signageEnabled and carries no aimeat.io address of its own', () => {
        const def = blockById('portal.frame-signage');
        expect(def!.presence).toEqual({ kind: 'config', configKey: 'signageEnabled' });
        expect(JSON.stringify(def!.props)).not.toContain('aimeat.io');
    });

    it('is neither offered nor in the built-in front page on a node that names no screen', () => {
        expect(blocksForSurface('portal', configWith(false)).map(b => b.id)).not.toContain('portal.frame-signage');
        const ids = defaultLayout('portal', configWith(false)).blocks.map(b => b.id);
        expect(ids).not.toContain('portal.frame-signage');
        expect(ids[0]).toBe('portal.frame-hero');
        expect(ids[ids.length - 1]).toBe('portal.frame-close');
    });

    it('is offered and built in where the node names one', () => {
        expect(blocksForSurface('portal', configWith(true)).map(b => b.id)).toContain('portal.frame-signage');
        expect(defaultLayout('portal', configWith(true)).blocks.map(b => b.id)).toContain('portal.frame-signage');
    });
});

describe('the served apps\' aimeat.io badge', () => {
    it('stays on by default and follows the owner\'s per-app switch', () => {
        expect(servedBadgeOn({ appBadge: 'aimeat' })).toBe(true);
        expect(servedBadgeOn({ appBadge: 'aimeat' }, { marks: { badge: false } } as never)).toBe(false);
    });

    it('is off on every app when the node says off, whatever the app says', () => {
        expect(servedBadgeOn({ appBadge: 'off' })).toBe(false);
        expect(servedBadgeOn({ appBadge: 'off' }, { marks: { badge: true } } as never)).toBe(false);
    });
});
