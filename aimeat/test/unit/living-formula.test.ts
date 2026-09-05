/**
 * @file test/unit/living-formula.test.ts
 * @description The living document's expression language, proved end to end without a browser:
 *   the parser produces the MathJSON-shaped tree, the evaluator works it out with the units still
 *   on, a refusal comes back as a VALUE with words in it rather than an exception, and the TeX
 *   printer sets the same tree the evaluator walked.
 *
 *   Two rules this file exists to hold. An offset unit (°C, °F) that meets a multiplication comes
 *   back as a plain number, which is what makes t * 9/5 + 32 with unit °F mean what its author
 *   meant — while p * v / (r * T) is still checked all the way through. And a percentage is a
 *   LABEL on a face number: 72 % computes as 72, so ln(rh) and rh / 100 stop disagreeing about
 *   which reading they took, and fraction(x) / percent(x) are the two doors between them.
 * @usage cd aimeat && pnpm vitest run test/unit/living-formula.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-05 — The percentage rule (living 0.3.0).
 *   v1.0.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { describe, it, expect } from 'vitest';
import { parse, symbolsOf } from '../../src/static/sdk-libs/living/formula-parse.js';
import { evaluate, isError, asText } from '../../src/static/sdk-libs/living/formula-eval.js';
import { parseUnit, convert, unitLabel } from '../../src/static/sdk-libs/living/units.js';
import { toTex } from '../../src/static/sdk-libs/living/tex.js';

/** A scope over a plain map, the way the graph hands one to a formula. */
function scopeOf(map: Record<string, unknown>) {
  return { get: (id: string) => (Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined) };
}
function q(n: number, unit: string) { return { n, u: parseUnit(unit) }; }
function run(src: string, map: Record<string, unknown> = {}) {
  return evaluate(parse(src), scopeOf(map));
}

describe('parse: the tree is MathJSON-shaped', () => {
  it('an operator becomes a head and its arguments', () => {
    expect(parse('p * v')).toEqual(['Multiply', 'p', 'v']);
  });

  it('precedence puts times under plus, and brackets survive as structure', () => {
    // Times and divide are one level and read left to right, so this is (t * 9) / 5 + 32.
    expect(parse('t * 9/5 + 32')).toEqual(['Add', ['Divide', ['Multiply', 't', 9], 5], 32]);
    expect(parse('p * v / (r * T)')).toEqual(['Divide', ['Multiply', 'p', 'v'], ['Multiply', 'r', 'T']]);
  });

  it('a bare name is a symbol, a quoted run is a string, a number is a number', () => {
    expect(parse('x')).toBe('x');
    expect(parse('"hi"')).toEqual({ str: 'hi' });
    expect(parse('4.5e2')).toBe(450);
  });

  it('comparison is looser than arithmetic and tighter than and/or', () => {
    expect(parse('a + 1 > b and c')).toEqual(['And', ['Greater', ['Add', 'a', 1], 'b'], 'c']);
  });

  it('a function call becomes its MathJSON head', () => {
    expect(parse('if(t > 30, "hot", "fine")')).toEqual(['If', ['Greater', 't', 30], { str: 'hot' }, { str: 'fine' }]);
    expect(parse('avg(readings)')).toEqual(['Mean', 'readings']);
    expect(parse('clamp(x, 0, 1)')).toEqual(['Clamp', 'x', 0, 1]);
  });

  it('symbolsOf names every node the formula reads, once each, in order', () => {
    expect(symbolsOf(parse('p * v / (r * p)'))).toEqual(['p', 'v', 'r']);
  });

  it('a refusal names the place instead of throwing', () => {
    const bad = parse('2 * * 3') as { error: string; at: number };
    expect(isError(bad)).toBe(true);
    expect(typeof bad.at).toBe('number');
    const unknown = parse('wobble(3)') as { error: string };
    expect(unknown.error).toMatch(/does not have/);
  });
});

describe('evaluate: numbers, text, truth and lists', () => {
  it('works arithmetic out in the ordinary order', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('2 ^ 10')).toBe(1024);
    expect(run('-3 + 1')).toBe(-2);
  });

  it('reads other nodes by name', () => {
    expect(run('a + b', { a: 2, b: 40 })).toBe(42);
  });

  it('if() picks a branch and does not work the other one out', () => {
    expect(run('if(t > 30, "liian kuuma", "hyvä")', { t: 31 })).toBe('liian kuuma');
    expect(run('if(t > 30, "liian kuuma", "hyvä")', { t: 12 })).toBe('hyvä');
  });

  it('aggregates take a list or the arguments themselves', () => {
    expect(run('avg(readings)', { readings: [1, 2, 3, 4] })).toBe(2.5);
    expect(run('sum(readings)', { readings: [1, 2, 3, 4] })).toBe(10);
    expect(run('count(readings)', { readings: [1, 2, 3] })).toBe(3);
    expect(run('max(1, 9, 4)')).toBe(9);
    expect(run('last(readings)', { readings: [1, 2, 7] })).toBe(7);
  });

  it('clamp, round and the rest do what a spreadsheet does', () => {
    expect(run('clamp(x, 0, 1)', { x: 2.5 })).toBe(1);
    expect(run('round(x, 1)', { x: 3.14159 })).toBe(3.1);
    expect(run('floor(x)', { x: 3.9 })).toBe(3);
  });

  it('and, or and not are truth, and & joins text', () => {
    expect(run('true and false')).toBe(false);
    expect(run('not false')).toBe(true);
    expect(run('"a" & "b"')).toBe('ab');
    expect(run('"t on " & t', { t: 12 })).toBe('t on 12');
  });
});

describe('evaluate: the units are carried and checked', () => {
  it('a unit rides through multiplication and division', () => {
    const out = run('p * v / (r * T)', {
      p: q(101325, 'Pa'), v: q(0.0224, 'm^3'), r: q(8.314462618, 'J/(mol*K)'), T: q(273.15, 'K'),
    }) as { n: number; u: { dim: Record<string, number> } };
    expect(isError(out)).toBe(false);
    expect(out.n).toBeCloseTo(0.99936, 4);
    expect(out.u.dim).toEqual({ mol: 1 });
  });

  it('adding two things that measure different things is refused in words', () => {
    const out = run('a + b', { a: q(20, '°C'), b: q(1000, 'Pa') }) as { error: string };
    expect(isError(out)).toBe(true);
    expect(out.error).toMatch(/different things/);
  });

  it('adding the same kind converts the second into the first', () => {
    const out = run('a + b', { a: q(1, 'km'), b: q(500, 'm') }) as { n: number; u: { label: string } };
    expect(out.n).toBe(1.5);
    expect(out.u.label).toBe('km');
  });

  it('an offset unit that meets a multiplication comes back as a plain number', () => {
    // This is the whole reason the hand-written conversion works.
    expect(run('t * 9/5 + 32', { t: q(22, '°C') })).toBeCloseTo(71.6, 10);
  });

  it('a real conversion is asked for, and refuses across kinds', () => {
    const k = run('convert(t, "K")', { t: q(22, '°C') }) as { n: number; u: { label: string } };
    expect(k.n).toBeCloseTo(295.15, 10);
    expect(k.u.label).toBe('K');
    const no = run('convert(t, "Pa")', { t: q(22, '°C') }) as { error: string };
    expect(isError(no)).toBe(true);
    expect(no.error).toMatch(/different things/);
  });

  it('a comparison compares in the base unit, whatever each side was written in', () => {
    expect(run('a > b', { a: q(1, 'km'), b: q(999, 'm') })).toBe(true);
    expect(run('a > b', { a: q(1, 'km'), b: q(1001, 'm') })).toBe(false);
  });

  it('a currency is its own family and never converts', () => {
    const out = run('a + b', { a: q(10, 'EUR'), b: q(10, 'USD') }) as { error: string };
    expect(isError(out)).toBe(true);
    expect(unitLabel(parseUnit('EUR') as never)).toBe('EUR');
  });

  it('a compound unit is parsed rather than looked up', () => {
    const speed = parseUnit('km/h') as { dim: Record<string, number>; scale: number };
    expect(speed.dim).toEqual({ m: 1, s: -1 });
    expect(speed.scale).toBeCloseTo(1000 / 3600, 12);
    const moved = convert({ n: 36, u: parseUnit('km/h') as never }, parseUnit('m/s') as never) as { n: number };
    expect(moved.n).toBeCloseTo(10, 10);
  });

  it('an unknown unit is refused by name', () => {
    const out = parseUnit('bananas') as { error: string };
    expect(isError(out)).toBe(true);
    expect(out.error).toMatch(/bananas/);
  });
});

/**
 * A PERCENTAGE IS A LABEL ON A FACE NUMBER. With `%` carrying a scale of 0.01, one node read two
 * ways in the same recompute: ln(rh) took the logarithm of 72 while rh / 100 came out as 0.0072,
 * and neither said which reading it had used. The rule now is that 72 % computes as 72, and the
 * two doors between that and a fraction of one are written into the formula.
 */
describe('evaluate: a percentage is a face number, and the conversion is asked for', () => {
  const rh = { rh: q(72, '%') };

  it('ln(rh), rh / 100 and fraction(rh) each mean what they say', () => {
    expect(run('ln(rh)', rh)).toBeCloseTo(Math.log(72), 12);
    expect(run('rh / 100', rh)).toBeCloseTo(0.72, 12);
    expect(run('fraction(rh)', rh)).toBeCloseTo(0.72, 12);
  });

  it('arithmetic is on the number the author typed', () => {
    expect(run('rh + 5', rh)).toBeCloseTo(77, 12);
    expect(run('rh * 2', rh)).toBeCloseTo(144, 12);
    expect(run('rh > 50', rh)).toBe(true);
  });

  it('the node itself still carries its label, so it reads as a percentage', () => {
    expect(asText(q(72, '%'))).toBe('72 %');
  });

  it('percent() turns a fraction of one into a percentage, with the label on it', () => {
    const out = run('percent(x)', { x: 0.72 }) as { n: number; u: { label: string } };
    expect(out.n).toBeCloseTo(72, 12);
    expect(out.u.label).toBe('%');
  });

  it('percent() of something already a percentage is refused rather than doubled', () => {
    const out = run('percent(rh)', rh) as { error: string };
    expect(isError(out)).toBe(true);
    expect(out.error).toMatch(/already a percentage/);
  });

  it('fraction() of something measured is refused, naming what it was in', () => {
    const out = run('fraction(t)', { t: q(22, '°C') }) as { error: string };
    expect(isError(out)).toBe(true);
    expect(out.error).toMatch(/°C/);
  });

  it('convert between two dimensionless labels refuses and points at the two doors', () => {
    const out = run('convert(rh, "ppm")', rh) as { error: string };
    expect(isError(out)).toBe(true);
    expect(out.error).toMatch(/fraction\(x\)/);
    expect(out.error).toMatch(/percent\(x\)/);
  });

  it('a formula may still LABEL its answer a percentage', () => {
    // ratio comes out plain; the node's own unit names it, which is the same half of the unit
    // field that makes t * 9/5 + 32 with unit °F work.
    const out = run('a / b * 100', { a: 36, b: 50 });
    expect(out).toBeCloseTo(72, 12);
  });
});

describe('evaluate: a refusal is a value', () => {
  it('an unknown node says so and does not throw', () => {
    const out = run('a + nope', { a: 1 }) as { error: string };
    expect(out.error).toMatch(/nothing called "nope"/);
  });

  it('a refusal travels through whatever reads it', () => {
    const out = run('(a + nope) * 2', { a: 1 }) as { error: string };
    expect(isError(out)).toBe(true);
  });

  it('a refusal reads as its own words', () => {
    expect(asText(run('sqrt(0 - 4)'))).toMatch(/no square root/);
  });
});

describe('toTex: the same tree, set', () => {
  it('a division becomes a fraction and the brackets stop being written out', () => {
    expect(toTex(parse('p * v / (r * T)'))).toBe('\\frac{p \\cdot v}{r \\cdot T}');
  });

  it('a power becomes a superscript and a root gets its sign', () => {
    expect(toTex(parse('sqrt(a ^ 2 + b ^ 2)'))).toBe('\\sqrt{a^{2} + b^{2}}');
  });

  it('brackets appear where precedence needs them and nowhere else', () => {
    expect(toTex(parse('(a + b) * c'))).toBe('\\left(a + b\\right) \\cdot c');
    expect(toTex(parse('a + b * c'))).toBe('a + b \\cdot c');
  });

  it('a word-length name is set upright, a single letter stays a variable', () => {
    expect(toTex(parse('readings'))).toBe('\\mathrm{readings}');
    expect(toTex(parse('t'))).toBe('t');
  });

  it('an if becomes the cases brace mathematics already has', () => {
    expect(toTex(parse('if(t > 30, 1, 0)'))).toContain('\\begin{cases}');
  });

  it('a comparison and an operator function are set as themselves', () => {
    expect(toTex(parse('t >= 30'))).toBe('t \\ge 30');
    expect(toTex(parse('avg(readings)'))).toBe('\\operatorname{avg}\\left(\\mathrm{readings}\\right)');
  });
});
