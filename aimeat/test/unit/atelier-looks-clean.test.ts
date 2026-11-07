/**
 * @file test/unit/atelier-looks-clean.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The clean look (atelier-looks-clean.ts), PANEELI's design-tool look as a look of the
 *   kit: it ships in the registry, the validator and the generated stylesheet, passes the contrast
 *   matrix on every palette in both modes, names only fonts every machine has, moves nothing at
 *   idle, and the clean style kit's one blue (#2563eb, PANEELI's accent) becomes an accent the
 *   matrix passes in both modes.
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lookById } from '../../src/data/atelier-looks.js';
import { LOOKS } from '../../src/services/app-ui/registry.js';
import { validateUiLayout } from '../../src/services/app-ui/validate.js';
import { unservedFirstFamily } from '../../src/services/app-ui/signature-tokens.js';
import { runMatrix } from '../../src/services/atelier-contrast.js';
import { deriveBrandTokens } from '../../src/services/design-book/kit-brand.js';
import { validateKitBody } from '../../src/services/design-book/kit.js';
import { emitLooksCss } from '../../tools/build-atelier-looks.js';

const PANEELI_BLUE = '#2563eb';

describe('the clean look', () => {
  it('ships: registry, validator and the served stylesheet', () => {
    const onDisk = readFileSync(new URL('../../public/lib/aimeat-atelier/looks.css', import.meta.url), 'utf8');
    expect(lookById('clean')).toBeDefined();
    expect(LOOKS).toContain('clean');
    expect(validateUiLayout({ v: 1, look: 'clean', blocks: [] }).look).toBe('clean');
    expect(onDisk.replace(/\r\n/g, '\n')).toBe(emitLooksCss().replace(/\r\n/g, '\n'));
    expect(onDisk).toContain('@preset-block clean ');
    expect(onDisk).toContain('@preset-block clean@dark');
  });

  it('passes the contrast matrix on every palette in both modes', () => {
    expect(runMatrix(undefined, { presets: ['clean'] }).filter((r) => !r.ok)).toEqual([]);
  });

  it('names only fonts every machine has, and one family for headings and text', () => {
    const tokens = lookById('clean')!.tokens;
    for (const face of ['--ak-font', '--ak-font-display']) expect(unservedFirstFamily(tokens[face]!), face).toBeNull();
    expect(tokens['--ak-font-display']).toBe(tokens['--ak-font']);
  });

  it('is still: no ambient, no grain, no page image, flat cards, shadow only on what floats', () => {
    const tokens = lookById('clean')!.tokens;
    expect(tokens['--ak-ambient']).toBe('none');
    expect(tokens['--ak-grain']).toBe('none');
    expect(tokens['--ak-page-image']).toBe('none');
    expect(tokens['--ak-elev-1']).toBe('none');
    expect(tokens['--ak-elev-2']).not.toBe('none');
  });

  it('keeps PANEELI\'s card, words and dim words', () => {
    const g = lookById('clean')!.grounds!;
    expect(g.light['--ak-surface']).toBe('#ffffff');
    expect(g.light['--ak-ink']).toBe('#111827');
    expect(g.light['--ak-ink-dim']).toBe('#5f6673');
    expect(g.dark['--ak-ink']).toBe('#e7e9ec');
    expect(g.dark['--ak-ink-dim']).toBe('#9aa1ad');
  });
});

describe('the clean style kit', () => {
  it('validates with PANEELI\'s blue as its brand', () => {
    const body = validateKitBody({ reach: 'own', look: 'clean', brand: PANEELI_BLUE });
    expect(body.look).toBe('clean');
  });

  it('turns the blue into an accent the matrix passes on clean in both modes', () => {
    const { tokens, proof } = deriveBrandTokens(PANEELI_BLUE, 'clean');
    expect(Object.keys(tokens).sort()).toEqual(['--ak-accent', '--ak-accent-ink', '--ak-accent-text']);
    for (const [mode, half] of [['light', proof.light], ['dark', proof.dark]] as const) {
      const bad = runMatrix({ '--ak-accent': half.accent, '--ak-accent-ink': half.ink, '--ak-accent-text': half.text }, { presets: ['clean'] })
        .filter((r) => !r.ok && r.combo.includes('/dark') === (mode === 'dark'));
      expect(bad).toEqual([]);
      expect(half.ink_ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});
