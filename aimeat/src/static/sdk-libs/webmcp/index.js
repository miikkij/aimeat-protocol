/**
 * @file webmcp/index.js
 * @description The aimeat-webmcp library (SDK-libs migration Phase 2, TARGET-034 phase C). The in-page
 *   half of the WebMCP bridge: feature-detects every shipped shape of the WebMCP registration API
 *   (document.modelContext.registerTool — current CG draft; navigator.modelContext.registerTool /
 *   provideContext — transitional), registers an app's declared tools (apps.{appId}.tools) with real
 *   execute callbacks, and exposes node-level tools. Priced tools pay through AIMEAT.commerce.
 *   invokeAppTool when signed in; otherwise execute returns the 402/x402 payment instructions.
 *   Componentized ESM source esbuild bundles to the IIFE served, unchanged, at /v1/libs/aimeat-webmcp.js.
 *   Ported verbatim from lib-webmcp.ts; NODE_URL is the apex base (APEX_URL from _core/config).
 * @structure imports APEX_URL (config) + attach (namespace); asContent/registerWith/fetchListing/
 *   buildExecute; the `webmcp` object; attach('webmcp', …) + optional ?expose=node auto-activation.
 * @usage <script src="/v1/libs/aimeat-webmcp.js"></script>
 *   await AIMEAT.webmcp.exposeAppTools({ owner: 'alice', appId: 'shop.html' });
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-webmcp.ts (SDK-libs migration Phase 2).
 */
import { APEX_URL } from '../_core/config.js';
import { attach } from '../_core/namespace.js';

const NODE_URL = APEX_URL;

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
  // modelContext is a non-standard (WebMCP draft) API absent from lib.dom — access via any.
  const doc = /** @type {any} */ (typeof document !== 'undefined' ? document : {});
  const nav = /** @type {any} */ (typeof navigator !== 'undefined' ? navigator : {});
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
      const commerce = window.AIMEAT && window.AIMEAT.commerce;
      const session = window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession();
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
    const sess = window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession && window.AIMEAT.auth.getSession();
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
attach('webmcp', webmcp);

try {
  const el = /** @type {any} */ (typeof document !== 'undefined' && document.currentScript);
  const src = el && el.src ? new URL(el.src, location.href) : null;
  const expose = (src && src.searchParams.get('expose')) || (el && el.dataset && el.dataset.expose);
  if (expose === 'node') {
    // Defer past parse so a scanner's early modelContext shim is in place.
    setTimeout(function () { webmcp.exposeNodeTools().catch(function () {}); }, 0);
  }
} catch { /* auto-activation is best-effort; explicit calls always work */ }
