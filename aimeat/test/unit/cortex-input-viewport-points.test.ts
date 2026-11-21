/**
 * @file test/unit/cortex-input-viewport-points.test.ts
 * @description Two bundled cortex packs that handed an app the wrong point:
 *   - aimeat-input: dragStart's event is already past the slop, so an app that measured its grab
 *     offset from it made the object jump. info carries startX/startY, the pointer-down point
 *     (appdev pitfall ui/input-drag-grab-point-is-pointer-down).
 *   - aimeat-viewport: onTap's ev.target is the host, where the pointer was captured. onTap gets the
 *     element under the pointer as its second argument (appdev pitfall ui/viewport-tap-target-is-host).
 *
 *   Each pack runs as the browser script it is, on the stub DOM, with synthetic pointer events.
 *   FIRST FAIL: against aimeat-input 1.0.0 info has no startX; against aimeat-viewport 1.0.4 onTap
 *   gets one argument.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installGlobals } from './phaser-stub.mjs';

const dir = fileURLToPath(new URL('../../public/cortex-bundled/', import.meta.url));
let restore: () => void;

function load(name: string): void {
  // The packs are classic scripts that read `this`/window as their global.
  new Function('window', 'self', readFileSync(dir + name, 'utf8')).call(window, window, window);
}

const pe = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ type, pointerId: 1, pointerType: 'touch', button: 0, clientX: x, clientY: y, bubbles: true,
    preventDefault() {}, stopPropagation() {}, ...extra });

beforeAll(() => {
  restore = installGlobals({ motion: 'less' });
  load('aimeat-input.js');
  load('aimeat-viewport.js');
});
afterAll(() => restore());

describe('aimeat-input drag info', () => {
  it('gives dragStart and dragMove the pointer-down point, while dx/dy stay as they were', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const seen: any[] = [];
    (window as any).AIMEAT.input.on(el, {
      dragStart: (_ev: any, info: any) => seen.push(['start', info]),
      dragMove: (_ev: any, info: any) => seen.push(['move', info]),
    });
    el.dispatchEvent(pe('pointerdown', 100, 200));
    el.dispatchEvent(pe('pointermove', 130, 200));
    const start = seen.find(s => s[0] === 'start')[1];
    expect(start).toMatchObject({ startX: 100, startY: 200, dx: 30, dy: 0 });
    expect(seen.find(s => s[0] === 'move')[1]).toMatchObject({ startX: 100, startY: 200 });
  });

  it('a keyboard swipe has a zero start point rather than a stale one', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let got: any = null;
    (window as any).AIMEAT.input.on(el, { swipe: (_dir: any, info: any) => { got = info; } });
    el.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', bubbles: true, preventDefault() {} });
    expect(got).toMatchObject({ startX: 0, startY: 0, source: 'keyboard' });
  });
});

describe('aimeat-viewport onTap', () => {
  it('passes the element under the pointer as the second argument', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const card = document.createElement('button');
    (document as any).elementFromPoint = () => card;
    const taps: any[] = [];
    const vp = (window as any).AIMEAT.viewport.create(host, { onTap: (ev: any, target: any) => taps.push([ev, target]) });
    host.dispatchEvent(pe('pointerdown', 10, 10));
    host.dispatchEvent(pe('pointerup', 10, 10));
    expect(taps).toHaveLength(1);
    expect(taps[0][1]).toBe(card);
    vp.destroy();
  });

  it('falls back to the host when the page cannot say what is under the pointer', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    (document as any).elementFromPoint = () => null;
    let target: any;
    const vp = (window as any).AIMEAT.viewport.create(host, { onTap: (_ev: any, t: any) => { target = t; } });
    host.dispatchEvent(pe('pointerdown', 5, 5));
    host.dispatchEvent(pe('pointerup', 5, 5));
    expect(target).toBe(host);
    vp.destroy();
  });
});
