/**
 * @file test/unit/design-book-preview-stages.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stage a Design Book part is shown on, the ground the preview frame paints, the
 *   faces a look may name, and the kit rule that let a hero's picture collapse under an effect.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial (wish-design-book-n-ytt-osansa-niin-ett-ne-erottuvat-toisistaan-ja).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderableBodyFor, partPreviewHtml } from '../../src/services/design-book/preview.js';
import { lookStage, lookForShape } from '../../src/services/design-book/preview-stages.js';
import { SERVED_FONT_FAMILIES, unservedFirstFamily } from '../../src/services/app-ui/signature-tokens.js';
import { validateSignatureTokens } from '../../src/services/app-ui/validate.js';
import { validateUiLayout } from '../../src/services/app-ui/validate.js';
import type { DesignBookPart } from '../../src/services/design-book/service.js';

const part = (patch: Partial<DesignBookPart>): DesignBookPart => ({
  spec: 'aimeat.designbook.part/v1', id: 'x', kind: 'look', title: 'X', summary: 'A sentence that says what it is. And a second one.',
  body: {}, tags: [], status: 'published', proposed_by: 'a', proposed_by_owner: 'a@n', bench: { checks: [], passed_at: '' },
  created_at: '', updated_at: '', ...patch,
} as DesignBookPart);
const components = (body: Record<string, unknown> | null) => ((body?.blocks ?? []) as Array<{ component: string }>).map(b => b.component);

describe('the stage a part is shown on', () => {
  it('a look is worn by a page whose content fits its words, and never by "Bench"', () => {
    const mtv = renderableBodyFor(part({ id: 'look-mtv-broadcast', title: 'MTV broadcast', body: { tokens: { '--ak-radius': '10px' } } }));
    expect(components(mtv)).toEqual(expect.arrayContaining(['countdown', 'crawl']));
    expect(mtv?.__theme).toBe('dark');
    expect((mtv?.tokens as Record<string, string>)['--ak-radius']).toBe('10px');
    const ledger = renderableBodyFor(part({ id: 'look-forest-ledger', title: 'Forest ledger', body: { look: 'editorial', tokens: {} } }));
    expect(components(ledger)).toEqual(expect.arrayContaining(['table', 'figure']));
    expect(ledger?.look).toBe('editorial');
    expect(ledger?.__theme).toBeUndefined();
    expect(components(renderableBodyFor(part({ id: 'look-terminal-crt', title: 'The terminal', body: { look: 'terminal', tokens: {} } })))).toContain('console');
    // A look nobody wrote a stage for lands on a page with a name, too.
    const other = lookStage('look-quiet-something', {});
    expect(JSON.stringify(other)).not.toMatch(/Bench|A sample row/);
    expect(JSON.stringify(other)).toMatch(/Crust & Crumb/);
  });

  it('every stage is an arrangement the kit accepts, with rows for each source it names', () => {
    for (const words of ['mtv', 'ledger', 'terminal', 'lit stage', 'riso poster', 'something else']) {
      const stage = lookStage(words, {});
      const { __sources, __theme, ...layout } = stage;
      expect(() => validateUiLayout(layout), words).not.toThrow();
      for (const b of stage.blocks as Array<{ props: { source?: string } }>) {
        if (b.props.source) expect(__sources?.[b.props.source], `${words}: ${b.props.source}`).toBeDefined();
      }
      void __theme;
    }
  });

  it('a layer is shown alone and at a strength that is SAID', () => {
    const waves = renderableBodyFor(part({ id: 'ambient-waves', kind: 'ambient', title: 'Waves', body: { ambient: 'waves' } }));
    expect(components(waves)).toEqual(['hero']);
    expect(waves?.__stage).toBe('layer');
    expect((waves?.ambient as { alpha?: number }).alpha).toBeGreaterThan(0.3);
    const kal = renderableBodyFor(part({ id: 'effect-kaleidoscope', kind: 'effect', title: 'The kaleidoscope', body: { effect: 'kaleidoscope', on: 'layer', look: 'lounge' } }));
    expect(components(kal)).toEqual(['hero']);
    // Lounge runs its wave at 0.8, and an arrangement that names no alpha gets the preset's whisper.
    expect(kal?.ambient).toMatchObject({ preset: 'waves', alpha: 0.8, post: [{ id: 'kaleidoscope' }] });
    expect(kal?.__theme).toBe('dark');
  });

  it('a worn effect gets its one block over a real picture, and a moment gets its control', () => {
    const glitch = renderableBodyFor(part({ id: 'effect-glitch', kind: 'effect', title: 'The glitch', body: { effect: 'glitch', on: 'hero', look: 'neon-dense' } }));
    expect(components(glitch)).toEqual(['hero']);
    const hero = (glitch?.blocks as Array<{ props: { image?: string }; effect?: { id: string } }>)[0];
    expect(hero.props.image).toMatch(/^\/img\//);
    expect(hero.effect?.id).toBe('glitch');
    expect(glitch?.__fxPlay).toMatchObject({ id: 'glitch' });
    const html = partPreviewHtml(part({ id: 'effect-glitch', kind: 'effect', title: 'The glitch', body: { effect: 'glitch', on: 'hero', look: 'neon-dense' } }))!;
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('Play the effect');
  });

  it('a shape that names no look wears a committed one, the same one every time', () => {
    const a = renderableBodyFor(part({ id: 'leiska-cover', kind: 'layout', body: { v: 1, blocks: [] } }));
    expect(a?.look).toBe(lookForShape('leiska-cover'));
    expect(a?.look).not.toBe('vivid');
    expect(new Set(['leiska-cover', 'leiska-dashboard', 'fill-dialog-sure', 'leiska-work-queue', 'fill-report', 'leiska-shelf'].map(lookForShape)).size).toBeGreaterThan(2);
    expect(renderableBodyFor(part({ id: 'x1', kind: 'layout', body: { v: 1, blocks: [], look: 'terminal' } }))?.look).toBe('terminal');
  });

  it('the frame paints the look\'s ground, and the reader\'s theme wins over the stage\'s', () => {
    const p = part({ id: 'look-mtv-broadcast', title: 'MTV broadcast', body: { tokens: {} } });
    const html = partPreviewHtml(p)!;
    expect(html).toMatch(/\.dbp-frame \{[^}]*background-color: var\(--ak-bg\)/);
    expect(html).toContain('data-theme="dark"');
    expect(partPreviewHtml(p, { theme: 'light' })).toContain('data-theme="light"');
  });
});

describe('a face a look names is a face the node serves', () => {
  it('the list is what /lib/aimeat-fonts.css declares', () => {
    const css = readFileSync(new URL('../../public/lib/aimeat-fonts.css', import.meta.url), 'utf8');
    const declared = [...new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map(m => m[1]))].sort();
    expect([...SERVED_FONT_FAMILIES].sort()).toEqual(declared);
    for (const m of css.matchAll(/url\('\/lib\/fonts\/([^']+)'\)/g)) {
      expect(() => readFileSync(new URL(`../../public/lib/fonts/${m[1]}`, import.meta.url)), m[1]).not.toThrow();
    }
  });

  it('refuses a first family nobody serves, with the ones it does', () => {
    expect(unservedFirstFamily('Bungee, system-ui, sans-serif')).toBeNull();
    expect(unservedFirstFamily("'Archivo Black', sans-serif")).toBeNull();
    expect(unservedFirstFamily('Georgia, serif')).toBeNull();
    expect(unservedFirstFamily('var(--ak-font-mono)')).toBeNull();
    expect(unservedFirstFamily('Playfair Display, serif')).toBe('Playfair Display');
    expect(() => validateSignatureTokens({ '--ak-font-display': 'Playfair Display, serif' })).toThrow(/does not serve[\s\S]*Bungee/);
    expect(validateSignatureTokens({ '--ak-font-display': 'Bungee, system-ui, sans-serif', '--ak-font': 'VT323, ui-monospace, monospace' })['--ak-font-display']).toMatch(/^Bungee/);
  });
});

describe('the kit rules behind two of the findings', () => {
  const css = (name: string) => readFileSync(new URL(`../../public/lib/aimeat-atelier/${name}`, import.meta.url), 'utf8');

  it('an effect does not take the hero\'s picture out of its absolute box', () => {
    const rule = /([^{}]*)\{\s*position:\s*relative;\s*\}/.exec(css('effects.css').split('.ak-fx {')[1])![1];
    for (const fx of ['scanlines', 'vignette', 'vhs', 'glitch']) expect(rule).toContain(`.ak-fx-${fx}:not(.ak-hero__image)`);
  });

  it('box-sizing is said outright, because inherit stops at a <details>', () => {
    expect(css('shell.css')).toMatch(/\.ak-root \*, \.ak-root \*::before, \.ak-root \*::after \{ box-sizing: border-box; \}/);
    expect(css('shell.css')).not.toMatch(/box-sizing:\s*inherit/);
  });
});
