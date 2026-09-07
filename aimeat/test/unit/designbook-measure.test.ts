/**
 * @file test/unit/designbook-measure.test.ts
 * @description Regression inputs for the browser geometry policy: phone targets, content hidden
 *   by clipping, intentional scroll regions and small text. Real layouts are probed in Chrome.
 * @usage pnpm test -- test/unit/designbook-measure.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-08 — Boundary and clipping regressions for the strengthened bench.
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DESIGN_BOOK_GEOMETRY_JS } from '../../src/services/design-book/measure.js';

function probe({ width = 40, height = 40, text = false, fontSize = '16px', overflow = 'visible', left = 0, viewport = 390 } = {}) {
  const parent = {
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
    style: { overflowX: overflow, overflowY: 'visible' },
  };
  const el = {
    parentElement: parent,
    childNodes: text ? [{ nodeType: 3, textContent: 'Read this' }] : [],
    getBoundingClientRect: () => ({ left, top: 0, right: left + width, bottom: height, width, height }),
    matches: () => !text,
    closest: () => null,
    style: { fontSize, visibility: 'visible', display: 'block', opacity: '1' },
  };
  return runInNewContext(DESIGN_BOOK_GEOMETRY_JS, {
    document: { querySelectorAll: () => [el] },
    getComputedStyle: (node: typeof el | typeof parent) => node.style,
    innerWidth: viewport,
    Node: { TEXT_NODE: 3 },
  });
}

describe('Design Book browser geometry policy', () => {
  it('rejects the 30px phone button the previous 24px check accepted', () => {
    expect(probe({ width: 30, height: 30 }).smallControls).toBe(1);
    expect(probe({ width: 40, height: 40 }).smallControls).toBe(0);
    expect(probe({ width: 39, height: 44 }).smallControls).toBe(1);
    expect(probe({ width: 30, height: 30, viewport: 1280 }).smallControls).toBe(0);
  });
  it('rejects content inside hidden/clip even when the document itself fits', () => {
    for (const overflow of ['hidden', 'clip']) {
      expect(probe({ width: 200, text: true, overflow }).clippedContent).toBe(1);
    }
  });
  it('allows a region that can scroll to reveal its contents', () => {
    expect(probe({ width: 700, text: true, overflow: 'auto' }).clippedContent).toBe(0);
    expect(probe({ width: 700, text: true, overflow: 'scroll' }).clippedContent).toBe(0);
    expect(probe({ width: 700, text: true }).clippedContent).toBe(1);
  });
  it('rejects small text but excludes unrendered boxes', () => {
    expect(probe({ text: true, fontSize: '10px' }).smallText).toBe(1);
    expect(probe({ text: true, fontSize: '11px' }).smallText).toBe(0);
    expect(probe({ width: 0, height: 0 }).smallControls).toBe(0);
  });
});
