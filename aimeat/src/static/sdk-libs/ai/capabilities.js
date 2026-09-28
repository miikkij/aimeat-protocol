/**
 * @file ai/capabilities.js
 * @description AIMEAT.ai.capabilities() and AIMEAT.ai.models(): what the signed-in person's AI can do
 *   for this app, and which models a capability can use.
 *
 *   capabilities() reads GET /v1/ai/capabilities. The node plans each capability with the same gate a
 *   real call runs (the owner's providers, keys, model policy, app allowlist and budget) and spends
 *   nothing, so `on` is what a call would find now. A capability that is off carries `reason` and
 *   `fix`: the sentence an app shows the person.
 *
 *   models() reads GET /v1/ai/models, the node's model catalogue, which an app grant with ai:use can
 *   call. Until V5 it read the owner-only /v1/openrouter/models, which answered 403 to every app.
 *   Each row keeps the catalogue's own fields and adds `context_length` and `pricing` in the form the
 *   old OpenRouter listing had, so a picker written against that listing still reads it.
 * @structure capabilities(opts) · models(opts) · roles() · priceEstimate(state, units) · clearCaches()
 * @usage const caps = await AIMEAT.ai.capabilities({ app_id: 'my-app' });
 *   if (!caps.capabilities.image.on) showNotice(caps.capabilities.image.fix);
 * @version-history
 *   v1.1.0 - 2026-09-28 - roles(): GET /v1/ai/roles, the owner's AI roles and the apps' role bindings.
 *   v1.0.0 - 2026-09-28 - System 2 plan, V5. Initial: capabilities(), and models() moved from
 *     /v1/openrouter/models to /v1/ai/models.
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-ai.js');
import { aiError } from './call.js';

/** Capabilities answers, per app_id, for 60 seconds: an app may ask on every render. */
/** @type {Map<string, { v: any, t: number }>} */
const _capsCache = new Map();

/** Model lists, per query, for one hour: the catalogue is refreshed daily at most. */
/** @type {Map<string, { v: any[], t: number }>} */
const _modelsCache = new Map();

/**
 * What the person's AI can do for this app, per capability.
 *
 * Returns the node's answer as it is: { capabilities: { text, vision, files, image, speech,
 * transcription, embed }, policy, budget, catalog, guide }. Each capability is
 * { on, model?, provider?, providerType?, leaves?, keySource?, fallbacks?, price?, reason?, fix?,
 * message?, howTo }. `model` is a "type:id" reference; `leaves` says whether the data leaves the
 * person's machine; `price` is the catalogue's price for that model (per million tokens, per picture,
 * per character or per second).
 *
 * Cached 60 seconds per app_id; `fresh: true` reads again. Accepts the app id as a string too.
 * @param {{ app_id?: string, fresh?: boolean } | string} [opts]
 * @returns {Promise<any>}
 */
export async function capabilities(opts) {
  const o = typeof opts === 'string' ? { app_id: opts } : (opts || {});
  const appId = o.app_id || '';
  const now = Date.now();
  const hit = _capsCache.get(appId);
  if (!o.fresh && hit && (now - hit.t) < 60_000) return hit.v;
  const r = await authFetch('/v1/ai/capabilities' + (appId ? '?app_id=' + encodeURIComponent(appId) : ''));
  if (!r || !r.ok) throw aiError(r, 'Could not read what the AI can do');
  _capsCache.set(appId, { v: r.data, t: now });
  return r.data;
}

/**
 * A price line for the confirm dialog, from one capability's catalogue price: per picture for image,
 * per character for speech (units = characters), per second for transcription (units = seconds).
 * Undefined when the catalogue has no price the call can be counted in.
 * @param {any} state  one entry of capabilities().capabilities
 * @param {number} [units]
 * @returns {string|undefined}
 */
export function priceEstimate(state, units) {
  const p = state && state.price;
  if (!p) return undefined;
  const n = typeof p.perImage === 'number' ? p.perImage * (units || 1)
    : typeof p.speechPerChar === 'number' && units ? p.speechPerChar * units
      : typeof p.transcriptionPerSecond === 'number' && units ? p.transcriptionPerSecond * units
        : undefined;
  if (typeof n !== 'number' || !isFinite(n)) return undefined;
  return '~$' + (n < 0.01 ? n.toFixed(4) : n.toFixed(2));
}

/**
 * One catalogue row with the two fields the old OpenRouter listing had: `context_length` and
 * `pricing` ({ prompt, completion } as US dollars per token, in strings, as OpenRouter gives them).
 * @param {any} m
 * @returns {any}
 */
function compatRow(m) {
  const price = m.price || {};
  const perToken = (v) => (typeof v === 'number' ? String(v / 1e6) : undefined);
  const pricing = typeof price.inPerMtok === 'number' || typeof price.outPerMtok === 'number'
    ? { prompt: perToken(price.inPerMtok), completion: perToken(price.outPerMtok) }
    : undefined;
  return { ...m, context_length: m.limits ? m.limits.context : undefined, ...(pricing ? { pricing } : {}) };
}

/**
 * The models a capability can use. Cached one hour per query.
 *
 * Default: the text models this caller can use now (the owner's providers and model policy decide;
 * `allowed: false` lists the whole catalogue). Each row: { ref, type, id, name, caps, limits, price,
 * status, context_length, pricing }. Pass `ref` ("type:id") as `model` in a call: it names the
 * provider type as well as the model. `id` alone still works for an OpenRouter row.
 * @param {{ capability?: string, type?: string, status?: string, allowed?: boolean }} [opts]
 * @returns {Promise<any[]>}
 */
export async function models(opts) {
  const o = opts || {};
  const q = new URLSearchParams();
  q.set('capability', o.capability || 'text');
  if (o.type) q.set('type', o.type);
  if (o.status) q.set('status', o.status);
  if (o.allowed !== false) q.set('allowed', 'true');
  const qs = q.toString();
  const now = Date.now();
  const hit = _modelsCache.get(qs);
  if (hit && (now - hit.t) < 3600_000) return hit.v;
  const r = await authFetch('/v1/ai/models?' + qs);
  if (!r || !r.ok) throw aiError(r, 'Failed to list models');
  const v = (r.data && Array.isArray(r.data.models) ? r.data.models : []).map(compatRow);
  _modelsCache.set(qs, { v, t: now });
  return v;
}

/**
 * The signed-in person's AI roles and the AI roles apps declare: the data of GET /v1/ai/roles,
 * { roles: [...], apps: [{ app, roles: [{ name, capabilities, binding, boundTo, requestedAt? }] }] }.
 *
 * A capability says what a model does; a role says what it is used for. An app declares its roles in
 * its aimeat-ai meta (role.<name>=text+image) and names one as `role` in a call; the call runs only
 * once the owner bound that role to one of theirs (boundTo). Until then it is refused with
 * AI_ROLE_NOT_BOUND, and the owner sees the request on the AI page. Not cached: a binding the owner
 * just made should show at once.
 * @returns {Promise<any>}
 */
export async function roles() {
  const r = await authFetch('/v1/ai/roles');
  if (!r || !r.ok) throw aiError(r, 'Could not read the AI roles');
  return r.data;
}

/** Drop the capabilities and model caches (invalidateCache() calls this). */
export function clearCaches() {
  _capsCache.clear();
  _modelsCache.clear();
}
