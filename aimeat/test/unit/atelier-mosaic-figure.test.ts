/**
 * @file test/unit/atelier-mosaic-figure.test.ts
 * @description What a BOUND figure carries. figure() has always taken `unit` and `direction`, and
 *   the mosaic's bound case forwarded neither, so the same record read one way through an
 *   arrangement and another way when an app called figure() itself: a living document's
 *   Fahrenheit block showed a bare 71.6 while everything around it said what it was measured in.
 *
 *   The whole point of a mosaic is that a record is enough. A field the component takes and the
 *   binding drops is a field the record cannot use, and nothing on the screen says which of the
 *   two doors the data came through — which is why this is asserted on the MOUNTED surface
 *   rather than by reading the forwarding line.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-mosaic-figure.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (atelier 0.53.1: the bound figure carries its unit).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

type AnyEl = any;

let restore: any;
let mosaic: (spec: any) => any;
let doc: AnyEl;

beforeAll(async () => {
  // The browser goes in FIRST: the kit's import chain reads document, location and window.
  restore = installGlobals({ motion: 'auto' });
  doc = restore.document;
  ({ mosaic } = await import(new URL('../../src/static/sdk-libs/atelier/mosaic.js', import.meta.url).href));
});

afterAll(() => { if (restore) restore(); });

/** One arrangement holding a single bound figure, and the record its source hands over. */
async function mountFigure(record: any, props: any = {}) {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const surface = mosaic({
    target: host,
    layout: {
      v: 1,
      blocks: [{ id: 'fig', component: 'figure', span: 'full', props: Object.assign({ source: 's' }, props) }],
    },
    fallback: null,
    sources: { s: () => record },
  });
  // The bound path shows a skeleton until its source resolves, so let the promise land.
  await new Promise((r) => setTimeout(r, 20));
  const part = (name: string) => host.querySelector('[data-ak-part="' + name + '"]');
  return { host, surface, part };
}

describe('mosaic: a bound figure carries what the record says', () => {
  it('shows the unit the record names, beside the number', async () => {
    const { part, surface } = await mountFigure({ value: 71.6, label: 'Fahrenheit', unit: '°F' });
    expect(part('value').textContent).toBe('72');
    expect(part('unit')).toBeTruthy();
    expect(part('unit').textContent).toBe('°F');
    surface.destroy();
  });

  it('shows the direction the record names, as the kit\'s own glyph', async () => {
    const { host, surface } = await mountFigure({ value: 12, label: 'Kysyntä', direction: 'up', delta: '+3' });
    const delta = host.querySelector('[data-ak-part="delta"]');
    expect(delta.getAttribute('data-ak-direction')).toBe('up');
    expect(delta.textContent).toContain('↑');
    expect(delta.textContent).toContain('+3');
    surface.destroy();
  });

  it('a record with no unit is exactly what it was: the number on its own', async () => {
    const { part, surface } = await mountFigure({ value: 5, label: 'Määrä' });
    expect(part('value').textContent).toBe('5');
    expect(part('unit')).toBe(null);
    surface.destroy();
  });

  it('the block title still stands in when the record names no label', async () => {
    const { part, surface } = await mountFigure({ value: 5, unit: 'kg' }, { title: 'Paino' });
    expect(part('label').textContent).toBe('Paino');
    expect(part('unit').textContent).toBe('kg');
    surface.destroy();
  });
});
