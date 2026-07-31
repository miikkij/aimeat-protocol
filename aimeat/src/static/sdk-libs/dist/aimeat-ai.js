// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/ai/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-ai.js (with a per-node config prelude).
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

  // src/static/sdk-libs/_core/spend.js
  var ARM_MS = 400;
  function state() {
    const ns = namespace();
    if (!ns.__spend) {
      ns.__spend = { inflight: /* @__PURE__ */ new Map(), settled: /* @__PURE__ */ new Map(), remembered: {}, budget: null };
    }
    return ns.__spend;
  }
  function keyOf(parts) {
    const s = parts.map((p) => p == null ? "" : String(p)).join("\0");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return (parts[0] == null ? "k" : String(parts[0])) + ":" + h.toString(36);
  }
  function once(key, fn, opts) {
    const s = state();
    const ttl = opts && opts.ttlMs || 0;
    const running = s.inflight.get(key);
    if (running) return running;
    if (ttl > 0) {
      const done = s.settled.get(key);
      if (done && Date.now() - done.t < ttl) return Promise.resolve(done.v);
      if (done) s.settled.delete(key);
    }
    const p = Promise.resolve().then(fn).then(
      (v) => {
        s.inflight.delete(key);
        if (ttl > 0) s.settled.set(key, { v, t: Date.now() });
        return v;
      },
      (e) => {
        s.inflight.delete(key);
        throw e;
      }
    );
    s.inflight.set(key, p);
    return p;
  }
  function isBusy(key) {
    return state().inflight.has(key);
  }
  function forget(key) {
    state().settled.delete(key);
  }
  function noteBudget(b) {
    if (b) state().budget = b;
  }
  function lastBudget() {
    return state().budget;
  }
  function cancelledError(what) {
    const e = (
      /** @type {Error & { code?: string }} */
      new Error((what || "The action") + " was cancelled")
    );
    e.code = "SPEND_CANCELLED";
    return e;
  }
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function lang() {
    try {
      const a = window.AIMEAT && window.AIMEAT.auth;
      const l = a && a.getLang && a.getLang();
      if (l === "fi" || l === "en") return l;
    } catch {
    }
    try {
      return (navigator.language || "").toLowerCase().startsWith("fi") ? "fi" : "en";
    } catch {
      return "en";
    }
  }
  var STRINGS = {
    en: {
      title: "Confirm",
      cost: "This spends from your own account.",
      ok: "Continue",
      cancel: "Cancel",
      remember: "Don't ask again in this session",
      budget: "AI budget today",
      left: "left"
    },
    fi: {
      title: "Vahvista",
      cost: "Tämä kuluttaa omalta tililtäsi.",
      ok: "Jatka",
      cancel: "Peruuta",
      remember: "Älä kysy uudelleen tässä istunnossa",
      budget: "AI-budjetti tänään",
      left: "jäljellä"
    }
  };
  function ensureStyles() {
    if (document.getElementById("aimeat-spend-css")) return;
    const st = document.createElement("style");
    st.id = "aimeat-spend-css";
    st.textContent = [
      ".aim-spend::backdrop{background:rgba(9,11,16,.62)}",
      ".aim-spend{border:0;padding:0;background:transparent;max-width:min(440px,calc(100vw - 24px));",
      "max-height:calc(100dvh - 24px);overflow:visible}",
      ".aim-spend-box{box-sizing:border-box;max-height:calc(100dvh - 24px);overflow:auto;",
      "padding:20px 20px 16px;border-radius:14px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;",
      "background:#fff;color:#12151c;border:1px solid #e2e5ea;box-shadow:0 18px 48px rgba(9,11,16,.28)}",
      ".aim-spend-box h3{margin:0 0 6px;font-size:17px;font-weight:700;letter-spacing:-.01em}",
      ".aim-spend-what{margin:0 0 10px;font-size:14.5px;line-height:1.45}",
      ".aim-spend-detail{margin:0 0 10px;font-size:13px;line-height:1.5;opacity:.78;white-space:pre-wrap}",
      ".aim-spend-meta{margin:0 0 14px;font-size:12.5px;line-height:1.6;opacity:.72}",
      ".aim-spend-meta b{font-weight:650;opacity:.95}",
      ".aim-spend-remember{display:flex;align-items:center;gap:7px;margin:0 0 14px;font-size:12.5px;opacity:.8;cursor:pointer}",
      // Sticky footer: on a short viewport the detail text scrolls inside the box, and both actions
      // stay reachable without scrolling to find them.
      ".aim-spend-btns{position:sticky;bottom:-16px;margin-bottom:-16px;padding:12px 0 16px;background:inherit;",
      "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}",
      ".aim-spend-btns button{font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:9px;cursor:pointer;border:1px solid transparent}",
      ".aim-spend-cancel{background:transparent;color:inherit;border-color:#d3d7de}",
      ".aim-spend-cancel:hover{background:rgba(9,11,16,.05)}",
      ".aim-spend-ok{background:#E8564A;color:#fff}",
      ".aim-spend-ok:hover{background:#d54539}",
      ".aim-spend-ok[disabled]{opacity:.5;cursor:progress}",
      "@media (prefers-color-scheme:dark){",
      ".aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b;box-shadow:0 18px 48px rgba(0,0,0,.6)}",
      ".aim-spend-cancel{border-color:#39414d}",
      ".aim-spend-cancel:hover{background:rgba(255,255,255,.06)}",
      "}",
      ':root[data-theme="dark"] .aim-spend-box{background:#161a21;color:#e8eaee;border-color:#2b313b}',
      ':root[data-theme="dark"] .aim-spend-cancel{border-color:#39414d}',
      ':root[data-theme="light"] .aim-spend-box{background:#fff;color:#12151c;border-color:#e2e5ea}',
      ':root[data-theme="light"] .aim-spend-cancel{border-color:#d3d7de}',
      "@media (max-width:420px){.aim-spend-btns{flex-direction:column-reverse}.aim-spend-btns button{width:100%}}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }
  function confirmSpend(opts) {
    const o = opts || {};
    const s = state();
    if (o.remember && s.remembered[o.remember]) return Promise.resolve(true);
    if (typeof document === "undefined" || !document.body) return Promise.resolve(true);
    const t = STRINGS[lang()] || STRINGS.en;
    ensureStyles();
    let remaining = o.remaining;
    if (!remaining) {
      const b = s.budget;
      if (b && typeof b.remaining_usd === "number" && typeof b.daily_budget_usd === "number") {
        remaining = "$" + b.remaining_usd.toFixed(2) + " / $" + b.daily_budget_usd.toFixed(2) + " " + t.left;
      }
    }
    const dlg = document.createElement("dialog");
    dlg.className = "aim-spend";
    dlg.innerHTML = '<div class="aim-spend-box" role="document"><h3>' + esc(t.title) + '</h3><p class="aim-spend-what">' + esc(o.what || t.cost) + "</p>" + (o.detail ? '<p class="aim-spend-detail">' + esc(o.detail) + "</p>" : "") + (o.estimate || remaining ? '<p class="aim-spend-meta">' + (o.estimate ? esc(t.cost) + " <b>" + esc(o.estimate) + "</b>" : esc(t.cost)) + (remaining ? "<br>" + esc(t.budget) + ": <b>" + esc(remaining) + "</b>" : "") + "</p>" : "") + (o.remember ? '<label class="aim-spend-remember"><input type="checkbox" class="aim-spend-rem"><span>' + esc(t.remember) + "</span></label>" : "") + '<div class="aim-spend-btns"><button type="button" class="aim-spend-cancel">' + esc(o.cancelLabel || t.cancel) + '</button><button type="button" class="aim-spend-ok" disabled>' + esc(o.okLabel || t.ok) + "</button></div></div>";
    document.body.appendChild(dlg);
    return new Promise((resolve) => {
      let settled = false;
      const rem = (
        /** @type {HTMLInputElement|null} */
        dlg.querySelector(".aim-spend-rem")
      );
      const ok = (
        /** @type {HTMLButtonElement} */
        dlg.querySelector(".aim-spend-ok")
      );
      const cancel = (
        /** @type {HTMLButtonElement} */
        dlg.querySelector(".aim-spend-cancel")
      );
      function finish(answer) {
        if (settled) return;
        settled = true;
        if (answer && o.remember && rem && rem.checked) s.remembered[o.remember] = true;
        try {
          dlg.close();
        } catch {
        }
        dlg.remove();
        resolve(answer);
      }
      cancel.addEventListener("click", () => finish(false));
      ok.addEventListener("click", () => finish(true));
      dlg.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish(false);
      });
      dlg.addEventListener("click", (e) => {
        if (e.target === dlg) finish(false);
      });
      try {
        dlg.showModal();
      } catch {
        dlg.setAttribute("open", "");
      }
      try {
        cancel.focus({ preventScroll: true });
      } catch {
        cancel.focus();
      }
      const boxEl = dlg.querySelector(".aim-spend-box");
      if (boxEl) boxEl.scrollTop = 0;
      setTimeout(() => {
        ok.disabled = false;
      }, ARM_MS);
    });
  }
  var spend = {
    confirm: confirmSpend,
    once,
    key: keyOf,
    isBusy,
    forget,
    budget: lastBudget,
    /** Clear every "don't ask again" answer — e.g. when the user signs out. */
    resetRemembered() {
      state().remembered = {};
    }
  };
  function attachSpend() {
    attach("spend", spend);
  }

  // src/static/sdk-libs/ai/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-ai.js");
  var _availCache = null;
  var _modelsCache = null;
  var ai = {
    /**
     * Returns true if the user has AI configured (an OpenRouter key, or a keyless
     * self-hosted provider). Cached 60 seconds. Apps should call this before showing
     * "Use AI" buttons. Uses GET /v1/ai/available, which an app-grant token (a sandboxed
     * app on the isolated app origin) can call with the ai:use scope — unlike the
     * owner-only /v1/openrouter/settings. Falls back to that settings probe on older nodes.
     */
    async isAvailable() {
      const now = Date.now();
      if (_availCache && now - _availCache.t < 6e4) return _availCache.v;
      try {
        const r = await authFetch2("/v1/ai/available");
        if (r && r.ok && r.data && typeof r.data.available === "boolean") {
          _availCache = { v: r.data.available, t: now };
          return r.data.available;
        }
        const s = await authFetch2("/v1/openrouter/settings");
        const v = !!(s && s.ok && s.data && (s.data.hasApiKey || s.data.has_api_key));
        _availCache = { v, t: now };
        return v;
      } catch {
        return false;
      }
    },
    /**
     * Run a single completion. Returns { content, model, usage, budget }.
     * Throws an Error with .code set on quota/permission/auth failures.
     *
     * This spends the signed-in user's own OpenRouter money, so two guards ride along:
     *   • repeats collapse — while an identical call (same app_id + model + prompts) is in flight,
     *     every further call gets the SAME promise. Five clicks on "Summarise" = one paid call.
     *     `allowDuplicate: true` opts out; `dedupeMs: N` also returns the result to a click made
     *     within N ms of the first one finishing.
     *   • `confirm: true` (or an object passed straight to AIMEAT.spend.confirm) asks the user
     *     first — use it for batches and anything the user did not directly click for. A cancel
     *     rejects with `.code === 'SPEND_CANCELLED'`.
     *
     * Recognized error codes (see routes/ai.ts):
     *   NO_API_KEY            — user hasn't set up a key yet
     *   QUOTA_EXHAUSTED       — daily user budget hit
     *   APP_QUOTA_EXHAUSTED   — per-app daily quota hit
     *   APP_NOT_ALLOWED       — app_id not in user's allowlist
     *   APP_ID_REQUIRED       — user has an allowlist; app must pass app_id
     *   INVALID_API_KEY       — provider rejected the key
     *   RATE_LIMITED          — provider rate limit
     *   PROVIDER_ERROR        — upstream provider failed
     *   SPEND_CANCELLED       — the user declined the confirm dialog
     */
    async complete(opts) {
      if (!opts || typeof opts !== "object") throw new Error("opts object required");
      if (!opts.prompt) throw new Error("opts.prompt required");
      const body = {
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        model: opts.model,
        modelRole: opts.modelRole,
        temperature: opts.temperature,
        top_p: opts.top_p,
        max_tokens: opts.max_tokens,
        app_id: opts.app_id
      };
      const call = async () => {
        if (opts.confirm) {
          const c = typeof opts.confirm === "object" ? opts.confirm : {};
          const okToSpend = await confirmSpend({
            what: c.what || "Run an AI request on your own OpenRouter key.",
            detail: c.detail,
            estimate: c.estimate,
            remaining: c.remaining,
            okLabel: c.okLabel,
            cancelLabel: c.cancelLabel,
            remember: c.remember || "ai:" + (opts.app_id || "app")
          });
          if (!okToSpend) throw cancelledError("The AI request");
        }
        const r = await authFetch2("/v1/ai/complete", {
          method: "POST",
          body: JSON.stringify(body)
        });
        if (!r || !r.ok) {
          const code = r && r.error && r.error.code || "UNKNOWN";
          const msg = r && r.error && r.error.message || "AI call failed";
          const err = (
            /** @type {Error & { code?: string }} */
            new Error(msg)
          );
          err.code = code;
          throw err;
        }
        if (r.data) noteBudget(r.data.budget);
        return r.data;
      };
      if (opts.allowDuplicate) return call();
      const key = keyOf(["ai", opts.app_id, opts.model || opts.modelRole, opts.systemPrompt, opts.prompt]);
      return once(key, call, { ttlMs: opts.dedupeMs || 0 });
    },
    /**
     * Convenience: complete + JSON.parse. Adds a "return ONLY valid JSON"
     * suffix to systemPrompt. On parse failure, retries ONCE with a stronger
     * instruction. Further failures throw — the user can retry by clicking.
     */
    async completeJson(opts) {
      const suffix = "\nReturn ONLY valid JSON, no prose, no markdown fences.";
      const first = await ai.complete({
        ...opts,
        systemPrompt: (opts.systemPrompt || "") + suffix
      });
      try {
        return { ...first, parsed: JSON.parse(first.content) };
      } catch {
        const retry = await ai.complete({
          ...opts,
          systemPrompt: (opts.systemPrompt || "") + suffix + "\nIMPORTANT: your previous attempt was not valid JSON. Output ONLY the JSON object, starting with { and ending with }. No other text.",
          temperature: typeof opts.temperature === "number" ? Math.max(0, opts.temperature - 0.3) : 0.2
        });
        try {
          return { ...retry, parsed: JSON.parse(retry.content) };
        } catch {
          const err = (
            /** @type {Error & { code?: string }} */
            new Error("AI returned invalid JSON twice. Original response: " + retry.content.slice(0, 200))
          );
          err.code = "JSON_PARSE_FAILED";
          throw err;
        }
      }
    },
    /**
     * List the models the user's account can hit. Cached 1 hour.
     */
    async models() {
      const now = Date.now();
      if (_modelsCache && now - _modelsCache.t < 36e5) return _modelsCache.v;
      const r = await authFetch2("/v1/openrouter/models");
      if (!r || !r.ok) throw new Error(r && r.error && r.error.message || "Failed to list models");
      const v = r.data && r.data.models ? r.data.models : [];
      _modelsCache = { v, t: now };
      return v;
    },
    /**
     * Today's spend snapshot (owner-only). Useful for "AI used: $0.04 / $1.00".
     */
    async usage() {
      const r = await authFetch2("/v1/ai/usage");
      if (!r || !r.ok) throw new Error(r && r.error && r.error.message || "Failed to read usage");
      return r.data;
    },
    /**
     * Clear browser-side caches. Call after the user toggles their key/budget.
     */
    invalidateCache() {
      _availCache = null;
      _modelsCache = null;
    }
  };
  attach("ai", ai);
  attachSpend();
})();
