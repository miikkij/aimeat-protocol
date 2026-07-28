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
 *   v1.1.0 — 2026-07-28 — `?expose=app` auto-activation (owner/app from the script tag's data-*, else
 *     the injected #aimeat-app-ref block) and an `about-this-app` tool built from the listing's
 *     app_surface — bound SKILL.md packs, bundled crews, declared scopes, EXCHANGE listings — so an
 *     app with no priced tools still exposes something an agent can act on.
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

/**
 * The one tool every app exposes: what this app IS to an agent. The description carries the
 * headline counts so an agent that only reads descriptors already knows whether there is a skill
 * to load, a crew to deploy or a contract to take; execute() returns the whole surface.
 */
function aboutTool(ref, surface, toolCount) {
  const s = surface || {};
  const label = s.name || ref.appId;
  const parts = [];
  if (toolCount) parts.push(toolCount + ' callable tool' + (toolCount === 1 ? '' : 's'));
  if ((s.skills || []).length) parts.push(s.skills.length + ' bound skill' + (s.skills.length === 1 ? '' : 's'));
  if ((s.bundled_agents || []).length) parts.push(s.bundled_agents.length + ' bundled agent' + (s.bundled_agents.length === 1 ? '' : 's'));
  const offers = ((s.exchange || {}).offerings || []).length;
  if (offers) parts.push(offers + ' EXCHANGE listing' + (offers === 1 ? '' : 's'));
  const carries = parts.length ? ' Carries ' + parts.join(', ') + '.' : '';
  return {
    name: 'about-this-app',
    description: 'What "' + label + '" (' + ref.owner + '/' + ref.appId + ') offers an agent: its app id, '
      + 'declared scopes, the SKILL.md packs bound to it, the agent crews it ships, and what it sells on the '
      + 'AIMEAT EXCHANGE, with prices.' + carries,
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      if (surface) return asContent(surface);
      const listing = await fetchListing(ref.owner, ref.appId);
      return asContent(listing.app_surface || { app: ref.owner + '/' + ref.appId });
    },
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
   *
   * Every app also gets `about-this-app`, built from the listing's `app_surface`: the SKILL.md
   * packs bound to the app, the crew-defs it ships, its declared scopes and its live EXCHANGE
   * listings. An app that sells nothing still exposes that one, so an agent that lands on any
   * app page can ask what it is looking at instead of reading 200 kB of minified source.
   */
  async exposeAppTools(ref) {
    const listing = await fetchListing(ref.owner, ref.appId);
    const surface = listing.app_surface || null;
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
    tools.unshift(aboutTool(ref, surface, tools.length));
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

/**
 * Which app this page IS, for `?expose=app`. The serving route stamps data-owner/data-app on the
 * script tag; the `#aimeat-app-ref` JSON block (injected into every app served on an app origin) is
 * the fallback. Both state the app id WITH its extension — the subdomain label drops it, and a
 * lookup made from the label alone misses every time.
 */
function appRefFromPage(el) {
  const ds = (el && el.dataset) || {};
  if (ds.owner && ds.app) return { owner: ds.owner, appId: ds.app };
  try {
    const node = document.getElementById('aimeat-app-ref');
    if (!node) return null;
    const ref = JSON.parse(node.textContent || '{}');
    if (ref.owner && ref.app_id) return { owner: ref.owner, appId: ref.app_id };
  } catch { /* no usable ref block */ }
  return null;
}

try {
  const el = /** @type {any} */ (typeof document !== 'undefined' && document.currentScript);
  const src = el && el.src ? new URL(el.src, location.href) : null;
  const expose = (src && src.searchParams.get('expose')) || (el && el.dataset && el.dataset.expose);
  if (expose === 'node') {
    // Defer past parse so a scanner's early modelContext shim is in place.
    setTimeout(function () { webmcp.exposeNodeTools().catch(function () {}); }, 0);
  } else if (expose === 'app') {
    const ref = appRefFromPage(el);
    // Same deferral as above, and the same silence on failure: an app whose tools cannot be listed
    // must still render. The page keeps working with no tools registered.
    if (ref) setTimeout(function () { webmcp.exposeAppTools(ref).catch(function () {}); }, 0);
  }
} catch { /* auto-activation is best-effort; explicit calls always work */ }
