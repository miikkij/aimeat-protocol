/**
 * @file public/js/services/ai-connection.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's AI connection (OpenRouter, LM Studio or a custom OpenAI-compatible
 *   address, with its key) read and written through the provider routes. Node 4.0.0 removes
 *   GET/PUT/DELETE /v1/openrouter/settings, /v1/openrouter/models and /v1/openrouter/test; the screens
 *   that edited the connection through them (the AI page, the older AI panel, the calibrator) call
 *   this module instead, and keep their own look and words.
 *
 *   THE CONNECTION IS A PROVIDER. services/ai/provider-store.ts migrates the old setting into one of
 *   the owner's providers, with the id `openrouter`, `lmstudio` or `custom` and `migrated_from` in the
 *   view. connectionOf() picks it: the migrated one first, then any provider of the owner's own with
 *   one of those three ids. settingsOf() reads it back in the field names the old route answered
 *   (provider, baseUrl, hasApiKey, model, visionModel, sttModel, sttLanguage, temperature, top_p,
 *   max_tokens), so a screen changes its calls and nothing else.
 *
 *   WRITES. saveConnection() puts the provider (PUT /v1/ai/providers/:id) only when its type or
 *   address changes, then its key (PUT /v1/ai/providers/:id/key); a change of provider removes the
 *   previous one (DELETE /v1/ai/providers/:id), because the old setting held one connection at a
 *   time. A key is never carried over to a new provider: the node never returns a key. Writing takes
 *   the provider over from the migration (provider-store.ts putOwnerAiProvider), which is what the
 *   successor routes mean. removeConnection() removes the owner's key of an OpenRouter connection and
 *   leaves the provider and its agents' keys; a local or custom connection is deleted (for a migrated
 *   one the node also deletes the old key record and sets the old setting back to OpenRouter).
 *
 *   MODELS. listModels() reads the node's model catalogue (GET /v1/ai/models) for an OpenRouter
 *   connection and answers it in the shape of OpenRouter's own listing (id, name, pricing per token,
 *   context_length, input and output modalities), which components/ModelPicker.js and
 *   views/profile/openrouter/pricing.js read. A local or custom server's models are not in the
 *   catalogue, so for those it answers an empty list and the pickers take a typed model id.
 * @structure CONNECTION_IDS · connectionOf · settingsOf · readConnection · saveConnection ·
 *   testConnection · removeConnection · saveConnectionCapabilities · listModels · listingOf
 * @usage
 *   import { readConnection, saveConnection } from '/js/services/ai-connection.js';
 *   const { current, settings } = await readConnection();
 *   await saveConnection(current, { provider: 'openrouter', baseUrl: '', apiKey });
 * @version-history
 *   v1.0.1 — 2026-10-13 — Removing an OpenRouter connection's key deletes the key only, not the
 *     provider, so the agents' own keys stored for it stay, as they did with the old route.
 *   v1.0.0 — 2026-10-12 — Initial: the AI page, the older AI panel and the calibrator move off the
 *     settings routes node 4.0.0 removes.
 */
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';

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

/** The capabilities a provider of `type` is written with: what `from` had for each one the type serves, else on. */
function capabilitiesFor(type, from) {
  const out = {};
  for (const c of TYPE_CAPS[type]) {
    const had = from?.capabilities?.[c];
    out[c] = had ? capConfigOf(had) : { enabled: true, pool: false };
  }
  return out;
}

/**
 * The owner's connection among the providers of GET /v1/ai/providers, or null.
 * @param {{ providers?: any[] }|null} view
 */
export function connectionOf(view) {
  const own = (view?.providers || []).filter((p) => p.source === 'owner' && CONNECTION_IDS.includes(p.id));
  return own.find((p) => p.migrated_from) || own[0] || null;
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
  if (!sameAddress || (keyed && current.auth?.type !== 'key')) {
    await apiPut(`/v1/ai/providers/${id}`, {
      title: same ? current.title : TITLES[id], type,
      ...(type === 'openrouter' ? {} : { baseUrl: url }),
      auth: { type: keyed ? 'key' : 'none' },
      capabilities: capabilitiesFor(type, current),
    });
  }
  if (apiKey) await apiPut(`/v1/ai/providers/${id}/key`, { api_key: apiKey });
  if (current && current.id !== id) await apiDelete(`/v1/ai/providers/${current.id}`);
  return id;
}

/**
 * Change capabilities of the connection: each entry of `patch` is merged into that capability's
 * config (model, language, params). A capability the type does not serve is left out.
 * @param {any} current @param {Record<string, Record<string, unknown>>} patch
 */
export async function saveConnectionCapabilities(current, patch) {
  const capabilities = {};
  for (const [c, v] of Object.entries(current.capabilities || {})) if (v) capabilities[c] = capConfigOf(v);
  for (const [c, changes] of Object.entries(patch)) {
    if (!(c in capabilities) && !(TYPE_CAPS[current.type] || []).includes(c)) continue;
    const next = { ...(capabilities[c] || { enabled: true, pool: false }), ...changes };
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === null || next[k] === '') delete next[k];
    if (!next.model) next.pool = false;
    capabilities[c] = next;
  }
  await apiPut(`/v1/ai/providers/${current.id}`, {
    title: current.title, type: current.type,
    ...(current.type === 'openrouter' ? {} : { baseUrl: current.base_url }),
    auth: { type: current.auth?.type === 'none' ? 'none' : 'key' },
    capabilities,
  });
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

/**
 * Remove the connection's key, as the old "remove key" did. An OpenRouter connection loses the
 * owner's key only (DELETE /v1/ai/providers/:id/key): deleting the provider would also delete every
 * agent's own key stored for it, which the old route never touched. A local or custom connection is
 * deleted, because the old route set the connection back to OpenRouter.
 */
export async function removeConnection(current) {
  if (!current) return;
  if (current.type === 'openrouter') {
    if (current.auth?.has_key) await apiDelete(`/v1/ai/providers/${current.id}/key`);
    return;
  }
  await apiDelete(`/v1/ai/providers/${current.id}`);
}

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
