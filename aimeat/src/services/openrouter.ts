/**
 * @file openrouter.ts
 * @description Provider-agnostic AI client for OpenAI-compatible APIs (OpenRouter, LM Studio, etc.).
 * @structure
 *   - complete(apiKey, model, prompt, systemPrompt?, baseUrl?) — call chat completions
 *   - transcribe(apiKey, model, audio, baseUrl?, opts?) — call audio transcriptions (STT)
 *   - listModels(apiKey, baseUrl?, modality?) — fetch available models
 * @version-history
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

export interface OpenRouterCompletionResult {
  content: string;
  model: string;
  /**
   * Token + cost usage as reported by the provider. May be partial:
   *  - OpenRouter returns prompt/completion tokens reliably, and `cost` when
   *    the request asked for it.
   *  - LM Studio / custom OpenAI-compatible providers usually report tokens
   *    but no cost.
   * Callers treating cost as load-bearing should fall back to a per-token
   * estimate when `cost_usd` is undefined.
   */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
  };
}

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
  opts?: { size?: string },
): Promise<ImageGenerationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  logger.info(`[openrouter] image: model=${model}, size=${opts?.size ?? 'default'}`);

  try {
    let lastErr: (Error & { status?: number }) | null = null;
    for (let attempt = 1; attempt <= IMAGE_MODERATION_ATTEMPTS; attempt++) {
      const resp = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { ...providerHeaders(apiKey, baseUrl), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, ...(opts?.size ? { size: opts.size } : {}), usage: { include: true } }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        // eslint-disable-next-line aimeat/no-silent-catch -- the body only enriches an error already being reported; an unreadable body is honestly reported as empty
        const body = await resp.text().catch(() => '');
        const err = new Error(`OpenRouter ${resp.status}: ${body}`) as Error & { status: number };
        err.status = resp.status;
        if (!/moderat/i.test(body) || attempt === IMAGE_MODERATION_ATTEMPTS) throw err;
        lastErr = err;
        logger.info(`[openrouter] image: moderation refusal on attempt ${attempt}, retrying`);
        continue;
      }

      const json = await resp.json() as {
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
function providerHeaders(apiKey: string | undefined, baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (baseUrl === OPENROUTER_BASE) {
    headers['HTTP-Referer'] = 'https://aimeat.io';
    headers['X-Title'] = 'AIMEAT';
  }
  return headers;
}

/**
 * Call an OpenAI-compatible chat completions API.
 */
export interface CompletionOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

/** A user-message content part for OpenAI-compatible multimodal (vision) requests. */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export async function complete(
  apiKey: string | undefined,
  model: string,
  prompt: string,
  systemPrompt?: string,
  baseUrl: string = OPENROUTER_BASE,
  options?: CompletionOptions,
  images?: string[],
): Promise<OpenRouterCompletionResult> {
  const messages: Array<{ role: string; content: string | ContentPart[] }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  // With image attachments, send the user turn as a multimodal content array (text + image_url
  // parts). Without, keep the plain-string form so text-only callers are byte-for-byte unchanged.
  if (Array.isArray(images) && images.length > 0) {
    const parts: ContentPart[] = [{ type: 'text', text: prompt }];
    for (const url of images) {
      if (typeof url === 'string' && url) parts.push({ type: 'image_url', image_url: { url } });
    }
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({ role: 'user', content: prompt });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...providerHeaders(apiKey, baseUrl) };

  const requestBody: Record<string, unknown> = { model, messages };
  if (options?.temperature !== undefined) requestBody.temperature = options.temperature;
  if (options?.top_p !== undefined) requestBody.top_p = options.top_p;
  if (options?.max_tokens !== undefined) requestBody.max_tokens = options.max_tokens;
  if (options?.frequency_penalty !== undefined) requestBody.frequency_penalty = options.frequency_penalty;
  if (options?.presence_penalty !== undefined) requestBody.presence_penalty = options.presence_penalty;
  const bodyStr = JSON.stringify(requestBody);
  logger.info(`[openrouter] Sending: model=${model}, temp=${requestBody.temperature ?? 'default'}, top_p=${requestBody.top_p ?? 'default'}, max_tokens=${requestBody.max_tokens ?? 'default'}, bodyLen=${bodyStr.length}, userMsgLen=${messages[messages.length - 1]?.content?.length || 0}`);

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });

    if (!resp.ok) {
      // eslint-disable-next-line aimeat/no-silent-catch -- the body is read only to enrich an error message that is already being reported; an unreadable body is honestly reported as empty
      const body = await resp.text().catch(() => '');
      const err = new Error(`OpenRouter ${resp.status}: ${body}`) as Error & { status: number };
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      model?: string;
      error?: { message?: string; code?: number };
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
    };

    logger.info(`[openrouter] Response: status=${resp.status}, model=${data.model}, choices=${data.choices?.length || 0}, finish=${data.choices?.[0]?.finish_reason}, promptTokens=${data.usage?.prompt_tokens}, completionTokens=${data.usage?.completion_tokens}, hasError=${!!data.error}`);

    // Check for error in response body (OpenRouter sometimes returns 200 with error)
    if (data.error) {
      // Log the full error so we can diagnose model-specific issues (Owl Alpha
      // and friends sometimes reject params silently with 200 + error body).
      logger.warn(`[openrouter] error body: ${JSON.stringify(data.error).slice(0, 500)}`);
      const errMsg = data.error.message || JSON.stringify(data.error);
      const err = new Error(`OpenRouter error: ${errMsg}`) as Error & { status: number };
      err.status = data.error.code || 502;
      throw err;
    }

    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) {
      console.warn(`[openrouter] EMPTY CONTENT: model=${model}, finish_reason=${data.choices?.[0]?.finish_reason}, raw=${JSON.stringify(data).slice(0, 500)}`);
    }
    const usage = data.usage ? {
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      total_tokens: data.usage.total_tokens,
      cost_usd: typeof data.usage.cost === 'number' ? data.usage.cost : undefined,
    } : undefined;
    return { content, model: data.model ?? model, usage };
  } finally {
    clearTimeout(timeout);
  }
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
export async function transcribe(
  apiKey: string | undefined,
  model: string,
  audio: TranscriptionAudio,
  baseUrl: string = OPENROUTER_BASE,
  opts?: { language?: string; temperature?: number; verbose?: boolean },
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
    const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: providerHeaders(apiKey, baseUrl),
      body: form,
      signal: controller.signal,
    });

    if (!resp.ok) {
      // eslint-disable-next-line aimeat/no-silent-catch -- the body only enriches an error already being reported; an unreadable body is honestly reported as empty
      const body = await resp.text().catch(() => '');
      const err = new Error(`OpenRouter ${resp.status}: ${body}`) as Error & { status: number };
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json() as {
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
  const resp = await fetch(`${baseUrl}/models${qs}`, { headers });

  if (!resp.ok) {
    const err = new Error(`OpenRouter ${resp.status}`) as Error & { status: number };
    err.status = resp.status;
    throw err;
  }

  type RawModel = OpenRouterModel & {
    owned_by?: string;
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  };
  const data = await resp.json() as { data?: RawModel[] };
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
