/**
 * @file genre-blueprint-prints.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The blueprint genre has two prints of one drawing: the blueprint (white lines on
 *   process blue) and, in the light choice, the whiteprint (blue lines on white paper). A reader
 *   who could not read white text on the blue needs the whiteprint to exist, to be reachable from
 *   the pill, and to be readable; a fork needs every colour to be a token so the prints can be
 *   swapped per block.
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { GENRE_BODIES } from '../../src/data/app-templates/genres.js';

const body = (GENRE_BODIES as Record<string, string>).blueprint;
const css = (body.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';

function block(selector: string): string {
  const at = css.indexOf(selector + ' {');
  if (at < 0) return '';
  return css.slice(at, css.indexOf('}', at) + 1);
}
function token(rule: string, name: string): string {
  const m = rule.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  return m ? m[1] : '';
}
function lum(hex: string): number {
  const f = (i: number) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(1) + 0.7152 * f(3) + 0.0722 * f(5);
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('genre-blueprint: two prints of one drawing', () => {
  it('lets the pill switch light and dark', () => {
    expect(body).toContain('<meta name="aimeat-light" content="follows" />');
  });

  it('keeps the blueprint for a reader who has not chosen', () => {
    expect(body).toMatch(/localStorage\.getItem\('aimeat-theme'\)[\s\S]*setAttribute\('data-theme', 'dark'\)/);
  });

  it('sets the whiteprint in the light choice, and its text reads on the paper', () => {
    const light = block(':root[data-theme="light"]');
    expect(light).not.toBe('');
    const paper = token(light, 'bp-blue');
    for (const ink of ['bp-line', 'bp-dim', 'bp-hot']) {
      expect(contrast(token(light, ink), paper), ink).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('draws every colour from a token, so a fork can swap the print per block', () => {
    const rest = css.replace(block(':root'), '').replace(block(':root[data-theme="light"]'), '');
    expect(rest).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,6}\b/);
    const markup = body.slice(body.indexOf('<body>'));
    expect(markup).not.toMatch(/(fill|stroke)="#/);
  });
});
