/**
 * @file test/unit/atelier-motion-parts.test.ts
 * @description The ten motion parts' wiring on the stub browser, with motion OFF so every travel
 *   lands at once and what is asserted is the behaviour a hand-built copy gets wrong: the roles
 *   and states a screen reader hears, the keyboard model, the value reported to the app, and
 *   what each part leaves behind. The travel itself is springs.js, tested on its own.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-motion-parts.test.ts
 * @version-history
 *   v1.1.0 — 2026-10-01 — The tab row scrolls its chosen tab into view (first draw, set, a pick),
 *     moves only its own scrollLeft, glides only when motion is allowed, and stops on destroy.
 *   v1.0.0 — 2026-09-28 — Initial (atelier 0.55.0, the ten motion parts).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let doc: any;
let controls: any;
let menuMod: any;
let islandMod: any;
let shell: any;
let formMod: any;
let partsUi: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  doc = restore.document;
  controls = await import('../../src/static/sdk-libs/atelier/controls.js');
  menuMod = await import('../../src/static/sdk-libs/atelier/menu.js');
  islandMod = await import('../../src/static/sdk-libs/atelier/island.js');
  shell = await import('../../src/static/sdk-libs/atelier/shell.js');
  formMod = await import('../../src/static/sdk-libs/atelier/form.js');
  partsUi = await import('../../src/static/sdk-libs/atelier/parts-ui.js');
});
afterEach(() => { doc.body.innerHTML = ''; });
afterAll(() => restore());

function host(): any {
  const node = doc.createElement('div');
  doc.body.appendChild(node);
  return node;
}
const key = (node: any, k: string, extra: any = {}) => node.dispatchEvent(Object.assign({ type: 'keydown', key: k, bubbles: true, preventDefault() {} }, extra));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('toggle', () => {
  it('is a checkbox with role switch, labelled, and reports the new state', () => {
    const seen: boolean[] = [];
    const sw = controls.toggle({ target: host(), label: 'Notifications', onChange: (on: boolean) => seen.push(on) });
    expect(sw.input.getAttribute('type')).toBe('checkbox');
    expect(sw.input.getAttribute('role')).toBe('switch');
    expect(sw.el.querySelector('label').getAttribute('for')).toBe(sw.input.id);
    sw.input.checked = true;
    sw.input.dispatchEvent({ type: 'change', bubbles: true });
    expect(seen).toEqual([true]);
    expect(sw.value()).toBe(true);
  });

  it('draws the knob through its two properties', async () => {
    const sw = controls.toggle({ target: host(), label: 'A', checked: false });
    await tick();
    expect(sw.input.style.getPropertyValue('--ak-knob-w')).toMatch(/px$/);
    expect(sw.input.style.getPropertyValue('--ak-knob-x')).toMatch(/px$/);
  });

  it('the form\'s toggle field is the same switch', () => {
    const h = host();
    formMod.form({ target: h, submit: false, fields: [{ name: 'on', label: 'On', type: 'toggle', value: true }] });
    const input = h.querySelector('[data-ak-part="input"]');
    expect(input.getAttribute('role')).toBe('switch');
    expect(input.classList.contains('ak-toggle')).toBe(true);
  });
});

describe('segmented', () => {
  it('is a radio group whose arrow keys move the choice and tell the app', () => {
    const seen: string[] = [];
    const seg = controls.segmented({
      target: host(), label: 'Range', value: 'd', onChange: (id: string) => seen.push(id),
      items: [{ id: 'd', label: 'Day' }, { id: 'w', label: 'Week' }, { id: 'm', label: 'Month' }],
    });
    expect(seg.el.getAttribute('role')).toBe('radiogroup');
    const opts = seg.el.querySelectorAll('.ak-segmented__option');
    expect(opts.length).toBe(3);
    expect(opts[0].getAttribute('aria-checked')).toBe('true');
    expect(opts[0].getAttribute('tabindex')).toBe('0');
    expect(opts[1].getAttribute('tabindex')).toBe('-1');
    key(opts[0], 'ArrowRight');
    expect(seen).toEqual(['w']);
    expect(opts[1].getAttribute('aria-checked')).toBe('true');
    key(opts[1], 'End');
    expect(seg.value()).toBe('m');
    key(opts[2], 'ArrowRight');
    expect(seg.value()).toBe('d'); // wraps
  });

  it('carries one ink, which is not an option', () => {
    const seg = controls.segmented({ target: host(), label: 'R', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    expect(seg.el.querySelectorAll('.ak-ink').length).toBe(1);
    seg.set({ items: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }], value: 'y' });
    expect(seg.el.querySelectorAll('.ak-ink').length).toBe(1);
    expect(seg.el.querySelectorAll('.ak-segmented__option').length).toBe(3);
    expect(seg.value()).toBe('y');
  });
});

describe('slider', () => {
  it('writes the filled share and says the value with its unit', () => {
    const got: number[] = [];
    const sl = controls.slider({ target: host(), label: 'Volume', min: 0, max: 200, value: 50, unit: '%', onInput: (v: number) => got.push(v) });
    expect(sl.input.style.getPropertyValue('--ak-range-fill')).toBe('25.00%');
    expect(sl.input.getAttribute('aria-valuetext')).toBe('50 %');
    sl.input.value = '100';
    sl.input.dispatchEvent({ type: 'input', bubbles: true });
    expect(got).toEqual([100]);
    expect(sl.input.style.getPropertyValue('--ak-range-fill')).toBe('50.00%');
  });

  it('the form\'s range field gets the fill too, and setValues moves it', () => {
    const h = host();
    const f = formMod.form({ target: h, submit: false, fields: [{ name: 'v', label: 'V', type: 'range', min: 0, max: 10, value: 2 }] });
    const input = h.querySelector('[data-ak-part="input"]');
    expect(input.style.getPropertyValue('--ak-range-fill')).toBe('20.00%');
    f.setValues({ v: 5 });
    expect(input.style.getPropertyValue('--ak-range-fill')).toBe('50.00%');
  });
});

describe('menu', () => {
  function withMenu(extra: any = {}) {
    const btn = doc.createElement('button');
    doc.body.appendChild(btn);
    const picked: string[] = [];
    const m = menuMod.menu(Object.assign({
      anchor: btn, onPick: (id: string) => picked.push(id),
      items: [{ id: 'a', label: 'Alpha' }, '-', { id: 'b', label: 'Beta', disabled: true }, { id: 'c', label: 'Charlie', hint: 'C' }],
    }, extra));
    return { btn, m, picked };
  }

  it('the button says it opens a menu and whether it is open', () => {
    const { btn, m } = withMenu();
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    m.open();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(doc.body.querySelector('.ak-menu').getAttribute('role')).toBe('menu');
    m.close();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('opened from the keyboard, the first row takes focus; arrows skip the separator and a disabled row', () => {
    const { btn, m } = withMenu();
    key(btn, 'ArrowDown');
    const box = doc.body.querySelector('.ak-menu');
    expect(doc.activeElement.textContent).toContain('Alpha');
    key(box, 'ArrowDown');
    expect(doc.activeElement.textContent).toContain('Charlie');
    key(box, 'ArrowDown');
    expect(doc.activeElement.textContent).toContain('Alpha'); // wraps
    m.destroy();
  });

  it('Enter picks the focused row, closes, gives focus back and tells the app', () => {
    const { btn, m, picked } = withMenu();
    key(btn, 'ArrowDown');
    const box = doc.body.querySelector('.ak-menu');
    key(box, 'End');
    doc.activeElement.click();
    expect(picked).toEqual(['c']);
    expect(m.isOpen()).toBe(false);
    expect(doc.activeElement).toBe(btn);
  });

  it('a letter jumps to the next row that starts with it; Escape closes', () => {
    const { btn, m } = withMenu();
    key(btn, 'ArrowDown');
    const box = doc.body.querySelector('.ak-menu');
    key(box, 'c');
    expect(doc.activeElement.textContent).toContain('Charlie');
    key(box, 'Escape');
    expect(m.isOpen()).toBe(false);
  });
});

describe('tooltip', () => {
  it('describes its element and appears on focus', () => {
    const btn = doc.createElement('button');
    doc.body.appendChild(btn);
    menuMod.tooltip(btn, 'Copy link');
    const id = btn.getAttribute('aria-describedby');
    expect(id).toMatch(/^ak-tip-/);
    btn.dispatchEvent({ type: 'focus', bubbles: false });
    const tip = doc.body.querySelector('.ak-tooltip');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe('Copy link');
  });
});

describe('island and stateButton', () => {
  it('the island swaps its content and wears the shape and tone it was given', () => {
    const isl = islandMod.island({ target: host(), content: 'Writing…', shape: 'pill', tone: 'ink' });
    expect(isl.el.getAttribute('data-ak-shape')).toBe('pill');
    isl.set({ content: 'Done', shape: 'card', tone: 'ok' });
    expect(isl.el.getAttribute('data-ak-shape')).toBe('card');
    expect(isl.el.getAttribute('data-ak-tone')).toBe('ok');
    expect(isl.el.querySelectorAll('.ak-island__content').length).toBe(1);
    expect(isl.el.textContent).toBe('Done');
    // At rest the island is sized by its content again.
    expect(isl.el.style.getPropertyValue('width')).toBe('');
  });

  it('the state button goes busy, then done, and ignores a second press while busy', async () => {
    let calls = 0;
    let finish: () => void = () => {};
    const b = islandMod.stateButton({ target: host(), label: 'Save', done: 'Saved', run: () => { calls++; return new Promise<void>((r) => { finish = r; }); } });
    const first = b.press();
    expect(b.el.getAttribute('aria-busy')).toBe('true');
    expect(b.el.getAttribute('data-ak-shape')).toBe('circle');
    await b.press();
    expect(calls).toBe(1);
    finish();
    expect(await first).toBe(true);
    expect(b.el.getAttribute('aria-busy')).toBeNull();
    expect(b.el.getAttribute('data-ak-tone')).toBe('ok');
    expect(b.el.querySelector('[role="status"]').textContent).toBe('Saved');
    b.destroy();
  });

  it('a failure is the error state, said in words', async () => {
    const b = islandMod.stateButton({ target: host(), label: 'Send', fail: 'Not sent', run: () => { throw new Error('x'); } });
    expect(await b.press()).toBe(false);
    expect(b.el.getAttribute('data-ak-tone')).toBe('err');
    expect(b.el.textContent).toContain('Not sent');
    b.destroy();
  });
});

describe('the tab row wears the ink', () => {
  it('carries exactly one ink through a re-render', () => {
    const tb = shell.tabs({ target: host(), items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], value: 'a' });
    expect(tb.el.querySelectorAll('.ak-ink').length).toBe(1);
    tb.set({ value: 'b' });
    expect(tb.el.querySelectorAll('.ak-ink').length).toBe(1);
    expect(tb.el.querySelectorAll('.ak-tab').length).toBe(2);
    tb.destroy();
    expect(tb.el.querySelectorAll('.ak-ink').length).toBe(0);
  });
});

describe('the tab row keeps the chosen tab in view', () => {
  /** A 200px strip of five 100px tabs at a phone width, with the kit's 28px edge fade. */
  function strip(value: string) {
    const page = host();
    const tb = shell.tabs({ target: page, value,
      items: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, label: id.toUpperCase() })) });
    const root = tb.el;
    Object.defineProperty(root, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(root, 'scrollWidth', { value: 500, configurable: true });
    root.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 40, height: 40, x: 0, y: 0 });
    root.style.setProperty('--ak-scroll-fade', '28px');
    return { tb, root, page };
  }
  /** The boxes a browser would report: each tab 100px wide, moved by the strip's scrollLeft. */
  function lay(root: any) {
    Array.from(root.querySelectorAll('.ak-tab')).forEach((b: any, i: number) => {
      b.getBoundingClientRect = () => {
        const left = i * 100 - root.scrollLeft;
        return { left, right: left + 100, width: 100, top: 0, bottom: 40, height: 40, x: left, y: 0 };
      };
    });
  }
  const shown = (root: any) => {
    const r = root.querySelector('.ak-tab--active').getBoundingClientRect();
    return r.left >= 0 && r.right <= 200;
  };

  it('scrolls to the chosen tab at the first draw', async () => {
    const { tb, root } = strip('e');
    lay(root);
    await tick();
    expect(root.scrollLeft).toBe(300);
    expect(shown(root)).toBe(true);
    tb.destroy();
  });

  it('scrolls on set({ value }), clear of the edge fade, and back on a pick', async () => {
    const { tb, root } = strip('a');
    lay(root);
    await tick();
    expect(root.scrollLeft).toBe(0);
    tb.set({ value: 'c' });
    lay(root);
    await tick();
    // Tab c spans 200..300; its right edge lands 28px in from the strip's right edge.
    expect(root.scrollLeft).toBe(128);
    expect(shown(root)).toBe(true);
    tb.set({ value: 'e' });
    lay(root);
    await tick();
    expect(root.scrollLeft).toBe(300);
    root.querySelector('[data-ak-id="b"]').click();
    lay(root);
    await tick();
    await tick();
    expect(tb.el.querySelector('.ak-tab--active').getAttribute('data-ak-id')).toBe('b');
    expect(root.scrollLeft).toBe(72);
    expect(shown(root)).toBe(true);
    tb.destroy();
  });

  it('moves only the strip, never the page', async () => {
    const calls: any[] = [];
    const was = (globalThis as any).scrollTo;
    (globalThis as any).scrollTo = (...a: any[]) => calls.push(a);
    try {
      const { tb, root, page } = strip('a');
      page.scrollTop = 0;
      doc.documentElement.scrollTop = 0;
      tb.set({ value: 'd' });
      Array.from(root.querySelectorAll('.ak-tab')).forEach((b: any) => { b.scrollIntoView = () => calls.push('scrollIntoView'); });
      lay(root);
      await tick();
      expect(root.scrollLeft).toBeGreaterThan(0);
      expect(calls).toEqual([]);
      expect(page.scrollTop).toBe(0);
      expect(doc.documentElement.scrollTop).toBe(0);
      tb.destroy();
    } finally {
      (globalThis as any).scrollTo = was;
    }
  });

  it('glides when motion is allowed, and jumps under reduced motion', async () => {
    const { tb, root } = strip('a');
    lay(root);
    const glides: any[] = [];
    root.scrollTo = (o: any) => glides.push(o);
    tb.set({ value: 'd' });
    lay(root);
    await tick();
    expect(glides).toEqual([]);
    expect(root.scrollLeft).toBe(228);
    restore.setMotion(null);
    try {
      tb.set({ value: 'a' });
      lay(root);
      await tick();
      expect(glides).toEqual([{ left: 0, behavior: 'smooth' }]);
    } finally {
      restore.setMotion('less');
    }
    tb.destroy();
  });

  it('stops after destroy', async () => {
    const { tb, root } = strip('a');
    tb.set({ value: 'e' });
    lay(root);
    tb.destroy();
    await tick();
    expect(root.scrollLeft).toBe(0);
  });
});

describe('the palette', () => {
  it('opens from its anchor, keeps one ink, runs the chosen item and hands over to a toast', () => {
    const btn = doc.createElement('button');
    doc.body.appendChild(btn);
    const ran: string[] = [];
    const p = partsUi.palette({ anchor: btn, hotkey: false, items: [
      { id: 'one', label: 'Open inbox', run: () => ran.push('one') },
      { id: 'two', label: 'Archive all', done: 'Archived', run: () => ran.push('two') },
    ] });
    btn.click();
    const list = doc.body.querySelector('.ak-palette__list');
    expect(list.querySelectorAll('.ak-palette__item').length).toBe(2);
    expect(list.querySelectorAll('.ak-ink').length).toBe(1);
    const input = doc.body.querySelector('.ak-palette__input');
    input.value = 'arch';
    input.dispatchEvent({ type: 'input', bubbles: true });
    expect(list.querySelectorAll('.ak-palette__item').length).toBe(1);
    key(input, 'Enter');
    expect(ran).toEqual(['two']);
    expect(doc.body.querySelector('.ak-palette')).toBeNull();
    expect(doc.body.querySelector('.ak-toast').textContent).toContain('Archived');
    p.destroy();
  });
});
