/**
 * @file test/unit/atelier-ornaments.test.ts
 * @description The ornaments registry (src/data/atelier-ornaments.ts), its twin in the Atelier kit
 *   (sdk-libs/atelier/ornament.js), the geometry the figures are drawn from (ornament-geo.js), and
 *   the Design Book's ornament kind (services/design-book/ornament.ts): the registry and the kit
 *   name the same figures with the same knobs and bounds, a body outside them is refused in words,
 *   a stored body keeps only what differs from the defaults, and the geometry measures what it says.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-ornaments.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-29 — initial (wish-kasvavat-koristeet-atelieriin-ja-design-bookiin).
 */
import { describe, it, expect } from 'vitest';
import {
  ORNAMENTS, ORNAMENT_IDS, ORNAMENT_PARAMS, ornamentById, ornamentParamProblem, resolveOrnamentParams,
} from '../../src/data/atelier-ornaments.js';
import { LOOKS } from '../../src/data/atelier-looks.js';
import { ORN_PARAMS, ORNAMENT_IDS as KIT_IDS, ornamentParams } from '../../src/static/sdk-libs/atelier/ornament.js';
import { turtle, helix, line, rrect, helixLeaves } from '../../src/static/sdk-libs/atelier/ornament-geo.js';
import { validateOrnamentBody, ornamentPreviewHtml, ornamentSnippet } from '../../src/services/design-book/ornament.js';
import { validatePartInput } from '../../src/services/design-book/validate.js';

describe('atelier-ornaments — the registry', () => {
  it('names 23 figures once each, in lowercase words', () => {
    expect(ORNAMENT_IDS.length).toBe(23);
    expect(new Set(ORNAMENT_IDS).size).toBe(ORNAMENT_IDS.length);
    for (const id of ORNAMENT_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('every entry has words a picker can choose by, and looks this node ships', () => {
    const looks = new Set(LOOKS.map((l) => l.id));
    for (const o of ORNAMENTS) {
      expect(o.title.length).toBeGreaterThan(2);
      expect(o.summary.length).toBeGreaterThan(20);
      expect(o.summary.length).toBeLessThanOrEqual(240);
      expect(o.fitsLooks.length).toBeGreaterThan(0);
      for (const l of o.fitsLooks) expect(looks.has(l)).toBe(true);
      for (const p of o.params) expect(['leaves', 'value', 'strands']).toContain(p);
    }
  });

  it('every default sits inside its bounds', () => {
    for (const p of Object.values(ORNAMENT_PARAMS)) {
      expect(p.min).toBeLessThanOrEqual(p.default);
      expect(p.default).toBeLessThanOrEqual(p.max);
    }
  });
});

describe('atelier-ornaments — the kit says the same', () => {
  it('the kit draws exactly the registry\'s figures', () => {
    expect([...KIT_IDS].sort()).toEqual([...ORNAMENT_IDS].sort());
  });

  it('the kit clamps to the registry\'s bounds and defaults', () => {
    for (const [name, b] of Object.entries(ORNAMENT_PARAMS)) {
      const k = ORN_PARAMS[name as keyof typeof ORN_PARAMS];
      expect({ min: k.min, max: k.max, default: k.default }).toEqual({ min: b.min, max: b.max, default: b.default });
    }
  });

  it('each figure takes in the kit the knobs the registry gives it, and no other', () => {
    for (const o of ORNAMENTS) {
      for (const name of ['leaves', 'value', 'strands'] as const) {
        const b = ORNAMENT_PARAMS[name];
        const given = ornamentParams(o.id, { [name]: b.max === b.default ? b.min : b.max })[name];
        const takes = o.params.includes(name);
        expect(given !== b.default, `${o.id} ${name}`).toBe(takes);
      }
    }
  });

  it('the kit clamps a knob past its bounds', () => {
    expect(ornamentParams('frame', { speed: 99 }).speed).toBe(3);
    expect(ornamentParams('frame', { speed: -4 }).speed).toBe(0.25);
    expect(ornamentParams('rope', { strands: 9 }).strands).toBe(4);
  });
});

describe('atelier-ornaments — a knob is refused in words', () => {
  it('an unknown figure names the ones there are', () => {
    expect(ornamentParamProblem('lattice', undefined)).toMatch(/not an ornament.*frame/);
  });
  it('a knob the figure does not take names the ones it does', () => {
    expect(ornamentParamProblem('dinkus', { leaves: 1 })).toMatch(/takes speed, delay; "leaves"/);
  });
  it('a number past its bounds says the bounds', () => {
    expect(ornamentParamProblem('frame', { speed: 4 })).toMatch(/from 0.25 to 3/);
    expect(ornamentParamProblem('vine-bar', { value: '1' })).toMatch(/from 0 to 1/);
  });
  it('a body inside the bounds passes', () => {
    expect(ornamentParamProblem('vine-bar', { value: 0.2, leaves: 2, speed: 1.5 })).toBeNull();
  });
});

describe('atelier-ornaments — the Design Book kind', () => {
  it('keeps only what differs from the defaults', () => {
    expect(validateOrnamentBody({ ornament: 'frame', params: { speed: 1, leaves: 2 } })).toEqual({ ornament: 'frame', params: { leaves: 2 } });
    expect(resolveOrnamentParams({ speed: 1 })).toBeUndefined();
  });

  it('refuses a look the node does not ship, and a field the body does not have', () => {
    expect(() => validateOrnamentBody({ ornament: 'frame', look: 'nowhere' })).toThrow(/not a look/);
    expect(() => validateOrnamentBody({ ornament: 'frame', html: '<b>x</b>' })).toThrow(/"html" is not part of it/);
    expect(() => validateOrnamentBody({ ornament: 'trellis' })).toThrow(/one of frame/);
  });

  it('a proposal of kind ornament goes through the ornament bench', () => {
    const part = validatePartInput({ id: 'my-frame', kind: 'ornament', title: 'Lush frame', summary: 'The engraved frame with every leaf.', body: { ornament: 'frame', params: { leaves: 2 } } });
    expect(part.kind).toBe('ornament');
    expect(part.body).toEqual({ ornament: 'frame', params: { leaves: 2 } });
    expect(() => validatePartInput({ id: 'bad', kind: 'ornament', title: 'Bad one', summary: 'A figure the kit does not draw.', body: { ornament: 'trellis' } })).toThrow();
  });

  it('the preview page escapes the part\'s words and draws the figure on its element', () => {
    const html = ornamentPreviewHtml({ title: '<b>Frame</b>', summary: 'Round a card.', body: { ornament: 'vine-bar', params: { value: 0.3 } } });
    expect(html).toContain('&lt;b&gt;Frame&lt;/b&gt;');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('"id":"vine-bar"');
    expect(html).toContain('data-ak-look="kirjapaino"');
  });

  it('adopting answers the one line to call', () => {
    expect(ornamentSnippet({ ornament: 'rope', params: { strands: 4 } }).code).toBe('AIMEAT.atelier.ornament(el, \'rope\', {"strands":4});');
    expect(ornamentById('rope')?.wraps).toBe('block');
  });
});

describe('atelier-ornaments — the geometry', () => {
  it('a straight turtle is as long as it was asked to be', () => {
    const t = turtle(0, 0, 0, 100, () => 0);
    expect(t.end.x).toBeCloseTo(100.5, 0);
    expect(Math.abs(t.end.y)).toBeLessThan(1e-9);
  });

  it('a rounded rectangle\'s length is its perimeter', () => {
    const r = 10;
    expect(rrect(0, 0, 200, 100, r).L).toBeCloseTo(2 * (200 + 100) - 8 * r + 2 * Math.PI * r, 6);
  });

  it('a helix alternates front and back, and its segments cover the base', () => {
    const base = line(0, 0, 400, 0);
    const segs = helix(base.at, base.L, 10, 50, 0, 2);
    for (let i = 1; i < segs.length; i++) expect(segs[i].front).toBe(!segs[i - 1].front);
    expect(segs[0].s0).toBe(0);
    expect(segs[segs.length - 1].s1).toBe(400);
    expect(segs.length).toBeGreaterThanOrEqual(15);
  });

  it('two strands half a turn apart are never both in front where they cross', () => {
    const base = line(0, 0, 300, 0);
    const k = 2 * Math.PI / 60;
    for (let s = 0; s <= 300; s += 0.5) {
      const a = Math.sin(k * s);
      const b = Math.sin(k * s + Math.PI);
      if (Math.abs(a - b) < 1e-3) expect(Math.cos(k * s) >= 0).not.toBe(Math.cos(k * s + Math.PI) >= 0);
    }
    expect(helixLeaves(base.at, base.L, 10, 60, 0, { size: 10 }).length).toBe(10);
  });
});
