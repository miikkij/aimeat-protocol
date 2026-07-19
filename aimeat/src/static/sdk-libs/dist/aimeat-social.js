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
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/_core/session.js
  function getSession() {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before this library.");
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts) {
    return getSession().fetch(path, opts);
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
  async function publicFetch(path) {
    const r = await fetch(NODE_URL + path);
    return r.json();
  }
  var social = {
    // ── Boards ──
    // Create a new board
    async createBoard(name, opts) {
      const body = { name, visibility: "public", ...opts };
      const res = await authFetch("/v1/boards", { method: "POST", body: JSON.stringify(body) });
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
      const res = await authFetch("/v1/boards/" + encodeURIComponent(boardId) + "/posts", {
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
      const res = await authFetch(
        "/v1/boards/" + encodeURIComponent(boardId) + "/posts/" + encodeURIComponent(postId) + "/react",
        { method: "POST", body: JSON.stringify({ reaction }) }
      );
      if (!res.ok) throw new Error(res.error?.message || "Failed to react");
      return res.data;
    },
    // Reply to a post
    async reply(boardId, postId, body) {
      const content = typeof body === "string" ? { body } : body;
      const res = await authFetch(
        "/v1/boards/" + encodeURIComponent(boardId) + "/posts/" + encodeURIComponent(postId) + "/replies",
        { method: "POST", body: JSON.stringify(content) }
      );
      if (!res.ok) throw new Error(res.error?.message || "Failed to reply");
      return res.data;
    },
    // ── Subscriptions ──
    // Subscribe to a board
    async subscribe(boardId, opts) {
      const body = { callback_url: opts?.callback_url, filters: opts?.filters };
      const res = await authFetch("/v1/boards/" + encodeURIComponent(boardId) + "/subscribe", {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to subscribe");
      return res.data;
    },
    // Unsubscribe from a board
    async unsubscribe(boardId) {
      const res = await authFetch("/v1/boards/" + encodeURIComponent(boardId) + "/subscribe", {
        method: "DELETE"
      });
      if (!res.ok) throw new Error(res.error?.message || "Failed to unsubscribe");
      return res.data;
    },
    // List own subscriptions
    async subscriptions() {
      const res = await authFetch("/v1/boards/subscriptions");
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
