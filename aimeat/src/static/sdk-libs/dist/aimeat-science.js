// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/science/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-science.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
  }

  // src/static/sdk-libs/science/quantity.js
  var FACES = ["figure", "chip", "gauge", "sparkline", "thermometer"];
  var NS = "http://www.w3.org/2000/svg";
  var svgEl = (name, attrs) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    return node;
  };
  var el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== void 0 && text !== null) node.textContent = String(text);
    return node;
  };
  function fraction(value, min, max) {
    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : lo + 1;
    if (hi === lo) return 0;
    return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  }
  function toneFor(value, bands) {
    if (!Array.isArray(bands) || !bands.length) return "accent";
    for (const band of bands) if (Number.isFinite(band?.upTo) && value <= band.upTo) return band.tone || "accent";
    return bands[bands.length - 1]?.tone || "accent";
  }
  var TONE_VAR = {
    ok: "var(--ak-ok, var(--success-fg, #047857))",
    warn: "var(--ak-warn, var(--warn, #B45309))",
    err: "var(--ak-err, var(--accent, #E8564A))",
    accent: "var(--ak-accent, var(--accent, #E8564A))",
    dim: "var(--ak-muted, var(--text-dim, #6B7280))"
  };
  var toneColour = (tone) => TONE_VAR[tone] || TONE_VAR.accent;
  function quantityEl(answer, opts) {
    const o = opts || {};
    const face = FACES.indexOf(o.as) >= 0 ? o.as : "figure";
    if (!answer || answer.ok === false || answer.value === void 0 || answer.value === null) {
      return waitingEl(answer, o, face);
    }
    if (face === "chip") return chipFace(answer, o);
    if (face === "gauge") return gaugeFace(answer, o);
    if (face === "sparkline") return sparklineFace(answer, o);
    if (face === "thermometer") return thermometerFace(answer, o);
    return figureFace(answer, o);
  }
  function waitingEl(answer, o, face) {
    const box = el("div", "sci-q sci-q--waiting sci-q--" + face);
    if (o.label) box.append(el("span", "sci-q-label", o.label));
    box.append(el("span", "sci-q-empty", answer?.error?.message || "—"));
    return box;
  }
  function figureFace(answer, o) {
    const box = el("div", "sci-q sci-q--figure");
    if (o.label) box.append(el("span", "sci-q-label", o.label));
    const line = el("div", "sci-q-figure");
    line.append(el("b", null, formattedNumber(answer)));
    if (answer.unit) line.append(el("small", null, unitText(answer)));
    box.append(line);
    return box;
  }
  function chipFace(answer, o) {
    const box = el("span", "sci-q sci-q--chip");
    if (o.label) box.append(el("span", "sci-q-chip-label", o.label));
    box.append(el("span", "sci-q-chip-value", answer.formatted ?? String(answer.value)));
    return box;
  }
  function gaugeFace(answer, o) {
    const box = el("div", "sci-q sci-q--gauge");
    if (o.label) box.append(el("span", "sci-q-label", o.label));
    const W = 160, H = 96, cx = W / 2, cy = H - 10, r = 62;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci-gauge", role: "img", "aria-label": `${o.label || "reading"}: ${answer.formatted ?? answer.value}` });
    const arc = (from, to, colour, width) => {
      const p = (t) => [cx + r * Math.cos(Math.PI * (1 - t)), cy - r * Math.sin(Math.PI * (1 - t))];
      const [x1, y1] = p(from), [x2, y2] = p(to);
      return svgEl("path", { d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`, fill: "none", stroke: colour, "stroke-width": width, "stroke-linecap": "butt" });
    };
    svg.append(arc(0, 1, "var(--ak-line, var(--border, #E5E7EB))", 10));
    const f = fraction(answer.value, o.min, o.max);
    const tone = toneColour(toneFor(answer.value, o.bands));
    if (f > 0) svg.append(arc(0, f, tone, 10));
    const angle = Math.PI * (1 - f);
    svg.append(svgEl("line", {
      x1: cx,
      y1: cy,
      x2: cx + (r - 16) * Math.cos(angle),
      y2: cy - (r - 16) * Math.sin(angle),
      stroke: "var(--ak-ink, var(--text, #1A1A2E))",
      "stroke-width": 3,
      "stroke-linecap": "round"
    }));
    svg.append(svgEl("circle", { cx, cy, r: 4, fill: "var(--ak-ink, var(--text, #1A1A2E))" }));
    box.append(svg);
    box.append(el("div", "sci-q-under", answer.formatted ?? String(answer.value)));
    return box;
  }
  function sparklineFace(answer, o) {
    const box = el("div", "sci-q sci-q--spark");
    if (o.label) box.append(el("span", "sci-q-label", o.label));
    const points = (Array.isArray(o.history) ? o.history : []).filter((n) => Number.isFinite(n));
    const row = el("div", "sci-q-sparkrow");
    if (points.length >= 2) {
      const W = 120, H = 28;
      const lo = Math.min(...points), hi = Math.max(...points);
      const span = hi - lo || 1;
      const d = points.map((p, i) => `${i ? "L" : "M"} ${i / (points.length - 1) * W} ${H - (p - lo) / span * (H - 4) - 2}`).join(" ");
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci-spark", "aria-hidden": "true" });
      svg.append(svgEl("path", { d, fill: "none", stroke: toneColour(toneFor(answer.value, o.bands)), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      row.append(svg);
    }
    row.append(el("b", "sci-q-sparkvalue", answer.formatted ?? String(answer.value)));
    box.append(row);
    return box;
  }
  function thermometerFace(answer, o) {
    const box = el("div", "sci-q sci-q--therm");
    if (o.label) box.append(el("span", "sci-q-label", o.label));
    const f = fraction(answer.value, o.min, o.max);
    const tone = toneColour(toneFor(answer.value, o.bands));
    const W = 34, H = 120, bulb = 12;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "sci-therm", role: "img", "aria-label": `${o.label || "reading"}: ${answer.formatted ?? answer.value}` });
    const top = 8, bottom = H - bulb - 8, tube = bottom - top;
    svg.append(svgEl("rect", { x: W / 2 - 6, y: top, width: 12, height: tube, rx: 6, fill: "var(--ak-line, var(--border, #E5E7EB))" }));
    svg.append(svgEl("rect", { x: W / 2 - 6, y: top + tube * (1 - f), width: 12, height: tube * f, rx: 6, fill: tone }));
    svg.append(svgEl("circle", { cx: W / 2, cy: bottom + bulb / 2, r: bulb, fill: tone }));
    box.append(svg);
    box.append(el("div", "sci-q-under", answer.formatted ?? String(answer.value)));
    return box;
  }
  function formattedNumber(answer) {
    const text = answer.formatted ?? String(answer.value);
    const unit = unitText(answer);
    return unit && text.endsWith(unit) ? text.slice(0, -unit.length).trim() : text;
  }
  var UNIT_WORDS = { degC: "°C", degF: "°F", degK: "K", R: "°R", percent: "%" };
  function unitText(answer) {
    if (!answer.unit) return "";
    return UNIT_WORDS[answer.unit] || answer.unit;
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

  // src/static/sdk-libs/science/formula.js
  var el2 = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== void 0 && text !== null) node.textContent = String(text);
    return node;
  };
  function formulaEl(cell, answer) {
    const box = el2("div", "sci-formula");
    if (cell.label) box.append(el2("span", "sci-q-label", cell.label));
    const latex = answer?.latex || cell.latex || "";
    if (latex) {
      const math = el2("code", "sci-math", latex);
      math.dataset.latex = latex;
      box.append(math);
    }
    if (answer && answer.ok) {
      const line = el2("div", "sci-formula-answer");
      line.append(el2("span", "sci-eq", "="));
      line.append(el2("b", null, answer.formatted ?? String(answer.value)));
      box.append(line);
      if (cell.showWork && answer.workLatex) {
        const work = el2("details", "sci-work");
        work.append(el2("summary", null, "the workings"));
        const shown = el2("code", "sci-math", answer.workLatex);
        shown.dataset.latex = answer.workLatex;
        work.append(shown);
        box.append(work);
      }
    } else if (answer && answer.error) {
      box.append(el2("div", "sci-formula-error", answer.error.message));
    }
    return box;
  }
  var katexPromise = null;
  function ensureKatex() {
    if (katexPromise) return katexPromise;
    if (typeof window !== "undefined" && window.katex) return katexPromise = Promise.resolve(window.katex);
    katexPromise = new Promise((resolve) => {
      const base = NODE_URL;
      if (!document.querySelector("link[data-katex]")) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = base + "/lib/katex@0/katex.min.css";
        css.dataset.katex = "1";
        document.head.append(css);
      }
      const script = document.createElement("script");
      script.src = base + "/lib/katex@0/katex.min.js";
      script.async = true;
      script.onload = () => resolve(window.katex || null);
      script.onerror = () => resolve(null);
      document.head.append(script);
    });
    return katexPromise;
  }
  function typesetInto(root) {
    const nodes = root ? root.querySelectorAll("code.sci-math[data-latex]") : [];
    if (!nodes.length) return Promise.resolve(false);
    return ensureKatex().then((katex) => {
      if (!katex) return false;
      for (const node of nodes) {
        const latex = node.dataset.latex;
        if (!latex || node.dataset.set === "1") continue;
        try {
          katex.render(latex, node, { throwOnError: false, displayMode: false, output: "html" });
          node.dataset.set = "1";
        } catch {
          node.dataset.set = "1";
        }
      }
      return true;
    });
  }

  // src/static/sdk-libs/science/controls.js
  var el3 = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== void 0 && text !== null) node.textContent = String(text);
    return node;
  };
  var UNIT_WORDS2 = { degC: "°C", degF: "°F", degK: "K", R: "°R", percent: "%" };
  var unitWord = (unit) => unit ? UNIT_WORDS2[unit] || unit : "";
  function controlEl(cell, answer, opts) {
    const o = opts || {};
    const bounded = Number.isFinite(cell.min) && Number.isFinite(cell.max);
    const shape = cell.as === "field" || cell.as === "stepper" ? cell.as : bounded ? "slider" : "field";
    const box = el3("div", "sci-control sci-control--" + shape);
    const label = el3("label", "sci-q-label", cell.label || cell.id);
    const id = "sci-" + cell.id;
    label.htmlFor = id;
    box.append(label);
    const shown = el3("b", "sci-control-value", answer?.formatted ?? withUnit(cell.value, cell.unit));
    const report = (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      shown.textContent = withUnit(n, cell.unit);
      if (typeof o.onInput === "function") o.onInput(n);
    };
    const input = shape === "slider" ? sliderEl(cell) : fieldEl(cell);
    input.id = id;
    input.disabled = !!o.readOnly;
    input.addEventListener("input", () => report(input.value));
    const row = el3("div", "sci-control-row");
    if (shape === "stepper") {
      row.append(stepButton("−", () => report(clamp(Number(input.value) - step(cell), cell)), o.readOnly));
      row.append(input);
      row.append(stepButton("+", () => report(clamp(Number(input.value) + step(cell), cell)), o.readOnly));
    } else {
      row.append(input);
    }
    row.append(shown);
    box.append(row);
    if (Number.isFinite(cell.min) && Number.isFinite(cell.max)) {
      box.append(el3("small", "sci-control-bounds", `${withUnit(cell.min, cell.unit)} – ${withUnit(cell.max, cell.unit)}`));
    }
    return box;
  }
  function sliderEl(cell) {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "sci-slider";
    input.min = String(cell.min);
    input.max = String(cell.max);
    input.step = String(step(cell));
    input.value = String(cell.value);
    input.setAttribute("aria-label", cell.label || cell.id);
    return input;
  }
  function fieldEl(cell) {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "sci-field og-input";
    if (Number.isFinite(cell.min)) input.min = String(cell.min);
    if (Number.isFinite(cell.max)) input.max = String(cell.max);
    input.step = String(step(cell));
    input.value = String(cell.value);
    input.setAttribute("aria-label", cell.label || cell.id);
    return input;
  }
  function stepButton(sign, onClick, disabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sci-step og-door";
    button.textContent = sign;
    button.disabled = !!disabled;
    button.addEventListener("click", onClick);
    return button;
  }
  function step(cell) {
    if (Number.isFinite(cell.step) && cell.step > 0) return cell.step;
    if (Number.isFinite(cell.min) && Number.isFinite(cell.max)) {
      const span = Math.abs(cell.max - cell.min);
      if (span > 0) return Number((span / 100).toPrecision(1));
    }
    return 1;
  }
  function clamp(value, cell) {
    let n = value;
    if (Number.isFinite(cell.min)) n = Math.max(cell.min, n);
    if (Number.isFinite(cell.max)) n = Math.min(cell.max, n);
    return n;
  }
  function withUnit(value, unit) {
    if (!Number.isFinite(value)) return "—";
    const word = unitWord(unit);
    return word ? `${value} ${word}` : String(value);
  }

  // src/static/sdk-libs/science/live.js
  var { authFetch: authFetch2 } = makeSession("aimeat-science.js");
  var MIN_INTERVAL_MS = 4e3;
  function followKeys(keysByCell, onReading, opts) {
    const entries = Object.entries(keysByCell || {});
    if (!entries.length) return () => {
    };
    const o = opts || {};
    const last = /* @__PURE__ */ new Map();
    let stopped = false;
    let timer = null;
    let unsubscribe = null;
    const pass = async () => {
      if (stopped) return;
      const readings = await readKeys(entries.map(([, key]) => key), o.owner);
      if (stopped) return;
      for (const [cellId, key] of entries) {
        const value = readings.get(key);
        if (value === void 0) continue;
        if (last.get(cellId) === value) continue;
        last.set(cellId, value);
        onReading(cellId, value);
      }
    };
    pass();
    const live = typeof window !== "undefined" && window.AIMEAT && window.AIMEAT.live;
    if (live && typeof live.subscribe === "function") {
      unsubscribe = live.subscribe("memory", () => pass());
    } else {
      timer = setInterval(pass, Math.max(MIN_INTERVAL_MS, Number(o.intervalMs) || MIN_INTERVAL_MS));
    }
    return function stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }
  async function readKeys(keys, owner) {
    const out = /* @__PURE__ */ new Map();
    const unique = [...new Set(keys.filter(Boolean))];
    await Promise.all(unique.map(async (key) => {
      const path = owner ? "/v1/memory/" + encodeURIComponent(owner) + "/" + encodeURIComponent(key) : "/v1/memory/" + encodeURIComponent(key) + "?owner_scope=true";
      const res = await readOne(path);
      if (!res || !res.ok) return;
      const value = numberIn(res.data?.value);
      if (value !== null) out.set(key, value);
    }));
    return out;
  }
  async function readOne(path) {
    try {
      return await authFetch2(path);
    } catch {
      return null;
    }
  }
  var READING_NAMES = ["value", "reading", "v", "n", "celsius", "temp", "temperature", "amount", "level"];
  function numberIn(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    if (Array.isArray(value)) return value.length ? numberIn(value[value.length - 1]) : null;
    if (value && typeof value === "object") {
      for (const name of READING_NAMES) {
        if (name in value) {
          const found = numberIn(value[name]);
          if (found !== null) return found;
        }
      }
    }
    return null;
  }

  // src/static/sdk-libs/science/sheet.js
  var { authFetch: authFetch3 } = makeSession("aimeat-science.js");
  var el4 = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== void 0 && text !== null) node.textContent = String(text);
    return node;
  };
  var SETTLE_MS = 120;
  async function mount(target, opts) {
    if (!target) throw new Error("mount needs an element");
    const o = opts || {};
    const state = {
      sheet: o.sheet ? clone(o.sheet) : null,
      values: {},
      // cell id → the number its memory key currently reads
      history: {},
      // cell id → the recent readings, for a sparkline
      answers: /* @__PURE__ */ new Map(),
      seq: 0,
      settle: null,
      stopFollowing: null,
      dead: false
    };
    if (!state.sheet && o.key) state.sheet = await read(o.key, o.owner);
    if (!state.sheet) state.sheet = { cells: [] };
    const root = el4("div", "sci-sheet");
    target.replaceChildren(root);
    const api = {
      /** The sheet as it stands, safe to keep. */
      get sheet() {
        return clone(state.sheet);
      },
      /** The last answers, by cell id. */
      get answers() {
        return new Map(state.answers);
      },
      setInput,
      evaluate,
      destroy
    };
    await evaluate();
    state.stopFollowing = followKeys(liveKeys(state.sheet), (cellId, value) => {
      state.values[cellId] = value;
      const seen = state.history[cellId] || (state.history[cellId] = []);
      seen.push(value);
      if (seen.length > 60) seen.shift();
      schedule();
    }, { owner: o.owner });
    return api;
    async function evaluate() {
      if (state.dead) return;
      const seq = ++state.seq;
      let answer;
      try {
        const res = await authFetch3("/v1/worksheet/evaluate", {
          method: "POST",
          body: JSON.stringify({ sheet: state.sheet, values: state.values, locale: o.locale })
        });
        answer = res && res.ok ? res.data : null;
      } catch (err) {
        answer = null;
        note(String(err && err.message ? err.message : err));
      }
      if (state.dead || seq !== state.seq) return;
      if (!answer) return;
      state.answers = new Map((answer.cells || []).map((c) => [c.id, c]));
      draw();
    }
    function schedule() {
      if (state.settle) clearTimeout(state.settle);
      state.settle = setTimeout(() => {
        state.settle = null;
        evaluate();
      }, SETTLE_MS);
    }
    function setInput(id, value) {
      const cell = (state.sheet.cells || []).find((c) => c.id === id && c.kind === "input");
      if (!cell) return false;
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      cell.value = n;
      schedule();
      if (typeof o.onChange === "function") o.onChange(clone(state.sheet));
      return true;
    }
    function destroy() {
      state.dead = true;
      if (state.settle) clearTimeout(state.settle);
      if (state.stopFollowing) state.stopFollowing();
      root.replaceChildren();
    }
    function draw() {
      const rows = document.createDocumentFragment();
      for (const cell of state.sheet.cells || []) {
        const answer = state.answers.get(cell.id);
        const row = el4("div", "sci-row sci-row--" + cell.kind);
        row.dataset.cell = cell.id;
        if (cell.kind === "text") {
          row.append(el4("p", "sci-text", cell.text || ""));
        } else if (cell.kind === "input") {
          row.append(controlEl(cell, answer, { readOnly: o.readOnly, onInput: (v) => setInput(cell.id, v) }));
        } else if (cell.kind === "formula") {
          row.append(formulaEl(cell, answer));
        } else if (cell.kind === "view") {
          const of = cell.of ? state.answers.get(cell.of) : null;
          row.append(quantityEl(of || answer, {
            as: cell.as,
            label: cell.label,
            min: cell.min,
            max: cell.max,
            bands: cell.bands,
            history: cell.of ? state.history[cell.of] : void 0
          }));
        } else {
          row.append(quantityEl(answer, { as: "figure", label: cell.label || cell.id }));
          if (cell.live) row.append(el4("small", "sci-follows", cell.live));
        }
        if (cell.note) row.append(el4("small", "sci-note", cell.note));
        rows.append(row);
      }
      root.replaceChildren(rows);
      typesetInto(root);
    }
    function note(message) {
      let line = root.querySelector(".sci-sheet-note");
      if (!line) {
        line = el4("div", "sci-sheet-note");
        root.prepend(line);
      }
      line.textContent = message;
    }
  }
  async function read(key, owner) {
    const path = owner ? "/v1/memory/" + encodeURIComponent(owner) + "/" + encodeURIComponent(key) : "/v1/memory/" + encodeURIComponent(key) + "?owner_scope=true";
    const res = await authFetch3(path);
    if (!res || !res.ok) throw new Error(res?.error?.message || "The worksheet could not be read");
    return res.data?.value ?? null;
  }
  async function save(key, sheet) {
    const body = { key, value: { spec: "aimeat.worksheet/v1", ...sheet }, visibility: "private" };
    const res = await authFetch3("/v1/memory", { method: "POST", body: JSON.stringify(body) });
    if (!res || !res.ok) throw new Error(res?.error?.message || "The worksheet could not be kept");
    return res.data;
  }
  async function evaluateSheet(sheet, opts) {
    const res = await authFetch3("/v1/worksheet/evaluate", {
      method: "POST",
      body: JSON.stringify({ sheet, values: opts?.values, locale: opts?.locale })
    });
    if (!res || !res.ok) throw new Error(res?.error?.message || "The worksheet could not be worked out");
    return res.data;
  }
  function liveKeys(sheet) {
    const out = {};
    for (const cell of sheet?.cells || []) if (cell.kind === "quantity" && cell.live) out[cell.id] = cell.live;
    return out;
  }
  var clone = (value) => JSON.parse(JSON.stringify(value));

  // src/static/sdk-libs/science/series.js
  var NS2 = "http://www.w3.org/2000/svg";
  var svgEl2 = (name, attrs) => {
    const node = document.createElementNS(NS2, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    return node;
  };
  var el5 = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== void 0 && text !== null) node.textContent = String(text);
    return node;
  };
  var UNIT_WORDS3 = { degC: "°C", degF: "°F", degK: "K", R: "°R", percent: "%" };
  var unitWord2 = (unit) => unit ? UNIT_WORDS3[unit] || unit : "";
  function windowMs(text) {
    const m = /^(\d+)\s*([hdw])$/.exec(String(text || "").trim());
    if (!m) return null;
    const n = Number(m[1]);
    return m[2] === "h" ? n * 36e5 : m[2] === "d" ? n * 864e5 : n * 6048e5;
  }
  function rowsToPoints(rows, opts) {
    const o = opts || {};
    const list = Array.isArray(rows) ? rows : [];
    const points = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      let t = null, v = null;
      if (typeof row === "number") {
        t = i;
        v = row;
      } else if (Array.isArray(row) && row.length >= 2) {
        t = timeOf(row[0]) ?? i;
        v = Number(row[1]);
      } else if (row && typeof row === "object") {
        t = timeOf(row.at ?? row.t ?? row.time ?? row.timestamp ?? row.occurred_at) ?? i;
        v = Number(row.value ?? row.reading ?? row.v ?? row.n ?? row.celsius ?? row.temp);
      }
      if (Number.isFinite(v)) points.push({ t: Number.isFinite(t) ? t : i, v });
    }
    points.sort((a, b) => a.t - b.t);
    const span = windowMs(o.window);
    if (span && points.length) {
      const now = Number.isFinite(o.now) ? o.now : points[points.length - 1].t;
      return points.filter((p) => now - p.t <= span);
    }
    return points;
  }
  function timeOf(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  }
  function tickStep(span) {
    if (!(span > 0)) return 1;
    const raw = span / 4;
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / power;
    const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    return nice * power;
  }
  function seriesEl(rows, opts) {
    const o = opts || {};
    const points = rowsToPoints(rows, { window: o.window });
    const box = el5("div", "sci-series");
    if (o.label) box.append(el5("span", "sci-q-label", o.label));
    if (points.length < 2) {
      box.append(el5("div", "sci-q-empty", points.length ? "one reading so far" : "no readings yet"));
      return box;
    }
    const W = 320, H = Number.isFinite(o.height) ? o.height : 120;
    const padL = 40, padR = 8, padT = 8, padB = 18;
    const lo = Math.min(...points.map((p) => p.v));
    const hi = Math.max(...points.map((p) => p.v));
    const step2 = tickStep(hi - lo || Math.abs(hi) || 1);
    const floor = Math.floor(lo / step2) * step2;
    const ceil = Math.ceil(hi / step2) * step2;
    const span = ceil - floor || 1;
    const t0 = points[0].t, t1 = points[points.length - 1].t;
    const tSpan = t1 - t0 || 1;
    const x = (t) => padL + (t - t0) / tSpan * (W - padL - padR);
    const y = (v) => padT + (1 - (v - floor) / span) * (H - padT - padB);
    const svg = svgEl2("svg", {
      viewBox: `0 0 ${W} ${H}`,
      class: "sci-series-svg",
      role: "img",
      "aria-label": `${o.label || "series"}: ${points.length} readings from ${fmt(floor)} to ${fmt(ceil)}`
    });
    for (let v = floor; v <= ceil + 1e-9; v += step2) {
      svg.append(svgEl2("line", { x1: padL, y1: y(v), x2: W - padR, y2: y(v), stroke: "var(--ak-line, var(--border, #E5E7EB))", "stroke-width": 1 }));
      const label = svgEl2("text", { x: padL - 6, y: y(v) + 3, "text-anchor": "end", class: "sci-series-tick" });
      label.textContent = fmt(v);
      svg.append(label);
    }
    const d = points.map((p, i) => `${i ? "L" : "M"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
    svg.append(svgEl2("path", {
      d,
      fill: "none",
      "stroke-width": 2,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      stroke: o.tone || "var(--ak-accent, var(--accent, #E8564A))"
    }));
    const last = points[points.length - 1];
    svg.append(svgEl2("circle", { cx: x(last.t), cy: y(last.v), r: 3.5, fill: o.tone || "var(--ak-accent, var(--accent, #E8564A))" }));
    box.append(svg);
    box.append(el5("small", "sci-series-foot", `${points.length} readings · latest ${fmt(last.v)}${o.unit ? " " + unitWord2(o.unit) : ""}`));
    return box;
    function fmt(v) {
      const rounded = Number(v.toPrecision(6));
      return String(rounded);
    }
  }

  // src/static/sdk-libs/science/index.js
  attach("science", {
    /** Put a worksheet on the page and keep it worked out. */
    mount,
    /** A worksheet from a memory key. */
    read,
    /** Keep a worksheet under a memory key. */
    save,
    /** Work a sheet out once, without drawing it. */
    evaluate: evaluateSheet,
    /** One reading, drawn as a figure, chip, gauge, sparkline or thermometer. */
    quantity: quantityEl,
    /** The faces a reading can wear. */
    FACES,
    /** A reading over time as one line. */
    series: seriesEl,
    /** Rows of readings as points, windowed. */
    points: rowsToPoints,
    /** A number a person can move: slider, field or stepper. It reports and does nothing else. */
    control: controlEl,
    /** An expression set as maths, with its answer under it. */
    formula: formulaEl,
    /** Set every expression under an element, once KaTeX has loaded from this node. */
    typeset: typesetInto,
    /** Load KaTeX now, for a page that means to set maths in a moment. */
    ensureKatex,
    /** Follow memory keys and report each reading as it changes. */
    follow: followKeys,
    /** The number a record holds, wherever a device happened to put it. */
    numberIn
  });
})();
