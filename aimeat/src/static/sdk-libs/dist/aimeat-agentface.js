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
     * the platform's copy-a-prompt-to-your-AI pattern — stop hand-rolling it per app.
     */
    async copyText(text) {
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
    }
  };
  attach("agentface", agentface);
  window.AIMEATAgentFace = agentface;
})();
