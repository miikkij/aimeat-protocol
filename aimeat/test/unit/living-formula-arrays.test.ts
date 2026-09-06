/**
 * @file test/unit/living-formula-arrays.test.ts
 * @description ROWS. A spreadsheet's real power is not the formula, it is the COLUMN: one
 *   expression written once and worked out down a thousand rows. This file holds the half of the
 *   living document's language that gives it the same thing — a list is a value, arithmetic and
 *   comparison broadcast over it, and range/map/fold/scan/cumsum/index/at/where are the vocabulary
 *   for building one and reading it back.
 *
 *   THREE RULES THIS FILE EXISTS TO HOLD, because each of them is a decision that could have gone
 *   the other way and would then be wrong everywhere at once.
 *
 *   A POSITION IS COUNTED FROM ZERO. index(xs, 0) is the first element and at(xs, 0) is the same
 *   value, which is what lets a 24-hour day be range(24) and hour 13 be position 13. A one-based
 *   list would have made at() and index() disagree at every integer.
 *
 *   scan() ANSWERS WITH ONE MORE THAN IT WAS GIVEN. The accumulator it started from comes first,
 *   then one after each element — so a battery scanned over 24 hours gives 25 readings, which are
 *   the state of charge at each hour BOUNDARY, and the flow during hour i is the difference
 *   between position i and position i + 1. Answering with 24 would have left the day's first hour
 *   with nothing to subtract from.
 *
 *   A REFUSAL INSIDE A LIST NAMES THE POSITION. Adding metres to kilowatt-hours at element 7 of a
 *   288-element vector is a refusal nobody can act on unless it says 7.
 * @usage cd aimeat && pnpm vitest run test/unit/living-formula-arrays.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial (living 0.5.0: the language grows rows).
 */
import { describe, it, expect } from 'vitest';
import { parse, symbolsOf } from '../../src/static/sdk-libs/living/formula-parse.js';
import { evaluate, isError } from '../../src/static/sdk-libs/living/formula-eval.js';
import { parseUnit, unitLabel } from '../../src/static/sdk-libs/living/units.js';
import { toTex } from '../../src/static/sdk-libs/living/tex.js';
import { createGraph } from '../../src/static/sdk-libs/living/graph.js';

function scopeOf(map: Record<string, unknown>) {
  return { get: (id: string) => (Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined) };
}
function q(n: number, unit: string) { return { n, u: parseUnit(unit) }; }
function run(src: string, map: Record<string, unknown> = {}): any {
  return evaluate(parse(src), scopeOf(map));
}
/** The plain numbers inside a list of quantities, for comparing a whole row at once. */
function nums(v: any): number[] {
  return (v as any[]).map((x) => (x && typeof x === 'object' && 'n' in x ? x.n : x));
}

describe('range: where a row comes from', () => {
  it('range(n) counts from zero and stops before n', () => {
    expect(run('range(4)')).toEqual([0, 1, 2, 3]);
    expect(run('range(0)')).toEqual([]);
  });

  it('range(a, b) and range(a, b, step) walk the interval', () => {
    expect(run('range(2, 5)')).toEqual([2, 3, 4]);
    expect(nums(run('range(0, 1, 0.25)'))).toEqual([0, 0.25, 0.5, 0.75]);
    expect(run('range(5, 2, -1)')).toEqual([5, 4, 3]);
  });

  it('a step of nothing is refused rather than counted forever', () => {
    const out = run('range(0, 5, 0)');
    expect(isError(out)).toBe(true);
    expect(String(out.error)).toMatch(/step/i);
  });

  it('a row longer than this document could ever draw is refused by name', () => {
    const out = run('range(500000)');
    expect(isError(out)).toBe(true);
    expect(String(out.error)).toMatch(/500000|too long|20000/i);
  });
});

describe('broadcasting: one expression, worked out down the row', () => {
  const xs = [1, 2, 3];

  it('a list and a number', () => {
    expect(run('xs * 2', { xs })).toEqual([2, 4, 6]);
    expect(run('xs + 10', { xs })).toEqual([11, 12, 13]);
    expect(run('10 - xs', { xs })).toEqual([9, 8, 7]);
    expect(run('-xs', { xs })).toEqual([-1, -2, -3]);
  });

  it('two lists of the same length, element against element', () => {
    expect(run('xs * ys', { xs, ys: [10, 100, 1000] })).toEqual([10, 200, 3000]);
    expect(run('xs - ys', { xs, ys: [1, 1, 1] })).toEqual([0, 1, 2]);
  });

  it('two lists that do not line up are refused, and the refusal says both lengths', () => {
    const out = run('xs + ys', { xs, ys: [1, 2] });
    expect(isError(out)).toBe(true);
    expect(String(out.error)).toMatch(/3/);
    expect(String(out.error)).toMatch(/2/);
  });

  it('comparison broadcasts too, and answers with a row of truths', () => {
    expect(run('xs > 2', { xs })).toEqual([false, false, true]);
    expect(run('xs = ys', { xs, ys: [1, 9, 3] })).toEqual([true, false, true]);
  });

  it('a unit rides through every element, and is checked in every element', () => {
    const kwh = [q(1, 'kWh'), q(2, 'kWh')];
    const priced = run('e * p', { e: kwh, p: q(0.2, 'EUR/kWh') });
    expect(nums(priced)).toEqual([0.2, 0.4]);
    expect(unitLabel((priced as any[])[0].u)).toBe('EUR');
  });

  it('a unit refusal inside a row names the position it happened at', () => {
    const mixed = [q(1, 'kWh'), q(2, 'kWh'), q(3, 'm')];
    const out = run('e + f', { e: mixed, f: q(1, 'kWh') });
    expect(isError(out)).toBe(true);
    expect(String(out.error)).toMatch(/different things/);
    expect(String(out.error)).toMatch(/\b2\b/);
  });

  it('round and clamp go down the row as well', () => {
    expect(run('round(xs, 1)', { xs: [1.234, 5.678] })).toEqual([1.2, 5.7]);
    expect(run('clamp(xs, 0, 2)', { xs: [-1, 1, 5] })).toEqual([0, 1, 2]);
  });
});

describe('min and max: one argument reduces, several go down the row', () => {
  it('one list is still the aggregate it has always been', () => {
    expect(run('max(xs)', { xs: [1, 9, 4] })).toBe(9);
    expect(run('min(xs)', { xs: [1, 9, 4] })).toBe(1);
    expect(run('max(1, 9, 4)')).toBe(9);
  });

  it('two arguments are element-wise, which is what a surplus is written with', () => {
    expect(run('max(0, pv - load)', { pv: [1, 5], load: [3, 2] })).toEqual([0, 3]);
    expect(run('min(xs, 2)', { xs: [1, 5, 2] })).toEqual([1, 2, 2]);
    expect(run('min(a, b, c)', { a: [5, 5], b: [9, 1], c: 4 })).toEqual([4, 1]);
  });

  it('an element-wise max keeps the unit of whichever side carries one', () => {
    const out = run('max(0, x)', { x: [q(-2, 'kWh'), q(3, 'kWh')] }) as any[];
    expect(nums(out)).toEqual([0, 3]);
    expect(unitLabel(out[1].u)).toBe('kWh');
  });
});

describe('reading a row back', () => {
  it('index counts from zero and refuses past the end by name', () => {
    expect(run('index(xs, 0)', { xs: [7, 8, 9] })).toBe(7);
    expect(run('index(xs, 2)', { xs: [7, 8, 9] })).toBe(9);
    const out = run('index(xs, 3)', { xs: [7, 8, 9] });
    expect(isError(out)).toBe(true);
    expect(String(out.error)).toMatch(/3/);
  });

  it('at() reads between two positions, and stops at the ends rather than falling off them', () => {
    expect(run('at(xs, 0)', { xs: [0, 10, 20] })).toBe(0);
    expect(run('at(xs, 1.5)', { xs: [0, 10, 20] })).toBe(15);
    expect(run('at(xs, -4)', { xs: [0, 10, 20] })).toBe(0);
    expect(run('at(xs, 99)', { xs: [0, 10, 20] })).toBe(20);
  });

  it('at() keeps the unit it read', () => {
    const out = run('at(xs, 0.5)', { xs: [q(0, 'kWh'), q(4, 'kWh')] });
    expect((out as any).n).toBe(2);
    expect(unitLabel((out as any).u)).toBe('kWh');
  });

  it('cumsum adds along the row and keeps the unit', () => {
    expect(run('cumsum(xs)', { xs: [1, 2, 3, 4] })).toEqual([1, 3, 6, 10]);
    const out = run('cumsum(xs)', { xs: [q(1, 'kWh'), q(2, 'kWh')] }) as any[];
    expect(nums(out)).toEqual([1, 3]);
    expect(unitLabel(out[1].u)).toBe('kWh');
  });

  it('where() chooses element by element', () => {
    expect(run('where(xs > 2, 1, 0)', { xs: [1, 3, 5] })).toEqual([0, 1, 1]);
    expect(run('where(c, a, b)', { c: [true, false], a: [10, 20], b: [1, 2] })).toEqual([10, 2]);
  });
});

describe('map, fold and scan: the element is x, the position i, what is built acc', () => {
  it('map works the body out for every element', () => {
    expect(run('map(range(4), x * x)')).toEqual([0, 1, 4, 9]);
    expect(run('map(xs, x + i)', { xs: [10, 20, 30] })).toEqual([10, 21, 32]);
  });

  it('a map body may reach the rest of the document as well as its own element', () => {
    expect(run('map(range(3), x * k)', { k: 5 })).toEqual([0, 5, 10]);
  });

  it('fold answers with the last accumulator', () => {
    expect(run('fold(range(5), 0, acc + x)')).toBe(10);
    expect(run('fold(xs, 1, acc * x)', { xs: [2, 3, 4] })).toBe(24);
  });

  it('scan answers with EVERY accumulator, starting from the one it was given', () => {
    // Five elements in, six readings out: the state before the first, and one after each.
    expect(run('scan(range(5), 0, acc + x)')).toEqual([0, 0, 1, 3, 6, 10]);
    expect(run('scan(xs, 0, acc + x)', { xs: [] })).toEqual([0]);
  });

  it('a battery step is one scan, clamped both ways, and the flows are its differences', () => {
    // Surplus 3, 0, 0; deficit 0, 1, 5; a 4 kWh battery with no losses and no rate limit.
    const map = { s: [3, 0, 0], d: [0, 1, 5], cap: 4 };
    const soc = run('scan(range(3), 0, clamp(acc + index(s, i) - index(d, i), 0, cap))', map);
    expect(soc).toEqual([0, 3, 2, 0]);
    const flow = run('map(range(3), index(soc, i + 1) - index(soc, i))', { ...map, soc });
    expect(flow).toEqual([3, -1, -2]);
  });

  it('inside a body, x, i and acc are the element and not a node of the document', () => {
    // A document with its own node called x: the body's element wins, the way a bound name does.
    expect(run('map(range(2), x)', { x: 99 })).toEqual([0, 1]);
  });
});

describe('what a formula depends on, with a bound name in the middle of it', () => {
  it('the element names of a map, fold and scan are not read as node ids', () => {
    expect(symbolsOf(parse('map(pv, x * k)'))).toEqual(['pv', 'k']);
    expect(symbolsOf(parse('fold(pv, start, acc + x)'))).toEqual(['pv', 'start']);
    expect(symbolsOf(parse('scan(range(24), soc0, clamp(acc + index(s, i), 0, cap))')))
      .toEqual(['soc0', 's', 'cap']);
  });

  it('a node genuinely called x outside a body is still a dependency', () => {
    expect(symbolsOf(parse('x + map(range(2), x)'))).toEqual(['x']);
  });
});

describe('a unit written the way a person writes it', () => {
  it('m² and m³ are the same units as m^2 and m^3, and print as themselves', () => {
    const area = run('a * b', { a: q(4, 'm'), b: q(5, 'm') }) as any;
    expect(unitLabel(parseUnit('m²') as any)).toBe('m²');
    // The two spellings add, because they are the same unit under two names.
    const sum = run('x + y', { x: q(10, 'm²'), y: q(5, 'm^2') }) as any;
    expect(sum.n).toBe(15);
    expect(area.n).toBe(20);
  });

  it('a compound unit takes the superscript spelling too', () => {
    const out = run('e / a', { e: q(1000, 'kWh'), a: q(2, 'm²') }) as any;
    expect(out.n).toBe(500);
    expect(isError(evaluate(parse('convert(x, "kWh/m²")'), scopeOf({ x: out })))).toBe(false);
  });

  it('but a prefix on a superscript area is refused rather than answered wrongly', () => {
    // km² is a MILLION square metres, and a prefix table that squared nothing would say a
    // thousand. So the name is not prefixable and the refusal says which name it does not know.
    const out = parseUnit('km²') as any;
    expect(typeof out.error).toBe('string');
    // The power syntax gets it right, because the prefix lands before the square.
    const cm2 = parseUnit('cm^2') as any;
    expect(cm2.scale).toBeCloseTo(1e-4, 12);
  });
});

describe('the maths a solar sheet is written in', () => {
  it('the trigonometry, in radians, with the two doors between radians and degrees', () => {
    expect(run('sin(0)')).toBe(0);
    expect(run('round(cos(pi), 10)')).toBe(-1);
    expect(run('round(deg(pi), 6)')).toBe(180);
    expect(run('round(sin(rad(30)), 6)')).toBe(0.5);
    expect(run('round(deg(asin(0.5)), 6)')).toBe(30);
    expect(run('round(deg(atan2(1, 1)), 6)')).toBe(45);
  });

  it('pi is a number this language has, not a node the document must declare', () => {
    expect(run('pi')).toBeCloseTo(Math.PI, 12);
    expect(isError(run('pi'))).toBe(false);
  });

  it('log10 sits beside ln, and tan and acos are there too', () => {
    expect(run('log10(1000)')).toBeCloseTo(3, 12);
    expect(run('round(tan(rad(45)), 10)')).toBe(1);
    expect(run('round(deg(acos(0)), 6)')).toBe(90);
  });

  it('the trigonometry goes down a row like everything else', () => {
    expect(nums(run('round(sin(rad(h * 90)), 6)', { h: [0, 1, 2] }))).toEqual([0, 1, 0]);
  });
});

describe('the printer sets the new vocabulary readably', () => {
  it('a sum is a sigma, not an operator name', () => {
    expect(toTex(parse('sum(pv)'))).toContain('\\sum');
  });

  it('a map is bracketed with its element named', () => {
    const tex = toTex(parse('map(pv, x * 2)'));
    expect(tex).toContain('\\left[');
    expect(tex).toContain('\\in');
    expect(tex).toContain('\\mathrm{pv}');
  });

  it('an index is a subscript, and pi is pi', () => {
    expect(toTex(parse('index(pv, i)'))).toBe('\\mathrm{pv}_{i}');
    expect(toTex(parse('pi'))).toBe('\\pi');
  });

  it('a range says the interval it walks', () => {
    expect(toTex(parse('range(24)'))).toContain('\\ldots');
  });

  it('a scan and a fold say what they start from and what the step is', () => {
    const tex = toTex(parse('scan(range(3), 0, acc + x)'));
    expect(tex).toContain('\\operatorname{scan}');
    expect(tex).toContain('\\mathrm{acc}');
  });
});

describe('a row inside a real document', () => {
  it('a graph carries lists between its nodes and works them out in order', () => {
    const g = createGraph({
      v: 1,
      model: {
        nodes: {
          panels: { type: 'value', value: 20 },
          hours: { type: 'formula', expr: 'range(24)' },
          shape: { type: 'formula', expr: 'max(0, sin(pi * (hours - 6) / 12))' },
          pv: { type: 'formula', expr: 'shape * panels * 0.4', unit: 'kWh' },
          day: { type: 'formula', expr: 'sum(pv)', unit: 'kWh' },
        },
      },
    });
    expect(g.errors).toEqual([]);
    g.refresh();
    const day = g.valueOf('day') as { n: number; u: { label: string } };
    expect(day.u.label).toBe('kWh');
    expect(day.n).toBeGreaterThan(0);
    // Doubling the array of panels doubles everything standing on it, in one recompute.
    const before = day.n;
    const out = g.set('panels', 40);
    expect(out.changed).toContain('day');
    expect((g.valueOf('day') as { n: number }).n).toBeCloseTo(before * 2, 8);
  });

  it('a document that reads a position it does not have says so where it happened', () => {
    const g = createGraph({
      v: 1,
      model: {
        nodes: {
          xs: { type: 'value', value: [1, 2, 3] },
          bad: { type: 'formula', expr: 'index(xs, 7)' },
        },
      },
    });
    g.refresh();
    const out = g.valueOf('bad') as { error: string };
    expect(typeof out.error).toBe('string');
    expect(out.error).toMatch(/7/);
  });
});
