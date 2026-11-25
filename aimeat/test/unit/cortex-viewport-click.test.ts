/**
 * @file test/unit/cortex-viewport-click.test.ts
 * @description aimeat-viewport and a click inside its host. The browser sends a captured
 *   pointer's click to the capturing element, so a host that captured every pointerdown took the
 *   click away from every button in its world: the board's head actions, its Move/Use switch and
 *   a button in a frame body did nothing on a real mouse click (found building an app on the kit's
 *   board, 2026-11-25). The viewport now takes the pointer from a control only when the press
 *   becomes a drag, never from a claim handle that says capture: false, and drops a pointer whose
 *   pointerup it never saw.
 *
 *   The pack runs as the browser script it is, on the stub DOM, with synthetic pointer events;
 *   setPointerCapture is recorded on the host.
 *   FIRST FAIL: against aimeat-viewport 1.1.0 a press on a button is captured at pointerdown.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installGlobals } from './phaser-stub.mjs';

const dir = fileURLToPath(new URL('../../public/cortex-bundled/', import.meta.url));
let restore: () => void;

const pe = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ type, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: y, bubbles: true,
    preventDefault() {}, stopPropagation() {}, ...extra });

beforeAll(() => {
  restore = installGlobals({ motion: 'less' });
  // A classic script that reads `this`/window as its global.
  new Function('window', 'self', readFileSync(dir + 'aimeat-viewport.js', 'utf8')).call(window, window, window);
});
afterAll(() => restore());

/** A host with one button and one plain card in its world, recording every capture. */
function setup(opts: Record<string, unknown> = {}) {
  const host: any = document.createElement('div');
  document.body.appendChild(host);
  const captured: number[] = [];
  host.setPointerCapture = (id: number) => { captured.push(id); };
  const vp = (window as any).AIMEAT.viewport.create(host, opts);
  const button = document.createElement('button');
  const card = document.createElement('div');
  vp.world.appendChild(button);
  vp.world.appendChild(card);
  return { host, vp, button, card, captured };
}

describe('aimeat-viewport pointer capture', () => {
  it('leaves a press on a button uncaptured, so its click reaches the button', () => {
    const moves: number[] = [];
    const { vp, button, captured } = setup({ onClaimPointer: () => ({ onMove: (dx: number) => moves.push(dx), onEnd() {} }) });
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointerup', 10, 10));
    expect(captured).toEqual([]);
    expect(moves).toEqual([]);
    vp.destroy();
  });

  it('takes the pointer from a button once the press moves into a drag', () => {
    const moves: number[] = [];
    const { vp, button, captured } = setup({ onClaimPointer: () => ({ onMove: (dx: number) => moves.push(dx), onEnd() {} }) });
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointermove', 11, 10));
    expect(captured).toEqual([]);
    button.dispatchEvent(pe('pointermove', 40, 10));
    expect(captured).toEqual([1]);
    expect(moves).toEqual([30]);
    vp.destroy();
  });

  it('captures a press on plain content at once, as before', () => {
    const { vp, card, captured } = setup({ onClaimPointer: () => ({ onMove() {}, onEnd() {} }) });
    card.dispatchEvent(pe('pointerdown', 10, 10));
    expect(captured).toEqual([1]);
    vp.destroy();
  });

  it('never captures for a handle that says capture: false, not even when it moves', () => {
    const { vp, card, captured } = setup({ onClaimPointer: () => ({ capture: false, onMove() {}, onEnd() {} }) });
    card.dispatchEvent(pe('pointerdown', 10, 10));
    card.dispatchEvent(pe('pointermove', 60, 60));
    expect(captured).toEqual([]);
    vp.destroy();
  });

  it('pans from an unclaimed button only once it moves, and a press that stays put is not a tap', () => {
    const taps: unknown[] = [];
    const { vp, button, captured } = setup({ onTap: (_ev: unknown, t: unknown) => taps.push(t) });
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointerup', 10, 10));
    expect(captured).toEqual([]);
    expect(taps).toEqual([]);
    button.dispatchEvent(pe('pointerdown', 10, 10));
    button.dispatchEvent(pe('pointermove', 50, 10));
    expect(captured).toEqual([1]);
    expect(vp.cam().x).toBe(40 + 40);
    vp.destroy();
  });

  it('drops a pointer whose pointerup it never saw, so the next press is not read as a pinch', () => {
    const { vp, card, captured } = setup({ onClaimPointer: () => ({ capture: false, onMove() {}, onEnd() {} }) });
    card.dispatchEvent(pe('pointerdown', 10, 10, { pointerId: 7 }));
    // Lifted outside the host: no pointerup arrives.
    const k0 = vp.cam().k;
    card.dispatchEvent(pe('pointerdown', 20, 20, { pointerId: 8 }));
    card.dispatchEvent(pe('pointermove', 200, 200, { pointerId: 8 }));
    expect(vp.cam().k).toBe(k0);
    expect(captured).toEqual([]);
    vp.destroy();
  });
});
