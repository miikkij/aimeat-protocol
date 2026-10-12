/**
 * @file public/js/services/ai-connection.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's AI connection (OpenRouter, LM Studio or a custom OpenAI-compatible
 *   address, with its key), and the one switch between the two ways a screen reaches it.
 *
 *   THE SWITCH. Node 4.0.0 removes GET/PUT/DELETE /v1/openrouter/settings, GET /v1/openrouter/models
 *   and POST /v1/openrouter/test (they answer 410 GONE), and an operator can switch them off before
 *   that (AIMEAT_AI_LEGACY_SETTINGS_ROUTES=false). legacyOr(legacyCall, providerCall) runs the legacy
 *   call; on a 410 it remembers, for this page load, that the node has no legacy routes, and runs the
 *   provider call, and every later legacyOr goes straight to the provider call. On a node where the
 *   legacy routes answer (3.x), every screen calls them exactly as it did before 2026-10-12, so the
 *   screens look and behave as they did. Every screen that calls a legacy route does it through this
 *   switch (test/unit/no-legacy-ai-settings-callers.test.ts checks that it does).
 *
 *   THE CONNECTION IS A PROVIDER. On the provider path the connection is one of the owner's providers,
 *   with the id `openrouter`, `lmstudio` or `custom` (services/ai/provider-store.ts migrates the old
 *   setting into one, with `migrated_from` in the view). connectionOf() picks it: the migrated one
 *   first, then one in use, then any. settingsOf() reads it back in the field names the old route
 *   answered (provider, baseUrl, hasApiKey, model, visionModel, sttModel, sttLanguage, temperature,
 *   top_p, max_tokens), so a screen changes its calls and nothing else.
 *
 *   IN USE AS THE OLD SETTING WAS. The node routes a call to an owner's provider only for a capability
 *   in the owner's pool with a model, and, under the rule "only tested providers", only once that
 *   capability was tested (services/ai/route-plan.ts inPool, modelOf and 'untested'). The migration
 *   gives a migrated provider all three. A provider written here gets them the same way: each
 *   capability with a model joins the pool, as the AI page's providers section does; an OpenRouter
 *   connection the person gave no model takes the model the node uses for them now (GET
 *   /v1/ai/capabilities), as the old setting did; and every capability left untested is tested once
 *   (POST /v1/ai/providers/:id/test), so the person's own key pays at once, as it did after a save on
 *   the old route. A test is a real call and is recorded like one.
 *
 *   WRITES. saveConnection() puts the provider (PUT /v1/ai/providers/:id) when its type or address
 *   changes, or when it is not in use, then its key (PUT /v1/ai/providers/:id/key). A change of
 *   provider retires the previous one, because the old setting held one connection at a time. A key
 *   is never carried over to a new provider: the node never returns a key. Writing takes the provider
 *   over from the migration (provider-store.ts putOwnerAiProvider), which is what the successor routes
 *   mean. removeConnection() retires the connection: it is deleted, as the old removal left no
 *   connection, unless one of the owner's agents keeps its own key for it; then the owner's key goes
 *   and every capability leaves the pool, so the node's own provider answers and the agents' keys stay
 *   (DELETE /v1/ai/providers/:id would delete them).
 *
 *   MODELS. listModels() reads the node's model catalogue (GET /v1/ai/models) for an OpenRouter
 *   connection and answers it in the shape of OpenRouter's own listing (id, name, pricing per token,
 *   context_length, input and output modalities), which components/ModelPicker.js and
 *   views/profile/openrouter/pricing.js read. A local or custom server's models are not in the
 *   catalogue, so for those it answers an empty list and the pickers take a typed model id.
 * @structure legacyOr · legacyGone · isGone · CONNECTION_IDS · connectionOf · settingsOf ·
 *   readConnection · saveConnection · testConnection · removeConnection · saveConnectionCapabilities ·
 *   listModels · listingOf
 * @usage
 *   import { legacyOr, readConnection } from '/js/services/ai-connection.js';
 *   const settings = await legacyOr(
 *     async () => (await apiGet('/v1/openrouter/settings')).data,
 *     async () => (await readConnection()).settings);
 * @version-history
 *   v1.1.0 — 2026-10-13 — legacyOr(): the screens call the legacy routes first and take the provider
 *     path only on a 410, so a 3.x node behaves exactly as before. On the provider path a connection is
 *     in use as the old setting was: its capabilities with a model join the pool, an OpenRouter one
 *     without a model takes the node's model for the owner, and what is left untested is tested once.
 *     Removing a connection deletes it unless an agent keeps a key for it, and a switch of provider
 *     retires the old one the same way. A switch no longer copies the old provider's models.
 *   v1.0.1 — 2026-10-13 — Removing an OpenRouter connection's key deletes the key only, not the
 *     provider, so the agents' own keys stored for it stay, as they did with the old route.
 *   v1.0.0 — 2026-10-12 — Initial: the AI page, the older AI panel and the calibrator move off the
 *     settings routes node 4.0.0 removes.
 */
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/* ── The switch ─────────────────────────────────────────────────────────────────────────────── */

/** True once a legacy route answered 410 GONE in this page load: the node has none of them. */
let legacyRoutesGone = false;

/** Whether a failed request (js/api.js puts the status on the error) was a 410 GONE. */
export const isGone = (err) => !!err && err.status === 410;

/** Whether this page load found the legacy AI settings routes gone. */
export const legacyGone = () => legacyRoutesGone;

/**
 * Run `legacyCall`; when it fails with 410 GONE, remember that the node has no legacy routes and run
 * `providerCall` instead. Once remembered, `providerCall` runs straight away. Any other failure of
 * `legacyCall` is thrown as it was, so a screen's own error handling stays as it was.
 * @template T
 * @param {() => Promise<T>} legacyCall @param {() => Promise<T>} providerCall
 * @returns {Promise<T>}
 */
export async function legacyOr(legacyCall, providerCall) {
  if (!legacyRoutesGone) {
    try {
      return await legacyCall();
    } catch (err) {
      if (!isGone(err)) throw err;
      legacyRoutesGone = true;
    }
  }
  return providerCall();
}

/* ── The connection as a provider ───────────────────────────────────────────────────────────── */

/** The ids the old setting's three choices become (services/ai/provider-store.ts legacyRecord). */
export const CONNECTION_IDS = ['openrouter', 'lmstudio', 'custom'];

const TITLES = { openrouter: 'OpenRouter', lmstudio: 'LM Studio', custom: 'Custom provider' };
const LMSTUDIO_URL = 'http://localhost:1234/v1';

/** The capabilities the migration turns on for each type it writes (TYPE_CAPABILITIES without files and embed). */
const TYPE_CAPS = {
  openrouter: ['text', 'vision', 'image', 'speech', 'transcription'],
  local: ['text', 'vision', 'image', 'speech', 'transcription'],
  'openai-compatible': ['text', 'vision', 'image', 'speech', 'transcription'],
};

/** The capabilities whose test costs no more than one short call (an image test makes a picture). */
const SELF_TESTED = ['text', 'vision', 'transcription', 'speech', 'embed'];

/** The capabilities whose model the migration takes from the node when the setting names none. */
const NODE_MODEL_CAPS = ['text', 'vision'];

const isLoopbackHost = (host) => host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);

/** The provider type an address gets, as the migration decides it (provider-store.ts legacyRecord). */
function typeFor(id, url) {
  if (id === 'openrouter') return 'openrouter';
  // An address that does not parse has no host; the node refuses it on the PUT and says why.
  const host = URL.canParse(url) ? new URL(url).hostname.toLowerCase() : '';
  return id === 'lmstudio' && isLoopbackHost(host) ? 'local' : 'openai-compatible';
}

/** A capability as the PUT body takes it back: without the view's own additions. */
function capConfigOf(v) {
  const cfg = { ...v };
  delete cfg.model_status;
  delete cfg.model_retires_at;
  return cfg;
}

/** A capability with a model joins the owner's pool, as the AI page's providers section does; the node refuses a pool entry with no model. */
function pooled(cfg) {
  return { ...cfg, pool: !!cfg.model && cfg.enabled !== false };
}

/**
 * The capabilities a provider of `type` is written with: what `from` (the same provider before) had
 * for each one the type serves, else on; a missing model from `models`; each with a model in the pool.
 * @param {string} type @param {any|null} from @param {Record<string, string>} [models]
 */
function capabilitiesFor(type, from, models = {}) {
  const out = {};
  for (const c of TYPE_CAPS[type]) {
    const had = from?.capabilities?.[c];
    const cfg = had ? capConfigOf(had) : { enabled: true, pool: false };
    if (!cfg.model && models[c]) cfg.model = models[c];
    out[c] = pooled(cfg);
  }
  return out;
}

/** The PUT body of provider `p` with `capabilities`. */
function bodyOf(p, capabilities) {
  return {
    title: p.title, type: p.type,
    ...(p.type === 'openrouter' ? {} : { baseUrl: p.base_url }),
    auth: { type: p.auth?.type === 'none' ? 'none' : 'key' },
    capabilities,
  };
}

/**
 * The OpenRouter models the node uses for this owner now, for text and vision, as GET
 * /v1/ai/capabilities resolves them: the node's defaults when the owner has no provider in use. A
 * capability answered by another type gives nothing. Empty when the read fails.
 * @returns {Promise<Record<string, string>>}
 */
async function nodeModels() {
  try {
    const caps = (await apiGet('/v1/ai/capabilities'))?.data?.capabilities || {};
    /** @type {Record<string, string>} */
    const out = {};
    for (const c of NODE_MODEL_CAPS) {
      const e = caps[c];
      if (e?.on && e.providerType === 'openrouter' && typeof e.model === 'string' && e.model) out[c] = e.model.replace(/^openrouter:/, '');
    }
    return out;
  } catch (err) { swallowed('ai-connection: node models', err); return {}; }
}

/** Whether a provider is in use: migrated (the node pools it), or with a capability in the pool. */
const inUse = (p) => !!p && (!!p.migrated_from || Object.values(p.capabilities || {}).some((c) => c && c.pool));

/**
 * The owner's connection among the providers of GET /v1/ai/providers, or null: the migrated one, then
 * one in use or with a key, then a local or custom one that needs no key, then any. A connection
 * retired for an agent's key (no key, out of the pool) comes last.
 * @param {{ providers?: any[] }|null} view
 */
export function connectionOf(view) {
  const own = (view?.providers || []).filter((p) => p.source === 'owner' && CONNECTION_IDS.includes(p.id));
  return own.find((p) => p.migrated_from) || own.find((p) => inUse(p) || p.auth?.has_key)
    || own.find((p) => p.auth?.type === 'none') || own[0] || null;
}

/**
 * The connection in the field names GET /v1/openrouter/settings answered. No connection reads as
 * OpenRouter with no key, as the old route answered an owner who had saved nothing.
 * @param {any|null} p a provider from GET /v1/ai/providers
 */
export function settingsOf(p) {
  const cap = (c) => (p && p.capabilities && p.capabilities[c]) || {};
  const params = cap('text').params || {};
  return {
    provider: p ? p.id : 'openrouter',
    baseUrl: p && p.type !== 'openrouter' ? (p.base_url || '') : '',
    hasApiKey: !!(p && p.auth && p.auth.has_key),
    model: cap('text').model || null,
    visionModel: cap('vision').model || null,
    sttModel: cap('transcription').model || null,
    sttLanguage: cap('transcription').language || null,
    imageModel: cap('image').model || null,
    temperature: params.temperature ?? null,
    top_p: params.top_p ?? null,
    max_tokens: params.max_tokens ?? null,
  };
}

/** The providers view, the connection in it, and the connection as settings. Throws as apiGet does. */
export async function readConnection() {
  const r = await apiGet('/v1/ai/providers');
  const view = r?.data || null;
  const current = connectionOf(view);
  return { view, current, settings: settingsOf(current) };
}

/**
 * Test once each capability of provider `id` that is in the pool and untested, so the node routes to
 * it (route-plan.ts rejects an untested one). Only capabilities whose test is one short call; a
 * provider that needs a key and has none is not tested. A failed test is not thrown: the providers
 * table shows it.
 * @returns {Promise<Array<{ capability: string, ok: boolean, error?: any }>>}
 */
async function testUntested(id) {
  const { view } = await readConnection();
  const p = (view?.providers || []).find((x) => x.source === 'owner' && x.id === id);
  if (!p || (p.auth?.type === 'key' && !p.auth?.has_key)) return [];
  const out = [];
  for (const [c, cfg] of Object.entries(p.capabilities || {})) {
    if (!cfg?.enabled || !cfg.pool || !SELF_TESTED.includes(c)) continue;
    if ((p.health?.[c]?.status || 'untested') !== 'untested') continue;
    try {
      await apiPost(`/v1/ai/providers/${id}/test`, { capability: c, accept_cost: false });
      out.push({ capability: c, ok: true });
    } catch (error) {
      swallowed('ai-connection: test after save', error);
      out.push({ capability: c, ok: false, error });
    }
  }
  return out;
}

/** Whether one of the owner's agents keeps its own key for provider `id` (GET /v1/agents/:name/ai-keys). */
async function agentsKeepKeyFor(id) {
  const agents = (await apiGet('/v1/agents'))?.data?.agents || [];
  for (const a of agents) {
    if (!a?.name) continue;
    const keys = (await apiGet(`/v1/agents/${encodeURIComponent(a.name)}/ai-keys`))?.data?.providers || {};
    if (Object.prototype.hasOwnProperty.call(keys, id)) return true;
  }
  return false;
}

/**
 * Retire a connection, as the old removal and the old switch of provider left none: delete it,
 * unless an agent keeps its own key for it (or that cannot be read); then remove the owner's key and
 * take every capability out of the pool, so the node's own provider answers and the agents' keys stay.
 */
async function retire(p) {
  let keep;
  try { keep = await agentsKeepKeyFor(p.id); } catch (err) { swallowed('ai-connection: agents\' keys', err); keep = true; }
  if (!keep) { await apiDelete(`/v1/ai/providers/${p.id}`); return; }
  if (p.auth?.has_key) await apiDelete(`/v1/ai/providers/${p.id}/key`);
  const capabilities = {};
  for (const [c, v] of Object.entries(p.capabilities || {})) if (v) capabilities[c] = { ...capConfigOf(v), pool: false };
  await apiPut(`/v1/ai/providers/${p.id}`, bodyOf(p, capabilities));
}

/**
 * Save the connection: the provider choice, its address and, when typed, its key. Throws the node's
 * refusal as apiPut does (err.code, err.message).
 * @param {any|null} current the connection as readConnection() found it
 * @param {{ provider: string, baseUrl?: string, apiKey?: string }} next
 * @returns {Promise<string>} the id of the connection now
 */
export async function saveConnection(current, { provider, baseUrl, apiKey }) {
  const id = CONNECTION_IDS.includes(provider) ? provider : 'openrouter';
  const url = id === 'openrouter' ? '' : String(baseUrl || (id === 'lmstudio' ? LMSTUDIO_URL : '')).trim().replace(/\/+$/, '');
  const type = typeFor(id, url);
  const same = !!current && current.id === id;
  const sameAddress = same && current.type === type
    && (type === 'openrouter' || String(current.base_url || '').replace(/\/+$/, '') === url);
  // OpenRouter always takes a key; the other two take one when the person gives one or had one.
  const keyed = !!apiKey || id === 'openrouter' || (same && current.auth?.type === 'key');
  // The old setting held one connection: the previous one goes first, so the node's models below are
  // the node's own and not the previous provider's.
  if (current && !same) await retire(current);
  if (!sameAddress || (keyed && current.auth?.type !== 'key') || !inUse(current)) {
    const models = type === 'openrouter' ? await nodeModels() : {};
    await apiPut(`/v1/ai/providers/${id}`, {
      title: same ? current.title : TITLES[id], type,
      ...(type === 'openrouter' ? {} : { baseUrl: url }),
      auth: { type: keyed ? 'key' : 'none' },
      capabilities: capabilitiesFor(type, same ? current : null, models),
    });
  }
  if (apiKey) await apiPut(`/v1/ai/providers/${id}/key`, { api_key: apiKey });
  await testUntested(id);
  return id;
}

/**
 * Change capabilities of the connection: each entry of `patch` is merged into that capability's
 * config (model, language, params). A capability the type does not serve is left out. A changed
 * capability with a model is in the pool; writing a migrated connection takes it over from the
 * migration, so each of its capabilities with a model stays in the pool. What the change leaves
 * untested is tested once.
 * @param {any} current @param {Record<string, Record<string, unknown>>} patch
 */
export async function saveConnectionCapabilities(current, patch) {
  const capabilities = {};
  for (const [c, v] of Object.entries(current.capabilities || {})) if (v) capabilities[c] = capConfigOf(v);
  for (const [c, changes] of Object.entries(patch)) {
    if (!(c in capabilities) && !(TYPE_CAPS[current.type] || []).includes(c)) continue;
    const next = { ...(capabilities[c] || { enabled: true, pool: false }), ...changes };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null || next[k] === '') delete next[k];
    capabilities[c] = pooled(next);
  }
  if (current.migrated_from) for (const c of Object.keys(capabilities)) capabilities[c] = pooled(capabilities[c]);
  await apiPut(`/v1/ai/providers/${current.id}`, bodyOf(current, capabilities));
  await testUntested(current.id);
}

/**
 * One real text call on the connection, as the old test was. It may cost money, as the old test
 * did, so the cost is accepted. Throws the refusal (err.code QUOTA_EXHAUSTED when the budget is spent).
 * @returns {Promise<{ model: string }>}
 */
export async function testConnection(current) {
  const r = await apiPost(`/v1/ai/providers/${current.id}/test`, { capability: 'text', accept_cost: true });
  return { model: r?.data?.model || '' };
}

/** Remove the connection, as the old "remove key" did: retire() says how. */
export async function removeConnection(current) {
  if (current) await retire(current);
}

/* ── Models ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * A catalogue model in the shape of OpenRouter's own listing. Token prices go back to USD per token;
 * an audio model keeps the source's own number, whose unit no source states (pricing.js).
 * @param {any} m a model from GET /v1/ai/models
 */
export function listingOf(m) {
  const c = m.caps || {};
  const p = m.price || {};
  const raw = p.raw || {};
  const perToken = (v) => (typeof v === 'number' ? v / 1e6 : undefined);
  const pricing = {};
  const prompt = perToken(p.inPerMtok) ?? raw.prompt;
  const completion = perToken(p.outPerMtok) ?? raw.completion;
  if (prompt !== undefined) pricing.prompt = prompt;
  if (completion !== undefined) pricing.completion = completion;
  if (raw.image !== undefined) pricing.image = raw.image;
  const input = [c.textIn && 'text', c.imageIn && 'image', c.fileIn && 'file', c.audioIn && 'audio', c.videoIn && 'video'].filter(Boolean);
  const output = [c.textOut && 'text', c.imageOut && 'image', c.audioOut && 'audio'].filter(Boolean);
  return {
    id: m.id, name: m.name || m.id, context_length: m.limits?.context ?? null, pricing,
    input_modalities: input, output_modalities: output,
  };
}

/**
 * The models a picker offers for the connection: the catalogue's OpenRouter models that serve the
 * capability. Empty for a local or custom server, whose models the catalogue does not hold.
 * @param {{ provider?: string }} settings @param {'text'|'transcription'|'vision'|'image'} [capability]
 */
export async function listModels(settings, capability = 'text') {
  if ((settings?.provider || 'openrouter') !== 'openrouter') return [];
  const r = await apiGet(`/v1/ai/models?type=openrouter&capability=${encodeURIComponent(capability)}`);
  return Array.isArray(r?.data?.models) ? r.data.models.map(listingOf) : [];
}
