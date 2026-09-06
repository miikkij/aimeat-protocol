/**
 * @file living/formula-parse.js
 * @description THE EXPRESSION A PERSON ALREADY KNOWS HOW TO WRITE. A living document's formulas
 *   are spreadsheet formulas — p * v / (r * T), if(t > 30, "liian kuuma", "hyvä"), avg(readings),
 *   clamp(x, 0, 1) — because that is the one formula language a non-programmer has already been
 *   taught, and every hour spent inventing a better one is an hour spent making the document
 *   harder to write.
 *
 *   THE TREE IS MathJSON-SHAPED, and that is a decision rather than a detail. An operator becomes
 *   ["Multiply", "p", "v"], a bare identifier stays a string (it is a symbol: another node's id),
 *   a number stays a number, a string literal becomes { str: "…" } and a boolean stays a boolean.
 *   Nothing downstream has to know this parser exists: the evaluator walks the tree, the TeX
 *   printer walks the same tree, and a later engine that speaks MathJSON reads it without a
 *   translation layer.
 *
 *   A REFUSAL NAMES THE PLACE. parse() never throws: it returns { error, at } with the character
 *   offset, because a formula the AI wrote and a person is now editing needs to say where it
 *   went wrong, not that it did.
 *   A ROW IS A VALUE. A spreadsheet's real power is the COLUMN — one expression written once and
 *   worked out down a thousand rows — so a list is an ordinary value here: range() builds one,
 *   map/fold/scan walk one, index/at/cumsum/where read one back, and every arithmetic and
 *   comparison broadcasts over one. That is why a 24-hour day, a battery simulated hour by hour
 *   and a year of irradiation on a tilted plane are formulas in a record rather than code in an
 *   app. Three of the new names BIND a symbol inside their own body — `x` is the element, `i` its
 *   position, `acc` what is being built — and symbolsOf() knows it, so a document is not asked to
 *   declare a node called x.
 * @structure tokenize · parse(expr) → tree | { error } · symbolsOf(tree) · FUNCTIONS · CONSTANTS
 * @usage
 *   import { parse, symbolsOf } from './formula-parse.js';
 *   parse('t * 9/5 + 32');   // ["Add", ["Multiply", "t", ["Divide", 9, 5]], 32]
 *   symbolsOf(parse('a + b'));  // ['a', 'b']
 *   symbolsOf(parse('map(pv, x * k)'));  // ['pv', 'k'] — x is the element, not a node
 * @version-history
 *   v0.5.0 — 2026-09-06 — ROWS. range · map · fold · scan · cumsum · index · at · where join the
 *     table, along with the trigonometry a physical model needs (sin cos tan asin acos atan atan2
 *     deg rad log10) and `pi` as a constant rather than a node every document has to declare.
 *     symbolsOf() takes the bound names of a map, fold and scan out of the dependency list.
 *   v0.3.0 — 2026-09-05 — fraction() and percent() join the function table: the one explicit
 *     conversion a percentage gets, now that it is a label on a face number rather than a scale.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */

/**
 * @typedef {number|string|boolean|{ str: string }|Array<any>} Tree
 */

/** Function names a formula may call, each mapped to the MathJSON head it becomes. */
export const FUNCTIONS = {
  if: 'If', min: 'Min', max: 'Max', abs: 'Abs', sqrt: 'Sqrt', pow: 'Power',
  log: 'Log', ln: 'Ln', exp: 'Exp', round: 'Round', floor: 'Floor', ceil: 'Ceiling',
  sum: 'Sum', avg: 'Mean', mean: 'Mean', count: 'Count',
  clamp: 'Clamp', convert: 'Convert', text: 'Text', number: 'Number',
  and: 'And', or: 'Or', not: 'Not', first: 'First', last: 'Last',
  // The two doors between a percentage and a fraction of one. They are asked for out loud
  // because a percentage is a LABEL on a face number here, never a hidden factor — units.js
  // carries the rule and why it had to be written down.
  fraction: 'Fraction', percent: 'Percent',
  // ── ROWS ── build one, walk one, read one back.
  range: 'Range', map: 'Map', fold: 'Fold', scan: 'Scan',
  cumsum: 'CumSum', index: 'Index', at: 'At', where: 'Where',
  // ── The trigonometry a physical model is written in. Angles are RADIANS, and deg()/rad() are
  // the two doors, for the same reason fraction()/percent() are: a hidden conversion is a
  // conversion nobody can see.
  sin: 'Sin', cos: 'Cos', tan: 'Tan', asin: 'Asin', acos: 'Acos', atan: 'Atan', atan2: 'Atan2',
  deg: 'Deg', rad: 'Rad', log10: 'Log10',
};

/** The words that are values, not symbols. */
const LITERALS = { true: true, false: false };

/**
 * The named numbers a formula may use without the document declaring a node for them. Each becomes
 * a HEAD of its own rather than the number itself, so the printer can set π as π instead of as
 * 3.141592653589793 — the expression on the screen has to be the one a person would check.
 */
export const CONSTANTS = { pi: 'Pi' };

/**
 * The three functions that BIND a name inside their own body, and which argument that body is.
 * `map(xs, expr)` puts the body third; fold and scan put it fourth, after the accumulator they
 * start from.
 */
export const BINDERS = { Map: 2, Fold: 3, Scan: 3 };

/** What each binder puts in scope for its body: the element, its position, what is being built. */
export const BOUND = { Map: ['x', 'i'], Fold: ['acc', 'x', 'i'], Scan: ['acc', 'x', 'i'] };

const PUNCT = ['<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '^', '&', '(', ')', ',', '<', '>', '='];

/**
 * Break a formula into tokens. A refusal carries the offset so the caller can point at it.
 * @param {string} src
 * @returns {Array<{ t: string, v: any, at: number }>|{ error: string, at: number }}
 */
export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let text = '';
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < src.length) { text += src[j + 1]; j += 2; continue; }
        text += src[j];
        j++;
      }
      if (j >= src.length) return { error: 'a text that never closes', at: i };
      out.push({ t: 'str', v: text, at: i });
      i = j + 1;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (src[k] >= '0' && src[k] <= '9') { j = k; while (j < src.length && src[j] >= '0' && src[j] <= '9') j++; }
      }
      const n = Number(src.slice(i, j));
      if (!Number.isFinite(n)) return { error: 'a number I cannot read: ' + src.slice(i, j), at: i };
      out.push({ t: 'num', v: n, at: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.À-ɏ]/.test(src[j])) j++;
      out.push({ t: 'name', v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    const punct = PUNCT.find((p) => src.slice(i, i + p.length) === p);
    if (punct) { out.push({ t: 'op', v: punct, at: i }); i += punct.length; continue; }
    return { error: 'a character that does not belong in a formula: ' + c, at: i };
  }
  return out;
}

/**
 * Parse a spreadsheet-style formula into a MathJSON-shaped tree.
 *
 * Precedence, loosest first: or · and · not · comparison (= <> < <= > >=) · text join (&) ·
 * plus and minus · times and divide · unary minus · power · call.
 * @param {string} src
 * @returns {Tree|{ error: string, at?: number }}
 */
export function parse(src) {
  const tokens = tokenize(String(src == null ? '' : src));
  if (!Array.isArray(tokens)) return tokens;
  let p = 0;
  let failed = null;

  function fail(message, at) {
    if (!failed) failed = { error: message, at: at == null ? (tokens[p] ? tokens[p].at : String(src).length) : at };
    return null;
  }
  function peek() { return tokens[p]; }
  function isOp(v) { const tk = tokens[p]; return tk && tk.t === 'op' && tk.v === v; }
  function isWord(v) { const tk = tokens[p]; return tk && tk.t === 'name' && tk.v.toLowerCase() === v; }
  function eat(v) { if (isOp(v)) { p++; return true; } return false; }

  function primary() {
    const tk = peek();
    if (!tk) return fail('a formula that stops in the middle');
    if (tk.t === 'num') { p++; return tk.v; }
    if (tk.t === 'str') { p++; return { str: tk.v }; }
    if (eat('(')) {
      const inner = orExpr();
      if (!eat(')')) return fail('a missing )');
      return inner;
    }
    if (eat('-')) { const v = power(); return v == null ? null : ['Negate', v]; }
    if (eat('+')) return power();
    if (tk.t === 'name') {
      const name = tk.v;
      p++;
      const lower = name.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(LITERALS, lower) && !isOp('(')) return LITERALS[lower];
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, lower) && !isOp('(')) return [CONSTANTS[lower]];
      if (isOp('(')) {
        p++;
        const head = FUNCTIONS[lower];
        if (!head) return fail('a function this document does not have: ' + name + '. It knows ' + Object.keys(FUNCTIONS).join(', ') + '.', tk.at);
        const args = [];
        if (!isOp(')')) {
          for (;;) {
            const a = orExpr();
            if (a === null && failed) return null;
            args.push(a);
            if (eat(',')) continue;
            break;
          }
        }
        if (!eat(')')) return fail('a missing ) after ' + name);
        return [head].concat(args);
      }
      return name;
    }
    return fail('something I cannot read here');
  }

  function power() {
    const left = primary();
    if (left === null && failed) return null;
    if (eat('^')) {
      const right = power();
      if (right === null && failed) return null;
      return ['Power', left, right];
    }
    return left;
  }

  function product() {
    let left = power();
    if (left === null && failed) return null;
    while (isOp('*') || isOp('/')) {
      const op = peek().v;
      p++;
      const right = power();
      if (right === null && failed) return null;
      left = [op === '*' ? 'Multiply' : 'Divide', left, right];
    }
    return left;
  }

  function sum() {
    let left = product();
    if (left === null && failed) return null;
    while (isOp('+') || isOp('-')) {
      const op = peek().v;
      p++;
      const right = product();
      if (right === null && failed) return null;
      left = [op === '+' ? 'Add' : 'Subtract', left, right];
    }
    return left;
  }

  function join() {
    let left = sum();
    if (left === null && failed) return null;
    while (eat('&')) {
      const right = sum();
      if (right === null && failed) return null;
      left = ['Concat', left, right];
    }
    return left;
  }

  const COMPARE = { '=': 'Equal', '==': 'Equal', '<>': 'NotEqual', '!=': 'NotEqual', '<': 'Less', '<=': 'LessEqual', '>': 'Greater', '>=': 'GreaterEqual' };

  function compare() {
    let left = join();
    if (left === null && failed) return null;
    while (peek() && peek().t === 'op' && COMPARE[peek().v]) {
      const head = COMPARE[peek().v];
      p++;
      const right = join();
      if (right === null && failed) return null;
      left = [head, left, right];
    }
    return left;
  }

  function notExpr() {
    if (isWord('not') && tokens[p + 1] && !(tokens[p + 1].t === 'op' && tokens[p + 1].v === '(')) {
      p++;
      const v = notExpr();
      return v === null && failed ? null : ['Not', v];
    }
    return compare();
  }

  function andExpr() {
    let left = notExpr();
    if (left === null && failed) return null;
    while (isWord('and')) {
      p++;
      const right = notExpr();
      if (right === null && failed) return null;
      left = ['And', left, right];
    }
    return left;
  }

  function orExpr() {
    let left = andExpr();
    if (left === null && failed) return null;
    while (isWord('or')) {
      p++;
      const right = andExpr();
      if (right === null && failed) return null;
      left = ['Or', left, right];
    }
    return left;
  }

  const tree = orExpr();
  if (failed) return failed;
  if (p < tokens.length) return { error: 'something left over after the formula ended', at: tokens[p].at };
  if (tree === null) return { error: 'an empty formula', at: 0 };
  return tree;
}

/**
 * Every symbol a tree reads — the node ids this formula depends on, in first-seen order.
 *
 * A BOUND NAME IS NOT A DEPENDENCY. Inside the body of a map, fold or scan, `x` is the element,
 * `i` its position and `acc` what is being built, so a document writing map(pv, x * k) depends on
 * pv and k and not on a node called x. Outside such a body those three are ordinary names again,
 * and a document that really does have a node called x is shadowed inside the body the way a
 * bound name shadows anywhere else.
 * @param {Tree} tree @param {string[]} [into] @param {string[]} [bound]  names the body may not read out
 * @returns {string[]}
 */
export function symbolsOf(tree, into, bound) {
  const out = into || [];
  const hidden = bound || [];
  if (typeof tree === 'string') {
    if (hidden.indexOf(tree.split('.')[0]) < 0 && out.indexOf(tree) < 0) out.push(tree);
    return out;
  }
  if (Array.isArray(tree)) {
    const bodyAt = BINDERS[String(tree[0])];
    for (let i = 1; i < tree.length; i++) {
      symbolsOf(tree[i], out, bodyAt === i ? hidden.concat(BOUND[String(tree[0])]) : hidden);
    }
  }
  return out;
}
