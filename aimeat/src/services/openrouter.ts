/**
 * @file openrouter.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own HTTP transport to OpenAI-compatible providers (OpenRouter, LM Studio,
 *   a custom address), for what the AI SDK packages do not carry: image generation with the
 *   moderation retry, multipart transcription, speech, the raw chat request the proxy forwards, and
 *   the model listings. Text completions go through the gateway (services/ai/gateway.ts) since
 *   2026-09-28. Every function here reaches the network through safeFetch.
 * @structure
 *   - generateImage(apiKey, model, prompt, baseUrl?, opts?) — POST /images/generations
 *   - transcribe(apiKey, model, audio, baseUrl?, opts?) — call audio transcriptions (STT)
 *   - chatCompletionRaw / speechRaw / generationCost — the proxy's and the voice stream's transport
 *   - listModels(apiKey, baseUrl?, modality?) — fetch available models
 * @version-history
 *   v4.0.1 — 2026-10-05 — Every answer is read under a ceiling (readJson, readText; secaudit 2026-10, C6).
 *   v4.0.0 — 2026-09-28 — complete() is gone: text completions run through the System 2 gateway on
 *     the AI SDK (services/ai/gateway.ts), which keeps its empty-answer retry, its reasoning
 *     pass-through and its finish reason. generateImage() and listModels() reach the provider
 *     through safeFetch like everything else here: they were the last two plain `fetch` calls to an
 *     address an owner chose, which on a public node reached loopback. generateImage() takes a
 *     cancel signal, combined with its own timeout.
 *   v3.2.0 — 2026-09-09 — An empty answer is a failed call, not an answer. complete() retries it
 *     (`retries`, default 2; on OpenRouter a retry usually lands on a different provider) and then
 *     throws with the finish_reason, where it had returned '' with a warning nobody's caller read: a
 *     workflow step wrote the empty string to its key and went green. `reasoning` is passed to the
 *     provider as given, because a reasoning model behind a cap spends the cap on thinking and
 *     answers with nothing at HTTP 200. `finish_reason` joins the result.
 *   v3.1.0 — 2026-08-16 — chatCompletionRaw(): the request as given, the provider's response as it
 *     came. The chat proxy forwards both untouched, and this file is the node's only HTTP transport
 *     to a provider, which is a checked rule rather than a convention.
 *   v1.6.0 — 2026-08-16 — generateImage(): POST {baseUrl}/images/generations, and 'image' joins
 *     ModelModality so the picker can list image models the same way it lists whisper ones. The
 *     three-attempt retry is not padding: some providers' moderation throws false positives and the
 *     SAME prompt passes on the next attempt, which scripts/gen_image.py has worked around since it
 *     was written. Only moderation is retried; every other failure is reported at once, because
 *     retrying a real error only makes the person wait longer for it.
 *   v1.5.0 — 2026-08-01 — Speech-to-text: transcribe() posts multipart/form-data to
 *     `${baseUrl}/audio/transcriptions` (OpenAI-compatible, so it also reaches a local whisper.cpp /
 *     faster-whisper server), and listModels() takes a modality. The modality is not cosmetic:
 *     OpenRouter's DEFAULT catalogue contains no transcription models at all — measured 2026-08-01,
 *     336 models, zero whisper — they exist only behind ?output_modalities=transcription. Without it
 *     an STT model cannot be offered in a picker.
 *   v1.0.0 — 2026-03-20 — Initial implementation
 *   v1.1.0 — 2026-03-21 — Made provider-agnostic with baseUrl parameter; apiKey optional
 *   v1.2.0 — 2026-05-29 — `OpenRouterCompletionResult` now exposes optional
 *     `usage` (prompt/completion/total tokens + cost_usd) so callers (the new
 *     /v1/ai/complete app endpoint in particular) can enforce per-user/per-app
 *     daily budgets. Backwards-compatible: old callers ignoring `usage` are
 *     unaffected. Cost is OpenRouter-reported when present, undefined otherwise.
 *   v1.3.0 — 2026-06-24 — `complete()` accepts an optional `images` array
 *     (data: URLs or https URLs). When present the user message is sent as an
 *     OpenAI-compatible multimodal content array (text + image_url parts) so a
 *     vision-capable model can read attachments. Text-only callers are unaffected.
 *   v1.4.0 — 2026-07-05 — `listModels()` no longer assumes a `name` field: OpenAI-compatible
 *     providers (NVIDIA NIM's integrate.api.nvidia.com/v1, LM Studio, OpenAI) return models with
 *     only an `id`. Name now falls back to `id` and the alphabetical sort is guarded, so the model
 *     list populates instead of throwing on `undefined.localeCompare` (which surfaced as an empty
 *     dropdown for custom providers). `owned_by` is carried into `description` when present.
 */
import { logger } from '../utils/logger.js';
import { safeFetch } from '../utils/url-validator.js';
import { readJson, readText } from '../utils/read-capped.js';

/** The most of one answer this node reads from the AI provider: a model list, a transcript, images
 *  as base64. Read under a ceiling so the provider does not decide how much memory a call takes
 *  (secaudit 2026-10, C6). */
const ANSWER_MAX_BYTES = 64 * 1024 * 1024;
/** An error body, or a small status read: enough for the message, never more. */
const ERROR_BODY_MAX_BYTES = 64 * 1024;

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string; image?: string; audio?: string };
  /**
   * What the model ACCEPTS, straight from `architecture.input_modalities` (`text`, `image`, `audio`,
   * `file`). A picker filters on this instead of guessing from the name: 180 of the 336 catalogue
   * models read images, and no naming convention identifies them.
   */
  input_modalities?: string[];
  /** What the model PRODUCES (`text`, `transcription`, `speech`, `image`). */
  output_modalities?: string[];
}

/** What an image generation returns: the bytes, what they are, and what the provider charged. */
export interface ImageGenerationResult {
  data: Buffer;
  mime: string;
  model: string;
  /** Provider-reported cost in USD when it says; undefined otherwise, never estimated. */
  costUsd?: number;
}

/** How many times a moderation refusal is retried before the model is given up on. */
const IMAGE_MODERATION_ATTEMPTS = 3;

/**
 * Generate an image, OpenAI-compatible (`POST {baseUrl}/images/generations`).
 *
 * The retry is not defensive padding. Some providers' moderation throws false positives on ordinary
 * prompts and the SAME prompt passes on the next attempt, which scripts/gen_image.py has been
 * working around since it was written. Only a moderation refusal is retried; every other failure is
 * reported at once, because retrying a real error just makes the person wait longer for it.
 */
export async function generateImage(
  apiKey: string | undefined,
  model: string,
  prompt: string,
  baseUrl: string = OPENROUTER_BASE,
  opts?: { size?: string; signal?: AbortSignal },
): Promise<ImageGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // The caller's reason to stop, combined with the timeout rather than replacing it.
  const signal = opts?.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  logger.info(`[openrouter] image: model=${model}, size=${opts?.size ?? 'default'}`);

  try {
    let lastErr: (Error & { status?: number }) | null = null;
    for (let attempt = 1; attempt <= IMAGE_MODERATION_ATTEMPTS; attempt++) {
      const resp = await safeFetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { ...providerHeaders(apiKey, baseUrl), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, ...(opts?.size ? { size: opts.size } : {}), usage: { include: true } }),
        signal,
      });

      if (!resp.ok) {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body only enriches an error already being reported; an unreadable body is honestly reported as empty
        const body = await readText(resp, ERROR_BODY_MAX_BYTES).catch(() => '');
        const err = new Error(`OpenRouter ${resp.status}: ${body}`) as Error & { status: number };
        err.status = resp.status;
        if (!/moderat/i.test(body) || attempt === IMAGE_MODERATION_ATTEMPTS) throw err;
        lastErr = err;
        logger.info(`[openrouter] image: moderation refusal on attempt ${attempt}, retrying`);
        continue;
      }

      const json = await readJson(resp, ANSWER_MAX_BYTES) as {
        data?: Array<{ b64_json?: string; url?: string }>;
        usage?: { cost?: number };
        error?: { message?: string };
      };
      if (json.error?.message) throw new Error(`OpenRouter: ${json.error.message}`);

      const first = json.data?.[0];
      // Providers answer with either a base64 field or a data: URL carrying the same bytes.
      const b64 = first?.b64_json
        ?? (first?.url?.startsWith('data:') ? first.url.split('base64,', 2)[1] : undefined);
      if (!b64) throw new Error('OpenRouter returned no image data.');

      const data = Buffer.from(b64, 'base64');
      // Sniff rather than trust: the response does not say which format came back, and a wrong
      // Content-Type on the stored file is what makes an image fail to render later.
      const isPng = data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
      return {
        data,
        mime: isPng ? 'image/png' : 'image/jpeg',
        model,
        costUsd: typeof json.usage?.cost === 'number' ? json.usage.cost : undefined,
      };
    }
    throw lastErr ?? new Error('OpenRouter: image generation failed.');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Which slice of a provider's catalogue to list.
 *
 * `chat` is the plain `/models` catalogue. `transcription` and `speech` exist only behind
 * OpenRouter's `output_modalities` filter — they are NOT in the default listing, so asking for the
 * default and filtering client-side returns nothing.
 */
export type ModelModality = 'chat' | 'transcription' | 'speech' | 'image';

/** Audio bytes handed to transcribe(). `filename` only decides the multipart part name the provider
 *  sees; `mime` is what actually tells it how to decode. */
export interface TranscriptionAudio {
  data: Buffer;
  mime: string;
  filename: string;
}

export interface TranscriptionResult {
  text: string;
  model: string;
  /** Detected (or echoed) language, present with response_format=verbose_json. */
  language?: string;
  /**
   * Provider-reported usage. `seconds` is the measured audio duration and `cost_usd` the actual
   * charge — for STT this is the ONLY trustworthy price signal: the catalogue's `pricing.prompt`
   * for an audio model is per-minute on one provider and per-hour on another (Whisper Large V3:
   * Together 0.0015, Groq 0.111) with nothing in the API saying which.
   */
  usage?: {
    seconds?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
  };
}

/**
 * The provider kinds this transport speaks to. `custom` means "an OpenAI-compatible endpoint the
 * owner named themselves", which is why its default base URL is the empty string: there is no
 * default to guess, and a caller must supply one.
 */
export type ProviderType = 'openrouter' | 'lmstudio' | 'custom';

/**
 * Where each provider lives when the owner has not overridden it.
 *
 * DECLARED ONCE, HERE. This lived in three places — the route, the completion chokepoint, and a
 * private OPENROUTER_BASE in this file — which is three chances for them to disagree about what
 * `custom` means, on the one path that decides where a decrypted API key gets sent. The transport is
 * the right home because it is the module that actually makes the request.
 */
export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  custom: '',
};

const OPENROUTER_BASE = DEFAULT_BASE_URLS.openrouter;
const TIMEOUT_MS = 1_800_000; // 30 minutes
/** Transcription is bounded work, and OpenRouter's upstream provider timeout is 60 s per request.
 *  A 30-minute ceiling here would only keep a dead socket open. */
const STT_TIMEOUT_MS = 120_000;

/** Auth + the OpenRouter-only attribution headers (which a non-OpenRouter endpoint has no use for). */
/**
 * The headers every outbound call to the provider carries. Exported because the chat proxy sends the
 * request itself rather than through the gateway, and two places building these by hand is how the
 * attribution headers end up on one route and not the other.
 */
export function providerHeaders(apiKey: string | undefined, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (baseUrl === OPENROUTER_BASE) {
    headers['HTTP-Referer'] = 'https://aimeat.io';
    headers['X-Title'] = 'AIMEAT';
  }
  return headers;
}

/**
 * OpenRouter's unified reasoning parameter, sent to the provider exactly as given. `enabled: false`
 * turns a reasoning model's hidden thinking off; `effort` sizes it; `max_tokens` caps it; `exclude`
 * keeps it out of the response. Nothing is sent when the caller sets nothing.
 */
export interface CompletionReasoning {
  enabled?: boolean;
  effort?: 'low' | 'medium' | 'high';
  max_tokens?: number;
  exclude?: boolean;
}

/**
 * The knobs of one text completion, in the provider's own spelling. The gateway
 * (services/ai/gateway.ts) sends them since 2026-09-28; the type stays here because the notebook
 * passes it through unchanged.
 */
export interface CompletionOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  reasoning?: CompletionReasoning;
  /**
   * How many times an answer with no content is asked again before the gateway fails the call.
   * Default 2 (DEFAULT_EMPTY_RETRIES in services/ai/gateway.ts); 0 asks once. An empty answer at
   * HTTP 200 is what a reasoning model produces when its cap runs out mid-thought, and what a few
   * providers produce for no reason anyone has found; on OpenRouter the next attempt usually lands
   * on a different provider.
   */
  retries?: number;
  /**
   * An outside reason to stop waiting — a cancelled AI job, so far. It is COMBINED with the call's
   * own timeout rather than replacing it: a caller that can cancel still gets the timeout, and a
   * caller that cannot is unchanged.
   */
  signal?: AbortSignal;
}

/**
 * Transcribe audio with an OpenAI-compatible speech-to-text endpoint.
 *
 * multipart/form-data, not the JSON `input_audio` form OpenRouter also accepts. Two reasons: the
 * bytes are already a Buffer on this side (base64 would inflate them by 4/3 for nothing), and
 * multipart is the shape every OpenAI-compatible STT server understands, so the same call reaches a
 * self-hosted whisper.cpp / faster-whisper endpoint. `FormData` and `Blob` are globals on Node 24, so
 * this adds no dependency.
 *
 * Content-Type is deliberately NOT set: fetch derives it from the FormData together with the
 * multipart boundary, and setting it by hand produces a body the provider cannot parse.
 */
/**
 * Send a chat-completion request exactly as given, and hand back the provider's own response.
 *
 * The gateway (services/ai/gateway.ts) builds the request and parses the answer, which is what a
 * caller wanting a string needs. The chat proxy needs neither: it already has an OpenAI-shaped body from its caller
 * and it forwards the provider's bytes untouched, streamed frames included. So this returns the raw
 * `Response`.
 *
 * It lives here because this file is the node's only HTTP transport to a model provider, and that is
 * enforced rather than agreed (`pnpm check:llm-transport`). A second place speaking to a provider is
 * a second place that can forget to meter the call.
 *
 * Deciding whether the call may happen, whose key pays and what it cost is NOT this function's job —
 * that is services/ai/completion.ts, and every caller of this goes through it first.
 */
export async function chatCompletionRaw(
  apiKey: string | undefined,
  baseUrl: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  return safeFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...providerHeaders(apiKey, baseUrl) },
    body: JSON.stringify(body),
    signal,
  });
}

/** Speech transport shares the same guarded caller and never receives a client-selected URL. */
export async function speechRaw(apiKey: string | undefined, baseUrl: string, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  return safeFetch(`${baseUrl}/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...providerHeaders(apiKey, baseUrl) },
    body: JSON.stringify(body), signal,
  });
}

/** OpenRouter reports the actual charge separately for binary speech responses. */
export async function generationCost(apiKey: string | undefined, baseUrl: string, id: string): Promise<number | undefined> {
  if (new URL(baseUrl).hostname !== 'openrouter.ai') return undefined;
  const response = await safeFetch(`${baseUrl}/generation?id=${encodeURIComponent(id)}`, {
    headers: providerHeaders(apiKey, baseUrl), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return undefined;
  const value = await readJson(response, ERROR_BODY_MAX_BYTES) as { data?: { total_cost?: number } };
  const cost = value.data?.total_cost;
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

export async function transcribe(
  apiKey: string | undefined,
  model: string,
  audio: TranscriptionAudio,
  baseUrl: string = OPENROUTER_BASE,
  opts?: { language?: string; temperature?: number; verbose?: boolean; signal?: AbortSignal },
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio.data)], { type: audio.mime }), audio.filename);
  form.append('model', model);
  if (opts?.language) form.append('language', opts.language);
  if (opts?.temperature !== undefined) form.append('temperature', String(opts.temperature));
  if (opts?.verbose) {
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  logger.info(`[openrouter] STT: model=${model}, mime=${audio.mime}, bytes=${audio.data.length}, lang=${opts?.language ?? 'auto'}`);

  try {
    const resp = await safeFetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: providerHeaders(apiKey, baseUrl),
      body: form,
      signal: opts?.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
    });

    if (!resp.ok) {
      // eslint-disable-next-line aimeat/no-silent-catch -- the body only enriches an error already being reported; an unreadable body is honestly reported as empty
      const body = await readText(resp, ERROR_BODY_MAX_BYTES).catch(() => '');
      const err = new Error(`OpenRouter ${resp.status}: ${body}`) as Error & { status: number };
      err.status = resp.status;
      throw err;
    }

    const data = await readJson(resp, ANSWER_MAX_BYTES) as {
      text?: string;
      language?: string;
      model?: string;
      error?: { message?: string; code?: number };
      usage?: { seconds?: number; input_tokens?: number; output_tokens?: number; total_tokens?: number; cost?: number };
    };

    // Same trap as chat completions: a 200 can still carry an error body.
    if (data.error) {
      logger.warn(`[openrouter] STT error body: ${JSON.stringify(data.error).slice(0, 500)}`);
      const err = new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`) as Error & { status: number };
      err.status = data.error.code || 502;
      throw err;
    }

    logger.info(`[openrouter] STT result: chars=${(data.text ?? '').length}, seconds=${data.usage?.seconds}, cost=${data.usage?.cost}`);

    return {
      text: data.text ?? '',
      model: data.model ?? model,
      language: data.language,
      usage: data.usage ? {
        seconds: data.usage.seconds,
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
        total_tokens: data.usage.total_tokens,
        cost_usd: typeof data.usage.cost === 'number' ? data.usage.cost : undefined,
      } : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch available models from an OpenAI-compatible API.
 *
 * `modality` appends OpenRouter's `output_modalities` filter. STT and TTS models are absent from the
 * default catalogue entirely, so `chat` and `transcription` are genuinely different listings, not the
 * same list filtered twice. Other OpenAI-compatible providers ignore the unknown query parameter and
 * return their whole catalogue, which is the sane fallback.
 */
export async function listModels(
  apiKey: string | undefined,
  baseUrl: string = OPENROUTER_BASE,
  modality: ModelModality = 'chat',
): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const qs = modality === 'chat' ? '' : `?output_modalities=${encodeURIComponent(modality)}`;
  const resp = await safeFetch(`${baseUrl}/models${qs}`, { headers });

  if (!resp.ok) {
    const err = new Error(`OpenRouter ${resp.status}`) as Error & { status: number };
    err.status = resp.status;
    throw err;
  }

  type RawModel = OpenRouterModel & {
    owned_by?: string;
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  };
  const data = await readJson(resp, ANSWER_MAX_BYTES) as { data?: RawModel[] };
  return (data.data ?? [])
    .filter((m): m is RawModel => !!m && typeof m.id === 'string')
    .map(m => ({
      id: m.id,
      // OpenRouter returns a human `name`; OpenAI-compatible providers (NVIDIA NIM,
      // LM Studio, OpenAI, …) return only `id`. Fall back to the id so the option
      // label — and the sort below — never dereference `undefined`.
      name: m.name || m.id,
      description: m.description || m.owned_by,
      context_length: m.context_length,
      pricing: m.pricing,
      // Carried through so a picker can filter on what a model actually accepts rather than on its
      // name. Absent on providers that don't describe themselves; callers treat that as "unknown".
      input_modalities: m.architecture?.input_modalities,
      output_modalities: m.architecture?.output_modalities,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
