/**
 * @file src/services/worksheet/units.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Quantities for the Worksheet: a number that carries a unit, on top of the Compute
 *   Engine's MathJSON. Everything a worksheet cell holds is DATA — `["Quantity", 21, "degC"]` — so a
 *   sheet is a record the way a table row is a record, and no cell is ever a program. That is what
 *   lets an agent write one, and what keeps the eval-free CSP the mosaic relies on intact.
 *
 *   Three things the library does NOT do, and this file does:
 *
 *   1. AN UNKNOWN UNIT IS SILENT. `["Quantity", 1, "banana"]` evaluates to itself with no error and
 *      `.isValid` true, so a typo would ride all the way to the screen as a plausible number.
 *      `knownUnit()` asks for the unit's dimension vector: a real unit answers with a List, a made-up
 *      one answers with the unevaluated `UnitDimension` call.
 *   2. AN UNRESOLVED EXPRESSION IS SILENT TOO. Adding metres to seconds does not throw; the result is
 *      the `Add` you handed in, unevaluated. `readResult()` therefore asks what the answer IS rather
 *      than whether the call threw: a number, a quantity, or neither.
 *   3. A DIFFERENCE OF TWO TEMPERATURES IS NOT A TEMPERATURE. 21 degC − (−12 degC) answers
 *      `33 degC`, whose magnitude is right and whose unit is wrong: converted to Fahrenheit that
 *      reads 91.4 instead of the 59.4 degrees of difference it actually is. degC and degF are affine
 *      scales, so the difference of two of them belongs on the matching absolute scale.
 *      `differenceUnit()` is that correction, and it is applied where the subtraction is known to be
 *      a difference rather than in the library's own arithmetic.
 * @structure MathJson · box · Quantity · engine · unitExpr · knownUnit · quantityOf · readResult ·
 *   unitJson · differenceUnit · isAffine · tidy · formatQuantity · unitWord · latexOf · symbolsOf ·
 *   parseLatex
 * @usage
 *   import { box, readResult, knownUnit } from './units.js';
 *   const answer = readResult(box(['Add', a, b]).evaluate());
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 1).
 */
import { ComputeEngine } from '@cortex-js/compute-engine';

/**
 * MathJSON is JSON the Compute Engine accepts. Typed as JSON rather than as the library's own
 * expression type so a sheet coming off the wire needs no cast to be held; `box()` is the one place
 * it crosses into the library.
 */
export type MathJson = string | number | boolean | null | MathJson[] | { [key: string]: MathJson };

/** The one crossing into the library's own types. */
export function box(math: MathJson) {
  return engine().box(math as never);
}

/** What a resolved cell answers with: a number, and a unit when it carries one. */
export interface Quantity {
  value: number;
  /** As it is written: `degC`, `W/(K·m²)`. null for a plain number, a ratio or a count. */
  unit: string | null;
  /**
   * The same unit as the library's own expression. Carried because the written form is for a reader
   * (`m²` sets, `m^2` does not) and cannot be handed back to the engine for the next conversion.
   */
  unitJson?: MathJson;
}

/**
 * One engine per process. Boot costs ~14 ms and an evaluation ~0.06 ms, so the engine is built once
 * and every request reuses it. It holds no per-request state: symbols are substituted into the
 * expression before it is boxed (see evaluate.ts) rather than assigned onto the engine, so two
 * requests can never see each other's values.
 */
let shared: ComputeEngine | null = null;
export function engine(): ComputeEngine {
  if (!shared) shared = new ComputeEngine();
  return shared;
}

/**
 * A written unit as MathJSON. `W/(m^2*K)` is an expression, not a name, and the maths parser cannot
 * be used for it: it applies implicit multiplication to a run of letters, so `km` arrives as k times
 * m and `degC` as four separate symbols. This grammar keeps an identifier whole and understands only
 * what a unit needs — multiplication, division, a power, and brackets.
 *
 *   expr   := term (('*' | '·' | '/') term)*
 *   term   := factor ('^' number)?
 *   factor := identifier | number | '(' expr ')'
 */
export function unitExpr(unit: string): MathJson | null {
  const src = String(unit || '').trim();
  if (!src) return null;
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(src)) return src;   // a plain name: degC, km, kWh

  const tokens = src.match(/[A-Za-z][A-Za-z0-9_]*|\d+(?:\.\d+)?|[*·/^()]|\S/g);
  if (!tokens) return null;
  let at = 0;
  const peek = () => tokens[at];
  const eat = () => tokens[at++];

  const factor = (): MathJson | null => {
    const tok = eat();
    if (tok === undefined) return null;
    if (tok === '(') {
      const inner = expr();
      if (eat() !== ')') return null;
      return inner;
    }
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(tok)) return tok;
    if (/^\d/.test(tok)) return Number(tok);
    return null;
  };
  const term = (): MathJson | null => {
    let base = factor();
    if (base === null) return null;
    if (peek() === '^') {
      eat();
      const exponent = eat();
      if (exponent === undefined || !/^-?\d+(?:\.\d+)?$/.test(exponent)) return null;
      base = ['Power', base, Number(exponent)];
    }
    return base;
  };
  const expr = (): MathJson | null => {
    let left = term();
    if (left === null) return null;
    while (peek() === '*' || peek() === '·' || peek() === '/') {
      const op = eat();
      const right = term();
      if (right === null) return null;
      left = op === '/' ? ['Divide', left, right] : ['Multiply', left, right];
    }
    return left;
  };

  const built = expr();
  return built !== null && at === tokens.length ? built : null;
}

/**
 * Does this unit exist? A real unit has a dimension vector; a made-up one leaves the call
 * unevaluated. Memoized because a sheet asks the same handful of units on every keystroke.
 */
const unitCache = new Map<string, boolean>();
export function knownUnit(unit: string): boolean {
  const u = String(unit || '').trim();
  if (!u) return false;
  const hit = unitCache.get(u);
  if (hit !== undefined) return hit;
  const ok = hasDimension(u);
  if (unitCache.size < 500) unitCache.set(u, ok);
  return ok;
}

/** Does the maths library know a dimension for this unit? Both ways of not knowing answer false. */
function hasDimension(unit: string): boolean {
  try {
    const expression = unitExpr(unit);
    return expression !== null && box(['UnitDimension', expression]).evaluate().operator === 'List';
  } catch {
    // The question is "is this a unit", and a throw from the maths library is one of the ways the
    // answer is no. There is no failure here to report to anyone.
    // eslint-disable-next-line aimeat/no-silent-catch -- false here means "not a unit"
    return false;
  }
}

/** A number with a unit as MathJSON; a number without one stays a plain number. */
export function quantityOf(value: number, unit?: string | null, unitAst?: MathJson): MathJson {
  if (unitAst !== undefined && unitAst !== null) return ['Quantity', value, unitAst];
  if (!unit) return value;
  const expression = unitExpr(unit);
  return expression === null ? value : ['Quantity', value, expression];
}

/**
 * What an evaluated expression IS: a number, a quantity, or nothing we can use. The library answers
 * an unresolved expression with the expression itself, so "did it throw" is the wrong question and
 * this asks "what came back" instead.
 */
export function readResult(box: { operator?: string; isNumberLiteral?: boolean; re?: number; ops?: readonly { json: unknown }[] }): Quantity | null {
  if (box?.isNumberLiteral && typeof box.re === 'number' && Number.isFinite(box.re)) {
    return { value: box.re, unit: null };
  }
  if (box?.operator === 'Quantity' && box.ops && box.ops.length >= 2) {
    const raw = box.ops[0]?.json;
    const value = typeof raw === 'number' ? raw : Number(raw);
    const ast = box.ops[1]?.json;
    const unit = unitJson(ast);
    if (Number.isFinite(value) && unit) return { value, unit, unitJson: ast as MathJson };
  }
  return null;
}

/**
 * A unit written the way it is written on paper. A simple unit is a name; a compound one is MathJSON
 * (`["Divide","W",["Multiply","K",["Power","m",2]]]`) and becomes `W/(K·m²)`. The library's own LaTeX
 * is not used for this: it answers `\frac{W}{Km^2}`, which needs a maths setter to be read at all.
 */
export function unitJson(json: unknown, depth = 0): string | null {
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (!Array.isArray(json) || depth > 12) return null;
  const [head, ...rest] = json;
  const parts = rest.map(p => unitJson(p, depth + 1));
  if (parts.some(p => p === null)) return null;
  const wrap = (p: string) => (/[·/]/.test(p) ? `(${p})` : p);
  if (head === 'Multiply') return (parts as string[]).map(wrap).join('·');
  if (head === 'Divide' && parts.length === 2) return `${wrap(parts[0]!)}/${wrap(parts[1]!)}`;
  if (head === 'Power' && parts.length === 2) return `${wrap(parts[0]!)}${superscript(parts[1]!)}`;
  return null;
}

/** An exponent as a written figure: m² reads, m^2 needs decoding. */
const SUPERSCRIPTS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
function superscript(exponent: string): string {
  return /^-?\d+$/.test(exponent) ? [...exponent].map(c => SUPERSCRIPTS[c] ?? c).join('') : `^${exponent}`;
}

/**
 * The unit a DIFFERENCE of two values on this scale belongs on. Celsius and Fahrenheit are affine:
 * their zero is a convention, so a gap between two readings is a span on the matching absolute
 * scale, and only there does converting it answer the number a person means.
 */
const AFFINE_DIFFERENCE: Record<string, string> = { degC: 'K', celsius: 'K', degF: 'R', fahrenheit: 'R' };
export function differenceUnit(unit: string | null): string | null {
  if (!unit) return null;
  return AFFINE_DIFFERENCE[unit] ?? unit;
}

/** Is this unit an affine scale, where a difference means something other than a reading? */
export function isAffine(unit: string | null | undefined): boolean {
  return !!unit && unit in AFFINE_DIFFERENCE;
}

/**
 * Round away the float dust an affine conversion leaves behind: 100 degC answers 211.99999999999994
 * degF, and a person reading a temperature wants 212. Twelve significant digits keeps every figure a
 * measurement can carry and drops what the double could not represent in the first place.
 */
export function tidy(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** The reader's own number, with the unit after it. `decimals` bounds a long tail without hiding it. */
export function formatQuantity(q: Quantity, locale = 'en', decimals?: number): string {
  const tag = locale === 'fi' ? 'fi-FI' : locale === 'es' ? 'es-ES' : 'en-GB';
  const value = tidy(q.value);
  const text = groupedNumber(value, tag, decimals);
  return q.unit ? `${text} ${unitWord(q.unit)}` : text;
}

/** The number in the reader's own grouping, or the plain digits when the platform has no such tag. */
function groupedNumber(value: number, tag: string, decimals?: number): string {
  try {
    return new Intl.NumberFormat(tag, {
      maximumFractionDigits: decimals ?? (Math.abs(value) < 1 && value !== 0 ? 6 : 3),
    }).format(value);
  } catch {
    // Intl refuses a tag it does not know. The number still has to reach the reader, so it goes out
    // ungrouped rather than not at all: the digits are the fallback, not a failure to report.
    return String(value);
  }
}

/** The symbol a person writes: degC is °C on a screen, whatever it is called in the expression. */
const UNIT_WORDS: Record<string, string> = { degC: '°C', degF: '°F', degK: 'K', K: 'K', R: '°R', percent: '%' };
export function unitWord(unit: string): string {
  return UNIT_WORDS[unit] ?? unit;
}

/** The expression as LaTeX, for KaTeX to set. Empty when the library cannot write it. */
export function latexOf(math: MathJson): string {
  try {
    const latex = box(math).latex;
    return typeof latex === 'string' ? latex : '';
  } catch {
    // An expression the library cannot write as LaTeX has no LaTeX, and the cell's own answer is
    // unaffected: only the typeset copy of the formula is missing.
    // eslint-disable-next-line aimeat/no-silent-catch -- empty here means "no LaTeX for this"
    return '';
  }
}

/** The free symbols an expression stands on — the cell ids it depends upon. */
export function symbolsOf(math: MathJson): string[] {
  try {
    const unknowns = box(math).unknowns;
    return Array.isArray(unknowns) ? unknowns.map(String) : [];
  } catch {
    // An expression the library will not box has no free symbols to report, and the cell that owns
    // it answers NOT_A_NUMBER on its own line — which is where a reader is told.
    // eslint-disable-next-line aimeat/no-silent-catch -- empty here means "stands on nothing we can read"
    return [];
  }
}

/** A person's typed maths as MathJSON, or null when it does not parse. */
export function parseLatex(latex: string): MathJson | null {
  try {
    const parsed = engine().parse(String(latex || ''));
    if (!parsed || !parsed.isValid) return null;
    return parsed.json as MathJson;
  } catch {
    // "That is not maths" is the answer to a person still typing, and the caller turns this null
    // into BAD_LATEX on the cell they typed it into.
    // eslint-disable-next-line aimeat/no-silent-catch -- null here means "does not parse as maths"
    return null;
  }
}
