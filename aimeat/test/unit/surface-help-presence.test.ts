/**
 * @file test/unit/surface-help-presence.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The home's "Who knows?" block (home.ask, Ask someone who knows) exists only where the
 *   operator has the feature on (help.enabled), and the default home carries it under the door to the
 *   chat. Switched off, it is neither offered in the Portal nor in the built-in home.
 * @usage pnpm exec vitest run test/unit/surface-help-presence.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { describe, it, expect } from 'vitest';
import { blockById, blocksForSurface, defaultLayout } from '../../src/services/surface-layout/registry.js';
import type { AimeatConfig } from '../../src/config.js';

function configWith(helpEnabled: boolean): AimeatConfig {
    return { helpEnabled, signageEnabled: false, storeEnabled: false, commerceEnabled: true, coOriginEnabled: false, portfolioEnabled: true, siteEnabled: true } as unknown as AimeatConfig;
}

describe('the home\'s "Who knows?" block', () => {
    it('is gated on helpEnabled and re-reads on the help domain', () => {
        const def = blockById('home.ask');
        expect(def!.presence).toEqual({ kind: 'config', configKey: 'helpEnabled' });
        expect(def!.liveDomains).toContain('help');
    });

    it('is offered and built into the default home when the feature is on, right under the chat door', () => {
        expect(blocksForSurface('home', configWith(true)).map(b => b.id)).toContain('home.ask');
        const ids = defaultLayout('home', configWith(true)).blocks.map(b => b.id);
        expect(ids).toContain('home.ask');
        const door = ids.indexOf('home.chat-door');
        if (door >= 0) expect(ids.indexOf('home.ask')).toBe(door + 1);
    });

    it('is on the onboarding home too, so a newcomer can ask from the first day', () => {
        expect(defaultLayout('home-onboarding', configWith(true)).blocks.map(b => b.id)).toContain('home.ask');
        expect(defaultLayout('home-onboarding', configWith(false)).blocks.map(b => b.id)).not.toContain('home.ask');
    });

    it('is neither offered nor built in when the operator switched the feature off', () => {
        expect(blocksForSurface('home', configWith(false)).map(b => b.id)).not.toContain('home.ask');
        expect(defaultLayout('home', configWith(false)).blocks.map(b => b.id)).not.toContain('home.ask');
    });

    it('waiting threads take the helpFirst setting, on by default', () => {
        const def = blockById('home.your-turn');
        expect(def!.props.helpFirst).toMatchObject({ type: 'boolean', default: true });
    });
});
