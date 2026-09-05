/**
 * @file test/unit/atelier-form-range.test.ts
 * @description The Atelier form's live half, driven on the stub browser: `type: 'range'` and the
 *   per-field onInput/onChange that let a control which reports CONTINUOUSLY be a declared field
 *   instead of markup an app builds beside the kit.
 *
 *   What is actually asserted is the wiring a hand-built slider gets wrong, in this order: the
 *   label points at the control, the reading beside the track says the number AND its unit, the
 *   announcement (aria-valuetext) says the same words as the screen, a drag reports a NUMBER
 *   rather than the DOM's string, a value set from outside moves the reading with it, and a form
 *   that is only controls carries no submit bar. Then the 40px hit area, which is a stylesheet
 *   fact and is read out of the stylesheet: the JavaScript can only put the class on.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-form-range.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (atelier 0.53.0: the range field and the continuous path).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

type AnyEl = any;

let restore: any;
let form: (spec: any) => any;
let doc: AnyEl;

beforeAll(async () => {
  // The browser goes in FIRST: the kit's import chain reads document, location and window.
  restore = installGlobals({ motion: 'auto' });
  doc = restore.document;
  ({ form } = await import(new URL('../../src/static/sdk-libs/atelier/form.js', import.meta.url).href));
});

afterAll(() => { if (restore) restore(); });

/** One host element inside the stub document, so a form has somewhere to land. */
function host(): AnyEl {
  const node = doc.createElement('div');
  doc.body.appendChild(node);
  return node;
}

/** Fire the event a browser fires when a hand moves a control. */
function type(input: AnyEl, value: string, kind: 'input' | 'change' = 'input') {
  input.value = value;
  input.dispatchEvent({ type: kind, bubbles: true });
}

describe('the range field', () => {
  it('is a real range control with the bounds it was declared with', () => {
    const h = host();
    form({
      target: h, submit: false,
      fields: [{ name: 't', label: 'Lämpötila', type: 'range', min: -20, max: 45, step: 0.5, unit: '°C', value: 22 }],
    });
    const input = h.querySelector('[data-ak-part="input"]');
    expect(input.getAttribute('type')).toBe('range');
    expect(input.getAttribute('min')).toBe('-20');
    expect(input.getAttribute('max')).toBe('45');
    expect(input.getAttribute('step')).toBe('0.5');
    expect(input.className).toContain('ak-input--range');
    // The class an app may already target is still on it.
    expect(input.className).toContain('ak-input');
  });

  it('the label points at the control, and the field is marked as a range', () => {
    const h = host();
    form({ target: h, submit: false, fields: [{ name: 't', label: 'Lämpötila', type: 'range', value: 5 }] });
    const label = h.querySelector('[data-ak-part="label"]');
    const input = h.querySelector('[data-ak-part="input"]');
    expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
    expect(input.getAttribute('id')).toBeTruthy();
    expect(h.querySelector('[data-ak-part="field"]').className).toContain('ak-form__field--range');
  });

  it('an id the host supplies is the one that is used, both ends of the wiring', () => {
    const h = host();
    form({ target: h, submit: false, fields: [{ name: 't', label: 'T', type: 'range', id: 'my-own-id', value: 1 }] });
    expect(h.querySelector('[data-ak-part="input"]').getAttribute('id')).toBe('my-own-id');
    expect(h.querySelector('[data-ak-part="label"]').getAttribute('for')).toBe('my-own-id');
  });

  it('the reading beside the track says the number and its unit', () => {
    const h = host();
    form({
      target: h, submit: false,
      fields: [{ name: 't', label: 'Lämpötila', type: 'range', min: 0, max: 50, unit: '°C', value: 22 }],
    });
    const readout = h.querySelector('[data-ak-part="readout"]');
    expect(readout.tagName).toBe('OUTPUT');
    expect(readout.textContent).toBe('22 °C');
    // It sits inside the track's own row, not under it.
    expect(readout.parentNode.getAttribute('data-ak-part')).toBe('range');
  });

  it('the announcement says what the screen says', () => {
    const h = host();
    form({ target: h, submit: false, fields: [{ name: 't', label: 'T', type: 'range', unit: 'kg', value: 7 }] });
    const input = h.querySelector('[data-ak-part="input"]');
    expect(input.getAttribute('aria-valuetext')).toBe('7 kg');
    type(input, '9');
    expect(input.getAttribute('aria-valuetext')).toBe('9 kg');
    expect(h.querySelector('[data-ak-part="readout"]').textContent).toBe('9 kg');
  });

  it('a field with no unit reads as the bare number', () => {
    const h = host();
    form({ target: h, submit: false, fields: [{ name: 'n', label: 'N', type: 'range', value: 3 }] });
    expect(h.querySelector('[data-ak-part="readout"]').textContent).toBe('3');
  });

  it('values() answers with a number, never the DOM string', () => {
    const h = host();
    const handle = form({ target: h, submit: false, fields: [{ name: 't', label: 'T', type: 'range', value: 22 }] });
    type(h.querySelector('[data-ak-part="input"]'), '33');
    expect(handle.values()).toEqual({ t: 33 });
  });

  it('setValues moves the control and the reading together', () => {
    const h = host();
    const handle = form({ target: h, submit: false, fields: [{ name: 't', label: 'T', type: 'range', unit: '°C', value: 22 }] });
    handle.setValues({ t: 31 });
    expect(h.querySelector('[data-ak-part="input"]').value).toBe('31');
    expect(h.querySelector('[data-ak-part="readout"]').textContent).toBe('31 °C');
  });

  it('a range out of its bounds is refused in words, like a number', () => {
    const h = host();
    const handle = form({
      target: h,
      fields: [{ name: 't', label: 'Lämpötila', type: 'range', min: 0, max: 45, value: 22 }],
      onSubmit() { return null; },
    });
    type(h.querySelector('[data-ak-part="input"]'), '99');
    handle.el.dispatchEvent({ type: 'submit', bubbles: true });
    const error = h.querySelector('[data-ak-part="error"]');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('Lämpötila');
    expect(error.textContent).toContain('45');
  });

  it('the hit area is the kit touch floor, and that is a stylesheet fact', () => {
    const css = readFileSync(new URL('../../public/lib/aimeat-atelier/data.css', import.meta.url), 'utf8');
    const rule = /\.ak-input--range \{([\s\S]*?)\}/.exec(css);
    expect(rule).toBeTruthy();
    expect(rule![1]).toContain('min-height: var(--ak-touch)');
    expect(rule![1]).toContain('height: var(--ak-touch)');
    // The token the kit declares for that floor is 40px or more.
    const contract = readFileSync(new URL('../../public/lib/aimeat-atelier.css', import.meta.url), 'utf8');
    const touch = /--ak-touch:\s*(\d+)px/.exec(contract);
    expect(touch).toBeTruthy();
    expect(Number(touch![1])).toBeGreaterThanOrEqual(40);
    // And the grip is a fingertip's, not the 6px rail.
    expect(contract).toMatch(/--ak-range-thumb:\s*\d\dpx/);
    expect(contract).toMatch(/--ak-range-track:\s*\dpx/);
  });
});

describe('the continuous path, beside the submit one', () => {
  it('onInput reports every move, onChange only the letting-go', () => {
    const h = host();
    const moves: any[] = [];
    const settled: any[] = [];
    form({
      target: h, submit: false,
      fields: [{
        name: 't', label: 'T', type: 'range', value: 1,
        onInput(v: any) { moves.push(v); },
        onChange(v: any) { settled.push(v); },
      }],
    });
    const input = h.querySelector('[data-ak-part="input"]');
    type(input, '2');
    type(input, '3');
    expect(moves).toEqual([2, 3]);
    expect(settled).toEqual([]);
    type(input, '3', 'change');
    expect(settled).toEqual([3]);
  });

  it('the field itself comes back with the value, so one handler serves many fields', () => {
    const h = host();
    const seen: string[] = [];
    form({
      target: h, submit: false,
      fields: [
        { name: 'a', label: 'A', type: 'text', onInput(_v: any, f: any) { seen.push(f.name); } },
        { name: 'b', label: 'B', type: 'text', onInput(_v: any, f: any) { seen.push(f.name); } },
      ],
    });
    const inputs = h.querySelectorAll('[data-ak-part="input"]');
    type(inputs[1], 'x');
    type(inputs[0], 'y');
    expect(seen).toEqual(['b', 'a']);
  });

  it('every kind reports in its own type: text a string, number a number, toggle a boolean', () => {
    const h = host();
    const got: Record<string, any> = {};
    form({
      target: h, submit: false,
      fields: [
        { name: 'word', label: 'W', type: 'text', onInput(v: any) { got.word = v; } },
        { name: 'count', label: 'C', type: 'number', onInput(v: any) { got.count = v; } },
        { name: 'on', label: 'O', type: 'toggle', onInput(v: any) { got.on = v; } },
      ],
    });
    const inputs = h.querySelectorAll('[data-ak-part="input"]');
    type(inputs[0], 'hei');
    type(inputs[1], '12');
    inputs[2].checked = true;
    inputs[2].dispatchEvent({ type: 'input', bubbles: true });
    expect(got).toEqual({ word: 'hei', count: 12, on: true });
  });

  it('a form that is only controls carries no submit bar', () => {
    const h = host();
    form({ target: h, submit: false, fields: [{ name: 't', label: 'T', type: 'range', value: 1 }] });
    expect(h.querySelector('[data-ak-part="bar"]')).toBe(null);
    expect(h.querySelector('[data-ak-part="submit"]')).toBe(null);
  });

  it('a form that submits still has its bar, and the two paths do not interfere', async () => {
    const h = host();
    const moves: any[] = [];
    let submitted: any = null;
    const handle = form({
      target: h,
      fields: [{ name: 't', label: 'T', type: 'range', min: 0, max: 10, value: 1, onInput(v: any) { moves.push(v); } }],
      onSubmit(values: any) { submitted = values; return null; },
    });
    expect(h.querySelector('[data-ak-part="bar"]')).toBeTruthy();
    type(h.querySelector('[data-ak-part="input"]'), '4');
    handle.el.dispatchEvent({ type: 'submit', bubbles: true });
    // The submit path answers through a promise (the button is held busy until it settles).
    await Promise.resolve();
    await Promise.resolve();
    expect(moves).toEqual([4]);
    expect(submitted).toEqual({ t: 4 });
  });
});

describe('describe() answers for the form', () => {
  it('the generated vocabulary carries the range parts and the two tokens', async () => {
    const { PARTS } = await import(
      new URL('../../src/static/sdk-libs/atelier/describe-data.js', import.meta.url).href) as any;
    expect(PARTS.form).toBeTruthy();
    expect(PARTS.form.parts).toContain('range');
    expect(PARTS.form.parts).toContain('readout');
    expect(PARTS.form.tokens).toEqual(['--ak-range-track', '--ak-range-thumb']);
    expect(PARTS.form.fork).toContain('range');
  });
});
