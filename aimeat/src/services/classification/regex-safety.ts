/**
 * @file src/services/classification/regex-safety.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps a detection rule's regular expression from stopping the node (TARGET-082, the
 *   review of 2026-09-29: a rule pattern ran synchronously on up to 200 kB in the main process, on
 *   the write worker and on the scan request path, so one pattern with a nested repeat hung it).
 *   Two defences, and a caller uses both:
 *
 *   1. unsafeRegexReason(pattern, flags): a conservative static check, run where a policy is
 *      stored (levels.ts validateNodePolicy and validateLayer) and again before a stored rule is
 *      compiled (detect.ts), so a rule stored before the check existed matches nothing instead of
 *      hanging. It refuses three shapes:
 *      - a repeat inside a repeat, such as (a+)+, (a*)* or (\w+\s?)*, unless every pass of the
 *        outer repeat starts with a character that none of the inner repeats can match, which is
 *        what makes (?:\.[a-z0-9-]+)* in the default e-mail rule safe;
 *      - alternatives under a repeat that can start with the same character, such as (a|a)+ or
 *        (\w|\d)+, and an empty alternative under a repeat;
 *      - two repeats of overlapping characters side by side, with only optional parts between
 *        them, such as \d+\d+, .*.* or \w+\s*\w+.
 *      It errs towards refusing: a refused pattern that was safe costs the owner a rewrite, an
 *      accepted pattern that was not costs every write on the node.
 *
 *   2. testWithin(re, text, ms): runs one match with a real time limit. A regular expression in V8
 *      cannot be interrupted from the same thread, but a script run through node:vm with `timeout`
 *      is interrupted by V8's watchdog, and that includes a match in progress (measured
 *      2026-09-29: (a+)+$ on 40 characters stopped at 59 ms with a 50 ms limit; 0.23 ms overhead a
 *      call). This is the backstop for the polynomial shapes the static check lets through: the
 *      default e-mail rule takes 342 ms on 20 000 letters with no @ and 35 s on 200 000, which is
 *      what a base64 image in a JSON value looks like.
 * @structure unsafeRegexReason() · testWithin() · internal: Ranges, Atom, parser, checks
 * @usage
 *   const why = unsafeRegexReason(rule.pattern, rule.flags); if (why) problems.push(why);
 *   const hit = testWithin(re, text, 25);   // true, false, or null when the limit was reached
 * @version-history
 *   v1.0.1 — 2026-09-30 — unsafeRegexReason(): an invalid pattern's reason carries the engine's own
 *     message, and a valid pattern the parser cannot read is logged as a parser gap before it is
 *     refused (aimeat/no-silent-catch, substitutes).
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 review, ReDoS).
 */
import vm from 'node:vm';
import { logger } from '../../utils/logger.js';

// ─── Character sets as code point ranges ────────────────────────────────────────────────────────

type Ranges = Array<[number, number]>;
const MAX_CP = 0x10ffff;

function norm(r: Ranges): Ranges {
  const s = r.filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0]);
  const out: Ranges = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
const union = (a: Ranges, b: Ranges): Ranges => norm([...a, ...b]);
function complement(r: Ranges): Ranges {
  const out: Ranges = [];
  let next = 0;
  for (const [a, b] of norm(r)) {
    if (a > next) out.push([next, a - 1]);
    next = b + 1;
  }
  if (next <= MAX_CP) out.push([next, MAX_CP]);
  return out;
}
function intersects(a: Ranges, b: Ranges): boolean {
  for (const [x1, x2] of a) for (const [y1, y2] of b) if (x1 <= y2 && y1 <= x2) return true;
  return false;
}

const ALL: Ranges = [[0, MAX_CP]];
const DIGIT: Ranges = [[48, 57]];
const WORD: Ranges = [[48, 57], [65, 90], [95, 95], [97, 122]];
const SPACE: Ranges = norm([[9, 13], [32, 32], [160, 160], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]]);
const LINE_ENDS: Ranges = [[10, 10], [13, 13], [0x2028, 0x2029]];

/** Case-insensitive: ASCII letters in both cases, and any non-ASCII as overlapping everything
 *  non-ASCII, because folding outside ASCII is not modelled here (conservative). */
function foldCase(r: Ranges): Ranges {
  const extra: Ranges = [];
  for (const [a, b] of r) {
    const lo = Math.max(a, 65), hi = Math.min(b, 90);
    if (lo <= hi) extra.push([lo + 32, hi + 32]);
    const lo2 = Math.max(a, 97), hi2 = Math.min(b, 122);
    if (lo2 <= hi2) extra.push([lo2 - 32, hi2 - 32]);
    if (b > 127) extra.push([128, MAX_CP]);
  }
  return union(r, extra);
}

// ─── The parsed pattern ─────────────────────────────────────────────────────────────────────────

interface Quant { min: number; max: number }
type Atom =
  | { t: 'set'; set: Ranges; q: Quant }
  | { t: 'group'; alts: Atom[][]; q: Quant; look: boolean }
  | { t: 'ref'; q: Quant }
  | { t: 'zero' };

const ONCE: Quant = { min: 1, max: 1 };

class Parser {
  i = 0;
  constructor(private readonly src: string, private readonly flags: string) {}

  private get ci(): boolean { return this.flags.includes('i'); }
  private peek(o = 0): string { return this.src[this.i + o] ?? ''; }
  private cp(): number {
    const c = this.src.codePointAt(this.i) ?? 0;
    this.i += c > 0xffff && this.flags.includes('u') ? 2 : 1;
    return c;
  }
  private lit(c: number): Ranges { return this.ci ? foldCase([[c, c]]) : [[c, c]]; }

  alts(): Atom[][] {
    const out: Atom[][] = [[]];
    while (this.i < this.src.length && this.peek() !== ')') {
      if (this.peek() === '|') { this.i++; out.push([]); continue; }
      const a = this.atom();
      if (a) out[out.length - 1]!.push(a);
    }
    return out;
  }

  private atom(): Atom | null {
    const c = this.peek();
    let a: Atom;
    if (c === '(') a = this.group();
    else if (c === '[') a = { t: 'set', set: this.klass(), q: ONCE };
    else if (c === '.') { this.i++; a = { t: 'set', set: this.flags.includes('s') ? ALL : complement(LINE_ENDS), q: ONCE }; }
    else if (c === '^' || c === '$') { this.i++; a = { t: 'zero' }; }
    else if (c === '\\') a = this.escape();
    else a = { t: 'set', set: this.lit(this.cp()), q: ONCE };
    const q = this.quant();
    if (q && a.t !== 'zero') a.q = q;
    return a;
  }

  private quant(): Quant | null {
    const c = this.peek();
    let q: Quant | null = null;
    if (c === '*') { this.i++; q = { min: 0, max: Infinity }; }
    else if (c === '+') { this.i++; q = { min: 1, max: Infinity }; }
    else if (c === '?') { this.i++; q = { min: 0, max: 1 }; }
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i));
      if (m) {
        this.i += m[0].length;
        const min = Number(m[1]);
        q = { min, max: m[2] === undefined ? min : m[3] ? Number(m[3]) : Infinity };
      }
    }
    if (q && this.peek() === '?') this.i++;   // lazy: the same search space
    return q;
  }

  private group(): Atom {
    this.i++;   // (
    let look = false;
    if (this.peek() === '?') {
      const rest = this.src.slice(this.i + 1);
      if (rest.startsWith('=') || rest.startsWith('!')) { look = true; this.i += 2; }
      else if (rest.startsWith('<=') || rest.startsWith('<!')) { look = true; this.i += 3; }
      else if (rest.startsWith('<')) this.i = this.src.indexOf('>', this.i) + 1;
      else this.i = this.src.indexOf(':', this.i) + 1;   // (?: and the (?i:) modifiers
    }
    const alts = this.alts();
    this.i++;   // )
    return { t: 'group', alts, q: ONCE, look };
  }

  /** One escape outside a class: a set, a zero-width assertion or a back reference. */
  private escape(): Atom {
    this.i++;   // backslash
    const c = this.peek();
    if (c === 'b' || c === 'B') { this.i++; return { t: 'zero' }; }
    if (/[1-9]/.test(c)) { while (/\d/.test(this.peek())) this.i++; return { t: 'ref', q: ONCE }; }
    if (c === 'k' && this.peek(1) === '<') { this.i = this.src.indexOf('>', this.i) + 1; return { t: 'ref', q: ONCE }; }
    return { t: 'set', set: this.escapeSet(false), q: ONCE };
  }

  /** The set of one escape (the backslash already read). In a class, \b is a backspace. */
  private escapeSet(inClass: boolean): Ranges {
    const c = this.src[this.i++] ?? '';
    switch (c) {
      case 'd': return DIGIT;
      case 'D': return complement(DIGIT);
      case 'w': return this.ci ? foldCase(WORD) : WORD;
      case 'W': return complement(WORD);
      case 's': return SPACE;
      case 'S': return complement(SPACE);
      case 't': return [[9, 9]];
      case 'n': return [[10, 10]];
      case 'v': return [[11, 11]];
      case 'f': return [[12, 12]];
      case 'r': return [[13, 13]];
      case '0': return [[0, 0]];
      case 'b': return inClass ? [[8, 8]] : ALL;
      case 'p': case 'P':
        if (this.peek() === '{') this.i = this.src.indexOf('}', this.i) + 1;
        return ALL;   // a Unicode property: taken as overlapping everything (conservative)
      case 'c': { const x = this.src.charCodeAt(this.i++); return [[x % 32, x % 32]]; }
      case 'x': { const h = parseInt(this.src.slice(this.i, this.i + 2), 16); this.i += 2; return this.lit(h); }
      case 'u': {
        if (this.peek() === '{') {
          const end = this.src.indexOf('}', this.i);
          const h = parseInt(this.src.slice(this.i + 1, end), 16);
          this.i = end + 1;
          return this.lit(h);
        }
        const h = parseInt(this.src.slice(this.i, this.i + 4), 16);
        this.i += 4;
        return this.lit(h);
      }
      default: {
        this.i--;
        return this.lit(this.cp());
      }
    }
  }

  private klass(): Ranges {
    this.i++;   // [
    const negate = this.peek() === '^';
    if (negate) this.i++;
    let set: Ranges = [];
    // In JavaScript a `]` right after `[` closes the class (an empty class), so no special case.
    while (this.i < this.src.length && this.peek() !== ']') {
      const lo = this.classAtom();
      if (this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== '' && lo.length === 1 && lo[0]![0] === lo[0]![1]) {
        this.i++;
        const hi = this.classAtom();
        if (hi.length === 1 && hi[0]![0] === hi[0]![1]) {
          const r: Ranges = [[lo[0]![0], hi[0]![0]]];
          set = union(set, this.ci ? foldCase(r) : r);
          continue;
        }
        set = union(set, union(lo, union(hi, [[45, 45]])));
        continue;
      }
      set = union(set, lo);
    }
    this.i++;   // ]
    return negate ? complement(set) : set;
  }

  private classAtom(): Ranges {
    if (this.peek() === '\\') { this.i++; return this.escapeSet(true); }
    return this.lit(this.cp());
  }
}

// ─── The checks ─────────────────────────────────────────────────────────────────────────────────

const zeroWidth = (a: Atom) => a.t === 'zero' || (a.t === 'group' && a.look);
const quantOf = (a: Atom): Quant => (a.t === 'zero' ? { min: 0, max: 0 } : a.q);

/** Every character the atom may consume anywhere. */
function allOf(a: Atom): Ranges {
  if (a.t === 'set') return a.set;
  if (a.t === 'ref') return ALL;
  if (a.t === 'zero' || a.look) return [];
  return a.alts.flat().reduce<Ranges>((acc, x) => union(acc, allOf(x)), []);
}

function nullable(a: Atom): boolean {
  if (a.t === 'zero' || a.t === 'ref') return true;
  if (a.q.min === 0) return true;
  if (a.t === 'set') return false;
  if (a.look) return true;
  return a.alts.some(seq => seq.every(nullable));
}

/** The characters a sequence may start with: the leading atoms up to the first that cannot be empty. */
function firstOfSeq(seq: Atom[]): Ranges {
  let out: Ranges = [];
  for (const a of seq) {
    if (zeroWidth(a)) continue;
    out = union(out, firstOf(a));
    if (!nullable(a)) return out;
  }
  return ALL;   // the sequence can match nothing, so whatever follows it comes first
}

function firstOf(a: Atom): Ranges {
  if (a.t === 'set') return a.set;
  if (a.t === 'ref') return ALL;
  if (a.t === 'zero' || a.look) return [];
  return a.alts.reduce<Ranges>((acc, seq) => union(acc, firstOfSeq(seq)), []);
}

/** The atoms inside a group, at any depth, whose length varies: the inner repeats. */
function innerVariables(alts: Atom[][], out: Atom[] = []): Atom[] {
  for (const a of alts.flat()) {
    if (a.t === 'zero') continue;
    if (a.t === 'group' && a.look) continue;
    if (a.t === 'ref' || a.q.min !== a.q.max) out.push(a);
    if (a.t === 'group') innerVariables(a.alts, out);
  }
  return out;
}

const NESTED = 'can take exponential time: it repeats something that itself repeats, as (a+)+ or (\\w+\\s?)* do. '
  + 'Start each pass of the outer repeat with a character the inner repeat cannot match, as (?:\\.[a-z0-9-]+)* does, or use a keyword rule.';
const OVERLAP = 'can take exponential time: alternatives under a repeat can start with the same character, as (a|a)+ or (\\w|\\d)+ do. '
  + 'Make each alternative start with a different character, or use a keyword rule.';
const ADJACENT = 'can take a very long time: two repeats of the same characters stand side by side, as \\d+\\d+ or \\w+\\s*\\w+ do. '
  + 'Put a character between them that the first cannot match, or merge them into one repeat.';

function checkGroup(g: Extract<Atom, { t: 'group' }>): string | null {
  if (g.look || g.q.max <= 1) return null;
  // The character each pass must start with, when an alternative starts with one exactly once.
  const heads = g.alts.map(seq => {
    const head = seq.find(a => !zeroWidth(a));
    return head && head.t === 'set' && head.q.min === 1 && head.q.max === 1 ? head.set : null;
  });
  if (g.alts.length > 1) {
    if (heads.some(h => !h)) return OVERLAP;
    for (let i = 0; i < heads.length; i++) {
      for (let j = i + 1; j < heads.length; j++) if (intersects(heads[i]!, heads[j]!)) return OVERLAP;
    }
  }
  const inner = innerVariables(g.alts);
  if (inner.length === 0) return null;
  if (heads.some(h => !h)) return NESTED;
  const starts = heads.reduce<Ranges>((acc, h) => union(acc, h!), []);
  for (const v of inner) {
    if (v.t !== 'set' || intersects(v.set, starts)) return NESTED;
  }
  return null;
}

function checkSeq(seq: Atom[]): string | null {
  let open: Ranges | null = null;
  for (const a of seq) {
    if (zeroWidth(a)) continue;
    const q = quantOf(a);
    if (q.max === Infinity) {
      if (open && intersects(open, firstOf(a))) return ADJACENT;
      open = union(open ?? [], allOf(a));
    } else if (q.min > 0 && !nullable(a)) {
      open = null;   // a part that must match stands between two repeats
    }
  }
  return null;
}

function walk(alts: Atom[][]): string | null {
  for (const seq of alts) {
    const s = checkSeq(seq);
    if (s) return s;
    for (const a of seq) {
      if (a.t !== 'group') continue;
      const g = checkGroup(a) ?? walk(a.alts);
      if (g) return g;
    }
  }
  return null;
}

/** The longest pattern a detection rule may have; levels.ts stores at most the same. */
const MAX_PATTERN = 1000;

/**
 * Why a detection rule's pattern may not run on this node, as a sentence, or null when it may.
 * Conservative: a pattern it cannot read with certainty is refused rather than run.
 */
export function unsafeRegexReason(pattern: string, flags = ''): string | null {
  if (typeof pattern !== 'string' || !pattern) return 'is empty.';
  if (pattern.length > MAX_PATTERN) return `is longer than ${MAX_PATTERN} characters.`;
  if (!/^[imsu]*$/.test(flags)) return 'uses a flag other than i, m, s and u.';
  try {
    new RegExp(pattern, flags);
  } catch (e) {
    // The engine's own words say what is wrong with the pattern, so the person who wrote it can fix it.
    return `is not a valid regular expression (${(e as Error).message}).`;
  }
  let alts: Atom[][];
  try {
    const p = new Parser(pattern, flags);
    alts = p.alts();
    if (p.i < pattern.length) return 'could not be read by the safety check, so it is not run.';
  } catch (e) {
    // The engine accepted the pattern and this parser did not: a gap in the parser, worth a line in
    // the log. The pattern is refused (fail closed), never run.
    logger.warn('classification: the regex safety check could not read a valid pattern', {
      length: pattern.length, flags, error: (e as Error).message,
    });
    return 'could not be read by the safety check, so it is not run.';
  }
  return walk(alts);
}

// ─── A match with a time limit ──────────────────────────────────────────────────────────────────

type Box = { __r?: RegExp; __s?: string };
const MATCH = new vm.Script('__r.lastIndex = 0; __r.test(__s)', { filename: 'classification-rule-match' });
const box: Box = {};
const ctx: vm.Context = vm.createContext(box);
// The first run of the script in a fresh context costs tens of milliseconds (measured 2026-09-29:
// a 33-character IBAN match timed out at 25 ms on the first call). Paid here, at import, so no
// rule's time limit is spent on it.
box.__r = /a/;
box.__s = 'a';
MATCH.runInContext(ctx, { timeout: 5000 });
box.__r = undefined;
box.__s = undefined;

/**
 * One `re.test(text)` that stops after `ms` milliseconds. Answers true or false, or null when the
 * limit was reached before the match finished. Anything else the match throws is rethrown.
 */
export function testWithin(re: RegExp, text: string, ms: number): boolean | null {
  box.__r = re;
  box.__s = text;
  try {
    return MATCH.runInContext(ctx, { timeout: Math.max(1, Math.ceil(ms)) }) === true;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return null;
    throw e;
  } finally {
    box.__r = undefined;
    box.__s = undefined;
  }
}
