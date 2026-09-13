/**
 * @file test/unit/sdk-atelier-mosaic-fill.test.ts
 * @description When a mosaic calls the app's `fill` for a section, and what one bad fill costs.
 *   The mosaic built each unit as a detached element, called the fill into it on the spot, and put
 *   the units in the page only after the loop. A fill that measured got 0x0, one that read a
 *   `--ak-*` token off getComputedStyle got an empty string, and the canvas it fed that into threw,
 *   and the throw ended the whole render: every block after that section was never built, with
 *   nothing on screen saying why (appdev pitfall mosaic-fills-a-section-before-it-mounts-it,
 *   2026-08-28). The fills run now once the projection is in the page, each on its own.
 *
 *   Asserted on the mounted surface, so the proof is what a person would see: which blocks exist,
 *   and whether the body a fill was handed is in the document.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-atelier-mosaic-fill.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

type AnyEl = any;

let restore: any;
let mosaic: (spec: any) => any;
let doc: AnyEl;

beforeAll(async () => {
  restore = installGlobals({ motion: 'auto' });
  doc = restore.document;
  ({ mosaic } = await import(new URL('../../src/static/sdk-libs/atelier/mosaic.js', import.meta.url).href));
});

afterAll(() => { if (restore) restore(); });

/** A host in the page, and an arrangement of a filled section followed by a plain block. */
function arrangement(nav?: string) {
  return {
    v: 1,
    ...(nav ? { nav } : {}),
    blocks: [
      { id: 'a', component: 'section', props: { title: 'A' } },
      { id: 'b', component: 'emptyState', props: { title: 'B' } },
    ],
  };
}

function pageHost() {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  return host;
}

describe('mosaic: a section is filled once it is in the page', () => {
  for (const nav of [undefined, 'tabs', 'bottom-bar', 'deck', 'flow', 'rail', 'overlay', 'canvas']) {
    it('hands the fill a body that is connected (' + (nav || 'stack') + ')', () => {
      const host = pageHost();
      const seen: boolean[] = [];
      const surface = mosaic({
        target: host, layout: arrangement(nav), fallback: null,
        fill: { a: (body: AnyEl) => { seen.push(body.isConnected); } },
      });
      expect(seen).toEqual([true]);
      surface.destroy();
    });
  }

  it('has filled the section by the time mosaic() returns, as it always had', () => {
    const host = pageHost();
    const surface = mosaic({
      target: host, layout: arrangement(), fallback: null,
      fill: { a: (body: AnyEl) => { body.appendChild(doc.createTextNode('written by the app')); } },
    });
    expect(host.querySelector('[data-ak-block="a"]').textContent).toContain('written by the app');
    surface.destroy();
  });
});

describe('mosaic: a fill that throws takes down its own section and nothing else', () => {
  it('still builds the blocks after it, and says which fill failed', () => {
    const host = pageHost();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let surface: any;
    expect(() => {
      surface = mosaic({
        target: host, layout: arrangement(), fallback: null,
        fill: { a: () => { throw new Error("the value ('') could not be parsed as a color"); } },
      });
    }).not.toThrow();
    expect(host.querySelector('[data-ak-block="b"]')).toBeTruthy();
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0][0])).toContain('"a"');
    logged.mockRestore();
    surface.destroy();
  });
});
