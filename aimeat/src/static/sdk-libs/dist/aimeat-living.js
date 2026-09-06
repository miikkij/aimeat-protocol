// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/living/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-living.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value2) {
    const ns = namespace();
    ns[key] = value2;
    return ns;
  }

  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/living/units.js
  var PREFIXES = {
    T: 1e12,
    G: 1e9,
    M: 1e6,
    k: 1e3,
    h: 100,
    da: 10,
    d: 0.1,
    c: 0.01,
    m: 1e-3,
    "µ": 1e-6,
    u: 1e-6,
    n: 1e-9,
    p: 1e-12
  };
  var PREFIXABLE = ["m", "g", "s", "A", "K", "mol", "cd", "N", "Pa", "J", "W", "V", "L", "Hz", "Ω", "ohm", "F", "C", "B", "Wh", "bar"];
  function d(dim) {
    return dim || {};
  }
  function u(dim, scale, offset) {
    return { dim: d(dim), scale: scale == null ? 1 : scale, offset: offset || 0, label: "" };
  }
  var UNITS = {
    // dimensionless — a LABEL on a face number, never a hidden factor. See the percentage rule at
    // the head of this file: the scale is 1 so 72 % computes as 72, and fraction()/percent() are
    // the two doors between a percentage and a fraction of one.
    "": u({}, 1),
    "%": u({}, 1),
    "ppm": u({}, 1),
    "x": u({}, 1),
    // length
    m: u({ m: 1 }),
    km: u({ m: 1 }, 1e3),
    cm: u({ m: 1 }, 0.01),
    mm: u({ m: 1 }, 1e-3),
    mi: u({ m: 1 }, 1609.344),
    ft: u({ m: 1 }, 0.3048),
    in: u({ m: 1 }, 0.0254),
    // area and volume, WRITTEN THE WAY A PERSON WRITES THEM. "m^2" parses because the power syntax
    // is general, and it is then what a sheet PRINTS, since a unit's label is the text it was
    // declared with — a caret in the middle of a designed page. The superscript spellings are the
    // same units under another name, so a record may say either.
    "m²": u({ m: 2 }),
    "m³": u({ m: 3 }),
    // mass
    kg: u({ kg: 1 }),
    g: u({ kg: 1 }, 1e-3),
    mg: u({ kg: 1 }, 1e-6),
    t: u({ kg: 1 }, 1e3),
    lb: u({ kg: 1 }, 0.45359237),
    // time
    s: u({ s: 1 }),
    ms: u({ s: 1 }, 1e-3),
    min: u({ s: 1 }, 60),
    h: u({ s: 1 }, 3600),
    day: u({ s: 1 }, 86400),
    a: u({ s: 1 }, 31557600),
    // current, amount, luminous
    A: u({ A: 1 }),
    mol: u({ mol: 1 }),
    cd: u({ cd: 1 }),
    // temperature — K is the scale; the other two carry an offset and are handled apart
    K: u({ K: 1 }),
    "°C": u({ K: 1 }, 1, 273.15),
    degC: u({ K: 1 }, 1, 273.15),
    "°F": u({ K: 1 }, 5 / 9, 255.3722222222222),
    degF: u({ K: 1 }, 5 / 9, 255.3722222222222),
    // derived
    Hz: u({ s: -1 }),
    N: u({ kg: 1, m: 1, s: -2 }),
    Pa: u({ kg: 1, m: -1, s: -2 }),
    bar: u({ kg: 1, m: -1, s: -2 }, 1e5),
    atm: u({ kg: 1, m: -1, s: -2 }, 101325),
    J: u({ kg: 1, m: 2, s: -2 }),
    Wh: u({ kg: 1, m: 2, s: -2 }, 3600),
    W: u({ kg: 1, m: 2, s: -3 }),
    C: u({ A: 1, s: 1 }),
    V: u({ kg: 1, m: 2, s: -3, A: -1 }),
    "Ω": u({ kg: 1, m: 2, s: -3, A: -2 }),
    ohm: u({ kg: 1, m: 2, s: -3, A: -2 }),
    F: u({ kg: -1, m: -2, s: 4, A: 2 }),
    L: u({ m: 3 }, 1e-3),
    B: u({ B: 1 }),
    bit: u({ B: 1 }, 0.125)
  };
  var CURRENCIES = ["EUR", "USD", "GBP", "SEK", "NOK", "DKK", "JPY", "CHF", "PLN"];
  for (const code of CURRENCIES) UNITS[code] = u({ ["cur:" + code]: 1 });
  UNITS.c = u({ "cur:EUR": 1 }, 0.01);
  UNITS.snt = u({ "cur:EUR": 1 }, 0.01);
  function lookup(name) {
    if (Object.prototype.hasOwnProperty.call(UNITS, name)) return UNITS[name];
    for (const p of Object.keys(PREFIXES)) {
      if (name.length > p.length && name.slice(0, p.length) === p) {
        const rest = name.slice(p.length);
        if (PREFIXABLE.indexOf(rest) >= 0 && Object.prototype.hasOwnProperty.call(UNITS, rest)) {
          const base = UNITS[rest];
          if (base.offset) return null;
          return { dim: base.dim, scale: base.scale * PREFIXES[p], offset: 0, label: "" };
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
      if (next === 0) delete out[k];
      else out[k] = next;
    }
    return out;
  }
  function mulUnits(a, b) {
    if (!a) return b;
    if (!b) return a;
    return { dim: mulDim(a.dim, b.dim, 1), scale: a.scale * b.scale, offset: 0, label: "" };
  }
  function divUnits(a, b) {
    const left = a || { dim: {}, scale: 1, offset: 0, label: "" };
    if (!b) return a;
    return { dim: mulDim(left.dim, b.dim, -1), scale: left.scale / b.scale, offset: 0, label: "" };
  }
  function powUnit(a, k) {
    if (!a) return null;
    const out = {};
    for (const key of Object.keys(a.dim)) out[key] = a.dim[key] * k;
    return { dim: out, scale: Math.pow(a.scale, k), offset: 0, label: "" };
  }
  function isAffine(unit) {
    return !!unit && unit.offset !== 0;
  }
  function isPlain(unit) {
    return !unit || Object.keys(unit.dim).length === 0;
  }
  function sameDim(a, b) {
    const da = a ? a.dim : {};
    const db = b ? b.dim : {};
    const keys = /* @__PURE__ */ new Set([...Object.keys(da), ...Object.keys(db)]);
    for (const k of keys) if ((da[k] || 0) !== (db[k] || 0)) return false;
    return true;
  }
  function parseUnit(text) {
    if (text == null) return null;
    const src = String(text).trim();
    if (src === "") return null;
    const direct = lookup(src);
    if (direct) return { dim: direct.dim, scale: direct.scale, offset: direct.offset, label: src };
    let i = 0;
    const s = src.replace(/·/g, "*").replace(/\s+/g, "");
    let bad = null;
    function factor() {
      if (s[i] === "(") {
        i++;
        const inner = expr();
        if (s[i] !== ")") {
          bad = bad || "a missing )";
          return null;
        }
        i++;
        return inner;
      }
      const start = i;
      while (i < s.length && !"*/^()".includes(s[i])) i++;
      const name = s.slice(start, i);
      if (!name) {
        bad = bad || "an empty unit name";
        return null;
      }
      const found = lookup(name);
      if (!found) {
        bad = bad || '"' + name + '"';
        return null;
      }
      if (found.offset) {
        bad = bad || name + " (a temperature with an offset cannot be part of a compound unit)";
        return null;
      }
      let out2 = { dim: found.dim, scale: found.scale, offset: 0, label: "" };
      if (s[i] === "^") {
        i++;
        const from = i;
        if (s[i] === "-") i++;
        while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
        const k = Number(s.slice(from, i));
        if (!Number.isFinite(k)) {
          bad = bad || "a power that is not a whole number";
          return null;
        }
        out2 = powUnit(out2, k);
      }
      return out2;
    }
    function expr() {
      let left = factor();
      while (left && (s[i] === "*" || s[i] === "/")) {
        const op = s[i];
        i++;
        const right = factor();
        if (!right) return null;
        left = op === "*" ? mulUnits(left, right) : divUnits(left, right);
      }
      return left;
    }
    const out = expr();
    if (!out || bad || i < s.length) {
      return { error: "I do not know the unit " + (bad || '"' + src + '"') + "." };
    }
    out.label = src;
    return out;
  }
  function unitLabel(unit) {
    if (!unit) return "";
    if (unit.label) return unit.label;
    const parts = [];
    for (const k of Object.keys(unit.dim).sort()) {
      const e = unit.dim[k];
      const name = k.indexOf("cur:") === 0 ? k.slice(4) : k;
      parts.push(e === 1 ? name : name + "^" + e);
    }
    return parts.join("·");
  }
  function toBase(n, unit) {
    return unit ? n * unit.scale + unit.offset : n;
  }
  function fromBase(n, unit) {
    return unit ? (n - unit.offset) / unit.scale : n;
  }
  function convert(q, target) {
    if (!sameDim(q.u, target)) {
      return {
        error: "I cannot turn " + (unitLabel(q.u) || "a plain number") + " into " + (unitLabel(target) || "a plain number") + ": those measure different things."
      };
    }
    const from = unitLabel(q.u);
    const to = unitLabel(target);
    if (isPlain(q.u) && isPlain(target) && from && to && from !== to) {
      return {
        error: "I cannot turn " + from + " into " + to + ": both are labels on a plain number, not scales. Say fraction(x) for the number as a fraction of one, or percent(x) for it as a percentage."
      };
    }
    return { n: fromBase(toBase(q.n, q.u), target), u: target };
  }

  // src/static/sdk-libs/living/formula-parse.js
  var FUNCTIONS = {
    if: "If",
    min: "Min",
    max: "Max",
    abs: "Abs",
    sqrt: "Sqrt",
    pow: "Power",
    log: "Log",
    ln: "Ln",
    exp: "Exp",
    round: "Round",
    floor: "Floor",
    ceil: "Ceiling",
    sum: "Sum",
    avg: "Mean",
    mean: "Mean",
    count: "Count",
    clamp: "Clamp",
    convert: "Convert",
    text: "Text",
    number: "Number",
    and: "And",
    or: "Or",
    not: "Not",
    first: "First",
    last: "Last",
    // The two doors between a percentage and a fraction of one. They are asked for out loud
    // because a percentage is a LABEL on a face number here, never a hidden factor — units.js
    // carries the rule and why it had to be written down.
    fraction: "Fraction",
    percent: "Percent",
    // ── ROWS ── build one, walk one, read one back.
    range: "Range",
    map: "Map",
    fold: "Fold",
    scan: "Scan",
    cumsum: "CumSum",
    index: "Index",
    at: "At",
    where: "Where",
    // ── The trigonometry a physical model is written in. Angles are RADIANS, and deg()/rad() are
    // the two doors, for the same reason fraction()/percent() are: a hidden conversion is a
    // conversion nobody can see.
    sin: "Sin",
    cos: "Cos",
    tan: "Tan",
    asin: "Asin",
    acos: "Acos",
    atan: "Atan",
    atan2: "Atan2",
    deg: "Deg",
    rad: "Rad",
    log10: "Log10"
  };
  var LITERALS = { true: true, false: false };
  var CONSTANTS = { pi: "Pi" };
  var BINDERS = { Map: 2, Fold: 3, Scan: 3 };
  var BOUND = { Map: ["x", "i"], Fold: ["acc", "x", "i"], Scan: ["acc", "x", "i"] };
  var PUNCT = ["<=", ">=", "<>", "!=", "==", "+", "-", "*", "/", "^", "&", "(", ")", ",", "<", ">", "="];
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === " " || c === "	" || c === "\n" || c === "\r") {
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const quote = c;
        let j = i + 1;
        let text = "";
        while (j < src.length && src[j] !== quote) {
          if (src[j] === "\\" && j + 1 < src.length) {
            text += src[j + 1];
            j += 2;
            continue;
          }
          text += src[j];
          j++;
        }
        if (j >= src.length) return { error: "a text that never closes", at: i };
        out.push({ t: "str", v: text, at: i });
        i = j + 1;
        continue;
      }
      if (c >= "0" && c <= "9" || c === "." && src[i + 1] >= "0" && src[i + 1] <= "9") {
        let j = i;
        while (j < src.length && (src[j] >= "0" && src[j] <= "9" || src[j] === ".")) j++;
        if (src[j] === "e" || src[j] === "E") {
          let k = j + 1;
          if (src[k] === "+" || src[k] === "-") k++;
          if (src[k] >= "0" && src[k] <= "9") {
            j = k;
            while (j < src.length && src[j] >= "0" && src[j] <= "9") j++;
          }
        }
        const n = Number(src.slice(i, j));
        if (!Number.isFinite(n)) return { error: "a number I cannot read: " + src.slice(i, j), at: i };
        out.push({ t: "num", v: n, at: i });
        i = j;
        continue;
      }
      if (/[A-Za-z_À-ɏ]/.test(c)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_.À-ɏ]/.test(src[j])) j++;
        out.push({ t: "name", v: src.slice(i, j), at: i });
        i = j;
        continue;
      }
      const punct = PUNCT.find((p) => src.slice(i, i + p.length) === p);
      if (punct) {
        out.push({ t: "op", v: punct, at: i });
        i += punct.length;
        continue;
      }
      return { error: "a character that does not belong in a formula: " + c, at: i };
    }
    return out;
  }
  function parse(src) {
    const tokens = tokenize(String(src == null ? "" : src));
    if (!Array.isArray(tokens)) return tokens;
    let p = 0;
    let failed = null;
    function fail(message, at) {
      if (!failed) failed = { error: message, at: at == null ? tokens[p] ? tokens[p].at : String(src).length : at };
      return null;
    }
    function peek() {
      return tokens[p];
    }
    function isOp(v) {
      const tk = tokens[p];
      return tk && tk.t === "op" && tk.v === v;
    }
    function isWord(v) {
      const tk = tokens[p];
      return tk && tk.t === "name" && tk.v.toLowerCase() === v;
    }
    function eat(v) {
      if (isOp(v)) {
        p++;
        return true;
      }
      return false;
    }
    function primary() {
      const tk = peek();
      if (!tk) return fail("a formula that stops in the middle");
      if (tk.t === "num") {
        p++;
        return tk.v;
      }
      if (tk.t === "str") {
        p++;
        return { str: tk.v };
      }
      if (eat("(")) {
        const inner = orExpr();
        if (!eat(")")) return fail("a missing )");
        return inner;
      }
      if (eat("-")) {
        const v = power();
        return v == null ? null : ["Negate", v];
      }
      if (eat("+")) return power();
      if (tk.t === "name") {
        const name = tk.v;
        p++;
        const lower = name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(LITERALS, lower) && !isOp("(")) return LITERALS[lower];
        if (Object.prototype.hasOwnProperty.call(CONSTANTS, lower) && !isOp("(")) return [CONSTANTS[lower]];
        if (isOp("(")) {
          p++;
          const head = FUNCTIONS[lower];
          if (!head) return fail("a function this document does not have: " + name + ". It knows " + Object.keys(FUNCTIONS).join(", ") + ".", tk.at);
          const args = [];
          if (!isOp(")")) {
            for (; ; ) {
              const a = orExpr();
              if (a === null && failed) return null;
              args.push(a);
              if (eat(",")) continue;
              break;
            }
          }
          if (!eat(")")) return fail("a missing ) after " + name);
          return [head].concat(args);
        }
        return name;
      }
      return fail("something I cannot read here");
    }
    function power() {
      const left = primary();
      if (left === null && failed) return null;
      if (eat("^")) {
        const right = power();
        if (right === null && failed) return null;
        return ["Power", left, right];
      }
      return left;
    }
    function product() {
      let left = power();
      if (left === null && failed) return null;
      while (isOp("*") || isOp("/")) {
        const op = peek().v;
        p++;
        const right = power();
        if (right === null && failed) return null;
        left = [op === "*" ? "Multiply" : "Divide", left, right];
      }
      return left;
    }
    function sum() {
      let left = product();
      if (left === null && failed) return null;
      while (isOp("+") || isOp("-")) {
        const op = peek().v;
        p++;
        const right = product();
        if (right === null && failed) return null;
        left = [op === "+" ? "Add" : "Subtract", left, right];
      }
      return left;
    }
    function join() {
      let left = sum();
      if (left === null && failed) return null;
      while (eat("&")) {
        const right = sum();
        if (right === null && failed) return null;
        left = ["Concat", left, right];
      }
      return left;
    }
    const COMPARE = { "=": "Equal", "==": "Equal", "<>": "NotEqual", "!=": "NotEqual", "<": "Less", "<=": "LessEqual", ">": "Greater", ">=": "GreaterEqual" };
    function compare() {
      let left = join();
      if (left === null && failed) return null;
      while (peek() && peek().t === "op" && COMPARE[peek().v]) {
        const head = COMPARE[peek().v];
        p++;
        const right = join();
        if (right === null && failed) return null;
        left = [head, left, right];
      }
      return left;
    }
    function notExpr() {
      if (isWord("not") && tokens[p + 1] && !(tokens[p + 1].t === "op" && tokens[p + 1].v === "(")) {
        p++;
        const v = notExpr();
        return v === null && failed ? null : ["Not", v];
      }
      return compare();
    }
    function andExpr() {
      let left = notExpr();
      if (left === null && failed) return null;
      while (isWord("and")) {
        p++;
        const right = notExpr();
        if (right === null && failed) return null;
        left = ["And", left, right];
      }
      return left;
    }
    function orExpr() {
      let left = andExpr();
      if (left === null && failed) return null;
      while (isWord("or")) {
        p++;
        const right = andExpr();
        if (right === null && failed) return null;
        left = ["Or", left, right];
      }
      return left;
    }
    const tree = orExpr();
    if (failed) return failed;
    if (p < tokens.length) return { error: "something left over after the formula ended", at: tokens[p].at };
    if (tree === null) return { error: "an empty formula", at: 0 };
    return tree;
  }
  function symbolsOf(tree, into, bound) {
    const out = into || [];
    const hidden = bound || [];
    if (typeof tree === "string") {
      if (hidden.indexOf(tree.split(".")[0]) < 0 && out.indexOf(tree) < 0) out.push(tree);
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

  // src/static/sdk-libs/living/formula-arrays.js
  var MAX_ROW = 2e4;
  function isList(v) {
    return Array.isArray(v);
  }
  function isErr(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && typeof v.error === "string";
  }
  function broadcast(args, apply) {
    let n = -1;
    for (const a of args) {
      if (!isList(a)) continue;
      if (n < 0) {
        n = a.length;
        continue;
      }
      if (a.length !== n) {
        return {
          error: "These lists are not the same length: one has " + n + " values and another has " + a.length + ". Working an expression out down a row needs them to line up."
        };
      }
    }
    if (n < 0) return apply(args);
    const out = [];
    for (let k = 0; k < n; k++) {
      const one = [];
      for (const a of args) one.push(isList(a) ? a[k] : a);
      const got = apply(one);
      if (isErr(got)) return { error: got.error + " That is at position " + k + " of the list." };
      out.push(got);
    }
    return out;
  }
  function rangeOf(args) {
    const one = args.length === 1;
    const from = one ? 0 : args[0];
    const to = one ? args[0] : args[1];
    const step = args.length > 2 ? args[2] : 1;
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) {
      return { error: "range() counts with plain numbers, and one of the three it was given is not one." };
    }
    if (step === 0) return { error: "range() was given a step of 0, and would never reach the end." };
    const count = Math.ceil((to - from) / step);
    if (count <= 0) return [];
    if (count > MAX_ROW) {
      return {
        error: "range() was asked for " + count + " values, and one row in this document holds at most " + MAX_ROW + "."
      };
    }
    const out = [];
    for (let k = 0; k < count; k++) out.push(from + k * step);
    return out;
  }
  function indexAt(list, i) {
    if (!Number.isFinite(i)) return { error: "index() needs a position that is a number." };
    if (!Number.isInteger(i)) {
      return { error: "index() reads a whole position, and got " + i + ". To read BETWEEN two positions, say at()." };
    }
    if (i < 0 || i >= list.length) {
      return {
        error: "This list holds " + list.length + " values, counted from 0, so there is nothing at position " + i + "."
      };
    }
    return list[i];
  }
  function readAt(list, t, blend) {
    if (!list.length) return { error: "at() was given an empty list." };
    if (!Number.isFinite(t)) return { error: "at() needs a position that is a number." };
    if (t <= 0) return list[0];
    const lo = Math.floor(t);
    if (lo >= list.length - 1) return list[list.length - 1];
    const f = t - lo;
    if (f === 0) return list[lo];
    return blend(list[lo], list[lo + 1], f);
  }
  function cumsumOf(list, add) {
    const out = [];
    let acc = null;
    for (let k = 0; k < list.length; k++) {
      acc = k === 0 ? list[0] : add(acc, list[k]);
      if (isErr(acc)) return { error: acc.error + " That is at position " + k + " of the list." };
      out.push(acc);
    }
    return out;
  }
  function childScope(parent, names, values) {
    return {
      get(symbol) {
        const whole = String(symbol);
        const head = whole.split(".")[0];
        const k = names.indexOf(head);
        if (k < 0) return parent.get(symbol);
        let at = values[k];
        if (whole === head) return at;
        for (const part of whole.slice(head.length + 1).split(".")) {
          if (at == null || typeof at !== "object") return void 0;
          at = at[part];
        }
        return at;
      }
    };
  }

  // src/static/sdk-libs/living/formula-eval.js
  var PERCENT = (
    /** @type {any} */
    parseUnit("%")
  );
  function isError(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && typeof v.error === "string";
  }
  function isQuantity(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && typeof v.n === "number" && "u" in v;
  }
  function num(v, what) {
    if (typeof v === "number") return { n: v, u: null };
    if (typeof v === "boolean") return { n: v ? 1 : 0, u: null };
    if (isQuantity(v)) return v;
    if (isError(v)) return v;
    return { error: "I need a number for " + (what || "this") + ", and got " + describeValue(v) + "." };
  }
  function describeValue(v) {
    if (v == null) return "nothing";
    if (Array.isArray(v)) return "a list";
    if (typeof v === "string") return 'the text "' + v + '"';
    if (typeof v === "boolean") return v ? "yes" : "no";
    return "something else";
  }
  function tidy(q) {
    if (!q.u) return q.n;
    if (Object.keys(q.u.dim).length === 0 && !q.u.offset) {
      return q.u.scale === 1 ? q.n : q.n * q.u.scale;
    }
    return q;
  }
  function asText(v) {
    if (v == null) return "";
    if (isError(v)) return v.error;
    if (isQuantity(v)) return trimNumber(v.n) + (unitLabel(v.u) ? " " + unitLabel(v.u) : "");
    if (typeof v === "number") return trimNumber(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (Array.isArray(v)) return v.map(asText).join(", ");
    return String(v);
  }
  function trimNumber(n) {
    if (!Number.isFinite(n)) return String(n);
    if (Number.isInteger(n)) return String(n);
    const rounded = Math.round(n * 1e10) / 1e10;
    return String(rounded);
  }
  function asNumber(v) {
    if (typeof v === "number") return v;
    if (isQuantity(v)) return v.n;
    if (typeof v === "boolean") return v ? 1 : 0;
    return NaN;
  }
  function truth(v) {
    if (isError(v)) return v;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (isQuantity(v)) return v.n !== 0;
    if (typeof v === "string") return v !== "";
    if (Array.isArray(v)) return v.length > 0;
    return !!v;
  }
  function addLike(a, b, sign, head) {
    const qa = num(a, head.toLowerCase());
    if (isError(qa)) return qa;
    const qb = num(b, head.toLowerCase());
    if (isError(qb)) return qb;
    if (!qa.u && !qb.u) return qa.n + sign * qb.n;
    if (!qb.u) return tidy({ n: qa.n + sign * qb.n, u: qa.u });
    if (!qa.u) return tidy({ n: qa.n + sign * qb.n, u: qb.u });
    if (!sameDim(qa.u, qb.u)) {
      return { error: "I cannot " + (sign > 0 ? "add " : "subtract ") + unitLabel(qb.u) + " " + (sign > 0 ? "to " : "from ") + unitLabel(qa.u) + ": those measure different things." };
    }
    if (isAffine(qa.u) || isAffine(qb.u)) {
      if (unitLabel(qa.u) !== unitLabel(qb.u)) {
        return { error: "I cannot put " + unitLabel(qa.u) + " and " + unitLabel(qb.u) + ' together: two temperature scales with different zeros need a conversion first, so say convert(x, "' + unitLabel(qa.u) + '").' };
      }
      return tidy({ n: qa.n + sign * qb.n, u: qa.u });
    }
    const moved = convert(qb, qa.u);
    if (isError(moved)) return moved;
    return tidy({ n: qa.n + sign * moved.n, u: qa.u });
  }
  function mulLike(a, b, divide) {
    const qa = num(a, divide ? "a division" : "a multiplication");
    if (isError(qa)) return qa;
    const qb = num(b, divide ? "a division" : "a multiplication");
    if (isError(qb)) return qb;
    const n = divide ? qa.n / qb.n : qa.n * qb.n;
    if (isAffine(qa.u) || isAffine(qb.u)) return n;
    const u2 = divide ? divUnits(qa.u, qb.u) : mulUnits(qa.u, qb.u);
    return tidy({ n, u: u2 });
  }
  function compareLike(a, b, test, head) {
    if (isError(a)) return a;
    if (isError(b)) return b;
    if (typeof a === "string" || typeof b === "string") {
      const left2 = typeof a === "string" ? a : asText(a);
      const right2 = typeof b === "string" ? b : asText(b);
      return test(left2 < right2 ? -1 : left2 > right2 ? 1 : 0);
    }
    const qa = num(a, head.toLowerCase());
    if (isError(qa)) return qa;
    const qb = num(b, head.toLowerCase());
    if (isError(qb)) return qb;
    if (qa.u && qb.u && !sameDim(qa.u, qb.u)) {
      return { error: "I cannot compare " + unitLabel(qa.u) + " with " + unitLabel(qb.u) + ": those measure different things." };
    }
    const bothCarry = !!qa.u && !!qb.u;
    const left = bothCarry ? toBase(qa.n, qa.u) : qa.n;
    const right = bothCarry ? toBase(qb.n, qb.u) : qb.n;
    const diff = Math.abs(left - right) < 1e-12 ? 0 : left < right ? -1 : 1;
    return test(diff);
  }
  function spread(args) {
    const out = [];
    for (const a of args) {
      if (isError(a)) return a;
      if (Array.isArray(a)) {
        for (const x of a) out.push(x);
      } else out.push(a);
    }
    return out;
  }
  function aggregate(args, fold, name) {
    const items = spread(args);
    if (isError(items)) return items;
    if (!items.length) return { error: name + " needs something to work on, and the list was empty." };
    const quantities = [];
    for (const x of items) {
      const q = num(x, name);
      if (isError(q)) return q;
      quantities.push(q);
    }
    const unit = quantities[0].u;
    const values = [];
    for (const q of quantities) {
      if (unit && q.u && !sameDim(unit, q.u)) {
        return { error: name + " cannot mix " + unitLabel(unit) + " and " + unitLabel(q.u) + ": those measure different things." };
      }
      const moved = unit && q.u && unitLabel(q.u) !== unitLabel(unit) ? convert(q, unit) : q;
      if (isError(moved)) return moved;
      values.push(moved.n);
    }
    return tidy({ n: fold(values), u: unit });
  }
  function pairPick(a, b, wantMax) {
    const name = wantMax ? "max" : "min";
    const qa = num(a, name);
    if (isError(qa)) return qa;
    const qb = num(b, name);
    if (isError(qb)) return qb;
    if (qa.u && qb.u && !sameDim(qa.u, qb.u)) {
      return { error: "I cannot take the " + name + " of " + unitLabel(qa.u) + " and " + unitLabel(qb.u) + ": those measure different things." };
    }
    const moved = qa.u && qb.u && unitLabel(qb.u) !== unitLabel(qa.u) ? convert(qb, qa.u) : qb;
    if (isError(moved)) return moved;
    const takeB = wantMax ? moved.n > qa.n : moved.n < qa.n;
    const unit = qa.u || moved.u;
    return tidy({ n: takeB ? moved.n : qa.n, u: unit });
  }
  var MATH1 = {
    Sin: Math.sin,
    Cos: Math.cos,
    Tan: Math.tan,
    Atan: Math.atan,
    Deg: (x) => x * 180 / Math.PI,
    Rad: (x) => x * Math.PI / 180,
    Log10: null,
    Asin: null,
    Acos: null
  };
  var ELEMENTWISE = {
    Add: 1,
    Subtract: 1,
    Negate: 1,
    Multiply: 1,
    Divide: 1,
    Power: 1,
    Equal: 1,
    NotEqual: 1,
    Less: 1,
    LessEqual: 1,
    Greater: 1,
    GreaterEqual: 1,
    Not: 1,
    Concat: 1,
    Text: 1,
    Number: 1,
    Where: 1,
    Abs: 1,
    Sqrt: 1,
    Exp: 1,
    Ln: 1,
    Log: 1,
    Log10: 1,
    Round: 1,
    Floor: 1,
    Ceiling: 1,
    Clamp: 1,
    Convert: 1,
    Fraction: 1,
    Percent: 1,
    Min: 1,
    Max: 1,
    Sin: 1,
    Cos: 1,
    Tan: 1,
    Asin: 1,
    Acos: 1,
    Atan: 1,
    Atan2: 1,
    Deg: 1,
    Rad: 1
  };
  function addValues(a, b) {
    return addLike(a, b, 1, "Add");
  }
  function blendValues(a, b, f) {
    const gap = addLike(b, a, -1, "Subtract");
    if (isError(gap)) return gap;
    const part = mulLike(gap, f, false);
    if (isError(part)) return part;
    return addLike(a, part, 1, "Add");
  }
  function evaluate(tree, scope) {
    if (tree == null) return { error: "an empty formula" };
    if (typeof tree === "number" || typeof tree === "boolean") return tree;
    if (typeof tree === "string") {
      const got = scope.get(tree);
      if (got === void 0) return { error: 'This document has nothing called "' + tree + '".' };
      return got;
    }
    if (!Array.isArray(tree)) {
      if (typeof tree.str === "string") return tree.str;
      if (isError(tree)) return tree;
      return { error: "something in the formula I cannot work out" };
    }
    const head = tree[0];
    const arg = (i) => evaluate(tree[i], scope);
    if (head === "Map" || head === "Fold" || head === "Scan") {
      const row = evaluate(tree[1], scope);
      if (isError(row)) return row;
      if (!isList(row)) {
        return { error: head.toLowerCase() + "() walks a list, and was given " + describeValue(row) + "." };
      }
      const body = tree[head === "Map" ? 2 : 3];
      const names = BOUND[head];
      if (head === "Map") {
        const out = [];
        for (let k = 0; k < row.length; k++) {
          const got = evaluate(body, childScope(scope, names, [row[k], k]));
          if (isError(got)) return { error: got.error + " That is at position " + k + " of the list." };
          out.push(got);
        }
        return out;
      }
      let acc = evaluate(tree[2], scope);
      if (isError(acc)) return acc;
      const trail = [acc];
      for (let k = 0; k < row.length; k++) {
        acc = evaluate(body, childScope(scope, names, [acc, row[k], k]));
        if (isError(acc)) return { error: acc.error + " That is at position " + k + " of the list." };
        trail.push(acc);
      }
      return head === "Scan" ? trail : acc;
    }
    if (head === "If") {
      const cond = truth(arg(1));
      if (isError(cond)) return cond;
      if (cond) return tree.length > 2 ? arg(2) : true;
      return tree.length > 3 ? arg(3) : false;
    }
    if (head === "And" || head === "Or") {
      const want = head === "And";
      for (let i = 1; i < tree.length; i++) {
        const v = truth(arg(i));
        if (isError(v)) return v;
        if (v !== want) return !want;
      }
      return want;
    }
    const args = [];
    for (let i = 1; i < tree.length; i++) {
      const v = arg(i);
      if (isError(v)) return v;
      args.push(v);
    }
    switch (head) {
      case "Range": {
        const plain = [];
        for (const one of args) {
          const q = num(one, "range");
          if (isError(q)) return q;
          plain.push(q.n);
        }
        return rangeOf(plain);
      }
      case "Index": {
        if (!isList(args[0])) return { error: "index() reads a list, and was given " + describeValue(args[0]) + "." };
        const at = num(args[1], "index");
        if (isError(at)) return at;
        return indexAt(args[0], at.n);
      }
      case "At": {
        if (!isList(args[0])) return { error: "at() reads a list, and was given " + describeValue(args[0]) + "." };
        const at = num(args[1], "at");
        if (isError(at)) return at;
        return readAt(args[0], at.n, blendValues);
      }
      case "CumSum": {
        if (!isList(args[0])) return { error: "cumsum() adds along a list, and was given " + describeValue(args[0]) + "." };
        return cumsumOf(args[0], addValues);
      }
      // One argument is the aggregate min and max this language has always had; two or more is the
      // element-wise pair, which falls through to the scalar table below.
      case "Min":
        if (args.length === 1) return aggregate(args, (v) => Math.min.apply(null, v), "min");
        break;
      case "Max":
        if (args.length === 1) return aggregate(args, (v) => Math.max.apply(null, v), "max");
        break;
      case "Sum":
        return aggregate(args, (v) => v.reduce((x, y) => x + y, 0), "sum");
      case "Mean":
        return aggregate(args, (v) => v.reduce((x, y) => x + y, 0) / v.length, "avg");
      case "Count": {
        const items = spread(args);
        return isError(items) ? items : items.length;
      }
      case "First": {
        const items = spread(args);
        return isError(items) ? items : items.length ? items[0] : { error: "first() was given an empty list." };
      }
      case "Last": {
        const items = spread(args);
        return isError(items) ? items : items.length ? items[items.length - 1] : { error: "last() was given an empty list." };
      }
      default:
        break;
    }
    if (ELEMENTWISE[head] && args.some(isList)) {
      return broadcast(args, function(one) {
        return applyScalar(head, one);
      });
    }
    return applyScalar(head, args);
  }
  function applyScalar(head, args) {
    const a = args[0];
    const b = args[1];
    if (MATH1[head] || head === "Asin" || head === "Acos" || head === "Log10") {
      const q = num(a, head.toLowerCase());
      if (isError(q)) return q;
      if (head === "Asin" || head === "Acos") {
        if (q.n < -1 || q.n > 1) {
          return { error: "There is no " + head.toLowerCase() + " of " + trimNumber(q.n) + ": it takes a number between -1 and 1." };
        }
        return head === "Asin" ? Math.asin(q.n) : Math.acos(q.n);
      }
      if (head === "Log10") {
        if (q.n <= 0) return { error: "There is no logarithm of " + trimNumber(q.n) + "." };
        return Math.log10(q.n);
      }
      return MATH1[head](q.n);
    }
    switch (head) {
      case "Pi":
        return Math.PI;
      case "Atan2": {
        const qy = num(a, "atan2");
        if (isError(qy)) return qy;
        const qx = num(b, "atan2");
        if (isError(qx)) return qx;
        return Math.atan2(qy.n, qx.n);
      }
      // where() is the element-wise door if(): it takes all three sides as values, so a row of
      // conditions picks from a row of answers. if() cannot do that — it works one side out and
      // leaves the other alone, which is what a lazy branch is for.
      case "Where": {
        const cond = truth(a);
        if (isError(cond)) return cond;
        return cond ? b : args[2];
      }
      case "Min":
      case "Max": {
        let best = args[0];
        for (let i = 1; i < args.length; i++) {
          best = pairPick(best, args[i], head === "Max");
          if (isError(best)) return best;
        }
        return best;
      }
      case "Add":
        return addLike(a, b, 1, "Add");
      case "Subtract":
        return addLike(a, b, -1, "Subtract");
      case "Negate": {
        const q = num(a, "a minus sign");
        return isError(q) ? q : tidy({ n: -q.n, u: q.u });
      }
      case "Multiply":
        return mulLike(a, b, false);
      case "Divide":
        return mulLike(a, b, true);
      case "Power": {
        const qa = num(a, "a power");
        if (isError(qa)) return qa;
        const qb = num(b, "a power");
        if (isError(qb)) return qb;
        if (qb.u) return { error: "A power has to be a plain number, and this one is in " + unitLabel(qb.u) + "." };
        if (qa.u && !Number.isInteger(qb.n)) return { error: "I can only raise " + unitLabel(qa.u) + " to a whole power." };
        return tidy({ n: Math.pow(qa.n, qb.n), u: qa.u ? powUnit(qa.u, qb.n) : null });
      }
      case "Not": {
        const v = truth(a);
        return isError(v) ? v : !v;
      }
      case "Equal":
        return compareLike(a, b, (d2) => d2 === 0, "Equal");
      case "NotEqual":
        return compareLike(a, b, (d2) => d2 !== 0, "NotEqual");
      case "Less":
        return compareLike(a, b, (d2) => d2 < 0, "Less");
      case "LessEqual":
        return compareLike(a, b, (d2) => d2 <= 0, "LessEqual");
      case "Greater":
        return compareLike(a, b, (d2) => d2 > 0, "Greater");
      case "GreaterEqual":
        return compareLike(a, b, (d2) => d2 >= 0, "GreaterEqual");
      case "Concat":
        return asText(a) + asText(b);
      case "Text":
        return asText(a);
      case "Number": {
        const q = num(a, "number()");
        return isError(q) ? q : q.n;
      }
      case "Abs": {
        const q = num(a, "abs");
        return isError(q) ? q : tidy({ n: Math.abs(q.n), u: q.u });
      }
      case "Sqrt": {
        const q = num(a, "sqrt");
        if (isError(q)) return q;
        if (q.n < 0) return { error: "There is no square root of " + trimNumber(q.n) + "." };
        return tidy({ n: Math.sqrt(q.n), u: null });
      }
      case "Exp": {
        const q = num(a, "exp");
        return isError(q) ? q : Math.exp(q.n);
      }
      case "Ln":
      case "Log": {
        const q = num(a, "log");
        if (isError(q)) return q;
        if (q.n <= 0) return { error: "There is no logarithm of " + trimNumber(q.n) + "." };
        if (head === "Ln" || args.length < 2) return Math.log(q.n) / (head === "Log" && args.length < 2 ? Math.LN10 : 1);
        const base = num(b, "log");
        if (isError(base)) return base;
        return Math.log(q.n) / Math.log(base.n);
      }
      case "Round":
      case "Floor":
      case "Ceiling": {
        const q = num(a, head.toLowerCase());
        if (isError(q)) return q;
        const places = args.length > 1 ? Math.trunc(asNumber(b)) : 0;
        const f = Math.pow(10, places);
        const fn = head === "Round" ? Math.round : head === "Floor" ? Math.floor : Math.ceil;
        return tidy({ n: fn(q.n * f) / f, u: q.u });
      }
      case "Clamp": {
        const q = num(a, "clamp");
        if (isError(q)) return q;
        const lo = num(b, "clamp");
        const hi = num(args[2], "clamp");
        if (isError(lo)) return lo;
        if (isError(hi)) return hi;
        return tidy({ n: Math.min(Math.max(q.n, lo.n), hi.n), u: q.u });
      }
      case "Convert": {
        const q = num(a, "convert");
        if (isError(q)) return q;
        const target = parseUnit(typeof b === "string" ? b : asText(b));
        if (isError(target)) return target;
        const moved = convert(q, target);
        return isError(moved) ? moved : tidy(moved);
      }
      // THE TWO DOORS OF THE PERCENTAGE RULE. A percentage is a label on a face number here, so
      // nothing rescales it behind the author's back; when they DO want the fraction of one, they
      // say so, and when they want a fraction written as a percentage, they say that.
      case "Fraction": {
        const q = num(a, "fraction");
        if (isError(q)) return q;
        if (q.u && !isPlain(q.u)) {
          return { error: "fraction() takes a percentage or a plain number, and this one is in " + unitLabel(q.u) + "." };
        }
        return q.n / 100;
      }
      case "Percent": {
        const q = num(a, "percent");
        if (isError(q)) return q;
        if (q.u && !isPlain(q.u)) {
          return { error: "percent() takes a fraction of one or a plain number, and this one is in " + unitLabel(q.u) + "." };
        }
        if (unitLabel(q.u) === "%") {
          return { error: "This is already a percentage. percent() turns a fraction of one into one, so pass the plain number." };
        }
        return { n: q.n * 100, u: PERCENT };
      }
      default:
        return { error: "a function this document does not have: " + head };
    }
  }

  // src/static/sdk-libs/living/format.js
  var FORMATS = ["unit", "plain", "int", "percent", "upper", "lower", "text", "<digits>"];
  var PLACES = ["after", "before", "none"];
  function parseFormat(spec) {
    if (spec == null || spec === "") return null;
    if (typeof spec === "number") {
      return Number.isFinite(spec) ? { decimals: Math.max(0, Math.trunc(spec)) } : null;
    }
    if (typeof spec === "string") {
      const f = spec.trim().toLowerCase();
      if (f === "" || f === "text") return null;
      if (/^\d+$/.test(f)) return { decimals: Number(f) };
      if (f === "unit") return { place: "after" };
      if (f === "plain") return { place: "none" };
      if (f === "int") return { decimals: 0 };
      if (f === "percent") return { style: "percent", maxDecimals: 1 };
      if (f === "upper" || f === "lower") return { word: f };
      return { unknown: spec, place: "after" };
    }
    if (typeof spec !== "object" || Array.isArray(spec)) return { unknown: String(spec), place: "after" };
    const out = {};
    if (typeof spec.decimals === "number" && Number.isFinite(spec.decimals)) out.decimals = Math.max(0, Math.trunc(spec.decimals));
    if (typeof spec.maxDecimals === "number" && Number.isFinite(spec.maxDecimals)) out.maxDecimals = Math.max(0, Math.trunc(spec.maxDecimals));
    if (spec.group === true) out.group = true;
    if (typeof spec.locale === "string" && spec.locale) out.locale = spec.locale;
    if (spec.style === "percent" || spec.style === "currency" || spec.style === "decimal") out.style = spec.style;
    if (typeof spec.currency === "string" && spec.currency) out.currency = spec.currency;
    if (typeof spec.unit === "string" && PLACES.indexOf(spec.unit) >= 0) out.place = spec.unit;
    if (typeof spec.prefix === "string") out.prefix = spec.prefix;
    if (typeof spec.suffix === "string") out.suffix = spec.suffix;
    if (spec.style === "currency" && !out.currency) return { unknown: "a currency format with no currency code" };
    return out;
  }
  function formatError(spec) {
    const f = parseFormat(spec);
    if (!f || !f.unknown) return null;
    return 'a format I do not know, "' + String(f.unknown) + '". It knows ' + FORMATS.join(", ") + ", or an object with decimals, maxDecimals, group, locale, style, currency, unit, prefix and suffix";
  }
  function needsIntl(f) {
    return f.group === true || f.locale != null || f.style === "currency";
  }
  function localeOf(f, lang) {
    if (f.locale === "auto") return lang ? String(lang) : void 0;
    return f.locale || void 0;
  }
  function formatNumber(n, spec, lang) {
    const f = parseFormat(spec) || {};
    if (!Number.isFinite(n)) return String(n);
    const scaled = f.style === "percent" ? n * 100 : n;
    const tail = f.style === "percent" ? " %" : "";
    let body;
    if (needsIntl(f)) {
      const opts = { useGrouping: f.group === true };
      if (f.decimals != null) {
        opts.minimumFractionDigits = f.decimals;
        opts.maximumFractionDigits = f.decimals;
      } else if (f.maxDecimals != null) {
        opts.minimumFractionDigits = 0;
        opts.maximumFractionDigits = f.maxDecimals;
      }
      if (f.style === "currency") {
        opts.style = "currency";
        opts.currency = f.currency;
      }
      try {
        body = new Intl.NumberFormat(localeOf(f, lang), opts).format(scaled);
      } catch {
        body = trimNumber(scaled);
      }
    } else if (f.decimals != null) {
      body = scaled.toFixed(f.decimals);
    } else if (f.maxDecimals != null) {
      const step = Math.pow(10, f.maxDecimals);
      body = trimNumber(Math.round(scaled * step) / step);
    } else {
      body = trimNumber(scaled);
    }
    return (f.prefix || "") + body + tail + (f.suffix || "");
  }
  function formatParts(value2, spec, defaultPlace, lang) {
    const f = parseFormat(spec);
    const fallback = PLACES.indexOf(String(defaultPlace)) >= 0 ? String(defaultPlace) : "none";
    if (isError(value2)) {
      return { number: value2.error, unit: "", place: "none", text: value2.error, refused: true };
    }
    if (f && f.word) {
      const cased = f.word === "upper" ? asText(value2).toUpperCase() : asText(value2).toLowerCase();
      return { number: cased, unit: "", place: "none", text: cased, refused: false };
    }
    if (Array.isArray(value2)) {
      const one = (x) => formatParts(x, spec, defaultPlace, lang).text;
      const body = value2.length <= 5 ? value2.map(one).join(", ") : value2.slice(0, 3).map(one).join(", ") + " … " + one(value2[value2.length - 1]);
      const text = body + (value2.length > 5 ? "  (" + value2.length + ")" : "");
      return { number: text, unit: "", place: "none", text, refused: false };
    }
    if (isQuantity(value2) || typeof value2 === "number") {
      const n = isQuantity(value2) ? value2.n : value2;
      const unit = isQuantity(value2) ? unitLabel(value2.u) : "";
      const number = formatNumber(n, spec, lang);
      const place = f && f.place ? f.place : fallback;
      const text = !unit || place === "none" ? number : place === "before" ? unit + " " + number : number + " " + unit;
      return { number, unit, place, text, refused: false };
    }
    const words2 = asText(value2);
    return { number: words2, unit: "", place: "none", text: words2, refused: false };
  }
  function formatValue(value2, spec, lang) {
    return formatParts(value2, spec, void 0, lang).text;
  }

  // src/static/sdk-libs/living/nodes/value.js
  function wrapValue(raw, unit) {
    if (raw == null) return unit ? { n: 0, u: unit } : 0;
    if (typeof raw === "number") return unit ? { n: raw, u: unit } : raw;
    if (Array.isArray(raw)) return unit ? raw.map((x) => wrapValue(x, unit)) : raw;
    if (typeof raw === "boolean" || typeof raw === "string") return raw;
    if (typeof raw === "object" && typeof raw.n === "number") return raw;
    return raw;
  }
  var value = {
    id: "value",
    settable: true,
    /** A value stands on nothing: it is where the graph starts. */
    dependsOn() {
      return [];
    },
    /** Read the unit once and seed the store, so a rebuild does not forget where the slider was. */
    prepare(node2, ctx) {
      const errors = [];
      const unit = parseUnit(node2.unit);
      if (isError(unit)) errors.push(unit.error);
      ctx.compiled.unit = isError(unit) ? null : unit;
      const badFormat = formatError(node2.format);
      if (badFormat) errors.push(badFormat);
      if (!ctx.state.values.has(ctx.id)) {
        ctx.state.values.set(ctx.id, wrapValue(node2.value, ctx.compiled.unit));
      }
      return errors;
    },
    evaluate(node2, ctx) {
      return ctx.state.values.get(ctx.id);
    },
    /**
     * What a person, a control or a machine's action is allowed to put here: the number is kept
     * inside min and max when the node declared them, and the unit is the node's own — a slider
     * reports 31, not 31 of whatever it thought the unit was.
     */
    coerce(node2, ctx, raw) {
      let v = raw;
      if (v != null && typeof v === "object" && typeof v.n === "number") v = v.n;
      if (typeof v === "number") {
        if (typeof node2.min === "number") v = Math.max(node2.min, v);
        if (typeof node2.max === "number") v = Math.min(node2.max, v);
        return wrapValue(v, ctx.compiled.unit);
      }
      if (typeof node2.value === "number" && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
        return this.coerce(node2, ctx, Number(v));
      }
      return v;
    }
  };

  // src/static/sdk-libs/living/tex.js
  var RANK = {
    Or: 1,
    And: 2,
    Not: 3,
    Equal: 4,
    NotEqual: 4,
    Less: 4,
    LessEqual: 4,
    Greater: 4,
    GreaterEqual: 4,
    Concat: 5,
    Add: 6,
    Subtract: 6,
    Multiply: 7,
    Divide: 7,
    Negate: 8,
    Power: 9
  };
  var RELATION = {
    Equal: "=",
    NotEqual: "\\ne",
    Less: "<",
    LessEqual: "\\le",
    Greater: ">",
    GreaterEqual: "\\ge"
  };
  var OPERATORS = {
    Min: "min",
    Max: "max",
    Mean: "avg",
    Count: "count",
    Clamp: "clamp",
    Convert: "convert",
    Text: "text",
    Number: "number",
    Round: "round",
    Floor: "floor",
    Ceiling: "ceil",
    First: "first",
    Last: "last",
    CumSum: "cumsum"
  };
  var MACROS = {
    Sin: "\\sin",
    Cos: "\\cos",
    Tan: "\\tan",
    Asin: "\\arcsin",
    Acos: "\\arccos",
    Atan: "\\arctan",
    Exp: "\\exp",
    Ln: "\\ln",
    Log: "\\log",
    Log10: "\\log_{10}",
    Deg: "\\deg"
  };
  function escapeText(s) {
    return String(s).replace(/([\\{}$&#^_%~])/g, "\\$1");
  }
  function texName(name) {
    const parts = String(name).split(".");
    const head = parts[0];
    const rest = parts.slice(1);
    const base = head.length === 1 ? escapeText(head) : "\\mathrm{" + escapeText(head) + "}";
    return rest.length ? base + "_{" + escapeText(rest.join(".")) + "}" : base;
  }
  function numberTex(n) {
    if (!Number.isFinite(n)) return "\\text{?}";
    return String(n);
  }
  function wrap(inner, childRank, parentRank) {
    return childRank < parentRank ? "\\left(" + inner + "\\right)" : inner;
  }
  function toTex(tree, parentRank) {
    const outer = parentRank || 0;
    if (tree == null) return "";
    if (typeof tree === "number") return numberTex(tree);
    if (typeof tree === "boolean") return "\\text{" + (tree ? "true" : "false") + "}";
    if (typeof tree === "string") return texName(tree);
    if (!Array.isArray(tree)) {
      if (typeof tree.str === "string") return "\\text{“" + escapeText(tree.str) + "”}";
      return "";
    }
    const head = tree[0];
    const rank = RANK[head] || 10;
    const at = (i) => toTex(tree[i], rank);
    switch (head) {
      case "Add":
        return wrap(at(1) + " + " + at(2), rank, outer);
      case "Subtract":
        return wrap(at(1) + " - " + at(2), rank, outer);
      case "Negate":
        return wrap("-" + at(1), rank, outer);
      case "Multiply":
        return wrap(at(1) + " \\cdot " + at(2), rank, outer);
      case "Divide":
        return "\\frac{" + toTex(tree[1], 0) + "}{" + toTex(tree[2], 0) + "}";
      case "Power":
        return toTex(tree[1], rank + 1) + "^{" + toTex(tree[2], 0) + "}";
      case "Sqrt":
        return "\\sqrt{" + toTex(tree[1], 0) + "}";
      case "Abs":
        return "\\left|" + toTex(tree[1], 0) + "\\right|";
      case "Concat":
        return wrap(at(1) + " \\mathbin{\\&} " + at(2), rank, outer);
      case "Not":
        return wrap("\\lnot " + at(1), rank, outer);
      case "And":
        return wrap(tree.slice(1).map((t) => toTex(t, rank)).join(" \\land "), rank, outer);
      case "Or":
        return wrap(tree.slice(1).map((t) => toTex(t, rank)).join(" \\lor "), rank, outer);
      case "If": {
        const then = toTex(tree[2], 0);
        const other = tree.length > 3 ? toTex(tree[3], 0) : "";
        return "\\begin{cases} " + then + " & " + toTex(tree[1], 0) + " \\\\ " + other + " & \\text{otherwise} \\end{cases}";
      }
      // ── THE ROW, SET AS A ROW. A sigma is a sigma, a map is the bracketed set-builder mathematics
      // already writes, and a position is a subscript. The alternative — \operatorname{index}(pv, i)
      // — is the source code printed in a serif face, which teaches a reader nothing they could not
      // read in the formula box above it.
      case "Pi":
        return "\\pi";
      case "Sum": {
        if (tree.length === 2) return wrap("\\sum " + toTex(tree[1], 10), 10, outer);
        return "\\sum\\left(" + tree.slice(1).map((t) => toTex(t, 0)).join(",\\; ") + "\\right)";
      }
      case "Index":
        return toTex(tree[1], 10) + "_{" + toTex(tree[2], 0) + "}";
      case "At":
        return toTex(tree[1], 10) + "\\!\\left(" + toTex(tree[2], 0) + "\\right)";
      case "Range": {
        const from = tree.length > 2 ? toTex(tree[1], 0) : "0";
        const to = toTex(tree[tree.length > 2 ? 2 : 1], 0);
        const step = tree.length > 3 ? "_{\\,\\Delta " + toTex(tree[3], 0) + "}" : "";
        return "\\left[" + from + " \\ldots " + to + "\\right)" + step;
      }
      case "Map":
        return "\\left[\\, " + toTex(tree[2], 0) + " \\;\\middle|\\; x \\in " + toTex(tree[1], 0) + " \\,\\right]";
      case "Fold":
      case "Scan": {
        const name = head === "Fold" ? "fold" : "scan";
        return "\\operatorname{" + name + "}_{x \\in " + toTex(tree[1], 0) + "}\\left(\\mathrm{acc}_{0} = " + toTex(tree[2], 0) + ",\\; " + toTex(tree[3], 0) + "\\right)";
      }
      case "Where": {
        return "\\begin{cases} " + toTex(tree[2], 0) + " & " + toTex(tree[1], 0) + " \\\\ " + toTex(tree[3], 0) + " & \\text{otherwise} \\end{cases}";
      }
      default: {
        if (RELATION[head]) return wrap(at(1) + " " + RELATION[head] + " " + at(2), rank, outer);
        const args = tree.slice(1).map((t) => toTex(t, 0)).join(",\\; ");
        if (MACROS[head]) return MACROS[head] + "\\left(" + args + "\\right)";
        const name = OPERATORS[head] || String(head).toLowerCase();
        return "\\operatorname{" + escapeText(name) + "}\\left(" + args + "\\right)";
      }
    }
  }

  // src/static/sdk-libs/living/nodes/formula.js
  function wear(out, unit) {
    if (Array.isArray(out)) {
      const row = [];
      for (const one of out) {
        const got = wear(one, unit);
        if (isError(got)) return got;
        row.push(got);
      }
      return row;
    }
    if (isQuantity(out)) return convert(out, unit);
    if (typeof out === "number") return { n: out, u: unit };
    return out;
  }
  var formula = {
    id: "formula",
    /** Every name the expression reads. A name this document does not have is caught in validate. */
    dependsOn(node2, ctx) {
      const tree = ctx.compiled.tree;
      return tree ? symbolsOf(tree).map((s) => s.split(".")[0]) : [];
    },
    /** Parse the expression and the unit ONCE — a formula is re-evaluated on every move. */
    prepare(node2, ctx) {
      const errors = [];
      const tree = parse(node2.expr);
      if (isError(tree)) {
        errors.push("the formula " + String(node2.expr) + " has " + tree.error);
        ctx.compiled.tree = null;
      } else {
        ctx.compiled.tree = tree;
        ctx.compiled.tex = toTex(tree);
      }
      const unit = parseUnit(node2.unit);
      if (isError(unit)) errors.push(unit.error);
      ctx.compiled.unit = isError(unit) ? null : unit;
      const badFormat = formatError(node2.format);
      if (badFormat) errors.push(badFormat);
      return errors;
    },
    evaluate(node2, ctx) {
      if (!ctx.compiled.tree) return { error: "This formula could not be read." };
      const out = evaluate(ctx.compiled.tree, ctx.scope);
      if (isError(out) || !ctx.compiled.unit) return out;
      return wear(out, ctx.compiled.unit);
    },
    /** The second output: the expression, set. */
    fields(node2, ctx) {
      return { tex: ctx.compiled.tex || "" };
    }
  };

  // src/static/sdk-libs/living/nodes/control.js
  var CONTROL_KINDS = ["slider", "toggle", "pick", "number", "text"];
  var control = {
    id: "control",
    /** A control READS its target so it can show where the value is now. */
    dependsOn(node2) {
      return node2.target ? [String(node2.target)] : [];
    },
    prepare(node2, ctx) {
      const errors = [];
      const kind = String(node2.kind || "slider");
      if (CONTROL_KINDS.indexOf(kind) < 0) {
        errors.push('a control of kind "' + kind + '"; this document has ' + CONTROL_KINDS.join(", "));
      }
      if (!node2.target) errors.push("a control with no target to move");
      if (kind === "pick" && !Array.isArray(node2.options)) {
        errors.push("a pick control with no options to pick from");
      }
      ctx.compiled.kind = kind;
      return errors;
    },
    /** A control's own output is its target's value: the control IS that quantity, seen. */
    evaluate(node2, ctx) {
      return node2.target ? ctx.scope.get(String(node2.target)) : void 0;
    }
  };

  // src/static/sdk-libs/living/nodes/binding.js
  var binding = {
    id: "binding",
    dependsOn(node2) {
      return node2.from ? [String(node2.from)] : [];
    },
    prepare(node2, ctx) {
      const errors = [];
      if (!node2.block) errors.push("a binding with no block to write to");
      if (!node2.prop) errors.push("a binding with no prop to write");
      if (!node2.from) errors.push("a binding with no node to read");
      ctx.compiled.path = String(node2.prop || "").split(".").filter(Boolean);
      return errors;
    },
    evaluate(node2, ctx) {
      return node2.from ? ctx.scope.get(String(node2.from)) : void 0;
    }
  };
  function unboundBlocks(surface, blockIds) {
    if (!surface || typeof surface.blocks !== "function") return [];
    const mounted = /* @__PURE__ */ new Map();
    for (const b of surface.blocks()) mounted.set(String(b.id), b);
    const out = [];
    for (const id of blockIds) {
      const block = mounted.get(String(id));
      if (block && !block.bound) out.push({ id: block.id, component: block.component });
    }
    return out;
  }
  function setPath(into, path, v) {
    if (!path.length) return;
    let at = into;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (at[key] == null || typeof at[key] !== "object") at[key] = /^\d+$/.test(path[i + 1]) ? [] : {};
      at = at[key];
    }
    at[path[path.length - 1]] = v;
  }

  // src/static/sdk-libs/living/text.js
  function formatValue2(value2, format, lang) {
    return formatValue(value2, format, lang);
  }
  function splitTag(body) {
    const bar = body.lastIndexOf("|");
    if (bar < 0) return { expr: body.trim(), format: null };
    const before = body.slice(0, bar);
    const quotes = (before.match(/"/g) || []).length + (before.match(/'/g) || []).length;
    if (quotes % 2 === 1) return { expr: body.trim(), format: null };
    return { expr: before.trim(), format: body.slice(bar + 1).trim() };
  }
  function parseTemplate(src) {
    const text = String(src == null ? "" : src);
    const root = [];
    const stack = [{ parts: root, branch: null }];
    let i = 0;
    function push(part) {
      stack[stack.length - 1].parts.push(part);
    }
    while (i < text.length) {
      const open = text.indexOf("{{", i);
      if (open < 0) {
        if (i < text.length) push({ kind: "text", text: text.slice(i) });
        break;
      }
      if (open > i) push({ kind: "text", text: text.slice(i, open) });
      const close = text.indexOf("}}", open);
      if (close < 0) return { error: "A tag opens with {{ and never closes." };
      const body = text.slice(open + 2, close);
      i = close + 2;
      const trimmed = body.trim();
      const lower = trimmed.toLowerCase();
      if (lower === "end") {
        if (stack.length === 1) return { error: "An {{ end }} with no {{ if }} in front of it." };
        stack.pop();
        continue;
      }
      if (lower === "else") {
        const top = stack[stack.length - 1];
        if (!top.branch) return { error: "An {{ else }} with no {{ if }} in front of it." };
        top.parts = top.branch.other;
        continue;
      }
      if (lower.indexOf("if ") === 0) {
        const tree2 = parse(trimmed.slice(3));
        if (isError(tree2)) return { error: "The condition " + trimmed.slice(3).trim() + " has " + tree2.error + "." };
        const part = { kind: "if", tree: tree2, then: [], other: [], source: trimmed.slice(3).trim() };
        push(part);
        stack.push({ parts: part.then, branch: part });
        continue;
      }
      const { expr, format } = splitTag(body);
      if (!expr) return { error: "An empty {{ }} tag." };
      const tree = parse(expr);
      if (isError(tree)) return { error: "The tag " + expr + " has " + tree.error + "." };
      push({ kind: "value", tree, format, source: expr });
    }
    if (stack.length > 1) return { error: "An {{ if }} that never reaches its {{ end }}." };
    return root;
  }
  function renderTemplate(parts, scope, lang) {
    if (!Array.isArray(parts)) return parts && parts.error ? parts.error : "";
    let out = "";
    for (const part of parts) {
      if (part.kind === "text") {
        out += part.text;
        continue;
      }
      if (part.kind === "value") {
        out += formatValue2(evaluate(part.tree, scope), part.format, lang);
        continue;
      }
      if (part.kind === "if") {
        const v = evaluate(part.tree, scope);
        if (isError(v)) {
          out += v.error;
          continue;
        }
        const yes = typeof v === "boolean" ? v : isQuantity(v) ? v.n !== 0 : typeof v === "number" ? v !== 0 : typeof v === "string" ? v !== "" : !!v;
        out += renderTemplate(yes ? part.then : part.other, scope, lang);
      }
    }
    return out;
  }
  function symbolsOfTemplate(parts, into) {
    const out = into || [];
    if (!Array.isArray(parts)) return out;
    for (const part of parts) {
      if (part.kind === "value" || part.kind === "if") symbolsOf(part.tree, out);
      if (part.kind === "if") {
        symbolsOfTemplate(part.then, out);
        symbolsOfTemplate(part.other, out);
      }
    }
    return out;
  }

  // src/static/sdk-libs/living/i18n.js
  var LANG_KEY = /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})?$/;
  var TEXT_KEYS = [
    "title",
    "sub",
    "hint",
    "caption",
    "label",
    "text",
    "summary",
    "note",
    "placeholder",
    "emptyTitle",
    "emptyHint",
    "legend",
    "heading",
    "subtitle",
    "description",
    "alt"
  ];
  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function pageLanguage() {
    try {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (ns && ns.atelier && ns.atelier.i18n && typeof ns.atelier.i18n.lang === "function") {
        const l = ns.atelier.i18n.lang();
        if (l) return String(l);
      }
    } catch {
    }
    try {
      const l = document.documentElement.getAttribute("lang");
      if (l) return String(l);
    } catch {
    }
    try {
      const stored = localStorage.getItem("aimeat-lang");
      if (stored) return String(stored);
    } catch {
    }
    try {
      return String(navigator.language || "en");
    } catch {
      return "en";
    }
  }
  function preference(doc, override) {
    const out = [];
    const add = (l) => {
      if (l && out.indexOf(String(l)) < 0) out.push(String(l));
    };
    add(override || pageLanguage());
    add(doc && doc.lang);
    return out;
  }
  function pickLang(map, wanted) {
    const keys = Object.keys(map || {});
    if (!keys.length) return null;
    for (const want of wanted || []) {
      if (!want) continue;
      const w = String(want).toLowerCase();
      const base = w.split("-")[0];
      for (const k of keys) if (k.toLowerCase() === w) return { lang: k, text: map[k] };
      for (const k of keys) if (k.toLowerCase() === base) return { lang: k, text: map[k] };
      for (const k of keys) if (k.toLowerCase().split("-")[0] === base) return { lang: k, text: map[k] };
    }
    return { lang: keys[0], text: map[keys[0]] };
  }
  function textOf(v, wanted) {
    if (v == null || typeof v === "string") return v;
    if (!isPlainObject(v)) return v;
    const got = pickLang(v, wanted);
    return got ? got.text : "";
  }
  function langKeysOf(v) {
    if (!isPlainObject(v)) return [];
    return Object.keys(v).filter((k) => LANG_KEY.test(k));
  }
  function langMapError(v) {
    if (v == null || typeof v === "string") return null;
    if (typeof v === "number" || typeof v === "boolean") return null;
    if (!isPlainObject(v)) return "is neither a line of text nor a language map";
    const keys = Object.keys(v);
    if (!keys.length) return "is an empty language map — it carries no language at all";
    const bad = keys.filter((k) => !LANG_KEY.test(k));
    if (bad.length === keys.length) {
      return "is a language map with no language in it (" + bad.join(", ") + '); a key is a language tag such as "fi" or "en"';
    }
    if (bad.length) {
      return 'is a language map carrying "' + bad.join('", "') + '", which is not a language tag such as "fi" or "en"';
    }
    const notText = keys.filter((k) => typeof v[k] !== "string");
    if (notText.length) {
      return "is a language map whose " + notText.map((k) => '"' + k + '"').join(" and ") + " is not a line of text";
    }
    return null;
  }
  function localizeProps(props, wanted) {
    if (Array.isArray(props)) return props.map((p) => localizeProps(p, wanted));
    if (!isPlainObject(props)) return props;
    const out = {};
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (TEXT_KEYS.indexOf(key) >= 0 && isPlainObject(v)) {
        out[key] = textOf(v, wanted);
        continue;
      }
      out[key] = isPlainObject(v) || Array.isArray(v) ? localizeProps(v, wanted) : v;
    }
    return out;
  }
  function hasLangMap(v) {
    if (Array.isArray(v)) return v.some(hasLangMap);
    if (!isPlainObject(v)) return false;
    for (const key of Object.keys(v)) {
      const at = v[key];
      if (TEXT_KEYS.indexOf(key) >= 0 && isPlainObject(at)) return true;
      if ((isPlainObject(at) || Array.isArray(at)) && hasLangMap(at)) return true;
    }
    return false;
  }
  function localizeLayout(layout, wanted) {
    if (!layout || !Array.isArray(layout.blocks)) return layout;
    return Object.assign({}, layout, {
      blocks: layout.blocks.map(function(block) {
        if (!block || !block.props) return block;
        return Object.assign({}, block, { props: localizeProps(block.props, wanted) });
      })
    });
  }
  function onLanguageChange(cb) {
    const stops = [];
    try {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (ns && ns.atelier && ns.atelier.i18n && typeof ns.atelier.i18n.onChange === "function") {
        stops.push(ns.atelier.i18n.onChange(function() {
          cb();
        }));
      }
    } catch {
    }
    const onEvent = function() {
      cb();
    };
    try {
      window.addEventListener("aimeat-lang-change", onEvent);
      stops.push(function() {
        window.removeEventListener("aimeat-lang-change", onEvent);
      });
    } catch {
    }
    return function() {
      for (const stop of stops) {
        try {
          stop();
        } catch {
        }
      }
    };
  }

  // src/static/sdk-libs/living/nodes/text-node.js
  var textNode = {
    id: "text",
    dependsOn(node2, ctx) {
      return symbolsOfTemplate(ctx.compiled.parts).map((s) => s.split(".")[0]);
    },
    prepare(node2, ctx) {
      const langs = ctx.langs ? ctx.langs() : [];
      const parts = parseTemplate(textOf(node2.template, langs));
      ctx.compiled.lang = langs[0] || "";
      if (isError(parts)) {
        ctx.compiled.parts = [];
        return [parts.error];
      }
      ctx.compiled.parts = parts;
      return [];
    },
    /** The page changed language: read the sentence again, from the same record. */
    relanguage(node2, ctx) {
      this.prepare(node2, ctx);
    },
    evaluate(node2, ctx) {
      return renderTemplate(ctx.compiled.parts, ctx.scope, ctx.compiled.lang);
    }
  };

  // src/static/sdk-libs/living/machine.js
  function compile(def, errors) {
    const guards = /* @__PURE__ */ new Map();
    const assigns = /* @__PURE__ */ new Map();
    const whens = [];
    function expr(src, where) {
      const tree = parse(src);
      if (isError(tree)) {
        errors.push(where + ": " + tree.error);
        return null;
      }
      return tree;
    }
    function walkAssign(map, where, key) {
      if (!map || typeof map !== "object") return;
      const list = [];
      for (const id of Object.keys(map)) {
        const src = map[id];
        if (isPlainObject(src)) {
          const trees = {};
          let any = false;
          for (const lang of Object.keys(src)) {
            const tree2 = expr(String(src[lang]), where + " sets " + id + " in " + lang);
            if (tree2) {
              trees[lang] = tree2;
              any = true;
            }
          }
          if (any) list.push({ id, tree: null, trees });
          continue;
        }
        const tree = expr(String(src), where + " sets " + id);
        if (tree) list.push({ id, tree, trees: null });
      }
      assigns.set(key, list);
    }
    function walk(states, prefix) {
      if (!states || typeof states !== "object") return;
      for (const name of Object.keys(states)) {
        const node2 = states[name] || {};
        const path = prefix ? prefix + "." + name : name;
        walkAssign(node2.entry, "entry of " + path, "entry:" + path);
        walkAssign(node2.exit, "exit of " + path, "exit:" + path);
        const on = node2.on || {};
        for (const event of Object.keys(on)) {
          const h = on[event];
          if (h && typeof h === "object" && h.guard) {
            const tree = expr(String(h.guard), "the guard on " + path + " → " + event);
            if (tree) guards.set(path + "|" + event, tree);
          }
        }
        if (node2.states) walk(node2.states, path);
      }
    }
    walk(def.states, "");
    for (const w of def.when || []) {
      const tree = expr(String(w.expr), "the crossing that sends " + w.send);
      if (tree) whens.push({ tree, send: String(w.send), was: false });
    }
    return { guards, assigns, whens };
  }
  function stateAt(def, path) {
    let node2 = def;
    for (const part of path) {
      const kids = node2.states || {};
      if (!kids[part]) return null;
      node2 = kids[part];
    }
    return node2;
  }
  function settleInto(def, path) {
    const out = path.slice();
    for (; ; ) {
      const node2 = stateAt(def, out);
      if (!node2 || !node2.states || !node2.initial) return out;
      if (!node2.states[node2.initial]) return out;
      out.push(node2.initial);
    }
  }
  function createMachine(def, opts) {
    const errors = [];
    const wanted = function() {
      return opts && typeof opts.langs === "function" ? opts.langs() || [] : [];
    };
    const model = def && typeof def === "object" ? def : {};
    if (!model.states || typeof model.states !== "object" || !Object.keys(model.states).length) {
      errors.push("a machine with no states");
    } else if (!model.initial || !model.states[model.initial]) {
      errors.push('a machine whose initial state "' + String(model.initial) + '" is not one of its states');
    }
    const compiled = compile(model, errors);
    let active = errors.length ? [] : settleInto(model, [model.initial]);
    let started = false;
    let enteredAt = /* @__PURE__ */ new Map();
    function markEntered(path, now2) {
      for (let i = 1; i <= path.length; i++) {
        const key = path.slice(0, i).join(".");
        if (!enteredAt.has(key)) enteredAt.set(key, now2);
      }
    }
    markEntered(active, 0);
    function resolveAssign(a) {
      if (!a.trees) return a;
      const got = pickLang(a.trees, wanted());
      return { id: a.id, tree: got ? got.text : null };
    }
    function assignsFor(kind, path) {
      const list = compiled.assigns.get(kind + ":" + path) || [];
      return list.length ? list.map(resolveAssign) : list;
    }
    function move(target, keep, now2) {
      const out = [];
      for (let i = active.length; i > keep; i--) {
        const path = active.slice(0, i).join(".");
        for (const a of assignsFor("exit", path)) out.push(a);
        enteredAt.delete(path);
      }
      const next = settleInto(model, target);
      for (let i = keep + 1; i <= next.length; i++) {
        const path = next.slice(0, i).join(".");
        if (!enteredAt.has(path)) for (const a of assignsFor("entry", path)) out.push(a);
      }
      active = next;
      markEntered(active, now2);
      return out;
    }
    function resolveTarget(target, ownerDepth) {
      const text = String(target);
      if (text.indexOf(".") >= 0) return text.split(".");
      const parent = active.slice(0, ownerDepth - 1);
      return parent.concat([text]);
    }
    const api = {
      /** The current state as a dotted path. */
      path() {
        return active.join(".");
      },
      /** Every state on the active path, outermost first. */
      states() {
        return active.map((_, i) => active.slice(0, i + 1).join("."));
      },
      errors,
      /**
       * ARRIVING WHERE IT STARTS. The entry actions of the initial state, and of every nested
       * initial state beneath it, outermost first — the same order a transition into that state
       * would run them in, which is what SCXML and XState call the initial transition.
       *
       * No exit action is ever produced here: nothing has been left. It answers once; a second
       * call hands back nothing, and reset() puts it back on the line.
       * @returns {{ changed: boolean, path: string, assigns: Array<{ id: string, tree: any }> }}
       */
      start() {
        if (started || errors.length || !active.length) {
          started = true;
          return { changed: false, path: active.join("."), assigns: [] };
        }
        started = true;
        const out = [];
        for (let i = 1; i <= active.length; i++) {
          for (const a of assignsFor("entry", active.slice(0, i).join("."))) out.push(a);
        }
        return { changed: out.length > 0, path: active.join("."), assigns: out };
      },
      /**
       * Send an event. Looks for a handler from the deepest active state outward, honouring guards.
       *
       * IT SAYS WHERE IT CAME FROM as well as where it is. A trigger's whole reason for existing is
       * "from charging to exporting", and a result that carried only the destination would leave the
       * caller to remember the previous state itself — which is a second copy of the machine's state,
       * kept somewhere else, going wrong the first time two machines move in one pass.
       * @param {string} event @param {{ get: (id: string) => any }} scope @param {number} [now]
       * @returns {{ changed: boolean, from: string, path: string, assigns: Array<{ id: string, tree: any }> }}
       */
      send(event, scope, now2) {
        const clock = now2 == null ? 0 : now2;
        const from = active.join(".");
        for (let depth = active.length; depth >= 1; depth--) {
          const path = active.slice(0, depth);
          const node2 = stateAt(model, path);
          const handler = node2 && node2.on ? node2.on[event] : null;
          if (!handler) continue;
          const target = typeof handler === "string" ? handler : handler.target;
          if (!target) continue;
          const guard = compiled.guards.get(path.join(".") + "|" + event);
          if (guard) {
            const v = evaluate(guard, scope);
            if (isError(v) || !truthy(v)) continue;
          }
          const assigns = move(resolveTarget(target, depth), depth - 1, clock);
          return { changed: true, from, path: active.join("."), assigns };
        }
        return { changed: false, from, path: from, assigns: [] };
      },
      /**
       * Fire whichever `after` timer is due. Called by the runtime with the clock; in a test, with
       * whatever number the test wants.
       * @param {number} now
       */
      tick(now2) {
        const from = active.join(".");
        for (let depth = active.length; depth >= 1; depth--) {
          const path = active.slice(0, depth);
          const node2 = stateAt(model, path);
          if (!node2 || !node2.after) continue;
          const since = enteredAt.get(path.join("."));
          if (since == null) continue;
          for (const ms of Object.keys(node2.after).map(Number).sort((a, b) => a - b)) {
            if (!Number.isFinite(ms) || now2 - since < ms) continue;
            const handler = node2.after[String(ms)];
            const target = typeof handler === "string" ? handler : handler && handler.target;
            if (!target) continue;
            const assigns = move(resolveTarget(target, depth), depth - 1, now2);
            return { changed: true, from, path: active.join("."), assigns };
          }
        }
        return { changed: false, from, path: from, assigns: [] };
      },
      /** How long until the earliest pending `after`, or null when nothing is waiting. */
      nextDue(now2) {
        let best = null;
        for (let depth = active.length; depth >= 1; depth--) {
          const path = active.slice(0, depth);
          const node2 = stateAt(model, path);
          if (!node2 || !node2.after) continue;
          const since = enteredAt.get(path.join("."));
          if (since == null) continue;
          for (const ms of Object.keys(node2.after).map(Number)) {
            if (!Number.isFinite(ms)) continue;
            const left = Math.max(0, since + ms - now2);
            if (best == null || left < best) best = left;
          }
        }
        return best;
      },
      /**
       * Which crossings just became true. A rising edge, so an event fires once when the condition
       * is crossed rather than on every recompute while it holds.
       * @param {{ get: (id: string) => any }} scope
       * @returns {string[]}
       */
      crossings(scope) {
        const out = [];
        for (const w of compiled.whens) {
          const v = evaluate(w.tree, scope);
          const now2 = !isError(v) && truthy(v);
          if (now2 && !w.was) out.push(w.send);
          w.was = now2;
        }
        return out;
      },
      /**
       * THE WORDS THIS MACHINE IS CURRENTLY SAYING, read again in the language now in force. Only
       * the entries written as a language map are here: a plain assignment has nothing to re-read,
       * and re-running it would overwrite a value somebody has since moved. The machine does not
       * transition, nothing is entered or left — the same states are still active and only the
       * words in them are read differently.
       * @returns {Array<{ id: string, tree: any }>}
       */
      words() {
        const out = [];
        for (let i = 1; i <= active.length; i++) {
          const path = active.slice(0, i).join(".");
          for (const a of compiled.assigns.get("entry:" + path) || []) {
            if (a.trees) out.push(resolveAssign(a));
          }
        }
        return out;
      },
      /** Back to the initial state, with the crossings forgotten and start() armed again. */
      reset() {
        active = errors.length ? [] : settleInto(model, [model.initial]);
        enteredAt = /* @__PURE__ */ new Map();
        markEntered(active, 0);
        started = false;
        for (const w of compiled.whens) w.was = false;
      }
    };
    return api;
  }
  function truthy(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (v && typeof v === "object" && typeof v.n === "number") return v.n !== 0;
    if (typeof v === "string") return v !== "";
    return !!v;
  }

  // src/static/sdk-libs/living/nodes/machine-node.js
  function referenced(node2) {
    const out = [];
    const add = (src) => {
      if (isPlainObject(src)) {
        for (const key of Object.keys(src)) add(src[key]);
        return;
      }
      const tree = parse(String(src));
      if (!isError(tree)) {
        for (const s of symbolsOf(tree)) if (out.indexOf(s.split(".")[0]) < 0) out.push(s.split(".")[0]);
      }
    };
    const walk = (states) => {
      for (const name of Object.keys(states || {})) {
        const s = states[name] || {};
        for (const event of Object.keys(s.on || {})) {
          const h = s.on[event];
          if (h && typeof h === "object" && h.guard) add(h.guard);
        }
        for (const map of [s.entry, s.exit]) {
          for (const id of Object.keys(map || {})) add(map[id]);
        }
        if (s.states) walk(s.states);
      }
    };
    walk(node2.states);
    for (const w of node2.when || []) add(w.expr);
    return out;
  }
  function writesOf(node2) {
    const out = [];
    const walk = (states) => {
      for (const name of Object.keys(states || {})) {
        const s = states[name] || {};
        for (const map of [s.entry, s.exit]) {
          for (const id of Object.keys(map || {})) if (out.indexOf(id) < 0) out.push(id);
        }
        if (s.states) walk(s.states);
      }
    };
    walk(node2.states);
    return out;
  }
  var machineNode = {
    id: "machine",
    /** A machine reads what its guards and crossings read. What it WRITES is an edge the graph
     *  adds in the other direction, so the machine is recomputed before the values it assigns. */
    dependsOn(node2) {
      return referenced(node2);
    },
    prepare(node2, ctx) {
      if (!ctx.state.machines.has(ctx.id)) {
        ctx.state.machines.set(ctx.id, createMachine(node2, { langs: ctx.langs }));
      }
      const m = ctx.state.machines.get(ctx.id);
      ctx.compiled.machine = m;
      return m.errors.slice();
    },
    evaluate(node2, ctx) {
      const m = ctx.state.machines.get(ctx.id);
      return m ? m.path() : "";
    }
  };

  // src/static/sdk-libs/living/json-path.js
  var NAME = /^[A-Za-z0-9_$-]+$/;
  function pathParts(path) {
    const text = String(path == null ? "" : path).trim();
    if (!text) return [];
    const out = [];
    let at = 0;
    while (at < text.length) {
      if (text[at] === "[") {
        const end2 = text.indexOf("]", at);
        if (end2 < 0) return null;
        const inner = text.slice(at + 1, end2);
        if (!/^\d+$/.test(inner)) return null;
        out.push(inner);
        at = end2 + 1;
        if (at < text.length && text[at] === ".") at += 1;
        continue;
      }
      let end = at;
      while (end < text.length && text[end] !== "." && text[end] !== "[") end += 1;
      const name = text.slice(at, end);
      if (!NAME.test(name)) return null;
      out.push(name);
      at = end;
      if (at < text.length && text[at] === ".") at += 1;
    }
    return out;
  }
  function digPath(value2, path) {
    const parts = pathParts(path);
    if (!parts) return void 0;
    let at = value2;
    for (const part of parts) {
      if (at == null || typeof at !== "object") return void 0;
      at = at[part];
    }
    return at;
  }
  function pathError(path) {
    if (path == null || path === "") return null;
    if (typeof path !== "string") return "a path that is not a line of text";
    return pathParts(path) ? null : 'a path "' + path + '" that cannot be read as a path; a path is names joined by dots with positions in brackets, such as "prices[1].price"';
  }
  function shapeFor(path, sample) {
    const parts = pathParts(path);
    if (!parts || !parts.length) return sample;
    let built = sample;
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (/^\d+$/.test(part)) {
        const row = [];
        for (let k = 0; k < Number(part); k++) row.push(null);
        row.push(built);
        built = row;
        continue;
      }
      const box = {};
      box[part] = built;
      built = box;
    }
    return built;
  }

  // src/static/sdk-libs/living/nodes/source.js
  var EVERY_FLOOR = 10;
  var COMMON_FIELDS = ["value", "reading", "n", "celsius", "temp", "amount"];
  var sourceNode = {
    id: "source",
    settable: true,
    dependsOn() {
      return [];
    },
    prepare(node2, ctx) {
      const errors = [];
      const unit = parseUnit(node2.unit);
      if (isError(unit)) errors.push(unit.error);
      ctx.compiled.unit = isError(unit) ? null : unit;
      const badFormat = formatError(node2.format);
      if (badFormat) errors.push(badFormat);
      const badPath = pathError(node2.path);
      if (badPath) errors.push(badPath);
      if (node2.key && node2.url) {
        errors.push("a source naming both a key and a url; a reading comes from one place");
      }
      if (node2.every != null) {
        const every = Number(node2.every);
        if (!Number.isFinite(every) || every < EVERY_FLOOR) {
          errors.push("a poll of " + String(node2.every) + " seconds; the shortest this document may ask an address for is " + EVERY_FLOOR);
        }
      }
      if (!ctx.state.values.has(ctx.id)) ctx.state.values.set(ctx.id, wrapValue(node2.value, ctx.compiled.unit));
      return errors;
    },
    evaluate(node2, ctx) {
      return ctx.state.values.get(ctx.id);
    },
    /**
     * The words a failed read left. It is an extra OUTPUT rather than part of the value, because the
     * value did not move — that is the whole point of keeping it — and a sentence reads it as
     * `{{ spot.stale }}`.
     */
    fields(node2, ctx) {
      const extra = ctx.state.extra ? ctx.state.extra.get(ctx.id) || {} : {};
      return { stale: String(extra.stale == null ? "" : extra.stale) };
    },
    coerce(node2, ctx, raw) {
      let v = raw;
      if (node2.url) {
        if (v != null && typeof v === "object" && typeof v.n === "number") v = v.n;
        return wrapValue(v, ctx.compiled.unit);
      }
      if (v != null && typeof v === "object" && !Array.isArray(v) && typeof v.n !== "number") {
        const dug = digPath(v, node2.path);
        v = dug;
        if (v != null && typeof v === "object" && !Array.isArray(v)) {
          for (const f of COMMON_FIELDS) if (typeof v[f] === "number") {
            v = v[f];
            break;
          }
        }
      } else if (node2.path && v != null && typeof v === "object") {
        v = digPath(v, node2.path);
      }
      if (v != null && typeof v === "object" && typeof v.n === "number") v = v.n;
      return wrapValue(v, ctx.compiled.unit);
    },
    /**
     * Read the key through the platform's data library, when the page has one. Resolves to
     * undefined where it cannot, and the fallback value stands. The URL road is not here: it needs a
     * session and a runtime that can poll, so it lives in sources-url.js.
     * @param {any} node
     * @returns {Promise<any>}
     */
    read(node2) {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (!node2.key || !ns || !ns.data) return Promise.resolve(void 0);
      const call = node2.scope === "public" && typeof ns.data.getPublic === "function" ? ns.data.getPublic(node2.owner, node2.key) : typeof ns.data.get === "function" ? ns.data.get(node2.key) : null;
      if (!call) return Promise.resolve(void 0);
      return Promise.resolve(call).catch(() => void 0);
    }
  };

  // src/static/sdk-libs/living/nodes/trigger.js
  var TRIGGER_METHODS = ["POST", "PUT"];
  function watchOf(node2) {
    const on = node2 && node2.on;
    if (typeof on === "string") return { node: on, when: "" };
    if (on && typeof on === "object") return { node: String(on.node || ""), when: String(on.when || "") };
    return { node: "", when: "" };
  }
  function readsOf(when) {
    if (!when) return [];
    const tree = parse(String(when));
    if (isError(tree)) return [];
    const out = [];
    for (const s of symbolsOf(tree)) {
      const head = s.split(".")[0];
      if (out.indexOf(head) < 0) out.push(head);
    }
    return out;
  }
  var trigger = {
    id: "trigger",
    settable: true,
    /** It stands on what it watches, so the chain draws it downstream of the machine. */
    dependsOn(node2) {
      const watch = watchOf(node2);
      const out = watch.node ? [watch.node] : [];
      for (const id of readsOf(watch.when)) if (out.indexOf(id) < 0) out.push(id);
      return out;
    },
    prepare(node2, ctx) {
      const errors = [];
      const nodes = ((ctx.doc || {}).model || {}).nodes || {};
      const watch = watchOf(node2);
      if (!watch.node) {
        errors.push("a trigger with no node to watch; `on` is a machine id, or { node, when }");
      } else if (!Object.prototype.hasOwnProperty.call(nodes, watch.node)) {
      } else if (!watch.when && String((nodes[watch.node] || {}).type) !== "machine") {
        errors.push('a trigger watching "' + watch.node + '", which is a ' + String((nodes[watch.node] || {}).type) + " rather than a machine. A trigger fires on a machine's transition; to fire on a value crossing, write on: { node, when }");
      }
      if (watch.when) {
        const tree = parse(String(watch.when));
        if (isError(tree)) errors.push("a crossing that cannot be read: " + tree.error);
      }
      const target = node2.target || {};
      const kind = String(target.kind || "");
      if (kind === "url") {
        if (!target.url) errors.push("a trigger aimed at a url with no url on it");
        const method = String(target.method || "POST").toUpperCase();
        if (TRIGGER_METHODS.indexOf(method) < 0) {
          errors.push('a trigger sending with "' + method + '"; it may use ' + TRIGGER_METHODS.join(" or "));
        }
      } else if (kind === "agent") {
        if (!target.agent) errors.push("a trigger aimed at an agent with no agent named on it");
      } else {
        errors.push('a trigger with no target to tell; a target is { kind: "url", url } or { kind: "agent", agent }');
      }
      if (Array.isArray(node2.include)) {
        for (const id of node2.include) {
          if (!Object.prototype.hasOwnProperty.call(nodes, String(id))) {
            errors.push('an include naming "' + String(id) + '", which this document does not have');
          }
        }
      } else if (node2.include != null && String(node2.include) !== "all") {
        errors.push('an include of "' + String(node2.include) + '"; it is "all" or a list of node ids');
      }
      if (!ctx.state.values.has(ctx.id)) ctx.state.values.set(ctx.id, "");
      return errors;
    },
    /** Its value is what the delivery runtime last wrote here: the time it spoke. */
    evaluate(node2, ctx) {
      return ctx.state.values.get(ctx.id);
    },
    coerce(node2, ctx, raw) {
      return raw == null ? "" : String(raw);
    }
  };

  // src/static/sdk-libs/living/nodes/index.js
  var NODE_TYPES = {
    value,
    formula,
    control,
    binding,
    text: textNode,
    machine: machineNode,
    source: sourceNode,
    trigger
  };
  function typeOf(name) {
    return Object.prototype.hasOwnProperty.call(NODE_TYPES, String(name)) ? NODE_TYPES[String(name)] : null;
  }

  // src/static/sdk-libs/living/graph.js
  var MAX_ROUNDS = 8;
  function same(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a == null || b == null) return false;
    if (isQuantity(a) && isQuantity(b)) return a.n === b.n && (a.u ? a.u.label : "") === (b.u ? b.u.label : "");
    if (isError(a) && isError(b)) return a.error === b.error;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === "object" && typeof b === "object") {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (const k of ka) if (!same(a[k], b[k])) return false;
      return true;
    }
    return false;
  }
  function createGraph(doc, opts) {
    const langs = opts && typeof opts.langs === "function" ? opts.langs : function() {
      return [];
    };
    const model = doc && doc.model || {};
    const nodes = model && model.nodes || {};
    const ids = Object.keys(nodes);
    const errors = [];
    const state = { values: /* @__PURE__ */ new Map(), machines: /* @__PURE__ */ new Map(), extra: /* @__PURE__ */ new Map() };
    const compiled = /* @__PURE__ */ new Map();
    const outputs = /* @__PURE__ */ new Map();
    const fields2 = /* @__PURE__ */ new Map();
    let moves = [];
    function note(id, from, to, event) {
      moves.push({ node: id, from: String(from || ""), to: String(to || ""), event: String(event || "") });
    }
    const scope = {
      get(symbol) {
        const parts = String(symbol).split(".");
        const head = parts[0];
        if (!Object.prototype.hasOwnProperty.call(nodes, head)) return void 0;
        if (parts.length === 1) return outputs.get(head);
        const extra = fields2.get(head);
        if (extra && Object.prototype.hasOwnProperty.call(extra, parts.slice(1).join("."))) {
          return extra[parts.slice(1).join(".")];
        }
        let at = outputs.get(head);
        for (let i = 1; i < parts.length; i++) {
          if (at == null || typeof at !== "object") return void 0;
          at = at[parts[i]];
        }
        return at;
      }
    };
    function ctxFor(id) {
      if (!compiled.has(id)) compiled.set(id, {});
      return {
        id,
        node: nodes[id],
        doc,
        scope,
        state,
        compiled: compiled.get(id),
        langs
      };
    }
    for (const id of ids) {
      const node2 = nodes[id] || {};
      const type = typeOf(node2.type);
      if (!type) {
        errors.push('Node "' + id + '" is of type "' + String(node2.type) + '", which this document does not have. It knows ' + Object.keys(NODE_TYPES).join(", ") + ".");
        continue;
      }
      const found = type.prepare ? type.prepare(node2, ctxFor(id)) : [];
      for (const e of found || []) errors.push('Node "' + id + '" has ' + e + ".");
    }
    const deps = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const node2 = nodes[id] || {};
      const type = typeOf(node2.type);
      const list = [];
      if (type && type.dependsOn) {
        for (const on of type.dependsOn(node2, ctxFor(id)) || []) {
          if (!Object.prototype.hasOwnProperty.call(nodes, on)) {
            errors.push('Node "' + id + '" reads "' + on + '", which this document does not have.');
            continue;
          }
          if (on !== id && list.indexOf(on) < 0) list.push(on);
        }
      }
      deps.set(id, list);
    }
    for (const id of ids) {
      if ((nodes[id] || {}).type !== "machine") continue;
      for (const target of writesOf(nodes[id])) {
        if (!Object.prototype.hasOwnProperty.call(nodes, target)) {
          errors.push('Node "' + id + '" assigns to "' + target + '", which this document does not have.');
          continue;
        }
        const list = deps.get(target) || [];
        if (list.indexOf(id) < 0) list.push(id);
        deps.set(target, list);
      }
    }
    const dependents = /* @__PURE__ */ new Map();
    for (const id of ids) dependents.set(id, []);
    for (const id of ids) for (const on of deps.get(id) || []) dependents.get(on).push(id);
    const order = [];
    const left = /* @__PURE__ */ new Map();
    for (const id of ids) left.set(id, (deps.get(id) || []).length);
    const ready = ids.filter((id) => left.get(id) === 0);
    while (ready.length) {
      const id = ready.shift();
      order.push(id);
      for (const next of dependents.get(id) || []) {
        left.set(next, left.get(next) - 1);
        if (left.get(next) === 0) ready.push(next);
      }
    }
    if (order.length !== ids.length) {
      const stuck = ids.filter((id) => order.indexOf(id) < 0);
      const a = stuck[0];
      const b = (deps.get(a) || []).find((x) => stuck.indexOf(x) >= 0) || stuck[1] || a;
      errors.push('These nodes stand in a circle: "' + a + '" needs "' + b + '", and following "' + b + '" comes back to "' + a + '". A document cannot work out a circle, so break it.');
      for (const id of stuck) order.push(id);
    }
    function computeOne(id) {
      const node2 = nodes[id] || {};
      const type = typeOf(node2.type);
      if (!type) return false;
      const ctx = ctxFor(id);
      let out;
      try {
        out = type.evaluate(node2, ctx);
      } catch (e) {
        out = { error: 'Node "' + id + '" could not be worked out: ' + (e && e.message || String(e)) };
      }
      if (type.fields) fields2.set(id, type.fields(node2, ctx));
      const before = outputs.get(id);
      if (outputs.has(id) && same(before, out)) return false;
      outputs.set(id, out);
      return true;
    }
    function put(id, raw) {
      const node2 = nodes[id] || {};
      const type = typeOf(node2.type);
      if (!type || !type.settable) return false;
      const ctx = ctxFor(id);
      const next = type.coerce ? type.coerce(node2, ctx, raw) : raw;
      if (same(state.values.get(id), next)) return false;
      state.values.set(id, next);
      return true;
    }
    function pass(seed, changed) {
      const dirty = new Set(seed);
      for (const id of order) {
        const mine = dirty.has(id) || (deps.get(id) || []).some((on) => dirty.has(on));
        if (!mine) continue;
        if (computeOne(id)) {
          dirty.add(id);
          if (changed.indexOf(id) < 0) changed.push(id);
        }
      }
    }
    function startMachines(changed) {
      const seed = [];
      for (const id of order) {
        if ((nodes[id] || {}).type !== "machine") continue;
        const m = state.machines.get(id);
        if (!m || typeof m.start !== "function") continue;
        for (const a of m.start().assigns) {
          const v = a.tree ? evaluateAssign(a.tree) : void 0;
          if (put(a.id, v) && seed.indexOf(a.id) < 0) seed.push(a.id);
        }
      }
      if (seed.length) pass(seed, changed);
    }
    function settleMachines(changed) {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const seed = [];
        for (const id of order) {
          if ((nodes[id] || {}).type !== "machine") continue;
          const m = state.machines.get(id);
          if (!m) continue;
          let moved = false;
          for (const event of m.crossings(scope)) {
            const out = m.send(event, scope, Date.now());
            if (!out.changed) continue;
            moved = true;
            note(id, out.from, out.path, event);
            for (const a of out.assigns) {
              const v = a.tree ? evaluateAssign(a.tree) : void 0;
              if (put(a.id, v) && seed.indexOf(a.id) < 0) seed.push(a.id);
            }
          }
          if (moved && seed.indexOf(id) < 0) seed.push(id);
        }
        if (!seed.length) return;
        pass(seed, changed);
      }
      errors.push("The machines in this document kept sending each other events; the engine stopped after " + MAX_ROUNDS + " rounds.");
    }
    function evaluateAssign(tree) {
      return tree ? evaluate(tree, scope) : void 0;
    }
    const api = {
      ids,
      order,
      errors,
      scope,
      /** The node record, as the document wrote it. */
      nodeOf(id) {
        return nodes[id];
      },
      /** What one node currently comes to. */
      valueOf(id) {
        return outputs.get(id);
      },
      /** A node's extra outputs — a formula's TeX, for instance. */
      fieldsOf(id) {
        return fields2.get(id) || {};
      },
      /** Who stands on this node. */
      dependents(id) {
        return (dependents.get(id) || []).slice();
      },
      /** What this node stands on. */
      dependencies(id) {
        return (deps.get(id) || []).slice();
      },
      /** Every edge, for the chain view. */
      edges() {
        const out = [];
        for (const id of ids) for (const on of deps.get(id) || []) out.push({ from: on, to: id });
        return out;
      },
      /** Work the whole document out from the top. @returns {{ changed: string[], transitions: any[] }} */
      refresh() {
        const changed = [];
        moves = [];
        pass(ids, changed);
        startMachines(changed);
        settleMachines(changed);
        return { changed, transitions: moves.slice() };
      },
      /**
       * A NODE'S EXTRA OUTPUT, WRITTEN FROM OUTSIDE. A URL source that failed to refresh is still the
       * number it last had, and what changed is the WORDS beside it — so the words are an extra
       * output rather than a value, and everything that stands on the node is worked out again in
       * case it reads them. Nothing else in this library writes here.
       * @param {string} id @param {string} name @param {string} text
       * @returns {{ changed: string[] }}
       */
      setField(id, name, text) {
        const store = state.extra.get(id) || {};
        const next = String(text == null ? "" : text);
        if (String(store[name] == null ? "" : store[name]) === next) return { changed: [] };
        store[name] = next;
        state.extra.set(id, store);
        const changed = [id];
        pass([id], changed);
        return { changed };
      },
      /**
       * THE LANGUAGE CHANGED, AND NOTHING ELSE DID. Every node whose own source is words is read
       * again from the record, every machine says the words of the state it is already in again,
       * and only what those touched is recomputed. A value a person moved is not written, a machine
       * does not transition, and the changed list is the words that actually became different — so
       * the caller can update those and leave the rest of the screen exactly where it is.
       * @returns {{ changed: string[] }}
       */
      relanguage() {
        const changed = [];
        const seed = [];
        for (const id of order) {
          const node2 = nodes[id] || {};
          const type = typeOf(node2.type);
          if (!type || typeof type.relanguage !== "function") continue;
          type.relanguage(node2, ctxFor(id));
          if (seed.indexOf(id) < 0) seed.push(id);
        }
        for (const id of order) {
          if ((nodes[id] || {}).type !== "machine") continue;
          const m = state.machines.get(id);
          if (!m || typeof m.words !== "function") continue;
          for (const a of m.words()) {
            if (put(a.id, evaluateAssign(a.tree)) && seed.indexOf(a.id) < 0) seed.push(a.id);
          }
        }
        if (seed.length) pass(seed, changed);
        return { changed };
      },
      /**
       * Move one writable node and recompute what stood on it.
       * @param {string} id @param {any} raw
       * @returns {{ changed: string[], transitions: any[] }}
       */
      set(id, raw) {
        const changed = [];
        moves = [];
        if (!put(id, raw)) return { changed, transitions: [] };
        pass([id], changed);
        settleMachines(changed);
        return { changed, transitions: moves.slice() };
      },
      /**
       * Send an event to every machine that has a handler for it.
       * @param {string} event
       * @returns {{ changed: string[], transitions: any[] }}
       */
      send(event) {
        const changed = [];
        const seed = [];
        moves = [];
        for (const id of order) {
          if ((nodes[id] || {}).type !== "machine") continue;
          const m = state.machines.get(id);
          if (!m) continue;
          const out = m.send(event, scope, Date.now());
          if (!out.changed) continue;
          seed.push(id);
          note(id, out.from, out.path, event);
          for (const a of out.assigns) {
            const v = evaluateAssign(a.tree);
            if (put(a.id, v)) seed.push(a.id);
          }
        }
        if (!seed.length) return { changed, transitions: [] };
        pass(seed, changed);
        settleMachines(changed);
        return { changed, transitions: moves.slice() };
      },
      /**
       * Fire whichever `after` timers are due.
       * @param {number} now
       * @returns {{ changed: string[], transitions: any[] }}
       */
      tick(now2) {
        const changed = [];
        const seed = [];
        moves = [];
        for (const id of order) {
          if ((nodes[id] || {}).type !== "machine") continue;
          const m = state.machines.get(id);
          if (!m) continue;
          for (let i = 0; i < MAX_ROUNDS; i++) {
            const out = m.tick(now2);
            if (!out.changed) break;
            seed.push(id);
            note(id, out.from, out.path, "after");
            for (const a of out.assigns) {
              const v = evaluateAssign(a.tree);
              if (put(a.id, v)) seed.push(a.id);
            }
          }
        }
        if (!seed.length) return { changed, transitions: [] };
        pass(seed, changed);
        settleMachines(changed);
        return { changed, transitions: moves.slice() };
      },
      /** How long until the earliest pending timer in any machine, or null. */
      nextDue(now2) {
        let best = null;
        for (const [, m] of state.machines) {
          const left2 = m.nextDue(now2);
          if (left2 != null && (best == null || left2 < best)) best = left2;
        }
        return best;
      },
      /** The machine handle for one node — the chain view reads its active states from here. */
      machineOf(id) {
        return state.machines.get(id) || null;
      }
    };
    return api;
  }

  // src/static/sdk-libs/living/bindings.js
  function sourceNameFor(blockId) {
    return "living:" + String(blockId);
  }
  function planBindings(doc) {
    const nodes = (doc && doc.model || {}).nodes || {};
    const plan = /* @__PURE__ */ new Map();
    for (const id of Object.keys(nodes)) {
      const node2 = nodes[id] || {};
      if (node2.type !== "binding" || !node2.block) continue;
      const list = plan.get(String(node2.block)) || [];
      const prop = String(node2.prop == null ? "." : node2.prop);
      list.push({ id, path: prop === "." ? [] : prop.split(".").filter(Boolean), from: String(node2.from) });
      plan.set(String(node2.block), list);
    }
    return plan;
  }
  function layoutWithSources(layout, plan) {
    if (!layout || !Array.isArray(layout.blocks)) return layout;
    const out = Object.assign({}, layout);
    out.blocks = layout.blocks.map(function(block) {
      if (!block || !plan.has(String(block.id))) return block;
      const props = Object.assign({}, block.props || {});
      props.source = sourceNameFor(block.id);
      return Object.assign({}, block, { props });
    });
    return out;
  }
  function plainValue(v) {
    if (v == null) return null;
    if (isError(v)) return null;
    if (isQuantity(v)) return v.n;
    if (Array.isArray(v)) return v.map(plainValue);
    return v;
  }
  function composeBlock(graph, entries, base) {
    let whole;
    let copy = {};
    if (base && typeof base === "object" && !Array.isArray(base)) {
      try {
        copy = JSON.parse(JSON.stringify(base));
      } catch {
        copy = Object.assign({}, base);
      }
    }
    const out = copy;
    for (const entry of entries || []) {
      const v = plainValue(graph.valueOf(entry.from));
      if (!entry.path.length) {
        whole = v;
        continue;
      }
      setPath(out, entry.path, v);
    }
    return whole === void 0 ? out : whole;
  }

  // src/static/sdk-libs/living/dom.js
  function el(tag, attrs, kids) {
    const node2 = document.createElement(tag);
    for (const key of Object.keys(attrs || {})) {
      const v = attrs[key];
      if (v == null || v === false) continue;
      if (key === "text") {
        node2.textContent = String(v);
        continue;
      }
      if (key === "on") {
        for (const ev of Object.keys(v)) node2.addEventListener(ev, v[ev]);
        continue;
      }
      if (v === true) {
        node2.setAttribute(key, "");
        continue;
      }
      node2.setAttribute(key, String(v));
    }
    const list = kids == null ? [] : Array.isArray(kids) ? kids : [kids];
    for (const kid of list) {
      if (kid == null || kid === false) continue;
      node2.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return node2;
  }
  function clear(node2) {
    while (node2 && node2.firstChild) node2.removeChild(node2.firstChild);
  }
  function resolve(target, fallback) {
    if (!target) return fallback || document.body;
    if (typeof target === "string") return document.querySelector(target) || fallback || document.body;
    return target;
  }
  function kit() {
    const ns = (
      /** @type {any} */
      window.AIMEAT
    );
    return ns && ns.atelier ? ns.atelier : null;
  }
  function reducedMotion() {
    const k = kit();
    if (k && typeof k.reducedMotion === "function") return k.reducedMotion();
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      return false;
    }
  }
  function countTo(node2, from, to, format) {
    const k = kit();
    if (k && typeof k.countUp === "function" && !reducedMotion() && Number.isFinite(from) && Number.isFinite(to)) {
      k.countUp(node2, from, to, { format });
      return;
    }
    node2.textContent = format(to);
  }

  // src/static/sdk-libs/living/formula-view.js
  var katexPromise = null;
  function loadKatex() {
    if (katexPromise) return katexPromise;
    const ns = (
      /** @type {any} */
      window
    );
    if (ns.katex) {
      katexPromise = Promise.resolve(ns.katex);
      return katexPromise;
    }
    const base = (APEX_URL || "").replace(/\/+$/, "");
    katexPromise = new Promise(function(done) {
      if (!document.querySelector("link[data-aimeat-katex]")) {
        const link = el("link", { rel: "stylesheet", href: base + "/lib/katex@0/katex.min.css", "data-aimeat-katex": "css" });
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.src = base + "/lib/katex@0/katex.min.js";
      script.setAttribute("data-aimeat-katex", "js");
      script.onload = function() {
        done(ns.katex || null);
      };
      script.onerror = function() {
        done(null);
      };
      document.head.appendChild(script);
    });
    return katexPromise;
  }
  function formulaView(host, spec) {
    const plain = el("div", { class: "ak-living__plain", text: spec.plain });
    const set = el("div", { class: "ak-living__tex" });
    const answerValue = el("span", { class: "ak-living__answer-value", text: "—" });
    const answerUnit = el("span", { class: "ak-living__answer-unit" });
    const answer = el("div", { class: "ak-living__answer" }, [
      el("span", { class: "ak-living__answer-eq", "aria-hidden": "true", text: "=" }),
      answerValue,
      answerUnit
    ]);
    const caption = spec.label ? el("figcaption", { class: "ak-living__formula-label", text: spec.label }) : null;
    const root = el("figure", { class: "ak-living__formula", "data-living-node": spec.id }, [
      caption,
      plain,
      set,
      answer
    ]);
    host.appendChild(root);
    const lang = function() {
      return (spec.langs ? spec.langs() || [] : [])[0];
    };
    let lastTex = "";
    let lastNumber = NaN;
    function typeset(tex) {
      if (!tex) return;
      lastTex = tex;
      loadKatex().then(function(katex) {
        if (!katex || lastTex !== tex || !root.isConnected) return;
        try {
          katex.render(tex, set, { throwOnError: false, displayMode: false });
          plain.hidden = true;
          root.setAttribute("data-living-set", "yes");
        } catch {
        }
      });
    }
    let unitNow = "";
    let placeNow = "none";
    const write = function(n) {
      const body = formatNumber(n, spec.format, lang());
      if (!unitNow || placeNow === "none") return body;
      return placeNow === "before" ? unitNow + " " + body : body + " " + unitNow;
    };
    function update(value2, tex) {
      if (tex && tex !== lastTex) typeset(tex);
      if (isError(value2)) {
        answerValue.textContent = value2.error;
        answerUnit.textContent = "";
        root.setAttribute("data-living-state", "refused");
        lastNumber = NaN;
        return;
      }
      root.removeAttribute("data-living-state");
      const parts = formatParts(value2, spec.format, void 0, lang());
      if (isQuantity(value2) || typeof value2 === "number") {
        const n = isQuantity(value2) ? value2.n : value2;
        unitNow = parts.unit;
        placeNow = parts.place;
        countTo(answerValue, Number.isFinite(lastNumber) ? lastNumber : n, n, write);
        lastNumber = n;
        answerUnit.textContent = parts.place === "none" ? parts.unit : "";
        return;
      }
      answerValue.textContent = parts.text;
      answerUnit.textContent = "";
      lastNumber = NaN;
    }
    typeset(spec.tex);
    if ("value" in spec) update(spec.value, spec.tex);
    function relabel(label, value2) {
      if (caption && label != null && caption.textContent !== String(label)) {
        caption.textContent = String(label);
      }
      const v = value2 === void 0 ? spec.value : value2;
      if (isError(v) || !(isQuantity(v) || typeof v === "number")) return;
      const parts = formatParts(v, spec.format, void 0, lang());
      unitNow = parts.unit;
      placeNow = parts.place;
      answerValue.textContent = write(isQuantity(v) ? v.n : v);
      answerUnit.textContent = parts.place === "none" ? parts.unit : "";
    }
    return { el: root, update, relabel };
  }

  // src/static/sdk-libs/living/hooks-words.js
  var WORDS = {
    fi: {
      "gear.in": "Tämä arvo voi tulla ulkoa",
      "gear.out": "Kun tämä muuttuu, kerro jollekin",
      "inward.title": "Tämä arvo voi tulla ulkoa",
      "inward.lead": "Arvon voi asettaa käsin, lukea osoitteesta tai kirjoittaa muistiin. Sinä valitset kumpaa tietä.",
      "inward.road": "Mistä arvo tulee",
      "inward.road.hand": "Käsin, tältä sivulta",
      "inward.road.url": "Osoitteesta",
      "inward.road.key": "Muistiavaimesta",
      "inward.url": "Osoite",
      "inward.path": "Polku vastauksen sisällä",
      "inward.every": "Kuinka usein, sekuntia",
      "inward.key": "Muistiavain",
      "inward.expected": "Näin vastauksen pitää näyttää",
      "inward.testRead": "Kokeile lukemista",
      "inward.write": "Kirjoita arvo muistiin",
      "inward.agent": "Sano tämä omalle tekoälyllesi",
      "inward.range": "Sallittu väli",
      "outward.title": "Kun tämä muuttuu, kerro jollekin",
      "outward.lead": "Jokaisesta siirtymästä lähtee yksi viesti, joka kantaa koko asiakirjan tilan.",
      "outward.kind": "Kenelle kerrotaan",
      "outward.kind.url": "Osoitteeseen",
      "outward.kind.agent": "Omalle agentille",
      "outward.url": "Osoite",
      "outward.method": "Menetelmä",
      "outward.agent": "Agentin nimi",
      "outward.enabled": "Päällä",
      "outward.states": "Tilat",
      "outward.watching": "Seurattava kone",
      "outward.payload": "Näin viesti lähtee",
      "outward.testSend": "Kokeile lähetystä",
      "save": "Tallenna",
      "close": "Sulje",
      "copy": "Kopioi",
      "copied": "Kopioitu",
      "guest.read": "Kirjaudu sisään, niin arvo luetaan ulkoa. Näytössä on viimeisin lukema.",
      "guest.send": "Kirjaudu sisään, niin tämä voi kertoa ulospäin.",
      "stale.lead": "Lukema ei päivittynyt: ",
      "stale.tail": " Näytössä on viimeisin, joka saatiin.",
      "refusal.ALLOWLIST_REFUSED": "Tätä osoitetta ei ole sallittu tällä solmulla.",
      "refusal.RATE_LIMITED": "Kutsuja on tehty liikaa tämän minuutin aikana.",
      "refusal.PAYLOAD_TOO_LARGE": "Viesti on liian iso lähetettäväksi.",
      "refusal.UPSTREAM_FAILED": "Vastaanottaja ei vastannut.",
      "refusal.NO_EXTENSION": "Tämän solmun living-hooks-laajennus ei vastannut.",
      "refusal.UNKNOWN": "Kutsu ei mennyt läpi.",
      "sentence.write": 'Kirjoita AIMEAT-muistiin avaimelle {key} arvo {sample}. Asiakirja "{title}" lukee sen sieltä.',
      "sentence.task": 'Asiakirja "{title}" siirtyi tilasta {from} tilaan {to}. Koko tila on tämän viestin mukana.'
    },
    en: {
      "gear.in": "This value can come from outside",
      "gear.out": "When this changes, tell someone",
      "inward.title": "This value can come from outside",
      "inward.lead": "The value can be set by hand, read from an address, or written into memory. You choose which road.",
      "inward.road": "Where the value comes from",
      "inward.road.hand": "By hand, on this page",
      "inward.road.url": "From an address",
      "inward.road.key": "From a memory key",
      "inward.url": "Address",
      "inward.path": "Path inside the answer",
      "inward.every": "How often, in seconds",
      "inward.key": "Memory key",
      "inward.expected": "This is the shape the answer must have",
      "inward.testRead": "Test read",
      "inward.write": "Write the value into memory",
      "inward.agent": "Say this to your own AI",
      "inward.range": "The range it accepts",
      "outward.title": "When this changes, tell someone",
      "outward.lead": "Every transition sends one message, and it carries the whole document's state.",
      "outward.kind": "Who to tell",
      "outward.kind.url": "An address",
      "outward.kind.agent": "One of your agents",
      "outward.url": "Address",
      "outward.method": "Method",
      "outward.agent": "The agent's name",
      "outward.enabled": "On",
      "outward.states": "The states",
      "outward.watching": "The machine it watches",
      "outward.payload": "This is the message as it goes",
      "outward.testSend": "Test send",
      "save": "Save",
      "close": "Close",
      "copy": "Copy",
      "copied": "Copied",
      "guest.read": "Sign in and the value is read from outside. What you see is the last reading.",
      "guest.send": "Sign in and this can tell the outside.",
      "stale.lead": "The reading did not refresh: ",
      "stale.tail": " What you see is the last one that arrived.",
      "refusal.ALLOWLIST_REFUSED": "This address is not one this node is allowed to call.",
      "refusal.RATE_LIMITED": "Too many calls have been made this minute.",
      "refusal.PAYLOAD_TOO_LARGE": "The message is too big to send.",
      "refusal.UPSTREAM_FAILED": "The receiver did not answer.",
      "refusal.NO_EXTENSION": "This node's living-hooks extension did not answer.",
      "refusal.UNKNOWN": "The call did not go through.",
      "sentence.write": 'Write into AIMEAT memory, under the key {key}, the value {sample}. The document "{title}" reads it from there.',
      "sentence.task": 'The document "{title}" went from {from} to {to}. Its whole state is with this message.'
    }
  };
  function say(key, langs) {
    const map = {};
    for (const lang of Object.keys(WORDS)) {
      if (WORDS[lang][key] != null) map[lang] = WORDS[lang][key];
    }
    const got = pickLang(map, langs || []);
    return got ? String(got.text) : String(key);
  }
  function fill(text, values) {
    return String(text).replace(/\{([A-Za-z0-9_]+)\}/g, function(whole, name) {
      const v = values ? values[name] : void 0;
      return v == null ? whole : String(v);
    });
  }
  function refusalWords(refusal, langs) {
    if (!refusal) return "";
    if (refusal.message) return String(refusal.message);
    const code = String(refusal.code || "UNKNOWN");
    const known = WORDS.en["refusal." + code] ? code : "UNKNOWN";
    return say("refusal." + known, langs);
  }

  // src/static/sdk-libs/living/gear.js
  var GEAR = '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z"/><path d="M19.3 13.6a7.6 7.6 0 0 0 0-3.2l1.7-1.2-1.7-3-2 .8a7.6 7.6 0 0 0-2.8-1.6L14.2 3h-3.4l-.3 2.4a7.6 7.6 0 0 0-2.8 1.6l-2-.8-1.7 3 1.7 1.2a7.6 7.6 0 0 0 0 3.2L3.7 15l1.7 3 2-.8a7.6 7.6 0 0 0 2.8 1.6l.3 2.2h3.4l.3-2.2a7.6 7.6 0 0 0 2.8-1.6l2 .8 1.7-3-1.4-1.4Z"/>';
  var GEAR_IN = '<g class="ak-living__gear-arrow"><path d="M1 12h6"/><path d="M4.6 9.2 7.4 12l-2.8 2.8"/></g>';
  var GEAR_OUT = '<g class="ak-living__gear-arrow"><path d="M17 12h6"/><path d="M20.4 9.2 23.2 12l-2.8 2.8"/></g>';
  function gearButton(spec) {
    const langs = typeof spec.langs === "function" ? spec.langs : function() {
      return [];
    };
    const title = say(spec.way === "out" ? "gear.out" : "gear.in", langs());
    const button = el("button", {
      type: "button",
      class: "ak-btn ak-btn--ghost ak-living__gear ak-living__gear--" + (spec.way === "out" ? "out" : "in"),
      "data-living-gear": spec.way === "out" ? "out" : "in",
      "data-living-for": String(spec.node || ""),
      title,
      "aria-label": title,
      on: { click: function() {
        if (spec.onOpen) spec.onOpen();
      } }
    });
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (spec.way === "out" ? GEAR_OUT : GEAR_IN) + GEAR + "</svg>";
    return button;
  }
  function relabelGears(root, langs) {
    if (!root || !root.querySelectorAll) return;
    for (const button of root.querySelectorAll("[data-living-gear]")) {
      const way = button.getAttribute("data-living-gear") === "out" ? "gear.out" : "gear.in";
      const title = say(way, langs ? langs() : []);
      if (button.getAttribute("title") !== title) button.setAttribute("title", title);
      if (button.getAttribute("aria-label") !== title) button.setAttribute("aria-label", title);
    }
  }

  // src/static/sdk-libs/living/render.js
  var seq = 0;
  function uid() {
    seq += 1;
    return "ak-living-" + seq;
  }
  function langsOf(spec) {
    if (!spec || typeof spec.langs !== "function") return [];
    return spec.langs() || [];
  }
  function readout(v, format, lang) {
    return formatParts(v, format, "after", lang).text;
  }
  var FIELD_TYPE = { slider: "range", toggle: "toggle", pick: "select", number: "number", text: "text" };
  var READS_OUT = ["slider", "number"];
  function asOption(o, langs) {
    const opt = o && typeof o === "object" ? o : { value: o, label: o };
    const label = textOf(opt.label == null ? opt.value : opt.label, langs);
    return { value: String(opt.value), label: String(label) };
  }
  function controlRow(host, spec) {
    const kind = String(spec.node.kind || "slider");
    const target = spec.target || {};
    const id = uid();
    const type = FIELD_TYPE[kind] || "text";
    const start = kind === "toggle" ? spec.value === true || asNumber(spec.value) === 1 : isQuantity(spec.value) ? spec.value.n : spec.value == null ? null : asText(spec.value);
    const wording = function() {
      const langs = langsOf(spec);
      const own = textOf(spec.node.label, langs);
      return String(own || textOf(target.label, langs) || spec.node.target);
    };
    const k = kit();
    const handle = k.form({
      target: host,
      submit: false,
      fields: [{
        name: "value",
        id,
        type,
        label: wording(),
        min: target.min,
        max: target.max,
        step: target.step,
        unit: target.unit,
        value: start,
        options: kind === "pick" ? (spec.node.options || []).map((o) => asOption(o, langsOf(spec))) : void 0,
        // The person's hand goes through the ENGINE, exactly where an agent's call goes: the input
        // is never the source of truth, it only reports.
        onInput(v) {
          spec.onSet(v);
        }
      }]
    });
    const root = handle.el;
    root.classList.add("ak-living__control");
    root.setAttribute("data-living-node", spec.id);
    root.setAttribute("data-living-kind", kind);
    const field = root.querySelector('[data-ak-part="field"]');
    const input = (
      /** @type {any} */
      root.querySelector('[data-ak-part="input"]')
    );
    const labelEl = root.querySelector('[data-ak-part="label"]');
    if (labelEl) labelEl.classList.add("ak-living__label");
    input.classList.add("ak-living__input");
    if (kind === "slider") input.classList.add("ak-living__slider");
    const row = root.querySelector('[data-ak-part="range"]');
    if (row) row.classList.add("ak-living__control-row");
    let readoutEl = READS_OUT.indexOf(kind) < 0 ? null : root.querySelector('[data-ak-part="readout"]');
    if (!readoutEl && READS_OUT.indexOf(kind) >= 0) {
      readoutEl = el("output", { class: "ak-form__readout", "data-ak-part": "readout", for: id });
      (field || root).appendChild(readoutEl);
    }
    if (readoutEl) readoutEl.classList.add("ak-living__readout");
    function update(v) {
      if (kind === "toggle") {
        const on = !!(v === true || asNumber(v) === 1);
        if (input.checked !== on) handle.setValues({ value: on });
      } else if (kind === "text" || kind === "pick") {
        const s = isQuantity(v) ? String(v.n) : asText(v);
        if (input.value !== s) handle.setValues({ value: s });
      } else {
        const n = asNumber(v);
        if (Number.isFinite(n) && String(n) !== input.value) handle.setValues({ value: n });
      }
      if (!readoutEl) return;
      const words2 = readout(v, target.format, langsOf(spec)[0]);
      if (readoutEl.textContent !== words2) readoutEl.textContent = words2;
      if (input.hasAttribute("aria-valuetext")) input.setAttribute("aria-valuetext", words2);
    }
    update(spec.value);
    function relabel(value2) {
      const langs = langsOf(spec);
      if (labelEl) {
        const words2 = wording();
        if (labelEl.textContent !== words2) labelEl.textContent = words2;
      }
      if (kind === "pick" && input.options) {
        const wanted = (spec.node.options || []).map((o) => asOption(o, langs));
        for (let i = 0; i < input.options.length && i < wanted.length; i++) {
          if (input.options[i].textContent !== wanted[i].label) input.options[i].textContent = wanted[i].label;
        }
      }
      update(value2 === void 0 ? spec.value : value2);
    }
    return { el: root, update, relabel };
  }
  function textView(host, spec) {
    const body = el("p", { class: "ak-living__text", text: spec.text });
    const labelEl = spec.label ? el("span", { class: "ak-living__note-label", text: spec.label }) : null;
    const root = el("div", { class: "ak-living__note", "data-living-node": spec.id }, [labelEl, body]);
    host.appendChild(root);
    return {
      el: root,
      update(text) {
        if (body.textContent !== text) body.textContent = String(text);
      },
      relabel(label) {
        if (labelEl && label != null && labelEl.textContent !== label) labelEl.textContent = String(label);
      }
    };
  }
  function machineView(host, spec) {
    const chips = /* @__PURE__ */ new Map();
    const strip = el("div", { class: "ak-living__states", role: "group" });
    for (const name of spec.states) {
      const chip = el("span", { class: "ak-living__state", "data-state": name, text: name });
      chips.set(name, chip);
      strip.appendChild(chip);
    }
    const labelEl = spec.label ? el("span", { class: "ak-living__note-label", text: spec.label }) : null;
    const root = el("div", { class: "ak-living__machine", "data-living-node": spec.id }, [labelEl, strip]);
    host.appendChild(root);
    function update(path) {
      root.setAttribute("data-living-state", String(path || ""));
      const on = String(path || "").split(".");
      for (const [name, chip] of chips) {
        const active = on.indexOf(name) >= 0 || String(path) === name;
        chip.setAttribute("data-on", active ? "yes" : "no");
        chip.setAttribute("aria-current", active ? "true" : "false");
      }
    }
    update(spec.path);
    return {
      el: root,
      update,
      relabel(label) {
        if (labelEl && label != null && labelEl.textContent !== label) labelEl.textContent = String(label);
      }
    };
  }
  function valueRow(host, spec) {
    const figure = el("span", { class: "ak-living__figure" });
    const unit = el("span", { class: "ak-living__figure-unit" });
    const labelEl = el("span", { class: "ak-living__note-label", text: spec.label || spec.id });
    const staleEl = el("p", { class: "ak-living__stale", hidden: true });
    const root = el("div", { class: "ak-living__value", "data-living-node": spec.id }, [
      labelEl,
      el("span", { class: "ak-living__figure-row" }, [figure, unit]),
      staleEl
    ]);
    host.appendChild(root);
    let last = NaN;
    let unitNow = "";
    let placeNow = "none";
    const write = function(n) {
      const body = formatNumber(n, spec.format, langsOf(spec)[0]);
      if (!unitNow || placeNow === "none") return body;
      return placeNow === "before" ? unitNow + " " + body : body + " " + unitNow;
    };
    function update(v, stale) {
      if (stale !== void 0) {
        const words2 = String(stale || "");
        if (staleEl.textContent !== words2) staleEl.textContent = words2;
        staleEl.hidden = !words2;
        root.setAttribute("data-living-stale", words2 ? "yes" : "no");
      }
      const parts = formatParts(v, spec.format, void 0, langsOf(spec)[0]);
      if (isQuantity(v) || typeof v === "number") {
        const n = isQuantity(v) ? v.n : v;
        unitNow = parts.unit;
        placeNow = parts.place;
        countTo(figure, Number.isFinite(last) ? last : n, n, write);
        last = n;
        unit.textContent = parts.place === "none" ? parts.unit : "";
        return;
      }
      figure.textContent = parts.text;
      unit.textContent = "";
      last = NaN;
    }
    update(spec.value);
    return {
      el: root,
      update,
      /**
       * The label, and the figure again: a number written with `locale: "auto"` changes its decimal
       * separator with the language even though the quantity did not move, so the count-up is not
       * re-run — the reading is simply written out again where it stands.
       */
      relabel(label, value2) {
        if (label != null && labelEl.textContent !== label) labelEl.textContent = String(label);
        const v = value2 === void 0 ? spec.value : value2;
        const parts = formatParts(v, spec.format, void 0, langsOf(spec)[0]);
        if (isQuantity(v) || typeof v === "number") {
          unitNow = parts.unit;
          placeNow = parts.place;
          figure.textContent = write(isQuantity(v) ? v.n : v);
          unit.textContent = parts.place === "none" ? parts.unit : "";
        }
      }
    };
  }
  function triggerRow(host, spec) {
    const labelEl = el("span", { class: "ak-living__note-label", text: spec.label || spec.id });
    const whereEl = el("code", { class: "ak-living__trigger-target" });
    const whenEl = el("span", { class: "ak-living__trigger-at" });
    const reasonEl = el("p", { class: "ak-living__trigger-reason", hidden: true });
    const root = el("div", { class: "ak-living__trigger", "data-living-node": spec.id }, [
      labelEl,
      el("span", { class: "ak-living__trigger-row" }, [whereEl, whenEl]),
      reasonEl
    ]);
    host.appendChild(root);
    function where(node2) {
      const target = node2 && node2.target || {};
      return String(target.kind) === "agent" ? "@" + String(target.agent || "") : String(target.url || "");
    }
    function update(at, reason, node2) {
      const def = node2 || spec.node || {};
      whereEl.textContent = where(def);
      whenEl.textContent = String(at || "");
      const words2 = String(reason || "");
      reasonEl.textContent = words2;
      reasonEl.hidden = !words2;
      root.setAttribute("data-living-on", def.enabled !== false && !words2 ? "yes" : "no");
    }
    update(spec.at, spec.reason, spec.node);
    return {
      el: root,
      update,
      relabel(label, reason) {
        if (label != null && labelEl.textContent !== label) labelEl.textContent = String(label);
        if (reason !== void 0) update(whenEl.textContent, reason, null);
      }
    };
  }
  function statesOf(def) {
    const out = [];
    const walk = (states) => {
      for (const name of Object.keys(states || {})) {
        out.push(name);
        if (states[name] && states[name].states) walk(states[name].states);
      }
    };
    walk(def && def.states);
    return out;
  }
  function renderNodeInto(host, spec) {
    const node2 = spec.node;
    const graph = spec.graph;
    const langs = spec.langs || function() {
      return [];
    };
    const value2 = graph.valueOf(spec.id);
    const label = function() {
      return textOf(node2.label, langs());
    };
    function geared(view, way) {
      if (!spec.gear || !view || !view.el) return view;
      view.el.classList.add("ak-living--geared");
      view.el.appendChild(gearButton({
        way,
        node: spec.id,
        langs,
        onOpen: function() {
          spec.gear(spec.id, way);
        }
      }));
      return view;
    }
    if (node2.type === "control") {
      const target = graph.nodeOf(String(node2.target)) || {};
      const view = controlRow(host, {
        id: spec.id,
        node: node2,
        target,
        value: value2,
        langs,
        onSet(v) {
          spec.set(String(node2.target), v);
        }
      });
      geared(view, "in");
      return {
        el: view.el,
        update: () => view.update(graph.valueOf(spec.id)),
        relabel: () => view.relabel(graph.valueOf(spec.id)),
        kind: "control"
      };
    }
    if (node2.type === "formula") {
      const view = formulaView(host, {
        id: spec.id,
        label: label(),
        value: value2,
        format: node2.format,
        langs,
        tex: (graph.fieldsOf(spec.id) || {}).tex || "",
        plain: spec.id + " = " + String(node2.expr)
      });
      return {
        el: view.el,
        update: () => view.update(graph.valueOf(spec.id), (graph.fieldsOf(spec.id) || {}).tex || ""),
        relabel: () => view.relabel(label(), graph.valueOf(spec.id)),
        kind: "formula"
      };
    }
    if (node2.type === "text") {
      const view = textView(host, { id: spec.id, label: label(), text: String(value2 == null ? "" : value2) });
      return {
        el: view.el,
        update: () => view.update(String(graph.valueOf(spec.id) == null ? "" : graph.valueOf(spec.id))),
        relabel: () => view.relabel(label()),
        kind: "text"
      };
    }
    if (node2.type === "machine") {
      const view = machineView(host, { id: spec.id, label: label(), states: statesOf(node2), path: String(value2 || "") });
      geared(view, "out");
      return {
        el: view.el,
        update: () => view.update(String(graph.valueOf(spec.id) || "")),
        relabel: () => view.relabel(label()),
        kind: "machine"
      };
    }
    if (node2.type === "trigger") {
      const reason = function() {
        return spec.reason ? spec.reason() : "";
      };
      const view = triggerRow(host, {
        id: spec.id,
        label: label(),
        node: node2,
        at: String(value2 || ""),
        reason: reason()
      });
      geared(view, "out");
      return {
        el: view.el,
        update: () => view.update(String(graph.valueOf(spec.id) || ""), reason(), node2),
        relabel: () => view.relabel(label(), reason()),
        kind: "trigger"
      };
    }
    if (node2.type === "value" || node2.type === "source") {
      const stale = function() {
        return String((graph.fieldsOf(spec.id) || {}).stale || "");
      };
      const view = valueRow(host, { id: spec.id, label: label(), value: value2, format: node2.format, langs });
      view.update(value2, stale());
      geared(view, "in");
      return {
        el: view.el,
        update: () => view.update(graph.valueOf(spec.id), stale()),
        relabel: () => view.relabel(label() || spec.id, graph.valueOf(spec.id)),
        kind: node2.type
      };
    }
    return null;
  }

  // src/static/sdk-libs/living/chain-draw.js
  var NS = "http://www.w3.org/2000/svg";
  var KIT_ROWS = 11;
  var KIT_COLS = 7;
  var PILL_H = 24;
  var ROW = 32;
  var GAP = 26;
  var PAD = 22;
  var LABEL_MAX = 26;
  var CHAR_W = 6.6;
  function words(label) {
    const text = String(label == null ? "" : label);
    return text.length > LABEL_MAX ? text.slice(0, LABEL_MAX - 1) + "…" : text;
  }
  function pillWidth(label) {
    return Math.max(56, words(label).length * CHAR_W + 22);
  }
  function node(name, attrs) {
    const el2 = document.createElementNS(NS, name);
    for (const key of Object.keys(attrs || {})) el2.setAttribute(key, String(attrs[key]));
    return el2;
  }
  function fitsKitFrame(data) {
    const nodes = data && data.nodes || [];
    if (!nodes.length) return true;
    let cols = 0;
    const perColumn = /* @__PURE__ */ new Map();
    for (const n of nodes) {
      const c = n.col || 0;
      cols = Math.max(cols, c + 1);
      perColumn.set(c, (perColumn.get(c) || 0) + 1);
    }
    return cols <= KIT_COLS && Math.max(...perColumn.values()) <= KIT_ROWS;
  }
  function drawChain(host, data, opts) {
    const root = document.createElement("div");
    root.className = "ak-root ak-graph ak-living__chain-draw";
    root.setAttribute("role", "img");
    host.appendChild(root);
    function render(next) {
      while (root.firstChild) root.removeChild(root.firstChild);
      const nodes = next && next.nodes || [];
      const edges = next && next.edges || [];
      if (!nodes.length) return;
      root.setAttribute("aria-label", ((opts || {}).title ? opts.title + " — " : "") + nodes.map((n) => n.label).join(", "));
      const byColumn = /* @__PURE__ */ new Map();
      for (const n of nodes) {
        const c = n.col || 0;
        const list = byColumn.get(c) || [];
        list.push(n);
        byColumn.set(c, list);
      }
      const columns = [...byColumn.keys()].sort((a, b) => a - b);
      const width = /* @__PURE__ */ new Map();
      for (const c of columns) width.set(c, Math.max(...byColumn.get(c).map((n) => pillWidth(n.label))));
      const centre = /* @__PURE__ */ new Map();
      let x = PAD;
      for (const c of columns) {
        centre.set(c, x + width.get(c) / 2);
        x += width.get(c) + GAP;
      }
      const frameW = x - GAP + PAD;
      const tallest = Math.max(...columns.map((c) => byColumn.get(c).length));
      const frameH = PAD * 2 + Math.max(1, tallest) * ROW;
      const place = /* @__PURE__ */ new Map();
      for (const c of columns) {
        const list = byColumn.get(c);
        const top = (frameH - list.length * ROW) / 2 + ROW / 2;
        list.forEach((n, i) => place.set(n.id, { x: centre.get(c), y: top + i * ROW, w: width.get(c) }));
      }
      const svg = node("svg", {
        viewBox: "0 0 " + Math.round(frameW) + " " + Math.round(frameH),
        width: Math.round(frameW),
        height: Math.round(frameH),
        class: "ak-graph__svg",
        "aria-hidden": "true"
      });
      for (const edge of edges) {
        const a = place.get(edge.from);
        const b = place.get(edge.to);
        if (!a || !b) continue;
        const ax = a.x + a.w / 2;
        const bx = b.x - b.w / 2;
        const bend = Math.max(18, (bx - ax) / 2);
        svg.appendChild(node("path", {
          d: "M " + ax + " " + a.y + " C " + (ax + bend) + " " + a.y + ", " + (bx - bend) + " " + b.y + ", " + bx + " " + b.y,
          fill: "none",
          class: "ak-graph__edge"
        }));
      }
      for (const n of nodes) {
        const at = place.get(n.id);
        if (!at) continue;
        const g = node("g", {
          class: "ak-graph__node ak-graph__node--" + (n.tone || "plain"),
          transform: "translate(" + at.x + ", " + at.y + ")"
        });
        g.appendChild(node("rect", {
          x: -at.w / 2,
          y: -PILL_H / 2,
          width: at.w,
          height: PILL_H,
          rx: PILL_H / 2,
          class: "ak-graph__pill"
        }));
        const label = node("text", { x: 0, y: 4, class: "ak-graph__label", "text-anchor": "middle" });
        label.textContent = words(n.label);
        g.appendChild(label);
        svg.appendChild(g);
      }
      root.appendChild(svg);
    }
    render(data);
    return {
      el: root,
      set(patch) {
        if (patch && patch.data) render(patch.data);
      },
      destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/living/chain.js
  var FLASH_MS = 900;
  var TONE = {
    control: "accent",
    value: "ok",
    source: "ok",
    formula: "plain",
    text: "plain",
    binding: "plain",
    machine: "warn"
  };
  function depths(graph) {
    const out = /* @__PURE__ */ new Map();
    for (const id of graph.order) {
      let deep = 0;
      for (const on of graph.dependencies(id)) deep = Math.max(deep, (out.get(on) || 0) + 1);
      out.set(id, deep);
    }
    return out;
  }
  function chainData(graph, langs) {
    const nodes = [];
    const edges = [];
    const depth = depths(graph);
    const column = /* @__PURE__ */ new Map();
    for (const id of graph.ids) column.set(id, depth.get(id) || 0);
    for (const id of graph.ids) {
      const node2 = graph.nodeOf(id) || {};
      const words2 = textOf(node2.label, langs || []);
      nodes.push({ id, label: words2 ? words2 + " (" + id + ")" : id, tone: TONE[node2.type] || "plain" });
      if (node2.type !== "machine") continue;
      const active = String(graph.valueOf(id) || "").split(".");
      for (const state of statesOf(node2)) {
        const sid = id + ":" + state;
        nodes.push({ id: sid, label: state, tone: active.indexOf(state) >= 0 ? "accent" : "plain" });
        column.set(sid, (depth.get(id) || 0) + 1);
        edges.push({ from: id, to: sid });
      }
    }
    for (const edge of graph.edges()) edges.push({ from: edge.from, to: edge.to });
    const byColumn = /* @__PURE__ */ new Map();
    for (const n of nodes) {
      const c = column.get(n.id) || 0;
      const list = byColumn.get(c) || [];
      list.push(n);
      byColumn.set(c, list);
    }
    const last = Math.max(0, ...byColumn.keys());
    for (const [c, list] of byColumn) {
      for (let i = 0; i < list.length; i++) {
        list[i].x = last === 0 ? 50 : c / last * 100;
        list[i].y = list.length === 1 ? 50 : i / (list.length - 1) * 100;
        list[i].col = c;
        list[i].row = i;
      }
    }
    return { nodes, edges };
  }
  function chain(host, spec) {
    const root = el("div", { class: "ak-living__chain", "data-ak-part": "chain" });
    const target = typeof host === "string" ? document.querySelector(host) : host;
    if (target) target.appendChild(root);
    const k = kit();
    let handle = null;
    let order = [];
    const timers = /* @__PURE__ */ new Set();
    let drawnBig = false;
    function paint() {
      const data = chainData(spec.graph, spec.langs ? spec.langs() : []);
      order = data.nodes.map(function(n) {
        return n.id;
      });
      const big = !fitsKitFrame(data);
      if (handle && big !== drawnBig) {
        handle.destroy();
        handle = null;
      }
      drawnBig = big;
      if (big) {
        if (!handle) handle = drawChain(root, data, { title: spec.title });
        else handle.set({ data });
        return;
      }
      if (k && typeof k.graph === "function") {
        if (!handle) handle = k.graph({ target: root, data, title: spec.title });
        else handle.set({ data });
        return;
      }
      clear(root);
      root.appendChild(el("ul", { class: "ak-living__chain-list" }, data.edges.map(function(e) {
        return el("li", { text: e.from + " → " + e.to });
      })));
    }
    paint();
    function nodeElements() {
      return root.querySelectorAll(".ak-graph__node");
    }
    return {
      el: root,
      /** Redraw from the graph's current state — a machine that moved changes which state is toned. */
      set() {
        paint();
      },
      /**
       * Light the nodes that just changed. Finite, and nothing at all under reduced motion.
       * @param {string[]} ids
       */
      flash(ids) {
        paint();
        if (!ids || !ids.length || reducedMotion()) return;
        const drawn = nodeElements();
        for (const id of ids) {
          const at = order.indexOf(id);
          const node2 = at >= 0 ? drawn[at] : null;
          if (!node2) continue;
          node2.setAttribute("data-living-flash", "yes");
          const timer = setTimeout(function() {
            node2.removeAttribute("data-living-flash");
            timers.delete(timer);
          }, FLASH_MS);
          timers.add(timer);
        }
      },
      destroy() {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        if (handle && handle.destroy) handle.destroy();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // src/static/sdk-libs/living/describe-data.js
  var NODES = {
    "binding": {
      summary: "One block prop on this screen reads one node.",
      inputs: ["from (the node whose output the prop takes)"],
      outputs: ["value — the same value, so the chain view can show where it went"],
      options: ["block (a layout block id)", "prop (a prop path on that block, dots allowed)"],
      languages: [],
      functions: [],
      example: { "type": "binding", "block": "dial", "prop": "value", "from": "t" },
      file: "nodes/binding.js"
    },
    "control": {
      summary: "A slider, switch, pick, number or text field bound to one value node.",
      inputs: ["target (the value node this control moves)"],
      outputs: ["value — what the target holds now, so a template can read the control by name"],
      options: ["kind=slider|toggle|pick|number|text", "label", "options (for pick)", "block (a section to put it in)"],
      languages: ["label", "options[].label"],
      functions: [],
      example: { "type": "control", "kind": "slider", "target": "t", "label": { "fi": "Lämpötila", "en": "Temperature" }, "block": "controls" },
      file: "nodes/control.js"
    },
    "formula": {
      summary: "A spreadsheet expression over the other nodes, worked out with its units.",
      inputs: ["expr (an expression naming other nodes; it may hold a whole ROW of values, and every operation goes down one)"],
      outputs: ["value — the result, with its unit", "tex — the same expression set as mathematics"],
      options: ["unit (convert the result, or name a plain one)", "format (how the answer is printed: 1", '"int"', '"unit"', '{ decimals, group, locale, style, currency, unit, prefix, suffix }; `locale: "auto"` writes the number in the page\'s language)', "label", "block (a section to print it in)"],
      languages: ["label"],
      functions: ["if(cond, a, b)", "and", "or", "not", "= <> < <= > >=", "& joins text", "+ - * / ^", "min(xs) and max(xs) reduce a row to one value; min(a, b, …) and max(a, b, …) with two or more arguments go element by element, which is how a surplus is written: max(0, pv - load)", "sum", "avg", "count", "first", "last", "abs", "sqrt", "pow", "exp", "ln", "log", "log10", "round(x, decimals)", "floor", "ceil", "clamp(x, lo, hi)", 'convert(x, "K")', "fraction(x) and percent(x), the two doors of the percentage rule", "text", "number", "sin", "cos", "tan", "asin", "acos", "atan", "atan2(y, x)", "deg(radians) and rad(degrees), because every angle in this language is in RADIANS", "pi", "ROWS — a list is an ordinary value and every operation above goes down one, a plain number repeating against it and two lists of different lengths refused by name: range(n)", "range(from, to)", "range(from, to, step), counted from the first and stopping BEFORE the last", "map(xs, expr), where the element is `x` and its position `i`", "fold(xs, start, expr), where what is being built is `acc`, answering with the last one", "scan(xs, start, expr), the same step answering with EVERY accumulator INCLUDING the one it started from, so it is ONE LONGER than the list and a 24-hour battery gives 25 readings", "cumsum(xs)", "index(xs, i), counted from 0", "at(xs, t), which reads BETWEEN two positions and stops at the ends", "where(cond, a, b), the element-wise if"],
      example: { "type": "formula", "expr": "t * 9/5 + 32", "unit": "°F", "format": 1, "label": { "fi": "Fahrenheit", "en": "Fahrenheit" }, "block": "maths" },
      file: "nodes/formula.js"
    },
    "machine": {
      summary: "A statechart in XState's vocabulary; its output is the state it is in.",
      inputs: ["initial", "states (nested allowed)", "when (crossings that send events)"],
      outputs: ['value — the current state as a dotted path, e.g. "hot" or "hot.rising"'],
      options: ["on { EVENT: { target, guard } }", "entry", "exit", "after { ms: target }", "block (a section to show it in)"],
      languages: ["label", "the entry and exit assignments that write words"],
      functions: [],
      example: { "type": "machine", "initial": "fine", "states": { "cold": { "on": { "WARM": "fine" } }, "fine": { "on": { "HOT": "hot", "COLD": "cold" } }, "hot": { "entry": { "note": { "fi": '"jäähdytä"', "en": '"cool it down"' } }, "on": { "COOL": { "target": "fine", "guard": "t < 30" } } } }, "when": [{ "expr": "t > 30", "send": "HOT" }, { "expr": "t < 30", "send": "COOL" }, { "expr": "t < 5", "send": "COLD" }] },
      file: "nodes/machine-node.js"
    },
    "source": {
      summary: "A live value from a memory key or a URL, or a constant when the page cannot read one.",
      inputs: ["key (a memory key)", "url (an address, read through the node's living-hooks extension)", "path (a path inside the answer, dots and brackets)", "raw (take the body itself as the value)", "value (the fallback)"],
      outputs: ["value — what the key or the address holds now, with the node's unit on it", "stale — the words a failed read left, empty while it is fresh"],
      options: ["unit", "every (seconds between reads of a url; the floor is 10)", "format (how it is printed: 1", '"int"', '"unit"', 'an object; `locale: "auto"` writes the number in the page\'s language)', "scope=own|public", "owner (for a public read)", "label"],
      languages: ["label"],
      functions: [],
      example: { "type": "source", "url": "https://api.porssisahko.net/v1/latest-prices.json", "path": "prices[0].price", "every": 900, "unit": "EUR/kWh", "value": 0.042, "label": { "fi": "Pörssihinta", "en": "Spot price" } },
      file: "nodes/source.js"
    },
    "text": {
      summary: "A sentence over the graph: it changes when the numbers do.",
      inputs: ["template (with {{ node }}, {{ node | format }} and {{ if expr }}…{{ else }}…{{ end }})"],
      outputs: ["value — the rendered sentence"],
      options: ["block (a section to render it into)", "label"],
      languages: ["template", "label"],
      functions: [],
      example: { "type": "text", "template": { "fi": "Lämpötila on {{ t | 1 }} °C, {{ if t > 30 }}liian kuuma{{ else }}hyvä{{ end }}.", "en": "It is {{ t | 1 }} °C, {{ if t > 30 }}too hot{{ else }}fine{{ end }}." }, "block": "note" },
      file: "nodes/text-node.js"
    },
    "trigger": {
      summary: "When a machine moves, the document tells somebody: a URL, or one of your own agents.",
      inputs: ["on (the machine id it watches, or { node, when } for a crossing that turns true)"],
      outputs: ["value — the time of the last delivery, empty before the first"],
      options: ['target { kind: "url", url, method } or { kind: "agent", agent }', "enabled", 'include ("all", or a list of node ids whose rows then go whole)', "label"],
      languages: ["label"],
      functions: [],
      example: { "type": "trigger", "on": "phase", "enabled": true, "target": { "kind": "url", "url": "https://example.org/hook", "method": "POST" }, "include": "all", "label": { "fi": "Kerro invertterille", "en": "Tell the inverter" } },
      file: "nodes/trigger.js"
    },
    "value": {
      summary: "A named quantity: the writable ground the rest of the document stands on.",
      inputs: ["value (the quantity itself, a literal — never a reference)"],
      outputs: ["value — the number with its unit, or the text, truth or list it holds"],
      options: ["unit", "min", "max", "step", "format (how it is printed: 1", '"int"', '"unit"', 'an object; `locale: "auto"` writes the number in the page\'s language)', "label"],
      languages: ["label"],
      functions: [],
      example: { "type": "value", "value": 22, "unit": "°C", "min": -20, "max": 40, "step": 0.5, "format": 1, "label": { "fi": "Lämpötila", "en": "Temperature" } },
      file: "nodes/value.js"
    }
  };

  // src/static/sdk-libs/living/hooks.js
  var EXTENSION = "living-hooks";
  function now() {
    try {
      if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
        return performance.now();
      }
    } catch {
    }
    return Date.now();
  }
  function currentSession() {
    try {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (!ns || !ns.auth || typeof ns.auth.getSession !== "function") return null;
      return ns.auth.getSession() || null;
    } catch {
      return null;
    }
  }
  function createHooks(opts) {
    const options = opts || {};
    const transport = typeof options.transport === "function" ? options.transport : null;
    const langs = typeof options.langs === "function" ? options.langs : function() {
      return [];
    };
    const ext = String(options.extension || EXTENSION);
    function signedIn() {
      if (typeof options.signedIn === "boolean") return options.signedIn;
      return !!currentSession();
    }
    async function overTheWire(req) {
      const session = currentSession();
      if (!session || typeof session.fetch !== "function") {
        return { error: { code: "NO_EXTENSION", message: say("refusal.NO_EXTENSION", langs()) } };
      }
      const head = { "Content-Type": "application/json" };
      if (req.kind === "task") {
        const made = await session.fetch("/v1/agents/" + encodeURIComponent(String(req.agent)) + "/tasks", {
          method: "POST",
          headers: head,
          body: JSON.stringify({ title: req.title, description: req.description })
        });
        if (!made || !made.ok) return { error: made && made.error || { code: "UPSTREAM_FAILED" } };
        return { ok: true, status: 201 };
      }
      const body = req.kind === "read" ? { url: req.url, path: req.path, raw: req.raw, headers: req.headers } : { url: req.url, method: req.method, headers: req.headers, body: req.body };
      const answer = await session.fetch("/v1/ext/" + encodeURIComponent(ext) + "/" + (req.kind === "read" ? "read" : "send"), {
        method: "POST",
        headers: head,
        body: JSON.stringify(body)
      });
      if (!answer || !answer.ok) return { error: answer && answer.error || { code: "UPSTREAM_FAILED" } };
      return answer.data || {};
    }
    async function call(req) {
      if (!signedIn()) {
        return {
          refusal: {
            code: "SIGNED_OUT",
            message: say(req.kind === "read" ? "guest.read" : "guest.send", langs())
          },
          ms: 0
        };
      }
      const started = now();
      try {
        const answer = transport ? await transport(req) : await overTheWire(req);
        const ms = Math.round(now() - started);
        if (answer && answer.error) return { refusal: answer.error, ms };
        return Object.assign({ ms }, answer || {});
      } catch (e) {
        return {
          refusal: { code: "UPSTREAM_FAILED", message: e && e.message || String(e) },
          ms: Math.round(now() - started)
        };
      }
    }
    return {
      /** Whether this page can make the call at all, and the words to say when it cannot. */
      status() {
        const ok = signedIn();
        return { signedIn: ok, reason: ok ? "" : say("guest.send", langs()) };
      },
      signedIn,
      /** The refusal a read earns for a guest, in words — the source runtime shows this on the node. */
      guestRead() {
        return say("guest.read", langs());
      },
      /** A refusal as a person reads it: the node's own sentence first, the code's fallback second. */
      words(refusal) {
        return refusalWords(refusal, langs());
      },
      /** @param {{ url: string, method?: string, headers?: object, body: any }} req */
      send(req) {
        return call({
          kind: "send",
          url: String(req.url),
          method: String(req.method || "POST"),
          headers: req.headers,
          body: req.body
        });
      },
      /** @param {{ url: string, path?: string, raw?: boolean, headers?: object }} req */
      read(req) {
        return call({
          kind: "read",
          url: String(req.url),
          path: req.path,
          raw: req.raw,
          headers: req.headers
        });
      },
      /** @param {{ agent: string, title: string, description: string, body: any }} req */
      task(req) {
        return call({
          kind: "task",
          agent: String(req.agent),
          title: String(req.title),
          description: String(req.description),
          body: req.body
        });
      }
    };
  }

  // src/static/sdk-libs/living/payload.js
  var ROW_HEAD = 24;
  var CARRIES_A_VALUE = ["value", "formula", "source", "text"];
  function readValue(v) {
    if (isQuantity(v)) return v.n;
    if (Array.isArray(v)) return v.map(readValue);
    if (isError(v)) return null;
    if (v === void 0) return null;
    return v;
  }
  function unitOf(v) {
    if (isQuantity(v)) return unitLabel(v.u);
    if (Array.isArray(v) && v.length && isQuantity(v[0])) return unitLabel(v[0].u);
    return "";
  }
  function buildPayload(spec) {
    const doc = spec.doc || {};
    const graph = spec.graph;
    const langs = typeof spec.langs === "function" ? spec.langs : function() {
      return [];
    };
    const wanted = langs();
    const nodes = (doc.model || {}).nodes || {};
    const trigger2 = spec.trigger || {};
    const named = Array.isArray(trigger2.include) ? trigger2.include.map(String) : null;
    const values = {};
    const machines = {};
    for (const id of graph.ids) {
      const node2 = nodes[id] || {};
      const type = String(node2.type);
      if (type === "machine") {
        machines[id] = String(graph.valueOf(id) || "");
        continue;
      }
      if (CARRIES_A_VALUE.indexOf(type) < 0) continue;
      if (named && named.indexOf(id) < 0) continue;
      const raw = graph.valueOf(id);
      let value2 = readValue(raw);
      if (Array.isArray(value2) && !named) {
        value2 = { length: value2.length, head: value2.slice(0, ROW_HEAD) };
      }
      const entry = {
        value: value2,
        unit: unitOf(raw),
        label: String(textOf(node2.label, wanted) || id)
      };
      if (isError(raw)) entry.error = String(raw.error);
      const stale = String((graph.fieldsOf(id) || {}).stale || "");
      if (stale) entry.stale = stale;
      values[id] = entry;
    }
    const body = {
      document: {
        key: String(doc.key || ""),
        title: String(textOf(doc.title, wanted) || ""),
        register: String(doc.register || "")
      },
      at: String(spec.at || (/* @__PURE__ */ new Date()).toISOString()),
      transition: {
        node: String((spec.transition || {}).node || ""),
        from: String((spec.transition || {}).from || ""),
        to: String((spec.transition || {}).to || ""),
        event: String((spec.transition || {}).event || "")
      },
      values,
      machines,
      trigger: {
        id: String(spec.triggerId || ""),
        label: String(textOf(trigger2.label, wanted) || spec.triggerId || "")
      }
    };
    if (spec.test) body.test = true;
    return body;
  }

  // src/static/sdk-libs/living/deliver.js
  var KEPT = 50;
  function asLine(v) {
    if (v == null) return "";
    if (typeof v === "object" && typeof v.n === "number") return String(v.n);
    if (Array.isArray(v)) return "[" + v.length + "]";
    if (typeof v === "object") return "";
    return String(v);
  }
  function truthy2(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (v && typeof v === "object" && typeof v.n === "number") return v.n !== 0;
    if (typeof v === "string") return v !== "";
    return !!v;
  }
  function createDeliveries(spec) {
    const doc = spec.doc || {};
    const graph = spec.graph;
    const hooks = spec.hooks;
    const langs = typeof spec.langs === "function" ? spec.langs : function() {
      return [];
    };
    const log = [];
    const crossings = /* @__PURE__ */ new Map();
    const trees = /* @__PURE__ */ new Map();
    let destroyed = false;
    function triggers() {
      const nodes = (doc.model || {}).nodes || {};
      const out = [];
      for (const id of Object.keys(nodes)) {
        const node2 = nodes[id] || {};
        if (String(node2.type) === "trigger") out.push({ id, node: node2 });
      }
      return out;
    }
    function masterOn() {
      return !(doc.hooks && doc.hooks.enabled === false);
    }
    function treeFor(when) {
      if (!trees.has(when)) {
        const tree = parse(String(when));
        trees.set(when, isError(tree) ? null : tree);
      }
      return trees.get(when);
    }
    function transitionFor(entry, transitions) {
      const watch = watchOf(entry.node);
      if (!watch.node) return null;
      if (!watch.when) {
        let found = null;
        for (const move of transitions) if (move.node === watch.node) found = move;
        return found;
      }
      const tree = treeFor(watch.when);
      if (!tree) return null;
      const before = crossings.get(entry.id);
      const value2 = graph.valueOf(watch.node);
      const now2 = truthy2(evaluate(tree, graph.scope));
      crossings.set(entry.id, { on: now2, reading: asLine(value2) });
      if (!now2 || before && before.on) return null;
      return {
        node: watch.node,
        from: before ? before.reading : "",
        to: asLine(value2),
        event: watch.when
      };
    }
    function taskTitle(transition) {
      const title = String(textOf(doc.title, langs()) || doc.key || "");
      return "Living document: " + title + ", " + transition.from + " → " + transition.to;
    }
    async function deliver(id, node2, transition, isTest) {
      const at = (/* @__PURE__ */ new Date()).toISOString();
      const body = buildPayload({
        doc,
        graph,
        langs,
        triggerId: id,
        trigger: node2,
        transition,
        at,
        test: !!isTest
      });
      const target = node2.target || {};
      const answer = String(target.kind) === "agent" ? await hooks.task({
        agent: String(target.agent || ""),
        title: taskTitle(transition),
        description: fill(say("sentence.task", langs()), {
          title: String(textOf(doc.title, langs()) || doc.key || ""),
          from: transition.from,
          to: transition.to
        }) + "\n\n" + JSON.stringify(body, null, 2),
        body
      }) : await hooks.send({
        url: String(target.url || ""),
        method: String(target.method || "POST"),
        body
      });
      const event = {
        trigger: id,
        at,
        test: !!isTest,
        ok: !answer.refusal,
        status: Number(answer.status || 0),
        ms: Number(answer.ms || 0),
        refusal: answer.refusal ? hooks.words(answer.refusal) : "",
        transition
      };
      log.push(event);
      while (log.length > KEPT) log.shift();
      if (spec.onDelivery) spec.onDelivery(event);
      if (!isTest && event.ok) {
        const out = graph.set(id, at);
        if (spec.onChanged && out.changed.length) spec.onChanged(out.changed);
      }
      return event;
    }
    return {
      /**
       * Everything one graph operation set off. Handed the operation's own result, so the
       * transitions are the ones it actually made rather than a guess from the changed list.
       * @param {{ changed?: string[], transitions?: any[] }} result
       * @returns {Promise<any[]>}
       */
      async after(result) {
        if (destroyed) return [];
        const transitions = result && result.transitions || [];
        const out = [];
        for (const entry of triggers()) {
          if (entry.node.enabled === false || !masterOn()) {
            continue;
          }
          const transition = transitionFor(entry, transitions);
          if (!transition) continue;
          out.push(await deliver(entry.id, entry.node, transition, false));
        }
        return out;
      },
      /**
       * A sample message, marked as one. It goes even when the switches are off, because that is
       * what a person pressing "test send" is asking for; the node's allowlist still decides.
       * @param {string} triggerId
       */
      async test(triggerId) {
        const nodes = (doc.model || {}).nodes || {};
        const node2 = nodes[String(triggerId)];
        if (!node2 || String(node2.type) !== "trigger") {
          return { trigger: String(triggerId), ok: false, status: 0, ms: 0, refusal: "No trigger by that name." };
        }
        const watch = watchOf(node2);
        const state = String(graph.valueOf(watch.node) || "");
        return deliver(String(triggerId), node2, {
          node: watch.node,
          from: state,
          to: state,
          event: watch.when || "TEST"
        }, true);
      },
      /**
       * REMEMBER WHERE THE CROSSINGS STAND, WITHOUT TELLING ANYBODY. Mounting is not a change: a
       * page opened twice must not send two messages saying nothing happened. So the crossing
       * expressions are evaluated once on the state as found, and the first rising edge that counts
       * is the first one a person or a reading actually causes.
       */
      prime() {
        for (const entry of triggers()) {
          const watch = watchOf(entry.node);
          if (!watch.when) continue;
          const tree = treeFor(watch.when);
          if (!tree) continue;
          crossings.set(entry.id, {
            on: truthy2(evaluate(tree, graph.scope)),
            reading: asLine(graph.valueOf(watch.node))
          });
        }
      },
      /** The deliveries this mount has made, oldest first. */
      list() {
        return log.slice();
      },
      /** Whether this page can tell anybody anything, and why not when it cannot. */
      status() {
        const from = hooks.status();
        return {
          signedIn: from.signedIn,
          enabled: masterOn(),
          reason: from.signedIn ? "" : from.reason,
          triggers: triggers().map(function(e) {
            return e.id;
          })
        };
      },
      destroy() {
        destroyed = true;
      }
    };
  }

  // src/static/sdk-libs/living/sources-url.js
  function asRaw(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const text = v.trim();
      if (text !== "" && Number.isFinite(Number(text))) return Number(text);
    }
    return v;
  }
  function createUrlSources(spec) {
    const doc = spec.doc || {};
    const graph = spec.graph;
    const hooks = spec.hooks;
    const langs = typeof spec.langs === "function" ? spec.langs : function() {
      return [];
    };
    const timers = /* @__PURE__ */ new Map();
    let destroyed = false;
    let running = false;
    let watching = null;
    function sources() {
      const nodes = (doc.model || {}).nodes || {};
      const out = [];
      for (const id of Object.keys(nodes)) {
        const node2 = nodes[id] || {};
        if (String(node2.type) === "source" && node2.url) out.push({ id, node: node2 });
      }
      return out;
    }
    function everyOf(node2) {
      const n = Number(node2.every);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.max(EVERY_FLOOR, n);
    }
    function report(out) {
      if (spec.onResult && out && out.changed && out.changed.length) spec.onResult(out);
    }
    async function readOnce(id) {
      if (destroyed) return;
      const node2 = ((doc.model || {}).nodes || {})[String(id)];
      if (!node2 || !node2.url) return;
      const answer = await hooks.read({
        url: String(node2.url),
        path: node2.path,
        raw: node2.raw ? true : void 0
      });
      if (destroyed) return;
      if (answer.refusal) {
        const words2 = String(answer.refusal.code) === "SIGNED_OUT" ? hooks.words(answer.refusal) : say("stale.lead", langs()) + hooks.words(answer.refusal) + say("stale.tail", langs());
        report(graph.setField(String(id), "stale", words2));
        return;
      }
      const value2 = node2.raw ? asRaw(answer.value) : answer.value;
      report(graph.set(String(id), value2));
      report(graph.setField(String(id), "stale", ""));
    }
    function visible() {
      try {
        if (typeof document === "undefined" || !document) return true;
        return document.visibilityState !== "hidden";
      } catch {
        return true;
      }
    }
    function clearTimers() {
      for (const [, handle] of timers) clearInterval(handle);
      timers.clear();
    }
    function arm() {
      clearTimers();
      if (destroyed || !running || !visible()) return;
      for (const entry of sources()) {
        const every = everyOf(entry.node);
        if (!every) continue;
        timers.set(entry.id, setInterval(function() {
          readOnce(entry.id);
        }, every * 1e3));
      }
    }
    return {
      /** Read every address once, then keep the ones with an `every` up to date. */
      start() {
        if (destroyed) return Promise.resolve();
        running = true;
        if (!watching) {
          watching = function() {
            arm();
          };
          try {
            document.addEventListener("visibilitychange", watching);
          } catch {
            watching = null;
          }
        }
        const first = sources().map(function(entry) {
          return readOnce(entry.id);
        });
        arm();
        return Promise.all(first);
      },
      /** Stop asking, without forgetting anything. */
      stop() {
        running = false;
        clearTimers();
      },
      readOnce,
      /** Which nodes are on a clock, and how often — after the floor has been applied. */
      polled() {
        const out = [];
        for (const entry of sources()) {
          const every = everyOf(entry.node);
          if (every) out.push({ id: entry.id, every });
        }
        return out;
      },
      destroy() {
        destroyed = true;
        running = false;
        clearTimers();
        if (watching) {
          try {
            document.removeEventListener("visibilitychange", watching);
          } catch {
          }
          watching = null;
        }
      }
    };
  }

  // src/static/sdk-libs/living/hooks-shapes.js
  function vocabularyOf(type) {
    const found = NODES[String(type)];
    return found ? Object.assign({ id: String(type) }, found) : { id: String(type) };
  }
  function memoryKeyFor(doc, id) {
    return String(doc && doc.key || "living") + ".in." + String(id);
  }
  function inwardShape(ctx) {
    const doc = ctx.doc || {};
    const nodes = (doc.model || {}).nodes || {};
    const langs = typeof ctx.langs === "function" ? ctx.langs : function() {
      return [];
    };
    const wanted = langs();
    const subjectId = String(ctx.node && ctx.node.type === "control" && ctx.node.target ? ctx.node.target : ctx.id);
    const subject = nodes[subjectId] || ctx.node || {};
    const sample = readValue(ctx.graph ? ctx.graph.valueOf(subjectId) : subject.value);
    const road = subject.url ? "url" : subject.key ? "key" : "hand";
    const path = String(subject.path || "");
    const expected = subject.raw ? sample : shapeFor(path || "value", sample);
    const base = String(ctx.base || "");
    const key = memoryKeyFor(doc, subjectId);
    const body = { key, value: { value: sample } };
    const hasRange = typeof subject.min === "number" || typeof subject.max === "number" || typeof subject.step === "number";
    return {
      subject: subjectId,
      target: subjectId,
      label: String(textOf(subject.label, wanted) || subjectId),
      road,
      url: String(subject.url || ""),
      path,
      raw: !!subject.raw,
      every: subject.every == null ? "" : String(subject.every),
      key: String(subject.key || ""),
      sample,
      /** The answer a URL has to give for THIS node to find its number in it. */
      expected,
      range: hasRange ? { min: subject.min, max: subject.max, step: subject.step, unit: String(subject.unit || "") } : null,
      /** The memory road: the key, the request, and a line somebody can paste into a terminal. */
      write: {
        key,
        request: {
          method: "POST",
          url: base + "/v1/memory",
          headers: { "Content-Type": "application/json", Authorization: "Bearer <your token>" },
          body
        },
        curl: "curl -X POST " + base + `/v1/memory -H "Content-Type: application/json" -H "Authorization: Bearer <your token>" -d '` + JSON.stringify(body) + "'"
      },
      /** The agent road: the same thing said out loud, in the language the page is reading. */
      sentence: fill(say("sentence.write", wanted), {
        key,
        sample: JSON.stringify(sample),
        title: String(textOf(doc.title, wanted) || doc.key || "")
      }),
      vocabulary: vocabularyOf(subject.type || "value")
    };
  }
  function outwardShape(ctx) {
    const doc = ctx.doc || {};
    const nodes = (doc.model || {}).nodes || {};
    const langs = typeof ctx.langs === "function" ? ctx.langs : function() {
      return [];
    };
    const wanted = langs();
    const isTrigger = String((ctx.node || {}).type) === "trigger";
    let triggerId = isTrigger ? String(ctx.id) : null;
    if (!triggerId) {
      for (const id of Object.keys(nodes)) {
        const node2 = nodes[id] || {};
        if (String(node2.type) === "trigger" && watchOf(node2).node === String(ctx.id)) {
          triggerId = id;
          break;
        }
      }
    }
    const written = triggerId ? nodes[triggerId] : null;
    const watching = written ? watchOf(written).node : String(ctx.id);
    const machine = nodes[watching] || {};
    const target = written && written.target || {};
    const kind = String(target.kind || "url") === "agent" ? "agent" : "url";
    const shaped = kind === "agent" ? { kind: "agent", agent: String(target.agent || "") } : { kind: "url", url: String(target.url || ""), method: String(target.method || "POST") };
    const draft = written || {
      type: "trigger",
      on: watching,
      enabled: true,
      target: shaped,
      include: "all"
    };
    const state = String(ctx.graph ? ctx.graph.valueOf(watching) || "" : "");
    return {
      /** The trigger's id when the record already carries one, null when this would write the first. */
      trigger: triggerId,
      /** The id a new trigger would be written under, so the dialog can say it before saving. */
      newId: String(watching) + "Tells",
      watching,
      label: String(textOf(draft.label, wanted) || textOf(machine.label, wanted) || watching),
      states: statesOf(machine),
      enabled: draft.enabled !== false,
      include: Array.isArray(draft.include) ? draft.include.slice() : "all",
      target: shaped,
      methods: TRIGGER_METHODS.slice(),
      /** The message as it would go, for the state the document is in right now. */
      payload: buildPayload({
        doc,
        graph: ctx.graph,
        langs,
        triggerId: triggerId || String(watching) + "Tells",
        trigger: draft,
        transition: { node: watching, from: state, to: state, event: "" },
        at: (/* @__PURE__ */ new Date()).toISOString()
      }),
      vocabulary: vocabularyOf("trigger")
    };
  }

  // src/static/sdk-libs/living/dialog-parts.js
  function group(host, title) {
    const body = el("div", { class: "ak-living__dialog-body" });
    const root = el("section", { class: "ak-living__dialog-group" }, [
      el("h3", { class: "ak-living__dialog-heading", text: String(title) }),
      body
    ]);
    host.appendChild(root);
    return {
      el: root,
      body,
      show(on) {
        root.hidden = !on;
      }
    };
  }
  function fields(host, list, draft) {
    const k = kit();
    const handle = k.form({
      target: host,
      submit: false,
      fields: list.map(function(field) {
        return Object.assign({}, field, {
          onInput(value2) {
            draft[field.name] = value2;
            if (field.after) field.after(value2);
          }
        });
      })
    });
    handle.el.classList.add("ak-living__dialog-fields");
    return handle;
  }
  function copyBlock(host, spec) {
    const langs = typeof spec.langs === "function" ? spec.langs : function() {
      return [];
    };
    const pre = el("pre", { class: "ak-living__copy-text", tabindex: "0", text: String(spec.text) });
    const button = el("button", {
      type: "button",
      class: "ak-btn ak-btn--outline ak-living__copy-btn",
      text: say("copy", langs()),
      on: {
        click() {
          const text = pre.textContent || "";
          const done = function() {
            button.textContent = say("copied", langs());
            setTimeout(function() {
              button.textContent = say("copy", langs());
            }, 1600);
          };
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(done, function() {
                select();
              });
              return;
            }
          } catch {
          }
          select();
        }
      }
    });
    function select() {
      try {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        pre.focus();
      } catch {
      }
    }
    const root = el("div", { class: "ak-living__copy" }, [
      el("div", { class: "ak-living__copy-head" }, [
        el("span", { class: "ak-living__copy-label", text: String(spec.label) }),
        button
      ]),
      pre
    ]);
    host.appendChild(root);
    return {
      el: root,
      set(text) {
        pre.textContent = String(text);
      }
    };
  }
  function statusLine(host) {
    const line = el("p", { class: "ak-living__dialog-status", role: "status" });
    host.appendChild(line);
    return {
      el: line,
      say(text, ok) {
        line.textContent = String(text || "");
        line.setAttribute("data-ok", ok ? "yes" : "no");
      }
    };
  }
  function vocabularyNote(host, vocabulary) {
    const root = el("div", { class: "ak-living__vocabulary" }, [
      el("p", { class: "ak-living__vocabulary-summary", text: String(vocabulary.summary || "") }),
      el("p", {
        class: "ak-living__vocabulary-options",
        text: (vocabulary.options || []).join(" · ")
      })
    ]);
    host.appendChild(root);
    return root;
  }

  // src/static/sdk-libs/living/dialog-inward.js
  function reading(value2) {
    if (value2 == null) return "";
    if (typeof value2 === "object") return JSON.stringify(value2);
    return String(value2);
  }
  function openInward(spec) {
    const langs = typeof spec.langs === "function" ? spec.langs : function() {
      return [];
    };
    const shape = inwardShape(spec);
    const words2 = function(key) {
      return say(key, langs());
    };
    const draft = {
      road: shape.road,
      url: shape.url,
      path: shape.path,
      every: shape.every,
      key: shape.key
    };
    const k = kit();
    const handle = k.dialog({
      title: words2("inward.title"),
      text: words2("inward.lead"),
      size: "wide",
      body(host) {
        host.classList.add("ak-living__dialog");
        const roads = group(host, words2("inward.road"));
        const urlRoad = group(host, words2("inward.url"));
        const keyRoad = group(host, words2("inward.write"));
        function showRoad() {
          urlRoad.show(draft.road === "url");
          keyRoad.show(draft.road === "key");
        }
        fields(roads.body, [{
          name: "road",
          id: "ak-living-road",
          type: "select",
          label: words2("inward.road"),
          value: draft.road,
          options: [
            { value: "hand", label: words2("inward.road.hand") },
            { value: "url", label: words2("inward.road.url") },
            { value: "key", label: words2("inward.road.key") }
          ],
          after: showRoad
        }], draft);
        const expected = { block: null };
        fields(urlRoad.body, [
          { name: "url", id: "ak-living-url", type: "text", label: words2("inward.url"), value: draft.url },
          {
            name: "path",
            id: "ak-living-path",
            type: "text",
            label: words2("inward.path"),
            value: draft.path,
            after() {
              if (expected.block) expected.block.set(JSON.stringify(shapeNow(), null, 2));
            }
          },
          { name: "every", id: "ak-living-every", type: "number", label: words2("inward.every"), value: draft.every, min: 10 }
        ], draft);
        function shapeNow() {
          return inwardShape(Object.assign({}, spec, {
            node: Object.assign({}, spec.node, { path: draft.path, raw: shape.raw, url: draft.url || "x" })
          })).expected;
        }
        expected.block = copyBlock(urlRoad.body, {
          label: words2("inward.expected"),
          text: JSON.stringify(shape.expected, null, 2),
          langs
        });
        const urlStatus = statusLine(urlRoad.body);
        const testRead = document.createElement("button");
        testRead.type = "button";
        testRead.className = "ak-btn ak-btn--outline ak-living__dialog-test";
        testRead.textContent = words2("inward.testRead");
        testRead.addEventListener("click", function() {
          urlStatus.say("…", true);
          spec.hooks.read({ url: draft.url, path: draft.path, raw: shape.raw ? true : void 0 }).then(function(answer) {
            if (answer.refusal) {
              urlStatus.say(spec.hooks.words(answer.refusal), false);
              return;
            }
            const got = shape.raw ? asRaw(answer.value) : answer.value;
            urlStatus.say(reading(got), true);
          });
        });
        urlRoad.body.appendChild(testRead);
        fields(keyRoad.body, [{
          name: "key",
          id: "ak-living-key",
          type: "text",
          label: words2("inward.key"),
          value: draft.key || shape.write.key
        }], draft);
        copyBlock(keyRoad.body, {
          label: words2("inward.write"),
          text: shape.write.curl,
          langs
        });
        copyBlock(host, { label: words2("inward.agent"), text: shape.sentence, langs });
        if (shape.range) {
          const line = document.createElement("p");
          line.className = "ak-living__dialog-range";
          line.textContent = words2("inward.range") + ": " + [
            shape.range.min,
            shape.range.max
          ].filter(function(n) {
            return n != null;
          }).join(" … ") + (shape.range.unit ? " " + shape.range.unit : "") + (shape.range.step != null ? " (" + shape.range.step + ")" : "");
          host.appendChild(line);
        }
        vocabularyNote(host, shape.vocabulary);
        showRoad();
      },
      actions: [
        { id: "close", label: words2("close"), tone: "ghost", run: function() {
          handle.close("close");
        } },
        { id: "save", label: words2("save"), tone: "primary", run: function() {
          save();
          handle.close("save");
        } }
      ]
    });
    function save() {
      const nodes = ((spec.doc || {}).model || {}).nodes || {};
      const node2 = nodes[shape.subject];
      if (!node2) return;
      delete node2.url;
      delete node2.key;
      delete node2.every;
      if (draft.road === "url") {
        node2.type = "source";
        node2.url = String(draft.url || "");
        if (draft.path) node2.path = String(draft.path);
        else delete node2.path;
        const every = Number(draft.every);
        if (Number.isFinite(every) && every > 0) node2.every = every;
      } else if (draft.road === "key") {
        node2.type = "source";
        node2.key = String(draft.key || shape.write.key);
        if (draft.path) node2.path = String(draft.path);
        else delete node2.path;
      } else {
        node2.type = "value";
        delete node2.path;
        delete node2.raw;
      }
      if (spec.onSave) spec.onSave(shape.subject);
    }
    return handle;
  }

  // src/static/sdk-libs/living/dialog-outward.js
  function openOutward(spec) {
    const langs = typeof spec.langs === "function" ? spec.langs : function() {
      return [];
    };
    const shape = outwardShape(spec);
    const words2 = function(key) {
      return say(key, langs());
    };
    const draft = {
      kind: shape.target.kind,
      url: String(shape.target.url || ""),
      method: String(shape.target.method || "POST"),
      agent: String(shape.target.agent || ""),
      enabled: shape.enabled
    };
    const k = kit();
    const handle = k.dialog({
      title: words2("outward.title"),
      text: words2("outward.lead"),
      size: "wide",
      body(host) {
        host.classList.add("ak-living__dialog");
        const watching = el("p", { class: "ak-living__dialog-watch" }, [
          el("span", { class: "ak-living__dialog-watch-label", text: words2("outward.watching") + ": " }),
          el("code", { text: shape.watching })
        ]);
        host.appendChild(watching);
        if (shape.states.length) {
          const strip = el("div", { class: "ak-living__states ak-living__dialog-states", role: "group" });
          for (const name of shape.states) {
            strip.appendChild(el("span", {
              class: "ak-living__state",
              "data-state": name,
              text: name,
              "data-on": String(shape.payload.machines[shape.watching] || "").split(".").indexOf(name) >= 0 ? "yes" : "no"
            }));
          }
          host.appendChild(el("div", { class: "ak-living__dialog-group" }, [
            el("h3", { class: "ak-living__dialog-heading", text: words2("outward.states") }),
            strip
          ]));
        }
        const who = group(host, words2("outward.kind"));
        const urlRoad = group(host, words2("outward.url"));
        const agentRoad = group(host, words2("outward.agent"));
        function showKind() {
          urlRoad.show(draft.kind === "url");
          agentRoad.show(draft.kind === "agent");
        }
        fields(who.body, [
          {
            name: "kind",
            id: "ak-living-kind",
            type: "select",
            label: words2("outward.kind"),
            value: draft.kind,
            options: [
              { value: "url", label: words2("outward.kind.url") },
              { value: "agent", label: words2("outward.kind.agent") }
            ],
            after: showKind
          },
          {
            name: "enabled",
            id: "ak-living-enabled",
            type: "toggle",
            label: words2("outward.enabled"),
            value: draft.enabled
          }
        ], draft);
        fields(urlRoad.body, [
          { name: "url", id: "ak-living-hook-url", type: "text", label: words2("outward.url"), value: draft.url },
          {
            name: "method",
            id: "ak-living-hook-method",
            type: "select",
            label: words2("outward.method"),
            value: draft.method,
            options: shape.methods.map(function(m) {
              return { value: m, label: m };
            })
          }
        ], draft);
        fields(agentRoad.body, [
          { name: "agent", id: "ak-living-hook-agent", type: "text", label: words2("outward.agent"), value: draft.agent }
        ], draft);
        copyBlock(host, {
          label: words2("outward.payload"),
          text: JSON.stringify(shape.payload, null, 2),
          langs
        });
        const status = statusLine(host);
        const testSend = el("button", {
          type: "button",
          class: "ak-btn ak-btn--outline ak-living__dialog-test",
          text: words2("outward.testSend"),
          on: {
            click() {
              status.say("…", true);
              const body = Object.assign({}, shape.payload, { test: true });
              const call = draft.kind === "agent" ? spec.hooks.task({
                agent: draft.agent,
                title: "Living document: " + shape.label + " (test)",
                description: JSON.stringify(body, null, 2),
                body
              }) : spec.hooks.send({ url: draft.url, method: draft.method, body });
              call.then(function(answer) {
                if (answer.refusal) {
                  status.say(spec.hooks.words(answer.refusal), false);
                  return;
                }
                status.say(String(answer.status || 200) + " · " + String(answer.ms || 0) + " ms", true);
              });
            }
          }
        });
        host.appendChild(testSend);
        vocabularyNote(host, shape.vocabulary);
        showKind();
      },
      actions: [
        { id: "close", label: words2("close"), tone: "ghost", run: function() {
          handle.close("close");
        } },
        { id: "save", label: words2("save"), tone: "primary", run: function() {
          save();
          handle.close("save");
        } }
      ]
    });
    function save() {
      const model = (spec.doc || {}).model || {};
      if (!model.nodes) model.nodes = {};
      const id = shape.trigger || shape.newId;
      const before = model.nodes[id] || {};
      model.nodes[id] = Object.assign({}, before, {
        type: "trigger",
        on: shape.watching,
        enabled: !!draft.enabled,
        include: shape.include,
        target: draft.kind === "agent" ? { kind: "agent", agent: String(draft.agent || "") } : { kind: "url", url: String(draft.url || ""), method: String(draft.method || "POST") }
      });
      if (spec.onSave) spec.onSave(id);
    }
    return handle;
  }

  // src/static/sdk-libs/living/validate-lang.js
  function nodeLanguageRefusals(id, node2, out) {
    for (const field of (NODES[String(node2.type)] || {}).languages || []) {
      if (/[^A-Za-z0-9_[\].]/.test(field)) continue;
      const perItem = /^([A-Za-z0-9_]+)\[\]\.([A-Za-z0-9_]+)$/.exec(field);
      if (perItem) {
        const items = node2[perItem[1]];
        if (!Array.isArray(items)) continue;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item || typeof item !== "object") continue;
          const bad2 = langMapError(item[perItem[2]]);
          if (bad2) out.push("Option " + (i + 1) + ' of "' + id + '" has a ' + perItem[2] + " that " + bad2 + ".");
        }
        continue;
      }
      const bad = langMapError(node2[field]);
      if (bad) out.push('Node "' + id + '" has a ' + field + " that " + bad + ".");
    }
  }
  function machineLanguageRefusals(id, node2, out) {
    const walk = (states, prefix) => {
      for (const name of Object.keys(states || {})) {
        const state = states[name] || {};
        const path = prefix ? prefix + "." + name : name;
        for (const kind of ["entry", "exit"]) {
          for (const target of Object.keys(state[kind] || {})) {
            const bad = langMapError(state[kind][target]);
            if (bad) {
              out.push("The " + kind + ' of "' + id + '" at ' + path + " writes a " + target + " that " + bad + ".");
            }
          }
        }
        if (state.states) walk(state.states, path);
      }
    };
    walk(node2.states, "");
  }
  function templateLanguageRefusals(id, node2, out) {
    const bad = langMapError(node2.template);
    if (bad) {
      out.push('The sentence "' + id + '" has a template that ' + bad + ".");
      return;
    }
    if (!isPlainObject(node2.template)) return;
    const perLang = /* @__PURE__ */ new Map();
    for (const lang of langKeysOf(node2.template)) {
      const parts = parseTemplate(node2.template[lang]);
      if (!Array.isArray(parts)) {
        out.push('The sentence "' + id + '" cannot be read in ' + lang + ": " + parts.error);
        continue;
      }
      perLang.set(lang, symbolsOfTemplate(parts).map((s) => s.split(".")[0]));
    }
    const every = [];
    for (const [, list] of perLang) for (const s of list) if (every.indexOf(s) < 0) every.push(s);
    for (const [lang, list] of perLang) {
      for (const s of every) {
        if (list.indexOf(s) >= 0) continue;
        out.push('The sentence "' + id + '" reads "' + s + '" in one language and not in ' + lang + ". A sentence carries the same holes in every language it is written in.");
      }
    }
  }
  function propLanguageRefusals(blockId, props, out, path) {
    if (Array.isArray(props)) {
      props.forEach((p, i) => propLanguageRefusals(blockId, p, out, path + "[" + i + "]"));
      return;
    }
    if (!isPlainObject(props)) return;
    for (const key of Object.keys(props)) {
      const at = props[key];
      const where = (path ? path + "." : "") + key;
      if (TEXT_KEYS.indexOf(key) >= 0 && isPlainObject(at)) {
        const bad = langMapError(at);
        if (bad) out.push('Block "' + blockId + '" has a ' + where + " that " + bad + ".");
        continue;
      }
      if (isPlainObject(at) || Array.isArray(at)) propLanguageRefusals(blockId, at, out, where);
    }
  }

  // src/static/sdk-libs/living/index.js
  var VERSION = "0.6.1";
  var DRAWN = ["control", "formula", "text", "machine", "value", "source", "trigger"];
  function validate(doc) {
    const refusals = [];
    if (!doc || typeof doc !== "object") return { ok: false, refusals: ["This is not a document record."] };
    if (doc.v != null && Number(doc.v) !== 1) refusals.push("This document says it is version " + doc.v + ", and this build reads version 1.");
    const model = doc.model || {};
    const nodes = model.nodes || {};
    if (!nodes || typeof nodes !== "object") return { ok: false, refusals: ["The document has no model.nodes to work out."] };
    const graph = createGraph(doc, { langs: function() {
      return preference(doc);
    } });
    for (const e of graph.errors) refusals.push(e);
    const blocks = /* @__PURE__ */ new Map();
    for (const block of (doc.layout || {}).blocks || []) if (block && block.id) blocks.set(String(block.id), block);
    for (const [blockId, block] of blocks) propLanguageRefusals(blockId, block.props, refusals, "");
    for (const id of Object.keys(nodes)) {
      const node2 = nodes[id] || {};
      nodeLanguageRefusals(id, node2, refusals);
      if (node2.type === "machine") machineLanguageRefusals(id, node2, refusals);
      if (node2.type === "text") templateLanguageRefusals(id, node2, refusals);
      if (node2.type === "binding") {
        const block2 = blocks.get(String(node2.block));
        if (!block2) {
          refusals.push('The binding "' + id + '" writes to block "' + String(node2.block) + '", and the layout has no block by that name.');
        }
        continue;
      }
      if (!node2.block) continue;
      if (DRAWN.indexOf(String(node2.type)) < 0) continue;
      const block = blocks.get(String(node2.block));
      if (!block) {
        refusals.push('Node "' + id + '" is drawn into block "' + String(node2.block) + '", and the layout has no block by that name.');
      } else if (String(block.component) !== "section") {
        refusals.push('Node "' + id + '" is drawn into block "' + block.id + '", which is a ' + block.component + ". A node is drawn into a section.");
      }
    }
    return { ok: refusals.length === 0, refusals };
  }
  function refusalPanel(host, refusals) {
    const k = kit();
    if (k && typeof k.emptyState === "function") {
      return k.emptyState({
        target: host,
        tone: "error",
        title: "This document cannot be worked out yet",
        hint: refusals.join(" ")
      });
    }
    const box = document.createElement("div");
    box.className = "ak-living__refusals";
    for (const r of refusals) {
      const line = document.createElement("p");
      line.textContent = r;
      box.appendChild(line);
    }
    host.appendChild(box);
    return { destroy() {
      if (box.parentNode) box.parentNode.removeChild(box);
    } };
  }
  function mount(target, doc, opts) {
    const options = opts || {};
    const host = (
      /** @type {HTMLElement} */
      resolve(target, document.body)
    );
    let wish = options.language ? String(options.language) : null;
    const langs = function() {
      return preference(doc, wish);
    };
    const check = validate(doc);
    if (!check.ok) {
      const panel = refusalPanel(host, check.refusals);
      return {
        el: host,
        refusals: check.refusals,
        ok: false,
        ready: Promise.resolve(),
        set() {
        },
        get() {
        },
        send() {
        },
        values() {
          return {};
        },
        state() {
          return {};
        },
        chain() {
          return null;
        },
        describe,
        language() {
          return langs()[0];
        },
        setLanguage() {
          return { changed: [] };
        },
        destroy() {
          panel.destroy();
        }
      };
    }
    const graph = createGraph(doc, { langs });
    graph.refresh();
    const plan = planBindings(doc);
    const layout = layoutWithSources(localizeLayout(doc.layout, langs()), plan);
    const wordyBlocks = /* @__PURE__ */ new Set();
    const heroPlace = /* @__PURE__ */ new Map();
    let heroes = 0;
    for (const block of (doc.layout || {}).blocks || []) {
      if (!block || !block.id) continue;
      if (hasLangMap(block.props)) wordyBlocks.add(String(block.id));
      if (String(block.component) === "hero") {
        heroPlace.set(String(block.id), heroes);
        heroes += 1;
      }
    }
    const drawnByBlock = /* @__PURE__ */ new Map();
    const nodes = (doc.model || {}).nodes || {};
    for (const id of Object.keys(nodes)) {
      const node2 = nodes[id] || {};
      if (!node2.block || DRAWN.indexOf(String(node2.type)) < 0) continue;
      const list = drawnByBlock.get(String(node2.block)) || [];
      list.push(id);
      drawnByBlock.set(String(node2.block), list);
    }
    const views = /* @__PURE__ */ new Map();
    let chainHandle = null;
    let timer = null;
    let destroyed = false;
    const hookOpts = options.hooks || {};
    const hooks = createHooks({
      transport: hookOpts.transport,
      signedIn: hookOpts.signedIn,
      extension: hookOpts.extension,
      langs
    });
    const deliveries = createDeliveries({
      doc,
      graph,
      hooks,
      langs,
      onDelivery(event) {
        tellDelivery(event);
      },
      onChanged(ids) {
        announce(ids);
      }
    });
    const live = createUrlSources({
      doc,
      graph,
      hooks,
      langs,
      onResult(out) {
        announceResult(out);
      }
    });
    const deliveryWatchers = [];
    const recordWatchers = [];
    const sources = {};
    for (const [blockId, entries] of plan) {
      sources[sourceNameFor(blockId)] = /* @__PURE__ */ (function(id, list) {
        return function() {
          const block = ((doc.layout || {}).blocks || []).find(function(b) {
            return b && String(b.id) === id;
          });
          const base = block && block.props ? localizeProps(block.props.data, langs()) : null;
          return composeBlock(graph, list, base);
        };
      })(blockId, entries);
    }
    const fill2 = {};
    for (const [blockId, ids] of drawnByBlock) {
      fill2[blockId] = /* @__PURE__ */ (function(list) {
        return function(body) {
          for (const id of list) {
            const view = renderNodeInto(body, {
              id,
              node: nodes[id],
              graph,
              langs,
              set: apply,
              gear: options.gears === false ? null : openGear,
              reason: guestReason
            });
            if (view) views.set(id, view);
          }
        };
      })(ids);
    }
    if (options.chainBlock) {
      fill2[options.chainBlock] = function(body) {
        chainHandle = chain(body, { graph, title: "The chain", langs });
      };
    }
    const k = kit();
    if (!k || typeof k.mosaic !== "function") {
      const panel = refusalPanel(host, ["This page needs the Atelier kit: load /v1/libs/aimeat-atelier.js before aimeat-living."]);
      return {
        el: host,
        refusals: ["aimeat-atelier is not on this page."],
        ok: false,
        ready: Promise.resolve(),
        set() {
        },
        get() {
        },
        send() {
        },
        values() {
          return {};
        },
        state() {
          return {};
        },
        chain() {
          return null;
        },
        describe,
        destroy() {
          panel.destroy();
        }
      };
    }
    const surface = k.mosaic({
      target: host,
      layout,
      fallback: layout,
      sources,
      fill: fill2
    });
    const lateRefusals = unboundBlocks(surface, plan.keys()).map(function(b) {
      return 'A binding writes to block "' + b.id + '", which is a ' + b.component + " — that component does not read a bound record.";
    });
    for (const line of lateRefusals) console.warn("aimeat-living: " + line);
    function announce(changed) {
      if (!changed.length) return;
      for (const id of changed) {
        const view = views.get(id);
        if (view) view.update();
      }
      const touched = /* @__PURE__ */ new Set();
      for (const id of changed) {
        const node2 = nodes[id] || {};
        if (node2.type === "binding" && node2.block) touched.add(String(node2.block));
        for (const next of graph.dependents(id)) {
          const dep = nodes[next] || {};
          if (dep.type === "binding" && dep.block) touched.add(String(dep.block));
        }
      }
      for (const blockId of touched) surface.refresh(sourceNameFor(blockId));
      if (chainHandle) chainHandle.flash(changed);
      schedule();
      if (options.onChange) {
        options.onChange({ changed: changed.slice(), values: valuesNow(), state: statesNow() });
      }
    }
    function announceResult(out) {
      announce(out.changed);
      deliveries.after(out);
      return out;
    }
    function apply(id, raw) {
      if (destroyed) return { changed: [] };
      return announceResult(graph.set(id, raw));
    }
    function tellDelivery(event) {
      if (options.onDelivery) options.onDelivery(event);
      for (const cb of deliveryWatchers.slice()) {
        try {
          cb(event);
        } catch {
        }
      }
      try {
        host.dispatchEvent(new CustomEvent("aimeat-living-delivery", { detail: event, bubbles: true }));
      } catch {
      }
    }
    function guestReason() {
      const state = deliveries.status();
      return state.signedIn ? "" : String(state.reason || "");
    }
    function openGear(id, way) {
      const spec = {
        id: String(id),
        node: nodes[String(id)] || {},
        doc,
        graph,
        hooks,
        langs,
        base: NODE_URL,
        onSave: recordChanged
      };
      if (way === "out") openOutward(spec);
      else openInward(spec);
    }
    function recordChanged(nodeId) {
      live.stop();
      live.start();
      announceResult(graph.refresh());
      for (const cb of recordWatchers.slice()) {
        try {
          cb({ node: String(nodeId), doc });
        } catch {
        }
      }
    }
    function elementOf(block, mounted) {
      const entry = mounted.get(String(block.id));
      if (!entry || !entry.el || !entry.el.querySelector) return null;
      if (entry.el.getAttribute && entry.el.getAttribute("data-ak-block") === String(block.id)) return entry.el;
      if (String(block.component) === "hero") {
        const band = entry.el.querySelectorAll(".ak-hero");
        return band[heroPlace.get(String(block.id)) || 0] || band[0] || null;
      }
      return entry.el;
    }
    function relabelBlocks() {
      if (!wordyBlocks.size) return;
      const wanted = langs();
      const mounted = /* @__PURE__ */ new Map();
      for (const entry of surface.blocks()) mounted.set(String(entry.id), entry);
      for (const block of (doc.layout || {}).blocks || []) {
        if (!block || !wordyBlocks.has(String(block.id))) continue;
        const root = elementOf(block, mounted);
        if (!root) continue;
        const props = localizeProps(block.props, wanted);
        for (const key of TEXT_KEYS) {
          const words2 = props[key];
          if (typeof words2 !== "string") continue;
          const at = root.querySelector('[data-ak-part="' + key + '"]');
          if (!at || at.closest && at.closest('[data-ak-part="body"]')) continue;
          if (at.textContent !== words2) at.textContent = words2;
        }
      }
    }
    let languageNow = langs().join("|");
    function relanguage() {
      const key = langs().join("|");
      if (destroyed || key === languageNow) return { changed: [], language: langs()[0] };
      languageNow = key;
      for (const [, view] of views) if (typeof view.relabel === "function") view.relabel();
      const out = graph.relanguage();
      for (const id of out.changed) {
        const view = views.get(id);
        if (view) view.update();
      }
      relabelBlocks();
      relabelGears(host, langs);
      for (const [blockId, entries] of plan) {
        const moved = entries.some(function(e) {
          return out.changed.indexOf(e.from) >= 0;
        });
        if (moved || wordyBlocks.has(String(blockId))) surface.refresh(sourceNameFor(blockId));
      }
      if (chainHandle) chainHandle.set();
      if (options.onChange) {
        options.onChange({
          changed: out.changed.slice(),
          values: valuesNow(),
          state: statesNow(),
          language: langs()[0]
        });
      }
      return { changed: out.changed, language: langs()[0] };
    }
    const stopLang = onLanguageChange(function() {
      relanguage();
    });
    function schedule() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const due = graph.nextDue(Date.now());
      if (due == null || destroyed) return;
      timer = setTimeout(function() {
        timer = null;
        if (destroyed) return;
        announceResult(graph.tick(Date.now()));
      }, Math.max(16, due));
    }
    function valuesNow() {
      const out = {};
      for (const id of graph.ids) {
        const v = graph.valueOf(id);
        out[id] = isQuantity(v) ? { value: v.n, unit: unitLabel(v.u) } : isError(v) ? { error: v.error } : v;
      }
      return out;
    }
    function statesNow() {
      const out = {};
      for (const id of graph.ids) if ((nodes[id] || {}).type === "machine") out[id] = String(graph.valueOf(id) || "");
      return out;
    }
    const sourceIds = graph.ids.filter(function(id) {
      return (nodes[id] || {}).type === "source" && nodes[id].key;
    });
    function readSources() {
      if (!sourceIds.length || destroyed) return Promise.resolve();
      const type = typeOf("source");
      return Promise.all(sourceIds.map(function(id) {
        return type.read(nodes[id]).then(function(v) {
          return { id, v };
        });
      })).then(function(got) {
        if (destroyed) return;
        const changed = [];
        for (const one of got) {
          if (one.v === void 0) continue;
          for (const c of graph.set(one.id, one.v).changed) if (changed.indexOf(c) < 0) changed.push(c);
        }
        announce(changed);
      });
    }
    const onLive = function() {
      readSources();
    };
    if (options.live !== false && sourceIds.length) window.addEventListener("aimeat-live-update", onLive);
    deliveries.prime();
    const ready = Promise.resolve().then(readSources).then(function() {
      return options.live === false ? null : live.start();
    }).then(function() {
      schedule();
    });
    return {
      el: host,
      ok: true,
      /** What the KIT refused once it had mounted; validate() cannot reach these on its own. */
      refusals: lateRefusals,
      ready,
      /** The mosaic this document is rendered through — the arrangement is still the kit's. */
      mosaic: surface,
      /** The graph itself, for a host that wants to read the wiring. */
      graph,
      /** Move one node. The same door a control uses, so a person and an agent are the same event. */
      set(id, value2) {
        return apply(String(id), value2);
      },
      /** What one node comes to now. */
      get(id) {
        return graph.valueOf(String(id));
      },
      /** Every node's current value, in a shape that can be written to a record. */
      values: valuesNow,
      /** Every machine's current state. */
      state: statesNow,
      /** Send an event to the machines. */
      send(event) {
        return announceResult(graph.send(String(event)));
      },
      /** Work the whole document out again. */
      refresh() {
        return announceResult(graph.refresh());
      },
      /** Whether this document can tell anybody anything, and the words to say when it cannot. */
      hooks() {
        return deliveries.status();
      },
      /** The last fifty deliveries this mount made, oldest first. */
      deliveries() {
        return deliveries.list();
      },
      /** Send one trigger's message as a sample, marked `test: true`. */
      test(triggerId) {
        return deliveries.test(String(triggerId));
      },
      /** Ask one URL source for its reading now, rather than waiting for its next turn. */
      read(id) {
        return live.readOnce(String(id));
      },
      /** Which sources are on a clock, and how often — after the ten-second floor. */
      polled() {
        return live.polled();
      },
      /**
       * Hear every delivery: { trigger, at, ok, status, ms, refusal, transition, test }. The same
       * event is dispatched on the host element as `aimeat-living-delivery`.
       * @param {(e: any) => void} cb @returns {() => void} stop listening
       */
      onDelivery(cb) {
        deliveryWatchers.push(cb);
        return function() {
          const at = deliveryWatchers.indexOf(cb);
          if (at >= 0) deliveryWatchers.splice(at, 1);
        };
      },
      /**
       * Hear the record being edited through a gear, so the app can save it. This library persists
       * nothing: the memory key a document lives under is the app's, and always was.
       * @param {(e: { node: string, doc: any }) => void} cb @returns {() => void} stop listening
       */
      onRecordChange(cb) {
        recordWatchers.push(cb);
        return function() {
          const at = recordWatchers.indexOf(cb);
          if (at >= 0) recordWatchers.splice(at, 1);
        };
      },
      /** Draw the chain somewhere of the host's choosing, following this same document. */
      chain(where) {
        const view = chain(where, { graph, title: "The chain", langs });
        if (!chainHandle) chainHandle = view;
        return view;
      },
      describe,
      version: VERSION,
      /** The language this screen is written in right now. */
      language() {
        return langs()[0];
      },
      /**
       * Ask for a language, for a host that has its own switch. Passing null hands the decision
       * back to the page, which is where it belongs — the login pill is the switch on this
       * platform, and a document that fought it would be a second answer to one question.
       * @param {string|null} lang
       */
      setLanguage(lang) {
        wish = lang == null ? null : String(lang);
        return relanguage();
      },
      destroy() {
        destroyed = true;
        if (timer) clearTimeout(timer);
        stopLang();
        deliveries.destroy();
        live.destroy();
        window.removeEventListener("aimeat-live-update", onLive);
        if (chainHandle) chainHandle.destroy();
        for (const [, view] of views) if (view.el && view.el.parentNode) view.el.parentNode.removeChild(view.el);
        views.clear();
        surface.destroy();
      }
    };
  }
  function describe(type) {
    if (type == null) return Object.keys(NODES).sort();
    const found = NODES[String(type)];
    if (!found) return null;
    return Object.assign({ id: String(type) }, found);
  }
  function chain2(where, doc) {
    const langs = function() {
      return preference(doc);
    };
    const graph = createGraph(doc, { langs });
    graph.refresh();
    return chain(where, { graph, title: "The chain", langs });
  }
  var living = {
    version: VERSION,
    mount,
    validate,
    describe,
    chain: chain2,
    /** The node type ids this build knows, without the documentation. */
    types() {
      return Object.keys(NODE_TYPES).sort();
    },
    /** What a value comes to, as a person would read it — number, unit, refusal. */
    read(value2) {
      return asText(value2);
    }
  };
  attach("living", living);
})();
