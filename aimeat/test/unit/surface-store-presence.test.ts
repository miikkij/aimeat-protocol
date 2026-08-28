/**
 * @file test/unit/surface-store-presence.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The front page's store block exists only when the node has a store to send people
 *   to. The e2e suite runs with AIMEAT_SITE_STORE_URL set and proves the block is offered; this is
 *   the other half, the one a fresh clone lives in: no store address, no store block, and the
 *   built-in front page still resolves without it. Both halves are needed, because a block gated
 *   on a config field that is never true simply never appears, on any node, with no error.
 * @usage pnpm exec vitest run test/unit/surface-store-presence.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial, with the showroom front page.
 */
import { describe, it, expect } from 'vitest';
import { blockById, blocksForSurface, defaultLayout } from '../../src/services/surface-layout/registry.js';
import type { AimeatConfig } from '../../src/config.js';

/** The two fields the presence check reads. Everything else is absent on purpose. */
function configWith(storeEnabled: boolean): AimeatConfig {
    return { storeEnabled, commerceEnabled: true, coOriginEnabled: false, portfolioEnabled: true, siteEnabled: true } as unknown as AimeatConfig;
}

describe('the store block on the front page', () => {
    it('is declared, on the portal only, gated on storeEnabled', () => {
        const def = blockById('portal.store');
        expect(def).toBeDefined();
        expect(def!.surfaces).toEqual(['portal']);
        expect(def!.presence).toEqual({ kind: 'config', configKey: 'storeEnabled' });
    });

    it('is not offered on a node with no store address', () => {
        const ids = blocksForSurface('portal', configWith(false)).map(b => b.id);
        expect(ids).not.toContain('portal.store');
        // The rest of the showroom is unconditional.
        for (const id of ['portal.showroom-hero', 'portal.wall-intro', 'portal.trust', 'portal.rooms', 'portal.close']) {
            expect(ids).toContain(id);
        }
    });

    it('is offered the moment the node has one', () => {
        const ids = blocksForSurface('portal', configWith(true)).map(b => b.id);
        expect(ids).toContain('portal.store');
    });

    it('sits in the built-in front page, so a node with a store shows it without arranging anything', () => {
        const ids = defaultLayout('portal', configWith(true)).blocks.map(b => b.id);
        expect(ids).toContain('portal.store');
        expect(ids[0]).toBe('portal.showroom-hero');
        expect(ids[ids.length - 1]).toBe('portal.close');
    });

    it('drops out of the built-in front page on a node with no store, and the rest of the order holds', () => {
        const ids = defaultLayout('portal', configWith(false)).blocks.map(b => b.id);
        expect(ids).not.toContain('portal.store');
        expect(ids.indexOf('portal.gallery')).toBe(ids.indexOf('portal.wall-intro') + 1);
        expect(ids[ids.length - 1]).toBe('portal.close');
    });
});
