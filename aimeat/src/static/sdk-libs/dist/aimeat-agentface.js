// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/agentface/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-agentface.js (with a per-node config prelude).
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

  // src/static/sdk-libs/_core/clipboard.js
  async function copyText(text) {
    const value = String(text == null ? "" : text);
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  // src/static/sdk-libs/agentface/index.js
  var MAX_BYTES = 256 * 1024;
  function getSession() {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before aimeat-agentface.js");
    }
    const s = auth.getSession();
    if (!s) {
      throw new Error("Not signed in. AIMEATAgentFace.publish writes the face as the signed-in user — call AIMEAT.auth.login() first. Note: the node serves only the record written by the APP OWNER; another user's publish lands in their own namespace and is never served.");
    }
    return s;
  }
  function compose(doc) {
    if (!doc || typeof doc !== "object") {
      throw new Error("compose expects { title, sections: [{ heading, body }] }");
    }
    const parts = [];
    if (doc.title) parts.push("# " + String(doc.title).trim());
    const sections = Array.isArray(doc.sections) ? doc.sections : [];
    for (const s of sections) {
      if (!s || typeof s.heading !== "string" || !s.heading.trim()) {
        throw new Error("Every section needs a non-empty string heading");
      }
      parts.push("## " + s.heading.trim() + "\n\n" + (typeof s.body === "string" ? s.body.trim() : ""));
    }
    if (parts.length === 0) throw new Error("Nothing to compose — provide a title and/or sections");
    return parts.join("\n\n") + "\n";
  }
  function inferFilename() {
    const meta = typeof document !== "undefined" && document.querySelector('meta[name="aimeat-app"]');
    const fromMeta = meta && meta.getAttribute("content");
    if (fromMeta && fromMeta.trim()) return fromMeta.trim();
    const m = typeof location !== "undefined" && location.pathname.match(/\/v1\/apps\/[^/]+\/([^/?#]+\.html?)$/i);
    if (m) return decodeURIComponent(m[1]);
    return null;
  }
  function sessionOrNull() {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth || typeof auth.getSession !== "function") return null;
    try {
      return auth.getSession() || null;
    } catch {
      return null;
    }
  }
  var quiet = /* @__PURE__ */ new Map();
  function quietState(filename) {
    let st = quiet.get(filename);
    if (!st) {
      st = { last: null, chain: Promise.resolve(), timer: null, input: null, waiters: [] };
      quiet.set(filename, st);
    }
    return st;
  }
  function quietWarn(filename, err) {
    console.warn("[aimeat-agentface] publishQuietly(" + (filename || "?") + ") wrote nothing: " + String(err && err.message || err));
  }
  function quietRun(filename, input) {
    const st = quietState(filename);
    const run = st.chain.then(async function() {
      if (!sessionOrNull()) return false;
      let markdown;
      try {
        const value = typeof input === "function" ? input() : input;
        markdown = typeof value === "string" ? value : compose(value);
      } catch (e) {
        quietWarn(filename, e);
        return false;
      }
      if (markdown === st.last) return false;
      st.last = markdown;
      try {
        await agentface.publish(markdown, { app: filename });
        return true;
      } catch (e) {
        st.last = null;
        quietWarn(filename, e);
        return false;
      }
    });
    st.chain = run;
    return run;
  }
  var agentface = {
    /** The convention memory key the face lives under. */
    key(filename) {
      return "apps." + filename + ".agentface";
    },
    /** The markdown composer (exposed so an app can preview what publish() will write). */
    compose,
    /**
     * Copy text to the clipboard the way every "Copy prompt" button should: async clipboard API
     * first, hidden-offscreen-textarea execCommand fallback — never a visible selection painted
     * over the page. Resolves to true/false; never throws. This is THE shared implementation for
     * the platform's copy-a-prompt-to-your-AI pattern — stop hand-rolling it per app. The code
     * lives in _core/clipboard.js, shared with the Atelier kit's copy().
     * @param {unknown} text
     * @returns {Promise<boolean>}
     */
    copyText(text) {
      return copyText(text);
    },
    /**
     * Publish this app's agent face: a markdown string, or { title, sections: [{ heading, body }] }.
     * opts.app names the app filename explicitly (e.g. 'my-app.html') and overrides inference —
     * pass it on per-app subdomain origins, where the filename is not derivable from the URL.
     * Writes the public record apps.{filename}.agentface via the authenticated memory API.
     */
    async publish(input, opts) {
      opts = opts || {};
      const markdown = typeof input === "string" ? input : compose(input);
      if (!markdown.trim()) throw new Error("AIMEATAgentFace.publish: the markdown content is empty");
      if (new TextEncoder().encode(markdown).length > MAX_BYTES) {
        throw new Error("Agent face exceeds the 256 KB cap — the node would treat it as absent. Publish a summary and link out to records instead.");
      }
      const filename = typeof opts.app === "string" && opts.app.trim() ? opts.app.trim() : inferFilename();
      if (!filename) {
        throw new Error('Cannot derive the app filename on this origin — pass { app: "your-file.html" } or add <meta name="aimeat-app" content="your-file.html"> to the page');
      }
      const session = getSession();
      const key = agentface.key(filename);
      const res = await session.fetch("/v1/memory", {
        method: "POST",
        body: JSON.stringify({ key, value: markdown, visibility: "public" })
      });
      if (!res.ok) {
        throw new Error(res.error && res.error.message || "Failed to publish the agent face");
      }
      return { key, app: filename, version: res.data && res.data.version, visibility: "public" };
    },
    /**
     * publish() for an app that updates its face as it runs and must never break because of it.
     * `input` is what publish() takes (markdown or { title, sections }) or a function that returns
     * it, called when the write happens, so a debounced burst composes the latest state once.
     * Resolves true when the face was written; false when nothing was written: signed out or no
     * aimeat-auth on the page, the same markdown as the last write for this app, a burst member
     * that a later call replaced, or a failure (then one console.warn line). Never rejects.
     * @param {string|object|(() => string|object)} input
     * @param {{ app?: string, debounceMs?: number }} [opts]
     * @returns {Promise<boolean>}
     */
    publishQuietly(input, opts) {
      const o = opts || {};
      if (!sessionOrNull()) return Promise.resolve(false);
      const filename = typeof o.app === "string" && o.app.trim() ? o.app.trim() : inferFilename();
      if (!filename) {
        quietWarn(null, new Error('no app filename on this origin; pass { app: "your-file.html" }'));
        return Promise.resolve(false);
      }
      const wait = Number(o.debounceMs) > 0 ? Number(o.debounceMs) : 0;
      if (!wait) return quietRun(filename, input);
      const st = quietState(filename);
      st.input = input;
      if (st.timer) clearTimeout(st.timer);
      return new Promise(function(resolveOk) {
        st.waiters.push(resolveOk);
        st.timer = setTimeout(function() {
          const waiters = st.waiters;
          const latest = st.input;
          st.waiters = [];
          st.input = null;
          st.timer = null;
          quietRun(filename, latest).then(function(ok) {
            waiters.forEach(function(w, i) {
              w(i === waiters.length - 1 ? ok : false);
            });
          });
        }, wait);
      });
    }
  };
  attach("agentface", agentface);
  window.AIMEATAgentFace = agentface;
})();
