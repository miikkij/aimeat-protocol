// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/webmcp/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-webmcp.js (with a per-node config prelude).
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

  // src/static/sdk-libs/webmcp/index.js
  var NODE_URL2 = APEX_URL;
  function asContent(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
    return { content: [{ type: "text", text }] };
  }
  async function registerWith(tools) {
    const doc = (
      /** @type {any} */
      typeof document !== "undefined" ? document : {}
    );
    const nav = (
      /** @type {any} */
      typeof navigator !== "undefined" ? navigator : {}
    );
    const docMc = doc.modelContext;
    const navMc = nav.modelContext;
    if (docMc && typeof docMc.registerTool === "function") {
      for (const t of tools) await docMc.registerTool(t);
      return "document.modelContext.registerTool";
    }
    if (navMc && typeof navMc.registerTool === "function") {
      for (const t of tools) await navMc.registerTool(t);
      return "navigator.modelContext.registerTool";
    }
    if (navMc && typeof navMc.provideContext === "function") {
      await navMc.provideContext({ tools: webmcp.tools.concat(tools) });
      return "navigator.modelContext.provideContext";
    }
    return "none";
  }
  async function fetchListing(owner, appId) {
    const r = await fetch(NODE_URL2 + "/v1/apps/" + encodeURIComponent(owner) + "/" + encodeURIComponent(appId) + "/webmcp");
    const body = await r.json();
    if (!r.ok) throw new Error(body.error && body.error.message || "WebMCP listing failed: " + r.status);
    return body;
  }
  function buildExecute(owner, appId, entry) {
    return async function execute(args) {
      const appRef = owner + "/" + appId;
      const paid = entry.payment && entry.payment.required;
      if (paid) {
        const commerce = window.AIMEAT && window.AIMEAT.commerce;
        const session = window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession();
        if (commerce && session) {
          try {
            const done = await commerce.invokeAppTool({ app: appRef, tool: entry.name, input: args || {} });
            const f = done.fulfillment || {};
            const result = f.results && f.results[0] && f.results[0].result !== void 0 ? f.results[0].result : { queued_task: f.taskIds && f.taskIds[0] || null, note: "Order queued as an agent task; the deliverable arrives via the seller." };
            return asContent({ tool: entry.name, receipt: done.receipt, result });
          } catch (e) {
            return asContent({ tool: entry.name, error: e.message, code: e.code, accepts: e.accepts });
          }
        }
        const r = await fetch(entry.invoke.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: args || {} }) });
        return asContent(await r.json());
      }
      const sess = window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession();
      if (!sess) return asContent({ tool: entry.name, error: "Sign in to call this free tool (bearer token required)." });
      const res = await sess.fetch("/v1/apps/" + encodeURIComponent(owner) + "/" + encodeURIComponent(appId) + "/webmcp/tools/" + encodeURIComponent(entry.name), {
        method: "POST",
        body: JSON.stringify({ input: args || {} })
      });
      return asContent(res.ok ? res.data : res);
    };
  }
  function aboutTool(ref, surface, toolCount) {
    const s = surface || {};
    const label = s.name || ref.appId;
    const parts = [];
    if (toolCount) parts.push(toolCount + " callable tool" + (toolCount === 1 ? "" : "s"));
    if ((s.skills || []).length) parts.push(s.skills.length + " bound skill" + (s.skills.length === 1 ? "" : "s"));
    if ((s.bundled_agents || []).length) parts.push(s.bundled_agents.length + " bundled agent" + (s.bundled_agents.length === 1 ? "" : "s"));
    const offers = ((s.exchange || {}).offerings || []).length;
    if (offers) parts.push(offers + " EXCHANGE listing" + (offers === 1 ? "" : "s"));
    const carries = parts.length ? " Carries " + parts.join(", ") + "." : "";
    return {
      name: "about-this-app",
      description: 'What "' + label + '" (' + ref.owner + "/" + ref.appId + ") offers an agent: its app id, declared scopes, the SKILL.md packs bound to it, the agent crews it ships, and what it sells on the AIMEAT EXCHANGE, with prices." + carries,
      inputSchema: { type: "object", properties: {} },
      async execute() {
        if (surface) return asContent(surface);
        const listing = await fetchListing(ref.owner, ref.appId);
        return asContent(listing.app_surface || { app: ref.owner + "/" + ref.appId });
      }
    };
  }
  var webmcp = {
    /** Every tool descriptor this page has registered (introspection + provideContext resends). */
    tools: [],
    /** The registration surface last used ('none' when no agent API is present). */
    surface: "none",
    /** Low-level: register ready-made WebMCP tool descriptors ({name, description, inputSchema, execute}).
     *  Re-registering a name REPLACES the earlier descriptor (idempotent across repeated expose calls). */
    async register(tools) {
      const names = tools.map(function(t) {
        return t.name;
      });
      webmcp.tools = webmcp.tools.filter(function(t) {
        return names.indexOf(t.name) === -1;
      });
      const surface = await registerWith(tools);
      webmcp.tools = webmcp.tools.concat(tools);
      webmcp.surface = surface;
      return surface;
    },
    /**
     * Expose an app's declared tools (apps.{appId}.tools manifest) to the in-browser agent.
     * Descriptions of priced tools carry the price tag so the agent can tell the user the cost.
     *
     * Every app also gets `about-this-app`, built from the listing's `app_surface`: the SKILL.md
     * packs bound to the app, the crew-defs it ships, its declared scopes and its live EXCHANGE
     * listings. An app that sells nothing still exposes that one, so an agent that lands on any
     * app page can ask what it is looking at instead of reading 200 kB of minified source.
     */
    async exposeAppTools(ref) {
      const listing = await fetchListing(ref.owner, ref.appId);
      const surface = listing.app_surface || null;
      const tools = (listing.tools || []).map(function(entry) {
        let desc = entry.description || entry.name;
        if (entry.payment && entry.payment.required) {
          const p = entry.payment;
          const tags = [];
          if (p.price) tags.push(p.price.morsels + " morsels/call");
          if (p.priceMoney) tags.push(p.priceMoney.amount / 1e6 + " " + p.priceMoney.currency + "/call");
          desc = "[PAID: " + tags.join(" or ") + "] " + desc;
        }
        return {
          name: entry.name,
          description: desc,
          inputSchema: entry.inputSchema || { type: "object", properties: {} },
          execute: buildExecute(ref.owner, ref.appId, entry)
        };
      });
      tools.unshift(aboutTool(ref, surface, tools.length));
      await webmcp.register(tools);
      return { surface: webmcp.surface, tools: tools.map(function(t) {
        return t.name;
      }) };
    },
    /** Node-level tools for the portal pages: public commerce/product discovery, no auth needed. */
    async exposeNodeTools() {
      const tools = [
        {
          name: "aimeat-commerce-feed",
          description: "List everything for sale on this AIMEAT node: agent offers and priced app-tools (per-call functions of published apps), with prices in morsels or money micro-units.",
          inputSchema: { type: "object", properties: {} },
          async execute() {
            const r = await fetch(NODE_URL2 + "/v1/commerce/feed");
            return asContent(await r.json());
          }
        },
        {
          name: "aimeat-node-info",
          description: "Describe this AIMEAT node: identity, capabilities, discovery endpoints, and how agents connect.",
          inputSchema: { type: "object", properties: {} },
          async execute() {
            const r = await fetch(NODE_URL2 + "/.well-known/aimeat");
            return asContent(await r.json());
          }
        }
      ];
      await webmcp.register(tools);
      return { surface: webmcp.surface, tools: tools.map(function(t) {
        return t.name;
      }) };
    }
  };
  attach("webmcp", webmcp);
  function appRefFromPage(el) {
    const ds = el && el.dataset || {};
    if (ds.owner && ds.app) return { owner: ds.owner, appId: ds.app };
    try {
      const node = document.getElementById("aimeat-app-ref");
      if (!node) return null;
      const ref = JSON.parse(node.textContent || "{}");
      if (ref.owner && ref.app_id) return { owner: ref.owner, appId: ref.app_id };
    } catch {
    }
    return null;
  }
  try {
    const el = (
      /** @type {any} */
      typeof document !== "undefined" && document.currentScript
    );
    const src = el && el.src ? new URL(el.src, location.href) : null;
    const expose = src && src.searchParams.get("expose") || el && el.dataset && el.dataset.expose;
    if (expose === "node") {
      setTimeout(function() {
        webmcp.exposeNodeTools().catch(function() {
        });
      }, 0);
    } else if (expose === "app") {
      const ref = appRefFromPage(el);
      if (ref) setTimeout(function() {
        webmcp.exposeAppTools(ref).catch(function() {
        });
      }, 0);
    }
  } catch {
  }
})();
