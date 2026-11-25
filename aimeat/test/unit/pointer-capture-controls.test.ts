/**
 * @file test/unit/pointer-capture-controls.test.ts
 * @description A click on a control inside an element that captures pointers. The browser sends a
 *   captured pointer's click to the capturing element, so an element that captured every
 *   pointerdown took the click away from each button inside it; element.click() never showed it.
 *   aimeat-viewport 1.2.0 fixed its host (cortex-viewport-click.test.ts); this file holds the rest
 *   of the same defect: aimeat-input's on() and pad(), and the Atelier kit's drag() and compare().
 *   Each captures a press on a control inside it only once the press moves; a press elsewhere is
 *   captured at once, as before. The control lists of the copies are held equal here.
 *
 *   The packs run on the stub DOM with a real pointer sequence (pointerdown, pointermove,
 *   pointerup on the element pressed); setPointerCapture is recorded on the capturing element.
 *   FIRST FAIL: against aimeat-input 1.1.0 and aimeat-atelier 0.72.3 a press on a button inside
 *   the element is captured at pointerdown.
 * @usage cd aimeat && pnpm exec vitest run test/unit/pointer-capture-controls.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installGlobals } from './phaser-stub.mjs';

const cortexDir = fileURLToPath(new URL('../../public/cortex-bundled/', import.meta.url));
let restore: () => void;
let dom: any;
let motion: any;
let partsUi: any;

const pe = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ type, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true,
    preventDefault() {}, ...extra });

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  // aimeat-input is a classic script that reads `this`/window as its global.
  new Function('window', 'self', readFileSync(cortexDir + 'aimeat-input.js', 'utf8')).call(window, window, window);
  dom = await import('../../src/static/sdk-libs/atelier/dom.js');
  motion = await import('../../src/static/sdk-libs/atelier/motion.js');
  partsUi = await import('../../src/static/sdk-libs/atelier/parts-ui.js');
});
afterAll(() => restore());

/** An element with one button and one plain child, recording every capture on the element. */
function surface(tag = 'div') {
  const wrap: any = document.createElement('div');
  const el: any = document.createElement(tag);
  wrap.appendChild(el);
  document.body.appendChild(wrap);
  const captured: number[] = [];
  el.setPointerCapture = (id: number) => { captured.push(id); };
  const button: any = document.createElement('button');
  const plain: any = document.createElement('span');
  el.appendChild(button);
  el.appendChild(plain);
  return { wrap, el, button, plain, captured };
}

describe('aimeat-input on()', () => {
  it('leaves a press on a button inside uncaptured, fires no tap and lets its click through', () => {
    const taps: unknown[] = [];
    const { wrap, el, button, captured } = surface();
    const g = (window as any).AIMEAT.input.on(el, { tap: () => taps.push(1), swipe() {} });
    const clicks: unknown[] = [];
    wrap.addEventListener('click', () => clicks.push(1));
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointerup', 10, 10));
    button.dispatchEvent({ type: 'click', bubbles: true });
    expect(captured).toEqual([]);
    expect(taps).toEqual([]);
    expect(clicks).toEqual([1]);
    g.destroy();
  });

  it('takes the pointer from a button once the press moves past the slop, and the drag runs', () => {
    const drags: number[] = [];
    const { el, button, captured } = surface();
    const g = (window as any).AIMEAT.input.on(el, { dragMove: (_ev: unknown, info: any) => drags.push(info.dx) });
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointermove', 14, 10));
    expect(captured).toEqual([]);
    button.dispatchEvent(pe('pointermove', 40, 10));
    expect(captured).toEqual([1]);
    expect(drags).toEqual([30]);
    button.dispatchEvent(pe('pointerup', 40, 10));
    g.destroy();
  });

  it('captures a press on plain content at once and taps, as before', () => {
    const taps: unknown[] = [];
    const { el, plain, captured } = surface();
    const g = (window as any).AIMEAT.input.on(el, { tap: () => taps.push(1) });
    plain.dispatchEvent(pe('pointerdown', 10, 10));
    expect(captured).toEqual([1]);
    plain.dispatchEvent(pe('pointerup', 10, 10));
    expect(taps).toEqual([1]);
    g.destroy();
  });

  it('treats the element itself as the surface when it is a button', () => {
    const taps: unknown[] = [];
    const { el, captured } = surface('button');
    const g = (window as any).AIMEAT.input.on(el, { tap: () => taps.push(1) });
    el.dispatchEvent(pe('pointerdown', 10, 10));
    el.dispatchEvent(pe('pointerup', 10, 10));
    expect(captured).toEqual([1]);
    expect(taps).toEqual([1]);
    g.destroy();
  });

  it('drops an uncaptured press whose pointerup it never saw, so the surface keeps working', () => {
    const taps: unknown[] = [];
    const { el, button, plain } = surface();
    const g = (window as any).AIMEAT.input.on(el, { tap: () => taps.push(1) });
    button.dispatchEvent(pe('pointerdown', 10, 10, { pointerId: 7 }));
    // Lifted outside the element: no pointerup arrives.
    plain.dispatchEvent(pe('pointerdown', 20, 20, { pointerId: 8 }));
    plain.dispatchEvent(pe('pointerup', 20, 20, { pointerId: 8 }));
    expect(taps).toEqual([1]);
    g.destroy();
  });
});

describe('aimeat-input pad()', () => {
  it('leaves a press on a button in the host uncaptured until the thumb moves', () => {
    const { el, button, plain, captured } = surface();
    const p = (window as any).AIMEAT.input.pad(el, { keyboard: false });
    button.dispatchEvent(pe('pointerdown', 10, 10));
    expect(captured).toEqual([]);
    button.dispatchEvent(pe('pointermove', 40, 10));
    expect(captured).toEqual([1]);
    button.dispatchEvent(pe('pointerup', 40, 10));
    plain.dispatchEvent(pe('pointerdown', 10, 10, { pointerId: 2 }));
    expect(captured).toEqual([1, 2]);
    plain.dispatchEvent(pe('pointerup', 10, 10, { pointerId: 2 }));
    p.destroy();
  });
});

describe('atelier drag()', () => {
  it('leaves a press on a button on the card uncaptured, and takes it once it drags', () => {
    const moves: number[] = [];
    const { el, button, captured } = surface();
    const d = motion.drag(el, { onMove: (dx: number) => moves.push(dx) }, { back: false });
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointerup', 10, 10));
    expect(captured).toEqual([]);
    expect(moves).toEqual([]);
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointermove', 12, 10));
    expect(captured).toEqual([]);
    button.dispatchEvent(pe('pointermove', 40, 10));
    expect(captured).toEqual([1]);
    expect(moves).toEqual([30]);
    button.dispatchEvent(pe('pointerup', 40, 10));
    d.destroy();
  });

  it('captures a press on the card itself at once, as before', () => {
    const { el, plain, captured } = surface();
    const d = motion.drag(el, {}, { back: false });
    plain.dispatchEvent(pe('pointerdown', 10, 10));
    expect(captured).toEqual([1]);
    plain.dispatchEvent(pe('pointerup', 10, 10));
    d.destroy();
  });
});

describe('atelier compare()', () => {
  function slider() {
    const ownButton: any = document.createElement('button');
    const c = partsUi.compare({ before: { el: ownButton }, after: { label: 'After' }, value: 50 });
    const captured: number[] = [];
    c.el.setPointerCapture = (id: number) => { captured.push(id); };
    c.el.style.width = '200px';
    document.body.appendChild(c.el);
    const handle = c.el.querySelector('.ak-compare__handle');
    const layer = c.el.querySelector('.ak-compare__after');
    return { c, ownButton, handle, layer, captured };
  }

  it('leaves a press on a button in a layer uncaptured and the divider where it was', () => {
    const { c, ownButton, captured } = slider();
    ownButton.dispatchEvent(pe('pointerdown', 20, 10));
    ownButton.dispatchEvent(pe('pointerup', 20, 10));
    expect(captured).toEqual([]);
    expect(c.el.style.getPropertyValue('--ak-compare')).toBe('50%');
    ownButton.dispatchEvent(pe('pointerdown', 20, 10));
    ownButton.dispatchEvent(pe('pointermove', 40, 10));
    expect(captured).toEqual([1]);
    expect(c.el.style.getPropertyValue('--ak-compare')).toBe('20%');
    ownButton.dispatchEvent(pe('pointerup', 40, 10));
    c.destroy();
  });

  it('drags at once from the handle and from a plain layer, as before', () => {
    const { c, handle, layer, captured } = slider();
    handle.dispatchEvent(pe('pointerdown', 100, 10));
    expect(captured).toEqual([1]);
    handle.dispatchEvent(pe('pointerup', 100, 10));
    layer.dispatchEvent(pe('pointerdown', 150, 10, { pointerId: 2 }));
    expect(captured).toEqual([1, 2]);
    expect(c.el.style.getPropertyValue('--ak-compare')).toBe('75%');
    layer.dispatchEvent(pe('pointerup', 150, 10, { pointerId: 2 }));
    c.destroy();
  });
});

describe('the control lists', () => {
  it('are the same in aimeat-viewport, aimeat-dag, aimeat-input and the Atelier kit', () => {
    const read = (file: string) => {
      const m = readFileSync(cortexDir + file, 'utf8').match(/var CONTROL = '([^']*)' \+\s*'([^']*)';/);
      return m ? m[1] + m[2] : null;
    };
    const kit = dom.CONTROL_SELECTOR;
    expect(kit).toContain('button');
    expect(read('aimeat-viewport.js')).toBe(kit);
    expect(read('aimeat-dag.js')).toBe(kit);
    expect(read('aimeat-input.js')).toBe(kit);
  });
});
