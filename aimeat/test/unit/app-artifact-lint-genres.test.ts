/**
 * @file test/unit/app-artifact-lint-genres.test.ts
 * @description A straight fork of any genre this node serves publishes with no colour or
 *   track-mixing warning. A real build on aimeat.io (2026-11-08) forked genre-receipt as the spec
 *   says and the publish then told it to load the Classic theme stylesheet and that it carried
 *   daisyUI markup: two warnings that contradict the track's own guide and would send a less
 *   sceptical builder the wrong way. The Classic warnings still reach a page that earns them.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-artifact-lint-genres.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { lintAppArtifact } from '../../src/services/app-artifact-lint.js';
import { getAppTemplates } from '../../src/data/app-templates.js';

const config = { baseUrl: 'https://aimeat.io', port: 40050, appAssetProbe: false } as unknown as AimeatConfig;
const QUIET = new Set(['hardcoded-theme-colors', 'track-mixing']);

describe('a straight genre fork', () => {
    const genres = getAppTemplates().filter(t => t.kind === 'genre');

    it('is served at all', () => {
        expect(genres.length).toBeGreaterThan(10);
    });

    for (const g of genres) {
        it(`${g.id}: no colour or track-mixing warning`, async () => {
            const r = await lintAppArtifact(g.content, config);
            const loud = [...r.blocking, ...r.warnings].filter(f => QUIET.has(f.pitfall)).map(f => `${f.pitfall}: ${f.message.slice(0, 120)}`);
            expect(loud).toEqual([]);
        });
    }
});

describe('the warnings still reach a page that earns them', () => {
    const atelierHead = '<!DOCTYPE html><html><head><meta name="aimeat-track" content="atelier"><meta name="aimeat-register" content="custom:test">'
        + '<link rel="stylesheet" href="/lib/aimeat-atelier.css"><script src="/v1/libs/aimeat-atelier.js"></script>';

    it('an Atelier page with daisyUI classes it never defines, and no section', async () => {
        const html = atelierHead + '</head><body><button class="btn btn-primary">Go</button><div class="card">x</div><script>AIMEAT.atelier.app({ title: "t" });</script></body></html>';
        const r = await lintAppArtifact(html, config);
        expect([...r.blocking, ...r.warnings].some(f => f.pitfall === 'track-mixing')).toBe(true);
    });

    it('an Atelier page that paints its own light and dark from the OS and states no light', async () => {
        const html = atelierHead + '<style>body{background:#fff;color:#111} .a{color:#222} .b{color:#333} .c{color:#444} .d{color:#555} .e{color:#666}'
            + ' @media (prefers-color-scheme: dark){body{background:#000;color:#eee}}</style></head><body><script>AIMEAT.atelier.app({ title: "t" });</script></body></html>';
        const r = await lintAppArtifact(html, config);
        expect([...r.blocking, ...r.warnings].some(f => f.pitfall === 'hardcoded-theme-colors')).toBe(true);
    });
});
