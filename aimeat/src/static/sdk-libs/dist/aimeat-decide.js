// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/decide/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-decide.js (with a per-node config prelude).
"use strict";
(() => {
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

  // src/static/sdk-libs/decide/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-decide.js");
  function decideError(r) {
    const code = r && r.error && r.error.code || "UNKNOWN";
    const said = r && r.error && r.error.message;
    const human = {
      DECIDE_DISABLED: "The decision model is turned off on this node.",
      NO_API_KEY: "No TypeSafe key is set. The owner adds one in AI settings, or the operator gives the node one.",
      QUOTA_EXHAUSTED: "The AI budget or allowance is used up for now.",
      APP_QUOTA_EXHAUSTED: "This app has used its AI budget for today.",
      DATAMAP_REQUIRED: "This app must say in its data map that data goes to TypeSafe before it can ask.",
      RATE_LIMITED: "Too many decisions at once. Try again in a moment.",
      INVALID_REQUEST: "The questions do not fit the model limits."
    }[code];
    const err = (
      /** @type {Error & { code?: string, details?: any }} */
      new Error(said || human || "The decision call failed")
    );
    err.code = code;
    if (r && r.error && r.error.details) err.details = r.error.details;
    return err;
  }
  async function call(path, init) {
    const r = await authFetch2(path, init);
    if (!r || r.ok === false) throw decideError(r);
    return r.data;
  }
  var post = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  function yesNo(instructions, meaning) {
    const q = { type: "noul", instructions };
    if (meaning && (meaning.yes !== void 0 || meaning.no !== void 0)) {
      q.criteria = {};
      if (meaning.yes !== void 0) q.criteria.true = meaning.yes;
      if (meaning.no !== void 0) q.criteria.false = meaning.no;
    }
    return q;
  }
  function pickOne(instructions, options) {
    const criteria = Array.isArray(options) ? Object.fromEntries(options.map((o) => [String(o), null])) : options;
    return { type: "choice", instructions, criteria };
  }
  function scale(instructions, levels) {
    return { type: "score", instructions, criteria: levels };
  }
  async function ask(state, questions, opts) {
    if (!questions || typeof questions !== "object") throw new Error("questions map required");
    return post("/v1/ai/decide", { state, questions, ...opts || {} });
  }
  async function gate(state, questions, thresholds, opts) {
    const r = await ask(state, questions, { ...opts || {}, thresholds });
    const passed = {};
    for (const [id, t] of Object.entries(thresholds || {})) {
      const a = r.answers && r.answers[id];
      if (!a) continue;
      const v = a.type === "choice" ? a.confidence ?? 0 : Number(a.value);
      passed[id] = v >= t;
    }
    return { ...r, passed };
  }
  async function questionSet(key) {
    const A = (
      /** @type {any} */
      globalThis.AIMEAT
    );
    if (!A || !A.data || typeof A.data.get !== "function") throw new Error("questionSet() needs aimeat-data.js");
    const rec = await A.data.get(key);
    const v = rec && typeof rec === "object" && "value" in rec ? rec.value : rec;
    if (!v || typeof v !== "object" || !v.questions) throw new Error(`No question set at ${key}`);
    return { questions: v.questions, thresholds: v.thresholds || {} };
  }
  async function decisions(q) {
    const o = q || {};
    if (o.id) return call(`/v1/ai/decisions/${encodeURIComponent(o.id)}`);
    const p = new URLSearchParams();
    for (
      const k of
      /** @type {const} */
      ["subject", "app_id", "limit", "before"]
    ) {
      if (o[k] !== void 0) p.set(k, String(o[k]));
    }
    const qs = p.toString();
    return call(`/v1/ai/decisions${qs ? `?${qs}` : ""}`);
  }
  function review(id, outcome, extra) {
    return post(`/v1/ai/decisions/${encodeURIComponent(id)}/review`, { outcome, ...extra || {} });
  }
  var run = {
    /**
     * @param {Record<string, any>} questions
     * @param {{ items?: {subject: string, state: any}[], keys?: string[], prefix?: string, fields?: string[], gates?: string, thresholds?: Record<string, number>, names?: string[], app_id?: string }} source
     */
    start(questions, source) {
      return post("/v1/ai/decide/runs", { questions, ...source || {} });
    },
    /** @param {string} id */
    get(id) {
      return call(`/v1/ai/decide/runs/${encodeURIComponent(id)}`);
    },
    list() {
      return call("/v1/ai/decide/runs");
    },
    /** @param {string} id */
    resume(id) {
      return post(`/v1/ai/decide/runs/${encodeURIComponent(id)}/resume`, {});
    },
    /** @param {string} id */
    stop(id) {
      return post(`/v1/ai/decide/runs/${encodeURIComponent(id)}/stop`, {});
    },
    /**
     * Poll until the run is no longer running. Resolves with the run and its per-item results.
     * @param {string} id
     * @param {{ intervalMs?: number, timeoutMs?: number }} [opts]
     */
    async waitFor(id, opts) {
      const interval = Math.max(1e3, opts && opts.intervalMs || 3e3);
      const until = Date.now() + (opts && opts.timeoutMs || 30 * 6e4);
      for (; ; ) {
        const r = await run.get(id);
        if (r.state !== "running" || Date.now() > until) return r;
        await new Promise((res) => setTimeout(res, interval));
      }
    }
  };
  function settings() {
    return call("/v1/ai/decide/settings");
  }
  var decide = { yesNo, pickOne, scale, ask, gate, questionSet, decisions, review, run, settings };
  attach("decide", decide);
})();
