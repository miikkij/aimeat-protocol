/**
 * @file test/unit/atelier-look-tdr.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tdr look, the machine-room style of the TDR family of apps (M-ROOM, DROP, LOOM,
 *   LINGUA): it is a look the node ships (registry, validator, generated stylesheet), it resolves
 *   to the family kit's own page and ink in light and in dark, it passes the contrast matrix on
 *   every palette, the family's orange is a pair the validator takes on it, its two faces are
 *   served with real files, its structure carries the console's plate and outlined actions, and a
 *   Design Book part that names it is shown on the operator's console in the dark.
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial.
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
import { layerStage, lookStage } from '../../src/services/design-book/preview-stages.js';

const LOOK = 'tdr';

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

describe('the tdr look', () => {
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

  it('resolves to the family kit\'s page, ink and tones, its own set in each mode', () => {
    // aimeat-tdr.js, the "orange" palette. The card is the kit's panel2 and the nested ground its
    // panel; the dark card and both hairlines moved the least the matrix asks (the look's note).
    const want: Record<'light' | 'dark', Record<string, string>> = {
      light: {
        '--ak-bg': '#f4f2ed', '--ak-surface': '#e7e3d8', '--ak-surface-2': '#efece4',
        '--ak-ink': '#141414', '--ak-ink-dim': '#5c594f', '--ak-line': '#ccc8bd',
        '--ak-ok': '#1e7a45', '--ak-warn': '#8a5a10', '--ak-err': '#a33830',
      },
      dark: {
        '--ak-bg': '#0a0a0b', '--ak-surface': '#17171c', '--ak-surface-2': '#0e0e10',
        '--ak-ink': '#e8e5de', '--ak-ink-dim': '#a29e95', '--ak-line': '#2d2d31',
        '--ak-ok': '#4caf6e', '--ak-warn': '#d9962f', '--ak-err': '#de5f55',
      },
    };
    for (const mode of ['aimeat/light', 'aimeat/dark', 'paper/light', 'circuit/dark']) {
      const vars = resolved(mode);
      const set = want[mode.endsWith('/dark') ? 'dark' : 'light'];
      for (const [token, hex] of Object.entries(set)) expect(colour(vars, token), `${mode} ${token}`).toBe(hex);
      expect(vars.get('--ak-font'), mode).toMatch(/^'IBM Plex Mono', /);
      expect(vars.get('--ak-font-mono'), mode).toMatch(/^'IBM Plex Mono', /);
      expect(vars.get('--ak-font-display'), mode).toMatch(/^Michroma, 'IBM Plex Mono'/);
      for (const r of ['--ak-radius', '--ak-radius-sm', '--ak-radius-pill']) expect(vars.get(r), `${mode} ${r}`).toBe('0px');
      for (const t of ['--ak-elev-1', '--ak-elev-2', '--ak-hero-image', '--ak-ambient']) expect(vars.get(t), `${mode} ${t}`).toBe('none');
    }
  });

  it('passes the contrast matrix on every palette in both modes', () => {
    const results = runMatrix(undefined, { presets: [LOOK] });
    const failed = results.filter((r) => !r.ok);
    expect(failed.map((r) => `${r.combo} ${r.label} ${r.actual.toFixed(2)}`)).toEqual([]);
    const combos = new Set(results.filter((r) => r.combo.startsWith(`${LOOK} ×`)).map((r) => r.combo));
    expect(combos.size).toBe(loadAtelierSheets().themes.size);
  });

  it('takes the family\'s orange as a Book part\'s accent pair, and refuses the kit\'s light value under white words', () => {
    const ok = validateUiLayout({ v: 1, look: LOOK, blocks: [], tokens: { '--ak-accent': '#d44500/#ff4d00' } });
    expect(ok.tokens?.['--ak-accent']).toBe('#d44500/#ff4d00');
    // The kit's light accent #e84a00 carries the kit's white action words at 3.3, under 4.5.
    expect(() => validateUiLayout({ v: 1, look: LOOK, blocks: [], tokens: { '--ak-accent': '#e84a00/#ff4d00' } }))
      .toThrow(/light half of --ak-accent/);
  });

  it('names two faces the node serves, Michroma and IBM Plex Mono with its 600', () => {
    const look = lookById(LOOK)!;
    expect(unservedFirstFamily(look.tokens['--ak-font-display']!)).toBeNull();
    expect(unservedFirstFamily(look.tokens['--ak-font']!)).toBeNull();
    expect(SERVED_FONT_FAMILIES).toContain('Michroma');
    expect(THEME_FACES.Michroma).toMatch(/^'Michroma', 'IBM Plex Mono'/);
    const css = readFileSync(new URL('../../public/lib/aimeat-fonts.css', import.meta.url), 'utf8');
    for (const file of ['michroma-400-latin', 'michroma-400-latin-ext', 'ibm-plex-mono-600-latin', 'ibm-plex-mono-600-latin-ext']) {
      expect(css, file).toContain(`/lib/fonts/${file}.woff2`);
      const bytes = readFileSync(new URL(`../../public/lib/fonts/${file}.woff2`, import.meta.url));
      expect(bytes.subarray(0, 4).toString('latin1'), file).toBe('wOF2');
    }
    expect(css).toMatch(/font-family: 'Michroma'; font-style: normal; font-weight: 400;/);
    expect(css).toMatch(/font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 600;/);
    const licence = readFileSync(new URL('../../public/lib/fonts/LICENSE.md', import.meta.url), 'utf8');
    expect(licence).toMatch(/\| Michroma \|[^\n]*The Michroma Project Authors/);
    expect(licence).toMatch(/\| IBM Plex Mono \|[^\n]*ibm-plex-mono-600-latin\.woff2/);
  });

  it('carries the console plate, the capital labels and the outlined action as the look\'s own structure', () => {
    const css = emitLooksCss();
    const sel = `[data-ak-look='${LOOK}']`;
    const start = css.indexOf('/* structure: operator-console');
    const block = css.slice(start, css.indexOf('/* ', start + 3));
    expect(block).toContain(`${sel} .ak-hero:not(.ak-hero--image)::before`);
    expect(block).toMatch(/border-top: 2px solid var\(--ak-accent\);\s*border-left: 2px solid var\(--ak-accent\);/);
    expect(block).toMatch(/\.ak-form__label,[\s\S]*?letter-spacing: 0\.12em;\s*text-transform: uppercase;/);
    // The action is outlined in the accent text (proven on card and page) and fills with the raw
    // accent under its own ink when touched (proven by AK-SOLID).
    expect(block).toMatch(/\.ak-btn--primary \{\s*background: transparent;\s*border-color: var\(--ak-accent-text\);\s*color: var\(--ak-accent-text\);/);
    expect(block).toMatch(/background: var\(--ak-accent\);\s*border-color: var\(--ak-accent\);\s*color: var\(--ak-accent-ink\);/);
    expect(block).toContain('dashed var(--ak-line)');
    // Only this look wears it.
    expect(css.match(/structure: operator-console/g)).toHaveLength(1);
  });

  it('is shown in the Design Book on the operator\'s console, in the dark', () => {
    const stage = lookStage('look-tdr TDR machine room tdr', {}, LOOK);
    expect(stage.look).toBe(LOOK);
    expect(JSON.stringify(stage.blocks)).toContain('"component":"console"');
    expect(stage.__theme).toBe('dark');
    const { __sources, __theme, ...layout } = stage;
    void __theme;
    expect(() => validateUiLayout(layout)).not.toThrow();
    for (const b of stage.blocks as Array<{ props: { source?: string } }>) {
      if (b.props.source) expect(__sources?.[b.props.source], b.props.source).toBeDefined();
    }
    expect(layerStage('t', 's', LOOK, {}, { ambient: 'grid' }).__theme).toBe('dark');
    // The word alone, without "machine", still finds the console, and a word that only contains it does not.
    expect(JSON.stringify(lookStage('look-tdr', {}).blocks)).toContain('"component":"console"');
    expect(JSON.stringify(lookStage('look-outdrive', {}).blocks)).not.toContain('"component":"console"');
  });
});
