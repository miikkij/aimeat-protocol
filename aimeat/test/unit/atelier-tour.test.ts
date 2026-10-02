/**
 * @file test/unit/atelier-tour.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier tour's note stays beside the element it marks when the page scrolls
 *   (the step's own smooth scroll included), and the note takes the keyboard focus for its step
 *   and gives it back to where it was when the tour ends.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-tour.test.ts
 * @version-history
 *   v1.0.0 - 2026-10-02 - Initial (atelier 0.63.1).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let doc: any;
let partsUi: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  doc = restore.document;
  partsUi = await import('../../src/static/sdk-libs/atelier/parts-ui.js');
});
afterEach(() => { doc.body.innerHTML = ''; });
afterAll(() => restore());

/** An element whose place on the screen the test moves, the way a scroll moves it. */
function placed(top: number): any {
  const node = doc.createElement('button');
  let at = top;
  node.getBoundingClientRect = () => ({ x: 40, y: at, left: 40, top: at, width: 40, height: 40, right: 80, bottom: at + 40 });
  node.moveTo = (next: number) => { at = next; };
  doc.body.appendChild(node);
  return node;
}
const note = () => doc.body.querySelector('.ak-tour__note');
const frame = () => new Promise((done) => setTimeout(done, 5));

describe('the tour note', () => {
  it('follows its target when the page scrolls', async () => {
    const target = placed(500);
    const tour = partsUi.tour({ steps: [{ target, text: 'Here' }] });
    tour.start();
    expect(note().style.top).toBe('552px');
    target.moveTo(200);
    window.dispatchEvent({ type: 'scroll' });
    await frame();
    expect(note().style.top).toBe('252px');
    tour.end();
  });

  it('stops following once the tour has ended', async () => {
    const target = placed(300);
    const tour = partsUi.tour({ steps: [{ target, text: 'Here' }] });
    tour.start();
    const shown = note();
    tour.end();
    target.moveTo(100);
    window.dispatchEvent({ type: 'scroll' });
    await frame();
    expect(shown.style.top).toBe('352px');
    expect(note()).toBeNull();
  });

  it('takes the focus for each step and gives it back at the end', () => {
    const opener = placed(10);
    opener.focus();
    const one = placed(200);
    const two = placed(400);
    const tour = partsUi.tour({ steps: [{ target: one, text: 'One' }, { target: two, text: 'Two' }] });
    tour.start();
    expect(doc.activeElement.parentNode.className).toBe('ak-tour__nav');
    doc.activeElement.dispatchEvent({ type: 'click', bubbles: true });
    expect(doc.activeElement.textContent).toBe('Done');
    tour.end();
    expect(doc.activeElement).toBe(opener);
  });
});
