/**
 * @file test/unit/atelier-page-look.test.ts
 * @description A page with kit blocks and no app frame picks its look on <html> or <body>
 *   (wish-a-page-with-kit-blocks-but-no-kit-app-frame-cannot-pick-the-). Two halves: wearLook gives
 *   a layer on the body the page's look, with the app frame's own look still first; and the
 *   stylesheet holds the token contract at zero specificity, so a look named on <html> is not
 *   outranked by the contract on the same element. The cascade itself needs a browser; what is
 *   proven here is the selector the contract sits under, and that the matrix still reads it.
 * @version-history
 *   v1.0.0 - 2026-10-02 - Initial.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';
import { parseAtelier } from '../../src/services/atelier-contrast.js';

let restore: () => void;
let wearLook: (node: any, from?: any) => any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  ({ wearLook } = await import('../../src/static/sdk-libs/atelier/dom.js'));
});
afterAll(() => restore());

beforeEach(() => {
  document.documentElement.removeAttribute('data-ak-look');
  document.body.removeAttribute('data-ak-look');
  for (const n of [...document.body.children]) document.body.removeChild(n);
});

const layer = () => document.createElement('div');

describe('wearLook on a page with no app frame', () => {
  it('gives a layer the look named on <html>, with no element and with the body as where it came from', () => {
    document.documentElement.setAttribute('data-ak-look', 'flat');
    expect(wearLook(layer()).getAttribute('data-ak-look')).toBe('flat');
    expect(wearLook(layer(), document.body).getAttribute('data-ak-look')).toBe('flat');
  });

  it('gives a layer from a block on the page the page\'s look', () => {
    document.documentElement.setAttribute('data-ak-look', 'flat');
    const block = document.createElement('section');
    const button = document.createElement('button');
    block.appendChild(button);
    document.body.appendChild(block);
    expect(wearLook(layer(), button).getAttribute('data-ak-look')).toBe('flat');
  });

  it('reads <body> before <html>', () => {
    document.documentElement.setAttribute('data-ak-look', 'flat');
    document.body.setAttribute('data-ak-look', 'calm-card');
    expect(wearLook(layer()).getAttribute('data-ak-look')).toBe('calm-card');
  });

  it('names no look when the page names none', () => {
    expect(wearLook(layer()).hasAttribute('data-ak-look')).toBe(false);
  });
});

describe('wearLook with an app frame on the page', () => {
  it('keeps the app frame\'s own look first, inside the frame and for a layer from nowhere', () => {
    document.documentElement.setAttribute('data-ak-look', 'flat');
    const app = document.createElement('div');
    app.className = 'ak-app';
    app.setAttribute('data-ak-look', 'workbench');
    const button = document.createElement('button');
    app.appendChild(button);
    document.body.appendChild(app);
    expect(wearLook(layer(), button).getAttribute('data-ak-look')).toBe('workbench');
    expect(wearLook(layer()).getAttribute('data-ak-look')).toBe('workbench');
    expect(wearLook(layer(), document.body).getAttribute('data-ak-look')).toBe('workbench');
  });

  it('leaves a layer that already names a look alone', () => {
    document.documentElement.setAttribute('data-ak-look', 'flat');
    const own = layer();
    own.setAttribute('data-ak-look', 'poster');
    expect(wearLook(own).getAttribute('data-ak-look')).toBe('poster');
  });
});

describe('the stylesheet lets a look on <html> win over the contract', () => {
  const css = readFileSync(new URL('../../public/lib/aimeat-atelier.css', import.meta.url), 'utf8');
  /** Every selector list that opens a rule at the top level of the entry stylesheet. */
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^([^\s@{}][^{}]*)\{/gm)].map((m) => m[1]!.trim());

  it('declares the light and the dark contract under :where(), not under a bare :root', () => {
    expect(selectors).toContain(':where(:root)');
    expect(selectors).toContain(':where(:root[data-theme=\'dark\'])');
    expect(selectors).not.toContain(':root');
    expect(selectors).not.toContain(':root[data-theme=\'dark\']');
  });

  it('still hands the contrast matrix the base and the dark contract', () => {
    const looks = readFileSync(new URL('../../public/lib/aimeat-atelier/looks.css', import.meta.url), 'utf8');
    const sheet = parseAtelier(css + '\n' + looks);
    expect(sheet.base.get('--ak-bg')).toBeTruthy();
    expect(sheet.dark.get('--ak-bg')).toBeTruthy();
    expect(sheet.presets.has('flat')).toBe(true);
  });
});
