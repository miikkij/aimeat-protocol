/**
 * @file src/routes/lib-webmcp.ts
 * @description Server-side generator for the browser library aimeat-webmcp.js — the IN-PAGE half
 *   of the WebMCP bridge (TARGET-034 phase C). WebMCP (W3C Web Machine Learning CG draft, Chrome
 *   149 origin trial / Edge 147) lets a page hand tools to in-browser agents via
 *   document.modelContext.registerTool. This library feature-detects every shipped shape of that
 *   API (document.modelContext.registerTool — current draft; navigator.modelContext.registerTool /
 *   provideContext — earlier explainer shape, and what readiness scanners shim), registers an
 *   app's declared tools (apps.{appId}.tools, phase A) with real execute callbacks, and exposes a
 *   small set of node-level tools for the portal homepage. Priced tools pay through the commerce
 *   checkout (AIMEAT.commerce.invokeAppTool) when the user is signed in; otherwise execute returns
 *   the 402/x402 payment instructions so the agent learns HOW to pay.
 * @structure
 *   - aimeatWebmcpLib(config): returns the IIFE source, stamped with node base URL
 *   - emitted webmcp.register(tools): feature-detected registration, returns the surface used
 *   - emitted webmcp.exposeAppTools({ owner, appId }): fetch /webmcp listing → register tools
 *   - emitted webmcp.exposeNodeTools(): node-level tools (commerce feed, node info)
 *   - auto-activation: <script src=".../aimeat-webmcp.js?expose=node"> registers node tools on load
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial WebMCP bridge library (TARGET-034 phase C)
 */
import type { AimeatConfig } from '../config.js';

export function aimeatWebmcpLib(config: AimeatConfig): string {
  return `// aimeat-webmcp.js — AIMEAT WebMCP bridge (expose app tools to in-browser agents)
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// WebMCP: https://github.com/webmachinelearning/webmcp (W3C Web Machine Learning CG draft)
// Usage (app page):   await AIMEAT.webmcp.exposeAppTools({ owner: 'alice', appId: 'shop.html' });
// Usage (any page):   await AIMEAT.webmcp.exposeNodeTools();
// Auto (script tag):  <script src="/v1/libs/aimeat-webmcp.js?expose=node" defer></script>
// Priced tools: execute() pays through AIMEAT.commerce.invokeAppTool when signed in (load
// aimeat-auth.js + aimeat-commerce.js first); signed out it returns the x402 payment instructions.
(function(global) {
'use strict';

const NODE_URL = '${config.baseUrl}';

/** Wrap any value as WebMCP tool-result content ({ content: [{ type:'text', text }] }). */
function asContent(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: 'text', text: text }] };
}

/**
 * Feature-detect the WebMCP registration surface:
 *  - document.modelContext.registerTool  (current CG draft)
 *  - navigator.modelContext.registerTool (transitional)
 *  - navigator.modelContext.provideContext({ tools }) (earlier explainer shape; readiness
 *    scanners shim this and watch for the call)
 * Returns which surface took the tools, or 'none' when no agent/scanner API is present.
 */
async function registerWith(tools) {
  const doc = typeof document !== 'undefined' ? document : {};
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const docMc = doc.modelContext;
  const navMc = nav.modelContext;
  if (docMc && typeof docMc.registerTool === 'function') {
    for (const t of tools) await docMc.registerTool(t);
    return 'document.modelContext.registerTool';
  }
  if (navMc && typeof navMc.registerTool === 'function') {
    for (const t of tools) await navMc.registerTool(t);
    return 'navigator.modelContext.registerTool';
  }
  if (navMc && typeof navMc.provideContext === 'function') {
    // provideContext replaces the full tool set — pass everything registered so far.
    await navMc.provideContext({ tools: webmcp.tools.concat(tools) });
    return 'navigator.modelContext.provideContext';
  }
  return 'none';
}

/** Fetch an app's served WebMCP listing (public manifest view). */
async function fetchListing(owner, appId) {
  const r = await fetch(NODE_URL + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(appId) + '/webmcp');
  const body = await r.json();
  if (!r.ok) throw new Error((body.error && body.error.message) || ('WebMCP listing failed: ' + r.status));
  return body;
}

/** Build the execute() for one app tool: paid → checkout; free-callable → HTTP invoke. */
function buildExecute(owner, appId, entry) {
  return async function execute(args) {
    const appRef = owner + '/' + appId;
    const paid = entry.payment && entry.payment.required;
    if (paid) {
      const commerce = global.AIMEAT && global.AIMEAT.commerce;
      const session = global.AIMEAT && global.AIMEAT.auth && global.AIMEAT.auth.getSession && global.AIMEAT.auth.getSession();
      if (commerce && session) {
        // Signed in: pay through the checkout core. A callable tool's result rides on the
        // completed session; a task tool returns the queued task id.
        try {
          const done = await commerce.invokeAppTool({ app: appRef, tool: entry.name, input: args || {} });
          const f = done.fulfillment || {};
          const result = (f.results && f.results[0] && f.results[0].result !== undefined)
            ? f.results[0].result
            : { queued_task: (f.taskIds && f.taskIds[0]) || null, note: 'Order queued as an agent task; the deliverable arrives via the seller.' };
          return asContent({ tool: entry.name, receipt: done.receipt, result: result });
        } catch (e) {
          return asContent({ tool: entry.name, error: e.message, code: e.code, accepts: e.accepts });
        }
      }
      // Signed out (or commerce lib absent): surface the 402 payment instructions verbatim so
      // the agent learns HOW to pay (x402-style accepts + ready-made checkout line item).
      const r = await fetch(entry.invoke.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: args || {} }) });
      return asContent(await r.json());
    }
    // Unpriced: direct HTTP invoke (needs a signed-in session for the bearer token).
    const sess = global.AIMEAT && global.AIMEAT.auth && global.AIMEAT.auth.getSession && global.AIMEAT.auth.getSession();
    if (!sess) return asContent({ tool: entry.name, error: 'Sign in to call this free tool (bearer token required).' });
    const res = await sess.fetch('/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(appId) + '/webmcp/tools/' + encodeURIComponent(entry.name), {
      method: 'POST', body: JSON.stringify({ input: args || {} }),
    });
    return asContent(res.ok ? res.data : res);
  };
}

const webmcp = {
  /** Every tool descriptor this page has registered (introspection + provideContext resends). */
  tools: [],
  /** The registration surface last used ('none' when no agent API is present). */
  surface: 'none',

  /** Low-level: register ready-made WebMCP tool descriptors ({name, description, inputSchema, execute}).
   *  Re-registering a name REPLACES the earlier descriptor (idempotent across repeated expose calls). */
  async register(tools) {
    const names = tools.map(function (t) { return t.name; });
    webmcp.tools = webmcp.tools.filter(function (t) { return names.indexOf(t.name) === -1; });
    const surface = await registerWith(tools);
    webmcp.tools = webmcp.tools.concat(tools);
    webmcp.surface = surface;
    return surface;
  },

  /**
   * Expose an app's declared tools (apps.{appId}.tools manifest) to the in-browser agent.
   * Descriptions of priced tools carry the price tag so the agent can tell the user the cost.
   */
  async exposeAppTools(ref) {
    const listing = await fetchListing(ref.owner, ref.appId);
    const tools = (listing.tools || []).map(function (entry) {
      let desc = entry.description || entry.name;
      if (entry.payment && entry.payment.required) {
        const p = entry.payment;
        const tags = [];
        if (p.price) tags.push(p.price.morsels + ' morsels/call');
        if (p.priceMoney) tags.push((p.priceMoney.amount / 1000000) + ' ' + p.priceMoney.currency + '/call');
        desc = '[PAID: ' + tags.join(' or ') + '] ' + desc;
      }
      return {
        name: entry.name,
        description: desc,
        inputSchema: entry.inputSchema || { type: 'object', properties: {} },
        execute: buildExecute(ref.owner, ref.appId, entry),
      };
    });
    await webmcp.register(tools);
    return { surface: webmcp.surface, tools: tools.map(function (t) { return t.name; }) };
  },

  /** Node-level tools for the portal pages: public commerce/product discovery, no auth needed. */
  async exposeNodeTools() {
    const tools = [
      {
        name: 'aimeat-commerce-feed',
        description: 'List everything for sale on this AIMEAT node: agent offers and priced app-tools (per-call functions of published apps), with prices in morsels or money micro-units.',
        inputSchema: { type: 'object', properties: {} },
        async execute() {
          const r = await fetch(NODE_URL + '/v1/commerce/feed');
          return asContent(await r.json());
        },
      },
      {
        name: 'aimeat-node-info',
        description: 'Describe this AIMEAT node: identity, capabilities, discovery endpoints, and how agents connect.',
        inputSchema: { type: 'object', properties: {} },
        async execute() {
          const r = await fetch(NODE_URL + '/.well-known/aimeat');
          return asContent(await r.json());
        },
      },
    ];
    await webmcp.register(tools);
    return { surface: webmcp.surface, tools: tools.map(function (t) { return t.name; }) };
  },
};

// ── Expose globally + optional auto-activation from the script tag ──
if (!global.AIMEAT) global.AIMEAT = {};
global.AIMEAT.webmcp = webmcp;

try {
  const el = typeof document !== 'undefined' && document.currentScript;
  const src = el && el.src ? new URL(el.src, location.href) : null;
  const expose = (src && src.searchParams.get('expose')) || (el && el.dataset && el.dataset.expose);
  if (expose === 'node') {
    // Defer past parse so a scanner's early modelContext shim is in place.
    setTimeout(function () { webmcp.exposeNodeTools().catch(function () {}); }, 0);
  }
} catch (e) { /* auto-activation is best-effort; explicit calls always work */ }

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
`;
}
