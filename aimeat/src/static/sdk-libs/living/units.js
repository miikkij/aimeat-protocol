/**
 * @file living/units.js
 * @description THE UNITS A LIVING DOCUMENT COUNTS IN. A quantity here is a number and a unit
 *   together, and the unit is not decoration: it rides through multiplication and division, it
 *   is CHECKED on addition, and a sum of two things that are not the same kind of thing is
 *   refused in words instead of producing a number nobody can use.
 *
 *   ONE RULE IS WORTH READING BEFORE THE REST. Celsius and Fahrenheit are not scales, they are
 *   scales WITH AN OFFSET, and multiplying one by a number has no meaning as a temperature: half
 *   of 20 °C is not 10 °C in any sense a person would defend. So an offset unit that meets a
 *   multiplication comes back as a PLAIN NUMBER, and the formula's own unit names the result —
 *   which is exactly what the hand-written conversion t * 9/5 + 32 with unit °F is doing, and it
 *   now says so instead of pretending to be dimensional analysis. A real conversion is asked
 *   for: convert(t, "K"), or a formula's unit when the computed result still carries one.
 *
 *   A CURRENCY IS A DIMENSION OF ITS OWN AND NEVER CONVERTS. EUR + EUR is money; EUR + USD is a
 *   rate this library does not have and will not invent, so it refuses. That is the honest
 *   answer, and it is the one a document about money needs.
 *
 *   A PERCENTAGE IS A LABEL ON A FACE NUMBER, NOT A FACTOR — the second rule worth reading
 *   before the rest. `%` and `ppm` measure nothing, so they cannot be checked the way kg and °C
 *   are checked, and a scale hidden inside one is a scale nobody can see: 72 % stored as 0.72
 *   made ln(rh) read the logarithm of 72 while rh / 100 collapsed to 0.0072, both from the same
 *   node in the same recompute, and neither said so. So a percentage is STORED AND COMPUTED AS
 *   ITS FACE NUMBER — rh is 72, ln(rh) is ln(72), rh / 100 is 0.72, rh + 5 is 77 — and the unit
 *   rides along as a word. The one conversion is asked for out loud and is in the formula
 *   function table: fraction(rh) → 0.72 and percent(x) → 100·x. convert() between two different
 *   dimensionless labels refuses and names those two, because a silent 72 ppm is exactly the
 *   answer this rule exists to stop.
 * @structure UNITS/PREFIXES tables · parseUnit · unitLabel · sameDim · convert · mul/div/pow ·
 *   addable · quantity helpers
 * @usage
 *   import { parseUnit, convert, mulUnits } from './units.js';
 *   const c = parseUnit('°C');            // { dim: { K: 1 }, scale: 1, offset: 273.15 }
 *   convert({ n: 22, u: c }, parseUnit('K'));   // { n: 295.15, u: K }
 * @version-history
 *   v0.3.0 — 2026-09-05 — A percentage is a label on a face number: `%` and `ppm` carry a scale
 *     of 1, so arithmetic is on the number the author typed, and convert() refuses between two
 *     dimensionless labels rather than answering with a rescaled one.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */

/**
 * @typedef {{ dim: Record<string, number>, scale: number, offset: number, label: string }} Unit
 * @typedef {{ n: number, u: Unit|null }} Quantity
 */

/** SI prefixes, applied only when the whole name is not in the table already. */
const PREFIXES = {
  T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, 'µ': 1e-6, u: 1e-6, n: 1e-9, p: 1e-12,
};

/** The names a prefix may sit in front of. Anything else must be written out in full. */
const PREFIXABLE = ['m', 'g', 's', 'A', 'K', 'mol', 'cd', 'N', 'Pa', 'J', 'W', 'V', 'L', 'Hz', 'Ω', 'ohm', 'F', 'C', 'B', 'Wh', 'bar'];

/** dim(base) → exponent. The seven SI bases plus one pseudo-base per currency code. */
function d(dim) { return dim || {}; }

/** One table entry: base dimensions, the factor to SI base, and an offset for the affine two. */
function u(dim, scale, offset) {
  return { dim: d(dim), scale: scale == null ? 1 : scale, offset: offset || 0, label: '' };
}

/**
 * Every unit this library knows by name. Compound units are written rather than listed:
 * "J/(mol*K)" and "km/h" are parsed, not looked up.
 */
const UNITS = {
  // dimensionless — a LABEL on a face number, never a hidden factor. See the percentage rule at
  // the head of this file: the scale is 1 so 72 % computes as 72, and fraction()/percent() are
  // the two doors between a percentage and a fraction of one.
  '': u({}, 1),
  '%': u({}, 1),
  'ppm': u({}, 1),
  'x': u({}, 1),
  // length
  m: u({ m: 1 }), km: u({ m: 1 }, 1e3), cm: u({ m: 1 }, 1e-2), mm: u({ m: 1 }, 1e-3),
  mi: u({ m: 1 }, 1609.344), ft: u({ m: 1 }, 0.3048), in: u({ m: 1 }, 0.0254),
  // mass
  kg: u({ kg: 1 }), g: u({ kg: 1 }, 1e-3), mg: u({ kg: 1 }, 1e-6), t: u({ kg: 1 }, 1e3),
  lb: u({ kg: 1 }, 0.45359237),
  // time
  s: u({ s: 1 }), ms: u({ s: 1 }, 1e-3), min: u({ s: 1 }, 60), h: u({ s: 1 }, 3600),
  day: u({ s: 1 }, 86400), a: u({ s: 1 }, 31557600),
  // current, amount, luminous
  A: u({ A: 1 }), mol: u({ mol: 1 }), cd: u({ cd: 1 }),
  // temperature — K is the scale; the other two carry an offset and are handled apart
  K: u({ K: 1 }),
  '°C': u({ K: 1 }, 1, 273.15), degC: u({ K: 1 }, 1, 273.15),
  '°F': u({ K: 1 }, 5 / 9, 255.3722222222222), degF: u({ K: 1 }, 5 / 9, 255.3722222222222),
  // derived
  Hz: u({ s: -1 }),
  N: u({ kg: 1, m: 1, s: -2 }),
  Pa: u({ kg: 1, m: -1, s: -2 }), bar: u({ kg: 1, m: -1, s: -2 }, 1e5),
  atm: u({ kg: 1, m: -1, s: -2 }, 101325),
  J: u({ kg: 1, m: 2, s: -2 }), Wh: u({ kg: 1, m: 2, s: -2 }, 3600),
  W: u({ kg: 1, m: 2, s: -3 }),
  C: u({ A: 1, s: 1 }),
  V: u({ kg: 1, m: 2, s: -3, A: -1 }),
  'Ω': u({ kg: 1, m: 2, s: -3, A: -2 }), ohm: u({ kg: 1, m: 2, s: -3, A: -2 }),
  F: u({ kg: -1, m: -2, s: 4, A: 2 }),
  L: u({ m: 3 }, 1e-3),
  B: u({ B: 1 }), bit: u({ B: 1 }, 0.125),
};

/** Currency codes are their own dimension and never convert into one another. */
const CURRENCIES = ['EUR', 'USD', 'GBP', 'SEK', 'NOK', 'DKK', 'JPY', 'CHF', 'PLN'];
for (const code of CURRENCIES) UNITS[code] = u({ ['cur:' + code]: 1 });

/** A single unit name, with a prefix when the bare name is not in the table. */
function lookup(name) {
  if (Object.prototype.hasOwnProperty.call(UNITS, name)) return UNITS[name];
  for (const p of Object.keys(PREFIXES)) {
    if (name.length > p.length && name.slice(0, p.length) === p) {
      const rest = name.slice(p.length);
      if (PREFIXABLE.indexOf(rest) >= 0 && Object.prototype.hasOwnProperty.call(UNITS, rest)) {
        const base = UNITS[rest];
        if (base.offset) return null;
        return { dim: base.dim, scale: base.scale * PREFIXES[p], offset: 0, label: '' };
      }
    }
  }
  return null;
}

function mulDim(a, b, sign) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k];
  for (const k of Object.keys(b)) {
    const next = (out[k] || 0) + sign * b[k];
    if (next === 0) delete out[k]; else out[k] = next;
  }
  return out;
}

/** Multiply two units. An offset unit cannot take part; the caller is told which. */
export function mulUnits(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { dim: mulDim(a.dim, b.dim, 1), scale: a.scale * b.scale, offset: 0, label: '' };
}

/** Divide two units. */
export function divUnits(a, b) {
  const left = a || { dim: {}, scale: 1, offset: 0, label: '' };
  if (!b) return a;
  return { dim: mulDim(left.dim, b.dim, -1), scale: left.scale / b.scale, offset: 0, label: '' };
}

/** Raise a unit to an integer power. */
export function powUnit(a, k) {
  if (!a) return null;
  const out = {};
  for (const key of Object.keys(a.dim)) out[key] = a.dim[key] * k;
  return { dim: out, scale: Math.pow(a.scale, k), offset: 0, label: '' };
}

/** True when a unit is a scale with an offset — the two temperatures, and nothing else. */
export function isAffine(unit) { return !!unit && unit.offset !== 0; }

/** True when the unit is present but measures nothing (a bare number, a percentage). */
export function isPlain(unit) { return !unit || Object.keys(unit.dim).length === 0; }

/** Two units measure the same kind of thing. */
export function sameDim(a, b) {
  const da = a ? a.dim : {};
  const db = b ? b.dim : {};
  const keys = new Set([...Object.keys(da), ...Object.keys(db)]);
  for (const k of keys) if ((da[k] || 0) !== (db[k] || 0)) return false;
  return true;
}

/**
 * Parse a unit expression: a name, a product, a quotient, a power, and brackets.
 * "km/h" · "J/(mol*K)" · "m/s^2" · "kg·m/s^2". Returns a Unit, null for the empty string, or
 * { error } naming the part it could not read.
 * @param {string|null|undefined} text
 * @returns {Unit|null|{ error: string }}
 */
export function parseUnit(text) {
  if (text == null) return null;
  const src = String(text).trim();
  if (src === '') return null;
  const direct = lookup(src);
  if (direct) return { dim: direct.dim, scale: direct.scale, offset: direct.offset, label: src };

  let i = 0;
  const s = src.replace(/·/g, '*').replace(/\s+/g, '');
  let bad = null;

  function factor() {
    if (s[i] === '(') {
      i++;
      const inner = expr();
      if (s[i] !== ')') { bad = bad || 'a missing )'; return null; }
      i++;
      return inner;
    }
    const start = i;
    while (i < s.length && !'*/^()'.includes(s[i])) i++;
    const name = s.slice(start, i);
    if (!name) { bad = bad || 'an empty unit name'; return null; }
    const found = lookup(name);
    if (!found) { bad = bad || ('"' + name + '"'); return null; }
    if (found.offset) { bad = bad || (name + ' (a temperature with an offset cannot be part of a compound unit)'); return null; }
    let out = { dim: found.dim, scale: found.scale, offset: 0, label: '' };
    if (s[i] === '^') {
      i++;
      const from = i;
      if (s[i] === '-') i++;
      while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
      const k = Number(s.slice(from, i));
      if (!Number.isFinite(k)) { bad = bad || 'a power that is not a whole number'; return null; }
      out = powUnit(out, k);
    }
    return out;
  }

  function expr() {
    let left = factor();
    while (left && (s[i] === '*' || s[i] === '/')) {
      const op = s[i];
      i++;
      const right = factor();
      if (!right) return null;
      left = op === '*' ? mulUnits(left, right) : divUnits(left, right);
    }
    return left;
  }

  const out = expr();
  if (!out || bad || i < s.length) {
    return { error: 'I do not know the unit ' + (bad || '"' + src + '"') + '.' };
  }
  out.label = src;
  return out;
}

/** How a unit is written back to a person: what it was declared as, or its dimensions. */
export function unitLabel(unit) {
  if (!unit) return '';
  if (unit.label) return unit.label;
  const parts = [];
  for (const k of Object.keys(unit.dim).sort()) {
    const e = unit.dim[k];
    const name = k.indexOf('cur:') === 0 ? k.slice(4) : k;
    parts.push(e === 1 ? name : name + '^' + e);
  }
  return parts.join('·');
}

/** A number in a unit, expressed in that unit's SI base. */
export function toBase(n, unit) { return unit ? n * unit.scale + unit.offset : n; }

/** A number in SI base, expressed in a unit. */
export function fromBase(n, unit) { return unit ? (n - unit.offset) / unit.scale : n; }

/**
 * Convert one quantity into another unit. Refuses in words when the two are not the same kind
 * of thing, which is the whole reason units are carried at all.
 * @param {Quantity} q @param {Unit|null} target
 * @returns {Quantity|{ error: string }}
 */
export function convert(q, target) {
  if (!sameDim(q.u, target)) {
    return {
      error: 'I cannot turn ' + (unitLabel(q.u) || 'a plain number') + ' into '
        + (unitLabel(target) || 'a plain number') + ': those measure different things.',
    };
  }
  // Two dimensionless LABELS have no rate between them — % and ppm both measure nothing, and
  // answering 72 ppm for 72 % would be the quiet wrong answer the percentage rule exists to stop.
  const from = unitLabel(q.u);
  const to = unitLabel(target);
  if (isPlain(q.u) && isPlain(target) && from && to && from !== to) {
    return {
      error: 'I cannot turn ' + from + ' into ' + to + ': both are labels on a plain number, not '
        + 'scales. Say fraction(x) for the number as a fraction of one, or percent(x) for it as a '
        + 'percentage.',
    };
  }
  return { n: fromBase(toBase(q.n, q.u), target), u: target };
}
