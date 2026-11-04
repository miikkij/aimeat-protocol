/**
 * @file test/unit/atelier-looks-office.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The five office and corporate looks and the brand colour of a style kit: each look
 *   ships (registry, validator, generated stylesheet) and passes the matrix on every palette, the
 *   binder's own colours and the highlighter's marker carry readable words, the served faces hold,
 *   and one brand colour becomes a kit whose every word is readable, the awkward colours included.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lookById } from '../../src/data/atelier-looks.js';
import { BINDER_COLOURS } from '../../src/data/atelier-structures-office.js';
import { LOOKS } from '../../src/services/app-ui/registry.js';
import { validateUiLayout } from '../../src/services/app-ui/validate.js';
import { unservedFirstFamily } from '../../src/services/app-ui/signature-tokens.js';
import { ratio, runMatrix } from '../../src/services/atelier-contrast.js';
import { deriveBrandTokens } from '../../src/services/design-book/kit-brand.js';
import { kitSnippet, validateKitBody } from '../../src/services/design-book/kit.js';
import { DesignBookError } from '../../src/services/design-book/errors.js';
import { lookStage } from '../../src/services/design-book/preview-stages.js';
import { emitLooksCss } from '../../tools/build-atelier-looks.js';

const FIVE = ['mappi', 'korostus', 'komento', 'vuosikertomus', 'konserni'];

describe('the five looks', () => {
  const onDisk = readFileSync(new URL('../../public/lib/aimeat-atelier/looks.css', import.meta.url), 'utf8');

  it.each(FIVE)('%s ships: registry, validator and the served stylesheet', (id) => {
    expect(lookById(id)).toBeDefined();
    expect(LOOKS).toContain(id);
    expect(validateUiLayout({ v: 1, look: id, blocks: [] }).look).toBe(id);
    expect(onDisk.replace(/\r\n/g, '\n')).toBe(emitLooksCss().replace(/\r\n/g, '\n'));
    expect(onDisk).toContain(`@preset-block ${id} `);
    expect(onDisk).toContain(`@preset-block ${id}@dark`);
  });

  it.each(FIVE)('%s passes the contrast matrix on every palette in both modes', (id) => {
    const results = runMatrix(undefined, { presets: [id] });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.some((r) => r.label === 'AK-MARK words on the marker')).toBe(true);
  });

  it.each(FIVE)('%s names only faces the node serves', (id) => {
    const tokens = lookById(id)!.tokens!;
    for (const face of ['--ak-font', '--ak-font-display']) {
      expect(unservedFirstFamily(tokens[face]!), `${id} ${face}`).toBeNull();
    }
  });

  it('the words on the binder\'s tabs and board read in both modes', () => {
    for (const tab of BINDER_COLOURS.tabs) expect(ratio(BINDER_COLOURS.tabInk, tab), tab).toBeGreaterThanOrEqual(4.5);
    expect(ratio(BINDER_COLOURS.onBoard.light, BINDER_COLOURS.board.light)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(BINDER_COLOURS.onBoard.dark, BINDER_COLOURS.board.dark)).toBeGreaterThanOrEqual(4.5);
  });

  it('the highlighter sets its own marker, and every other look keeps the quiet one', () => {
    expect(lookById('korostus')!.tokens!['--ak-mark']).toBe('#ffe94a');
    expect(ratio('#0b0b0a', '#ffe94a')).toBeGreaterThanOrEqual(7);
    for (const id of FIVE.filter((x) => x !== 'korostus')) expect(lookById(id)!.tokens!['--ak-mark']).toBeUndefined();
  });

  it('a preview of each stands on the working-day stage', () => {
    for (const id of FIVE) expect(JSON.stringify(lookStage(id, {}, id))).toContain('To check');
  });
});

describe('a kit from one brand colour', () => {
  const AWKWARD = ['#0b6b53', '#f2b705', '#5b2a86', '#0b2545', '#808080', '#ffffff', '#000000', '#e8564a', '#00ffcc'];

  it.each(AWKWARD)('%s becomes three pairs the matrix passes on konserni', (brand) => {
    const { tokens, proof } = deriveBrandTokens(brand, 'konserni');
    expect(Object.keys(tokens).sort()).toEqual(['--ak-accent', '--ak-accent-ink', '--ak-accent-text']);
    for (const [mode, half] of [['light', proof.light], ['dark', proof.dark]] as const) {
      const bad = runMatrix({ '--ak-accent': half.accent, '--ak-accent-ink': half.ink, '--ak-accent-text': half.text }, { presets: ['konserni'] })
        .filter((r) => !r.ok && r.combo.includes('/dark') === (mode === 'dark'));
      expect(bad).toEqual([]);
      expect(half.ink_ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the brand on the fill where it can, so a yellow stays yellow with dark words', () => {
    const { proof } = deriveBrandTokens('#f2b705', 'konserni');
    expect(proof.light.accent).toBe('#f2b705');
    expect(proof.light.moved).toBe(false);
    expect(proof.light.ink).toBe('#14161a');
    expect(ratio(proof.light.text, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('moves a brand that would vanish on the dark page, and says so', () => {
    const { proof } = deriveBrandTokens('#0b2545', 'konserni');
    expect(proof.light.accent).toBe('#0b2545');
    expect(proof.dark.moved).toBe(true);
    expect(ratio(proof.dark.accent, '#0e1013')).toBeGreaterThanOrEqual(2.2);
  });

  it.each(FIVE)('works on %s', (look) => {
    const body = validateKitBody({ reach: 'own', look, brand: '#0b6b53' });
    expect(body.tokens!['--ak-accent']).toMatch(/^#[0-9a-f]{6}\/#[0-9a-f]{6}$/);
    expect(body.brand_proof!.look).toBe(look);
  });

  it('the head stylesheet carries every pair per mode, on the look\'s element too', () => {
    const body = validateKitBody({ reach: 'own', look: 'konserni', brand: '#f2b705', tokens: { '--ak-radius': '2px' } });
    const { css } = kitSnippet(body, 'Yritys');
    expect(css).toContain('--ak-radius: 2px;');
    expect(css).toContain(':root { ');
    expect(css).toContain('--ak-accent: #f2b705;');
    expect(css).toContain(':root[data-theme="dark"] { --ak-accent: ');
    expect(css).toContain(':root, [data-ak-look] { --ak-accent-ink: #14161a;');
    expect(css).toContain(':root[data-theme="dark"], :root[data-theme="dark"] [data-ak-look] { --ak-accent-ink: ');
    expect(css).not.toContain('/#');
  });

  it('refuses a colour that is no colour, and a kit that gives both doors', () => {
    expect(() => validateKitBody({ reach: 'own', look: 'konserni', brand: 'red' })).toThrow(DesignBookError);
    expect(() => validateKitBody({ reach: 'own', look: 'konserni', brand: '#0b6b53', tokens: { '--ak-accent': '#0e7c66/#7fd8c4' } })).toThrow(/not both/);
  });

  it('never takes the worked-out record from the caller', () => {
    const body = validateKitBody({ reach: 'own', look: 'konserni', brand_proof: { made: 'up' } });
    expect(body.brand_proof).toBeUndefined();
  });
});
