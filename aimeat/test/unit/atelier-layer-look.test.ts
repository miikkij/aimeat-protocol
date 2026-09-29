/**
 * @file test/unit/atelier-layer-look.test.ts
 * @description A layer the Atelier kit appends to the body (a dialog, a toast, a menu) wears the look
 *   of the page's app or of the element it came from. A look's tokens are scoped to the element that
 *   carries data-ak-look, so a layer on the body without the attribute drew in the default look.
 * @version-history
 *   v1.0.0 - 2026-09-29 - The dialog, the toast and the menu carry the app's look; wearLook keeps a
 *     look a layer already names and prefers the look of the element the layer came from.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let dom: any;
let dialogMod: any;
let partsUi: any;
let menuMod: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  dom = await import('../../src/static/sdk-libs/atelier/dom.js');
  dialogMod = await import('../../src/static/sdk-libs/atelier/dialog.js');
  partsUi = await import('../../src/static/sdk-libs/atelier/parts-ui.js');
  menuMod = await import('../../src/static/sdk-libs/atelier/menu.js');
  const frame = dom.el('div', { class: 'ak-root ak-app', 'data-ak-look': 'workbench' });
  document.body.appendChild(frame);
});

afterAll(() => { if (restore) restore(); });

describe('a layer on the body wears the app look', () => {
  it('a dialog names the look of the page app', () => {
    const d = dialogMod.dialog({ title: 'Delete the draft?', actions: [{ id: 'ok', label: 'OK' }] });
    expect(d.el.getAttribute('data-ak-look')).toBe('workbench');
    d.close();
  });

  it('the toasts name the look of the page app', () => {
    partsUi.toast({ title: 'Saved', tone: 'ok' });
    const host = document.querySelector('.ak-toasts');
    expect(host && host.getAttribute('data-ak-look')).toBe('workbench');
  });

  it('a menu names the look of the element that opened it', () => {
    const other = dom.el('div', { 'data-ak-look': 'ledger' });
    const anchor = dom.el('button', { type: 'button' }, 'More');
    other.appendChild(anchor);
    document.body.appendChild(other);
    const m = menuMod.menu({ anchor, items: [{ id: 'a', label: 'A' }], onPick() {} });
    m.open();
    const box = document.querySelector('.ak-menu');
    expect(box && box.getAttribute('data-ak-look')).toBe('ledger');
  });

  it('wearLook keeps a look the layer already names', () => {
    const layer = dom.el('div', { 'data-ak-look': 'vivid' });
    dom.wearLook(layer);
    expect(layer.getAttribute('data-ak-look')).toBe('vivid');
  });
});
