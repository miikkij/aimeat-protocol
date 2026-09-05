// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/social/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-social.js (with a per-node config prelude).
"use strict";
(() => {
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

  // src/static/sdk-libs/social/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-social.js");
  async function publicFetch(path) {
    const r = await fetch(NODE_URL + path);
    return r.json();
  }
  var social = {
    // ── Boards ──
    // Create a new board
    async createBoard(name, opts) {
      const body = { name, visibility: "public", ...opts };
      const res = await authFetch2("/v1/boards", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error(res.error?.message || "Failed to create board");
      return res.data;
    },
    // List all visible boards (no auth needed for public boards)
    async boards() {
      const res = await publicFetch("/v1/boards");
      if (!res.ok) throw new Error(res.error?.message || "Failed to list boards");
      return res.data;
    },
    // ── Posts ──
    // Post to a board
    async post(boardId, content) {
      const body = typeof content === "string" ? { body: content } : content;
      const res = await authFetch2("/v1/boards/" + encodeURIComponent(boardId) + "/posts", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to post");
      return res.data;
    },
    // List posts in a board (public, no auth needed)
    async posts(boardId, opts) {
      const params = new URLSearchParams();
      if (opts?.category) params.set("category", opts.category);
      if (opts?.cursor) params.set("cursor", opts.cursor);
      if (opts?.limit) params.set("limit", String(opts.limit));
      const qs = params.toString();
      const res = await publicFetch("/v1/boards/" + encodeURIComponent(boardId) + "/posts" + (qs ? "?" + qs : ""));
      if (!res.ok) throw new Error(res.error?.message || "Failed to list posts");
      return res.data;
    },
    // Get a single post
    async getPost(boardId, postId) {
      const res = await publicFetch("/v1/boards/" + encodeURIComponent(boardId) + "/posts/" + encodeURIComponent(postId));
      if (!res.ok) {
        if (res.error?.code === "NOT_FOUND") return null;
        throw new Error(res.error?.message || "Failed to get post");
      }
      return res.data;
    },
    // ── Reactions & Replies ──
    // React to a post
    async react(boardId, postId, reaction) {
      const res = await authFetch2(
        "/v1/boards/" + encodeURIComponent(boardId) + "/posts/" + encodeURIComponent(postId) + "/react",
        { method: "POST", body: JSON.stringify({ reaction }) }
      );
      if (!res.ok) throw new Error(res.error?.message || "Failed to react");
      return res.data;
    },
    // Take your own reaction back. Every app that offered a heart offered a one-way door until
    // 2026-09-06, because this half did not exist anywhere below it either. Removes only the
    // signed-in person's own mark; throws when they never made it.
    async unreact(boardId, postId, reaction) {
      const res = await authFetch2(
        "/v1/boards/" + encodeURIComponent(boardId) + "/posts/" + encodeURIComponent(postId) + "/react?reaction=" + encodeURIComponent(reaction),
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(res.error?.message || "Failed to take the reaction back");
      return res.data;
    },
    // Reply to a post
    async reply(boardId, postId, body) {
      const content = typeof body === "string" ? { body } : body;
      const res = await authFetch2(
        "/v1/boards/" + encodeURIComponent(boardId) + "/posts/" + encodeURIComponent(postId) + "/replies",
        { method: "POST", body: JSON.stringify(content) }
      );
      if (!res.ok) throw new Error(res.error?.message || "Failed to reply");
      return res.data;
    },
    // Take a notice down as handled (resolved: true) or move its expiry (ttl_hours). Author or board keeper.
    async updatePost(boardId, postId, changes) {
      const res = await authFetch2(
        "/v1/boards/" + encodeURIComponent(boardId) + "/posts/" + encodeURIComponent(postId),
        { method: "PATCH", body: JSON.stringify(changes) }
      );
      if (!res.ok) throw new Error(res.error?.message || "Failed to update post");
      return res.data;
    },
    // ── Rules (board keeper only) ──
    // Set the board's own rules: { posting, categories, default_ttl_hours, post_cost }. null resets them.
    async setRules(boardId, rules) {
      const res = await authFetch2("/v1/boards/" + encodeURIComponent(boardId) + "/rules", {
        method: "PATCH",
        body: JSON.stringify({ rules })
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to set board rules");
      return res.data;
    },
    // True when a session is signed in, so a page can show the visitor a sign-in door instead of
    // letting post()/react()/reply() throw.
    signedIn() {
      const auth = window.AIMEAT && window.AIMEAT.auth;
      return !!(auth && auth.getSession && auth.getSession());
    },
    // ── Subscriptions ──
    // Subscribe to a board
    async subscribe(boardId, opts) {
      const body = { callback_url: opts?.callback_url, filters: opts?.filters };
      const res = await authFetch2("/v1/boards/" + encodeURIComponent(boardId) + "/subscribe", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to subscribe");
      return res.data;
    },
    // Unsubscribe from a board
    async unsubscribe(boardId) {
      const res = await authFetch2("/v1/boards/" + encodeURIComponent(boardId) + "/subscribe", {
        method: "DELETE"
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to unsubscribe");
      return res.data;
    },
    // List own subscriptions
    async subscriptions() {
      const res = await authFetch2("/v1/boards/subscriptions");
      if (!res.ok) throw new Error(res.error?.message || "Failed to list subscriptions");
      return res.data;
    },
    // ── Catalogue (public, no auth) ──
    // Browse public boards from catalogue
    async catalogue() {
      const res = await publicFetch("/v1/catalogue/boards");
      if (!res.ok) throw new Error(res.error?.message || "Failed to browse catalogue boards");
      return res.data;
    }
  };
  attach("social", social);
})();
