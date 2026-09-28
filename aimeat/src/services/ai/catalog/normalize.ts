/**
 * @file normalize.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The model catalogue's pure half (System 2 plan, V4; docs/internal/
 *   llmproviderintegrations/06, sections 1, 2 and 6): three source parsers that turn models.dev,
 *   OpenRouter and LiteLLM into CatalogModel rows in one set of units, the merge that ranks them,
 *   and the retirement state machine. No I/O: the caller fetches and stores.
 *
 *   Rules chosen from the data (snapshots of 2026-09-28):
 *   - models.dev lists an embedding model with output ['text'], so `embeddings` is read from the id or
 *     family containing "embed", and such a model has textOut false. `attachment` is not read: the
 *     input modalities already name pdf and image. An embedding model gets no output limit: models.dev
 *     writes its vector dimension there. A model whose only output is image has its output
 *     price as imageOutPerMtok (image tokens), not outPerMtok. status 'deprecated' is 'retiring'; any
 *     other value ('beta', none) is 'active'.
 *   - OpenRouter models whose outputs are only video, rerank or decisions are skipped: the node has
 *     no operation for them. A "-1" price is unknown and left unset; "0" is free and kept.
 *     `image` is a per-image input price and goes into `raw`. `created` becomes `released`, but in
 *     the merge a models.dev release date and family are kept, because `created` is OpenRouter's
 *     listing date.
 *   - LiteLLM modes kept: chat, responses, embedding, image_generation, audio_speech,
 *     audio_transcription. Skipped: completion, realtime, moderation, ocr, rerank, video_generation
 *     and anything else. An image_generation entry states its per-picture price as
 *     `input_cost_per_image` (no mapped entry has `output_cost_per_image`), so that is perImage for
 *     that mode. Keys with a quality or size path ('low/1024-x-1024/gpt-image-1.5') are variants of
 *     one model and are skipped, because folding them would pick one size's price at random.
 * @structure
 *   - LITELLM_PROVIDERS — LiteLLM provider name → CatalogType
 *   - liteLlmRef() — a LiteLLM key and provider → { type, id } or null
 *   - fromModelsDev(), fromOpenRouter(), fromLiteLLM() — the source parsers
 *   - mergeSources() — models.dev, then OpenRouter wins for openrouter, LiteLLM fills, operator wins
 *   - applyLifecycle() — active / retiring / retired / dropped (section 6)
 *   - recordSize(), groupByType() — for storage, one record per type
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */

import {
  CATALOG_TYPES, type CatalogModel, type CatalogSource, type CatalogStatus, type CatalogType, type ModelCaps,
  type ModelPrice,
} from './types.js';

type Json = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A model missing this long from every source is retired (plan 06, section 6). */
export const RETIRE_AFTER_MS = 28 * DAY_MS;
/** A retired model is dropped from the catalogue after this long. */
export const DROP_AFTER_MS = 180 * DAY_MS;

const SOURCE_ORDER: CatalogSource[] = ['models.dev', 'openrouter', 'litellm', 'operator'];

// ---------------------------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------------------------

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** A non-negative finite number from a number or a decimal string; anything else is undefined. */
function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** A positive integer limit; 0 and missing are unset. */
function limit(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
}

/** $ per token → $ per million tokens, rounded to 12 significant digits to drop float noise. */
function perM(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Number((n * 1e6).toPrecision(12));
}

function noCaps(): ModelCaps {
  return {
    textIn: false, imageIn: false, fileIn: false, audioIn: false, videoIn: false,
    textOut: false, imageOut: false, audioOut: false,
    tools: false, reasoning: false, structuredOutput: false,
    embeddings: false, speech: false, transcription: false,
  };
}

/** Removes undefined fields so a record carries only what a source said. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function isoDay(v: unknown): string | undefined {
  const s = str(v);
  if (!s || Number.isNaN(Date.parse(s))) return undefined;
  return s;
}

// ---------------------------------------------------------------------------------------------
// models.dev
// ---------------------------------------------------------------------------------------------

/**
 * models.dev api.json → catalogue rows for the provider keys in CATALOG_TYPES. Prices are already
 * $ per million tokens.
 */
export function fromModelsDev(json: unknown, seenAt: string): CatalogModel[] {
  if (!isObj(json)) return [];
  const out: CatalogModel[] = [];
  for (const type of CATALOG_TYPES) {
    const provider = json[type];
    if (!isObj(provider) || !isObj(provider.models)) continue;
    for (const raw of Object.values(provider.models)) {
      if (!isObj(raw)) continue;
      const id = str(raw.id);
      if (!id) continue;
      const mods = isObj(raw.modalities) ? raw.modalities : {};
      const input = strList(mods.input);
      const output = strList(mods.output);
      const family = str(raw.family);
      const embeddings = /embed/i.test(id) || /embed/i.test(family ?? '');
      const caps = noCaps();
      caps.textIn = input.includes('text');
      caps.imageIn = input.includes('image');
      caps.fileIn = input.includes('pdf');
      caps.audioIn = input.includes('audio');
      caps.videoIn = input.includes('video');
      caps.textOut = output.includes('text') && !embeddings;
      caps.imageOut = output.includes('image');
      caps.audioOut = output.includes('audio');
      caps.tools = raw.tool_call === true;
      caps.reasoning = raw.reasoning === true;
      caps.structuredOutput = raw.structured_output === true;
      caps.embeddings = embeddings;
      caps.speech = output.includes('audio') && !output.includes('text') && input.length > 0 && input.every((m) => m === 'text');
      caps.transcription = input.length > 0 && input.every((m) => m === 'audio') && output.includes('text')
        && output.every((m) => m === 'text');

      const cost = isObj(raw.cost) ? raw.cost : {};
      const imageOnly = output.includes('image') && !output.includes('text');
      const price: ModelPrice = compact({
        inPerMtok: num(cost.input),
        outPerMtok: imageOnly ? undefined : num(cost.output),
        imageOutPerMtok: imageOnly ? num(cost.output) : undefined,
        cacheReadPerMtok: num(cost.cache_read),
        cacheWritePerMtok: num(cost.cache_write),
        reasoningPerMtok: num(cost.reasoning),
        audioInPerMtok: num(cost.input_audio),
        audioOutPerMtok: num(cost.output_audio),
      });
      const lim = isObj(raw.limit) ? raw.limit : {};
      out.push(compact<CatalogModel>({
        type, id,
        name: str(raw.name) ?? id,
        family,
        released: isoDay(raw.release_date),
        caps,
        // An embedding model's limit.output is its vector dimension (1536, 3072), not tokens.
        limits: compact({ context: limit(lim.context), output: embeddings ? undefined : limit(lim.output) }),
        price,
        status: raw.status === 'deprecated' ? 'retiring' : 'active',
        sources: ['models.dev'],
        seenAt,
      }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------------------------

/** OpenRouter outputs the node has an operation for; a model with none of them is skipped. */
const OPENROUTER_USABLE_OUT = ['text', 'image', 'audio', 'speech', 'transcription', 'embeddings'];

/**
 * OpenRouter /api/v1/models?output_modalities=all → catalogue rows of type 'openrouter'. Prices are
 * $ per token and become $ per million; a speech or transcription model's prices go to `raw` only.
 */
export function fromOpenRouter(json: unknown, seenAt: string): CatalogModel[] {
  const data = isObj(json) && Array.isArray(json.data) ? json.data : [];
  const out: CatalogModel[] = [];
  for (const raw of data) {
    if (!isObj(raw)) continue;
    const id = str(raw.id);
    if (!id) continue;
    const arch = isObj(raw.architecture) ? raw.architecture : {};
    const input = strList(arch.input_modalities);
    const output = strList(arch.output_modalities);
    if (!output.some((m) => OPENROUTER_USABLE_OUT.includes(m))) continue;
    const params = strList(raw.supported_parameters);

    const caps = noCaps();
    caps.textIn = input.includes('text');
    caps.imageIn = input.includes('image');
    caps.fileIn = input.includes('file');
    caps.audioIn = input.includes('audio');
    caps.videoIn = input.includes('video');
    caps.speech = output.includes('speech');
    caps.transcription = output.includes('transcription');
    caps.embeddings = output.includes('embeddings');
    caps.textOut = output.includes('text') || caps.transcription;
    caps.imageOut = output.includes('image');
    caps.audioOut = output.includes('audio') || caps.speech;
    caps.tools = params.includes('tools');
    caps.structuredOutput = params.includes('structured_outputs') || params.includes('response_format');
    caps.reasoning = params.includes('reasoning') || params.includes('include_reasoning');
    const voices = strList(raw.supported_voices);
    if (voices.length > 0) caps.voices = voices;

    const p = isObj(raw.pricing) ? raw.pricing : {};
    let price: ModelPrice;
    if (caps.speech || caps.transcription) {
      // The unit of an audio model's price is not stated by the API (types.ts header): keep the
      // source's own numbers by field name and derive no rate from them.
      const rawPrice: Record<string, number> = {};
      for (const k of ['prompt', 'completion', 'audio', 'audio_output', 'input_audio_cache']) {
        const n = num(p[k]);
        if (n !== undefined) rawPrice[k] = n;
      }
      price = Object.keys(rawPrice).length > 0 ? { raw: rawPrice } : {};
    } else {
      const image = num(p.image);
      price = compact({
        inPerMtok: perM(p.prompt),
        outPerMtok: perM(p.completion),
        cacheReadPerMtok: perM(p.input_cache_read),
        cacheWritePerMtok: perM(p.input_cache_write),
        reasoningPerMtok: perM(p.internal_reasoning),
        imageOutPerMtok: perM(p.image_output) ?? perM(p.image_token),
        audioInPerMtok: perM(p.audio),
        audioOutPerMtok: perM(p.audio_output),
        raw: image !== undefined ? { image } : undefined,
      });
    }

    const created = typeof raw.created === 'number' && raw.created > 0
      ? new Date(raw.created * 1000).toISOString().slice(0, 10) : undefined;
    const top = isObj(raw.top_provider) ? raw.top_provider : {};
    out.push(compact<CatalogModel>({
      type: 'openrouter', id,
      name: str(raw.name) ?? id,
      released: created,
      caps,
      // An embedding model returns a vector, so a max_completion_tokens on it limits nothing.
      limits: compact({
        context: limit(raw.context_length),
        output: caps.embeddings ? undefined : limit(top.max_completion_tokens),
      }),
      price,
      status: 'active',
      retiresAt: isoDay(raw.expiration_date),
      sources: ['openrouter'],
      seenAt,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// LiteLLM
// ---------------------------------------------------------------------------------------------

/**
 * LiteLLM `litellm_provider` → CatalogType. Measured 2026-09-28: 'codestral' is Mistral's code model
 * on its own endpoint, same ids. 'text-completion-openai' and 'text-completion-codestral' carry only
 * mode 'completion', which the node does not call, so they are not mapped. 'vertex_ai-*' and
 * 'bedrock*' are other hosts' copies and are not these providers.
 */
export const LITELLM_PROVIDERS: Readonly<Record<string, CatalogType>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  xai: 'xai',
  mistral: 'mistral',
  codestral: 'mistral',
  deepseek: 'deepseek',
};

/** LiteLLM modes the node uses. Everything else (completion, realtime, moderation, ocr, rerank, video_generation, ...) is skipped. */
const LITELLM_MODES = new Set(['chat', 'responses', 'embedding', 'image_generation', 'audio_speech', 'audio_transcription']);

/**
 * A LiteLLM key and its provider → the catalogue reference. A leading segment equal to the LiteLLM
 * provider name or the target type is dropped ('xai/grok-4.3' → xai:grok-4.3, 'codestral/codestral-latest'
 * → mistral:codestral-latest); a key without a slash is the id as is ('whisper-1' → openai:whisper-1).
 * Any other slash means a quality or size variant ('low/1024-x-1024/gpt-image-1.5'), which is null,
 * and so is an unmapped provider.
 */
export function liteLlmRef(key: string, provider: string): { type: CatalogType; id: string } | null {
  const type = LITELLM_PROVIDERS[provider];
  if (!type || !key) return null;
  let id = key;
  const slash = key.indexOf('/');
  if (slash >= 0) {
    const head = key.slice(0, slash);
    if (head !== provider && head !== type) return null;
    id = key.slice(slash + 1);
  }
  if (!id || id.includes('/')) return null;
  return { type, id };
}

function liteLlmCaps(e: Json, mode: string): ModelCaps {
  const caps = noCaps();
  switch (mode) {
    case 'audio_transcription':
      caps.transcription = true; caps.audioIn = true; caps.textOut = true;
      break;
    case 'audio_speech':
      caps.speech = true; caps.textIn = true; caps.audioOut = true;
      break;
    case 'image_generation':
      caps.imageOut = true; caps.textIn = true;
      caps.imageIn = e.supports_vision === true || num(e.input_cost_per_image_token) !== undefined;
      break;
    case 'embedding':
      caps.embeddings = true; caps.textIn = true;
      break;
    default: // chat, responses
      caps.textIn = true; caps.textOut = true;
      caps.imageIn = e.supports_vision === true;
      caps.fileIn = e.supports_pdf_input === true;
      caps.audioIn = e.supports_audio_input === true;
      caps.audioOut = e.supports_audio_output === true;
      caps.tools = e.supports_function_calling === true;
      caps.reasoning = e.supports_reasoning === true;
      caps.structuredOutput = e.supports_response_schema === true;
  }
  return caps;
}

/**
 * LiteLLM model_prices_and_context_window.json → catalogue rows for the mapped providers and the
 * modes the node uses. Prices are $ per token and become $ per million; per second, per character
 * and per image stay per unit. Two keys naming one model ('deepseek-v4-flash' and
 * 'deepseek/deepseek-v4-flash') become one row: the first key keeps its fields, a later one fills.
 */
export function fromLiteLLM(json: unknown, seenAt: string): CatalogModel[] {
  if (!isObj(json)) return [];
  const byRef = new Map<string, CatalogModel>();
  for (const [key, e] of Object.entries(json)) {
    if (!isObj(e)) continue;
    const provider = str(e.litellm_provider);
    const mode = str(e.mode);
    if (!provider || !mode || !LITELLM_MODES.has(mode)) continue;
    const ref = liteLlmRef(key, provider);
    if (!ref) continue;
    const price: ModelPrice = compact({
      inPerMtok: perM(e.input_cost_per_token),
      outPerMtok: perM(e.output_cost_per_token),
      cacheReadPerMtok: perM(e.cache_read_input_token_cost),
      cacheWritePerMtok: perM(e.cache_creation_input_token_cost),
      reasoningPerMtok: perM(e.output_cost_per_reasoning_token),
      audioInPerMtok: perM(e.input_cost_per_audio_token),
      audioOutPerMtok: perM(e.output_cost_per_audio_token),
      imageOutPerMtok: perM(e.output_cost_per_image_token),
      perImage: num(e.output_cost_per_image) ?? (mode === 'image_generation' ? num(e.input_cost_per_image) : undefined),
      speechPerChar: num(e.input_cost_per_character),
      transcriptionPerSecond: num(e.input_cost_per_second),
    });
    const row = compact<CatalogModel>({
      type: ref.type, id: ref.id, name: ref.id,
      caps: liteLlmCaps(e, mode),
      limits: compact({ context: limit(e.max_input_tokens), output: limit(e.max_output_tokens) }),
      price,
      status: 'active',
      retiresAt: isoDay(e.deprecation_date),
      sources: ['litellm'],
      seenAt,
    });
    const k = `${ref.type}:${ref.id}`;
    const prev = byRef.get(k);
    byRef.set(k, prev ? fill(prev, row) : row);
  }
  return [...byRef.values()];
}

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

function refOf(m: CatalogModel): string {
  return `${m.type}:${m.id}`;
}

function unionSources(a: CatalogSource[], b: CatalogSource[]): CatalogSource[] {
  const set = new Set([...a, ...b]);
  return SOURCE_ORDER.filter((s) => set.has(s));
}

function laterIso(a: string, b: string): string {
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/** `base` keeps every field it has; `extra` supplies only what is missing, and turns on a cap it has. */
function fill(base: CatalogModel, extra: CatalogModel): CatalogModel {
  const caps = { ...base.caps };
  for (const k of Object.keys(extra.caps) as (keyof ModelCaps)[]) {
    if (k === 'voices') continue;
    if (extra.caps[k] === true) caps[k] = true;
  }
  if (!caps.voices && extra.caps.voices) caps.voices = [...extra.caps.voices];
  const price: ModelPrice = { ...extra.price, ...base.price };
  if (base.price.raw || extra.price.raw) price.raw = { ...extra.price.raw, ...base.price.raw };
  return compact<CatalogModel>({
    ...base,
    name: base.name || extra.name,
    family: base.family ?? extra.family,
    released: base.released ?? extra.released,
    caps,
    limits: { ...extra.limits, ...base.limits },
    price: compact(price),
    retiresAt: base.retiresAt ?? extra.retiresAt,
    sources: unionSources(base.sources, extra.sources),
    seenAt: laterIso(base.seenAt, extra.seenAt),
  });
}

/**
 * `win` replaces what it states: caps whole, name, status, retiresAt, and each price and limit it
 * has. `base` keeps what `win` leaves unset, and its family and release date (OpenRouter's `created`
 * is a listing date, not a release date).
 */
function overlay(base: CatalogModel, win: CatalogModel): CatalogModel {
  const price: ModelPrice = { ...base.price, ...win.price };
  if (base.price.raw || win.price.raw) price.raw = { ...base.price.raw, ...win.price.raw };
  return compact<CatalogModel>({
    ...base,
    name: win.name,
    family: base.family ?? win.family,
    released: base.released ?? win.released,
    caps: { ...win.caps },
    limits: { ...base.limits, ...win.limits },
    price: compact(price),
    status: win.status,
    retiresAt: win.retiresAt ?? base.retiresAt,
    sources: unionSources(base.sources, win.sources),
    seenAt: laterIso(base.seenAt, win.seenAt),
  });
}

function byTypeThenId(a: CatalogModel, b: CatalogModel): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * One row per `type:id` (the id as the provider writes it, case-sensitive). models.dev first;
 * OpenRouter replaces models.dev for type openrouter; LiteLLM only fills what is still missing and
 * adds models no other source had; `overrides` (keyed `<type>:<id>`) replaces prices over all of
 * them. An override for a model no source listed is ignored. Sorted by type, then id.
 */
export function mergeSources(
  parts: { modelsDev: CatalogModel[]; openRouter: CatalogModel[]; liteLlm: CatalogModel[] },
  overrides?: Record<string, Partial<ModelPrice>>,
): CatalogModel[] {
  const map = new Map<string, CatalogModel>();
  for (const m of parts.modelsDev) {
    const k = refOf(m);
    const prev = map.get(k);
    map.set(k, prev ? fill(prev, m) : m);
  }
  for (const m of parts.openRouter) {
    const k = refOf(m);
    const prev = map.get(k);
    map.set(k, prev ? overlay(prev, m) : m);
  }
  for (const m of parts.liteLlm) {
    const k = refOf(m);
    const prev = map.get(k);
    map.set(k, prev ? fill(prev, m) : m);
  }
  if (overrides) {
    for (const [k, correction] of Object.entries(overrides)) {
      const m = map.get(k);
      if (!m || !isObj(correction)) continue;
      const price: ModelPrice = { ...m.price, ...correction };
      if (m.price.raw || correction.raw) price.raw = { ...m.price.raw, ...correction.raw };
      map.set(k, { ...m, price: compact(price), sources: unionSources(m.sources, ['operator']) });
    }
  }
  return [...map.values()].sort(byTypeThenId);
}

// ---------------------------------------------------------------------------------------------
// Retirement (plan 06, section 6)
// ---------------------------------------------------------------------------------------------

function passed(iso: string | undefined, nowMs: number, afterMs = 0): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && nowMs - t > afterMs;
}

function reached(iso: string | undefined, nowMs: number, afterMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && nowMs - t >= afterMs;
}

/**
 * The catalogue after one refresh. A model in `fresh` is listed: its own status (active, or retiring
 * from models.dev), no missingSince, seenAt = now. A model only in `previous` is missing: the first
 * time it becomes retiring with missingSince = now and keeps its seenAt; after 28 days missing it is
 * retired. A retiresAt in the past retires a model whether it is listed or not. A retired model is
 * dropped more than 180 days after missingSince or after retiresAt. When `sourcesAnswered` is false
 * the refresh failed, and `previous` is returned as it is: the catalogue never empties because a
 * source was down.
 */
export function applyLifecycle(
  previous: CatalogModel[], fresh: CatalogModel[], now: string, sourcesAnswered: boolean,
): CatalogModel[] {
  if (!sourcesAnswered) return previous;
  const nowMs = Date.parse(now);
  const out: CatalogModel[] = [];
  const listed = new Set<string>();

  for (const f of fresh) {
    listed.add(refOf(f));
    const expired = passed(f.retiresAt, nowMs);
    if (expired && passed(f.retiresAt, nowMs, DROP_AFTER_MS)) continue;
    const status: CatalogStatus = expired ? 'retired' : f.status === 'retiring' ? 'retiring' : 'active';
    const row: CatalogModel = { ...f, status, seenAt: now };
    delete row.missingSince;
    out.push(row);
  }

  for (const p of previous) {
    if (listed.has(refOf(p))) continue;
    const missingSince = p.missingSince ?? now;
    const retired = p.status === 'retired' || passed(p.retiresAt, nowMs) || reached(missingSince, nowMs, RETIRE_AFTER_MS);
    if (retired && (passed(missingSince, nowMs, DROP_AFTER_MS) || passed(p.retiresAt, nowMs, DROP_AFTER_MS))) continue;
    out.push({ ...p, status: retired ? 'retired' : 'retiring', missingSince });
  }
  return out.sort(byTypeThenId);
}

// ---------------------------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------------------------

/**
 * UTF-8 bytes of the stored record `{ type, models, updatedAt }` for one type's models, for the
 * 700 kB warning. updatedAt is measured at the length of an ISO timestamp.
 */
export function recordSize(models: CatalogModel[]): number {
  const record = { type: models[0]?.type ?? '', models, updatedAt: new Date(0).toISOString() };
  return new TextEncoder().encode(JSON.stringify(record)).length;
}

/** Models grouped per type, in input order; a type with no model has no key. */
export function groupByType(models: CatalogModel[]): Partial<Record<CatalogType, CatalogModel[]>> {
  const out: Partial<Record<CatalogType, CatalogModel[]>> = {};
  for (const m of models) (out[m.type] ??= []).push(m);
  return out;
}
