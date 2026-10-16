/**
 * @file test/unit/atelier-look-kirjapaino.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The kirjapaino look, the printed-letter design Jouni chose for the AIMEAT
 *   newsletter: it is a look the node ships (registry, validator, generated stylesheet), it
 *   resolves to the design's paper and ink in BOTH modes, it passes the contrast matrix on every
 *   palette, its two faces are served, its structure carries the double rule, and a Design Book
 *   part that names it is shown on a letter.
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOOKS as LOOK_REGISTRY, lookById } from '../../src/data/atelier-looks.js';
import { LOOKS } from '../../src/services/app-ui/registry.js';
import { validateUiLayout } from '../../src/services/app-ui/validate.js';
import { SERVED_FONT_FAMILIES, unservedFirstFamily } from '../../src/services/app-ui/signature-tokens.js';
import { THEME_FACES } from '../../src/services/themes/tokens.js';
import { evalColor, loadAtelierSheets, runMatrix, type Vars } from '../../src/services/atelier-contrast.js';
import { emitLooksCss } from '../../tools/build-atelier-looks.js';
import { lookStage } from '../../src/services/design-book/preview-stages.js';

const LOOK = 'kirjapaino';

/** The custom properties a page wearing the look sees, layered the way the cascade layers them. */
function resolved(paletteMode: string): Vars {
  const { themes, sheet } = loadAtelierSheets();
  const vars: Vars = new Map(themes.get(paletteMode)!);
  for (const [k, v] of sheet.base) vars.set(k, v);
  const dark = paletteMode.endsWith('/dark');
  if (dark) for (const [k, v] of sheet.dark) vars.set(k, v);
  for (const [k, v] of sheet.presets.get(LOOK)!.decls) vars.set(k, v);
  if (dark) for (const [k, v] of sheet.presets.get(`${LOOK}@dark`)!.decls) vars.set(k, v);
  return vars;
}

const colour = (vars: Vars, token: string): string => evalColor(vars.get(token)!, vars, token).hex;

describe('the kirjapaino look', () => {
  it('is a look the node ships: in the registry, in the validator and in the served stylesheet', () => {
    expect(lookById(LOOK)).toBeDefined();
    expect(LOOK_REGISTRY.map((l) => l.id)).toContain(LOOK);
    expect(LOOKS).toContain(LOOK);
    expect(validateUiLayout({ v: 1, look: LOOK, blocks: [] }).look).toBe(LOOK);
    const onDisk = readFileSync(new URL('../../public/lib/aimeat-atelier/looks.css', import.meta.url), 'utf8');
    expect(onDisk.replace(/\r\n/g, '\n')).toBe(emitLooksCss().replace(/\r\n/g, '\n'));
    expect(onDisk).toContain(`@preset-block ${LOOK} `);
    expect(onDisk).toContain(`@preset-block ${LOOK}@dark`);
  });

  it('resolves to the design\'s paper and ink, the same in light and in dark mode', () => {
    const want = {
      '--ak-bg': '#e9e2d4',
      '--ak-surface': '#f3eee4',
      '--ak-surface-2': '#fbf8f2',
      '--ak-ink': '#16130f',
      '--ak-ink-dim': '#5a5247',
      '--ak-line': '#16130f',
    };
    for (const mode of ['aimeat/light', 'aimeat/dark', 'paper/dark', 'circuit/dark']) {
      const vars = resolved(mode);
      for (const [token, hex] of Object.entries(want)) expect(colour(vars, token), `${mode} ${token}`).toBe(hex);
      expect(vars.get('--ak-font-display'), mode).toMatch(/^Fraunces, Georgia/);
      expect(vars.get('--ak-font'), mode).toMatch(/^Newsreader, Georgia/);
      for (const r of ['--ak-radius', '--ak-radius-sm', '--ak-radius-pill']) expect(vars.get(r), `${mode} ${r}`).toBe('0px');
      expect(vars.get('--ak-elev-1'), mode).toBe('none');
      expect(vars.get('--ak-focus'), mode).toBe('var(--ak-ink)');
    }
  });

  it('passes the contrast matrix on every palette in both modes', () => {
    const results = runMatrix(undefined, { presets: [LOOK] });
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((r) => `${r.combo} ${r.label} ${r.actual.toFixed(2)}`)).toEqual([]);
    // Every palette in both modes was measured.
    const combos = new Set(results.filter((r) => r.combo.startsWith(`${LOOK} ×`)).map((r) => r.combo));
    expect(combos.size).toBe(loadAtelierSheets().themes.size);
  });

  it('takes the vermilion as a Book part\'s accent pair, with a dark half the night accent ink can sit on', () => {
    const ok = validateUiLayout({ v: 1, look: LOOK, blocks: [], tokens: { '--ak-accent': '#b3321c/#ec5f4c' } });
    expect(ok.tokens?.['--ak-accent']).toBe('#b3321c/#ec5f4c');
    // In dark mode the kit writes dark words on the accent, and dark words on #b3321c measure under 3:1.
    expect(() => validateUiLayout({ v: 1, look: LOOK, blocks: [], tokens: { '--ak-accent': '#b3321c/#b3321c' } }))
      .toThrow(/dark half of --ak-accent/);
  });

  it('names two faces the node serves, the Fraunces italic and Newsreader included', () => {
    const look = lookById(LOOK)!;
    expect(unservedFirstFamily(look.tokens['--ak-font-display']!)).toBeNull();
    expect(unservedFirstFamily(look.tokens['--ak-font']!)).toBeNull();
    expect(SERVED_FONT_FAMILIES).toContain('Newsreader');
    expect(THEME_FACES.Newsreader).toMatch(/^'Newsreader', Georgia/);
    const css = readFileSync(new URL('../../public/lib/aimeat-fonts.css', import.meta.url), 'utf8');
    for (const file of ['newsreader-var-latin', 'newsreader-var-latin-ext', 'newsreader-italic-var-latin',
      'newsreader-italic-var-latin-ext', 'fraunces-italic-var-latin', 'fraunces-italic-var-latin-ext']) {
      expect(css, file).toContain(`/lib/fonts/${file}.woff2`);
      const bytes = readFileSync(new URL(`../../public/lib/fonts/${file}.woff2`, import.meta.url));
      expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('wOF2');
    }
    expect(css).toMatch(/font-family: 'Fraunces'; font-style: italic;/);
    expect(css).toMatch(/font-family: 'Newsreader'; font-style: italic;/);
    const licence = readFileSync(new URL('../../public/lib/fonts/LICENSE.md', import.meta.url), 'utf8');
    expect(licence).toMatch(/\| Newsreader \|[^\n]*The Newsreader Project Authors/);
  });

  it('carries the double rule and the light form controls as the look\'s own structure', () => {
    const css = emitLooksCss();
    const sel = `[data-ak-look='${LOOK}']`;
    const block = css.slice(css.indexOf(`/* structure: press-rule`), css.indexOf('/* ', css.indexOf(`/* structure: press-rule`) + 3));
    expect(block).toContain(`${sel} { color-scheme: light; }`);
    expect(block).toContain(`${sel} .ak-app__bar::after`);
    expect(block).toMatch(/border-top: 3px solid var\(--ak-ink\);\s*border-bottom: 1px solid var\(--ak-ink\);/);
    expect(block).toMatch(/\.ak-btn--primary \{\s*background: var\(--ak-ink\);\s*color: var\(--ak-surface\);/);
    // Only this look wears it.
    expect(css.match(/structure: press-rule/g)).toHaveLength(1);
  });

  it('is shown in the Design Book on a letter, not on the poster or the bakery', () => {
    const stage = lookStage('look-kirjapaino Kirjapaino kirjapaino', {}, LOOK);
    expect(stage.look).toBe(LOOK);
    expect(JSON.stringify(stage.blocks)).toContain('The October letter');
    expect(stage.__theme).toBeUndefined();
    const { __sources, ...layout } = stage;
    expect(() => validateUiLayout(layout)).not.toThrow();
    for (const b of stage.blocks as Array<{ props: { source?: string } }>) {
      if (b.props.source) expect(__sources?.[b.props.source], b.props.source).toBeDefined();
    }
  });
});
