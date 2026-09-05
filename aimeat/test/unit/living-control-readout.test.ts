/**
 * @file test/unit/living-control-readout.test.ts
 * @description A CONTROL SAYS ONE THING, NOT TWO. A living document draws a reading beside the
 *   control it moves, and until 0.4.1 it drew one beside every kind of control — including the
 *   two that already display their own answer. On a pick the two then disagreed by construction:
 *   the select showed the option's words ("Outdoors") and the reading beside it showed what the
 *   document stores ("ulko"), which is the id a guard compares against and not something a person
 *   was ever meant to read.
 *
 *   So the rule proved here is the one a form obeys: a reading exists only where the control
 *   CANNOT show the answer itself — the slider, which shows no number at all, and the number
 *   field, which shows no unit. A pick, a toggle and a text field are their own readout.
 * @usage cd aimeat && pnpm exec vitest run test/unit/living-control-readout.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial (aimeat-living 0.4.1).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

type AnyEl = any;

let restore: any;
let doc: AnyEl;
let controlRow: (host: AnyEl, spec: any) => any;
let degrees: (n: number) => any;

beforeAll(async () => {
  // The stub browser goes in first: the kit's import chain and this library both read document,
  // window and location at import time.
  restore = installGlobals({ motion: 'auto' });
  doc = restore.document;
  const { form } = await import(new URL('../../src/static/sdk-libs/atelier/form.js', import.meta.url).href);
  // The library reaches the kit through window.AIMEAT.atelier at the moment it draws, so the one
  // call it makes — form() — is all this test has to stand up.
  (globalThis as any).AIMEAT = { atelier: { form } };
  ({ controlRow } = await import(new URL('../../src/static/sdk-libs/living/render.js', import.meta.url).href));
  const { parseUnit } = await import(new URL('../../src/static/sdk-libs/living/units.js', import.meta.url).href);
  // A quantity as the graph makes one, so the reading is printed by the same path the sheet uses.
  const celsius = parseUnit('°C');
  degrees = (n: number) => ({ n, u: celsius });
});

afterAll(() => { if (restore) restore(); delete (globalThis as any).AIMEAT; });

function host(): AnyEl {
  const node = doc.createElement('div');
  doc.body.appendChild(node);
  return node;
}

/** The pick from the proof sheet: the value is an id, the label is words in two languages. */
function pickRow(lang: string) {
  const h = host();
  const view = controlRow(h, {
    id: 'roomPick',
    node: {
      type: 'control', kind: 'pick', target: 'room',
      label: { fi: 'Mittauspaikka', en: 'Where it was taken' },
      options: [
        { value: 'sisa', label: { fi: 'Sisällä', en: 'Indoors' } },
        { value: 'ulko', label: { fi: 'Ulkona', en: 'Outdoors' } },
      ],
    },
    target: { label: { fi: 'Paikka', en: 'Place' } },
    value: 'ulko',
    langs: () => [lang],
    onSet() {},
  });
  return { h, view };
}

describe('a control that shows its own answer has no second reading beside it', () => {
  it('a pick has no readout — the select is the reading, and it is in the page’s language', () => {
    const { h } = pickRow('en');
    expect(h.querySelector('.ak-living__readout')).toBe(null);
    // What the control itself says is the OPTION'S words, never the stored value.
    const options = [...h.querySelectorAll('option')].map((o: AnyEl) => o.textContent);
    expect(options).toEqual(['Indoors', 'Outdoors']);
    expect(h.textContent).not.toContain('ulko');
  });

  it('the same pick read in Finnish says the Finnish option, and still says it once', () => {
    const { h, view } = pickRow('fi');
    expect(h.querySelector('.ak-living__readout')).toBe(null);
    view.relabel('ulko');
    const options = [...h.querySelectorAll('option')].map((o: AnyEl) => o.textContent);
    expect(options).toEqual(['Sisällä', 'Ulkona']);
    expect(h.textContent).not.toContain('ulko');
  });

  it('a text control has no readout — the box is the reading', () => {
    const h = host();
    controlRow(h, {
      id: 'nameHand',
      node: { type: 'control', kind: 'text', target: 'who', label: { fi: 'Mittaaja', en: 'Taken by' } },
      target: {},
      value: 'Jouni',
      langs: () => ['fi'],
      onSet() {},
    });
    expect(h.querySelector('.ak-living__readout')).toBe(null);
    expect(h.querySelector('[data-ak-part="input"]').value).toBe('Jouni');
  });

  it('a toggle has no readout — a switch that also printed "true" would be saying it twice', () => {
    const h = host();
    controlRow(h, {
      id: 'ventHand',
      node: { type: 'control', kind: 'toggle', target: 'vent', label: { fi: 'Tuuletus', en: 'Vent' } },
      target: {},
      value: true,
      langs: () => ['fi'],
      onSet() {},
    });
    expect(h.querySelector('.ak-living__readout')).toBe(null);
    expect(h.textContent).not.toContain('true');
  });
});

describe('a control that cannot show its answer keeps its reading', () => {
  it('a slider reads out the quantity with its unit', () => {
    const h = host();
    const view = controlRow(h, {
      id: 'tHand',
      node: { type: 'control', kind: 'slider', target: 't', label: { fi: 'Ilma ovella', en: 'Air at the door' } },
      target: { min: -5, max: 45, step: 1, unit: '°C' },
      value: degrees(21),
      langs: () => ['fi'],
      onSet() {},
    });
    const out = h.querySelector('.ak-living__readout');
    expect(out).not.toBe(null);
    expect(out.textContent).toContain('21');
    expect(out.textContent).toContain('°C');
    view.update(degrees(33));
    expect(out.textContent).toContain('33');
  });

  it('a number field keeps its reading, because the box shows no unit', () => {
    const h = host();
    controlRow(h, {
      id: 'rhHand',
      node: { type: 'control', kind: 'number', target: 'rh', label: { fi: 'Kosteus', en: 'Humidity' } },
      target: { min: 0, max: 100, step: 1 },
      value: 72,
      langs: () => ['fi'],
      onSet() {},
    });
    const out = h.querySelector('.ak-living__readout');
    expect(out).not.toBe(null);
    expect(out.textContent).toContain('72');
  });
});
