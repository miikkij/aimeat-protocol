/**
 * @file test/unit/atelier-added-faces.test.ts
 * @description The kit links the added faces' sheet only when the look needs it (Jouni's decision,
 *   2026-10-03, after the font manager): a look on the base faces loads nothing more, a look that
 *   names a face no @font-face on the page declares gets /v1/themes/fonts.css, a system face or a
 *   generic keyword never triggers it. Driven on the pure functions; the link on a real page is
 *   checked in the browser on the sandbox.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-added-faces.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (atelier 0.65.1).
 */
import { describe, it, expect } from 'vitest';
import { firstFamily, needsAddedFaces, ADDED_FACES_HREF, FACE_TOKENS } from '../../src/static/sdk-libs/atelier/added-faces.js';

describe('firstFamily', () => {
  it('reads the first family of a stack, without its quotes', () => {
    expect(firstFamily("'Space Mono', 'JetBrains Mono', monospace")).toBe('Space Mono');
    expect(firstFamily('"Press Start 2P", VT323, monospace')).toBe('Press Start 2P');
    expect(firstFamily('Archivo, system-ui, sans-serif')).toBe('Archivo');
    expect(firstFamily('  system-ui ')).toBe('system-ui');
    expect(firstFamily('')).toBe('');
  });
});

describe('needsAddedFaces', () => {
  const base = ['Archivo', 'Fjalla One', 'JetBrains Mono', 'Space Grotesk'];

  it('a look on the base faces needs nothing more', () => {
    expect(needsAddedFaces(['Archivo', 'Fjalla One'], base)).toBe(false);
  });

  it('a look that names a face no @font-face declares needs the added faces', () => {
    expect(needsAddedFaces(['Space Mono', 'Archivo'], base)).toBe(true);
  });

  it('a face the page already declares, quoted or not, in any case, needs nothing', () => {
    expect(needsAddedFaces(['space mono'], [...base, '"Space Mono"'])).toBe(false);
  });

  it('a system face or a generic keyword never needs the sheet', () => {
    expect(needsAddedFaces(['system-ui', 'Segoe UI', 'monospace', ''], base)).toBe(false);
  });

  it('reads the two face tokens and links the sheet of the app\'s own origin', () => {
    expect(FACE_TOKENS).toEqual(['--ak-font', '--ak-font-display']);
    expect(ADDED_FACES_HREF).toBe('/v1/themes/fonts.css');
  });
});
