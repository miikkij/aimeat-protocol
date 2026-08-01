/**
 * @file openrouter.ts
 * @description Provider-agnostic AI client for OpenAI-compatible APIs (OpenRouter, LM Studio, etc.).
 * @structure
 *   - complete(apiKey, model, prompt, systemPrompt?, baseUrl?) — call chat completions
 *   - listModels(apiKey, baseUrl?) — fetch available models
 * @version-history
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
  pricing?: { prompt: string; completion: string };
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

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  // Only add OpenRouter-specific headers when using OpenRouter
  if (baseUrl === OPENROUTER_BASE) {
    headers['HTTP-Referer'] = 'https://aimeat.io';
    headers['X-Title'] = 'AIMEAT Generator';
  }

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
 * Fetch available models from an OpenAI-compatible API.
 */
export async function listModels(
  apiKey: string | undefined,
  baseUrl: string = OPENROUTER_BASE,
): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = {};
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const resp = await fetch(`${baseUrl}/models`, { headers });

  if (!resp.ok) {
    const err = new Error(`OpenRouter ${resp.status}`) as Error & { status: number };
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json() as { data?: Array<OpenRouterModel & { owned_by?: string }> };
  return (data.data ?? [])
    .filter((m): m is OpenRouterModel & { owned_by?: string } => !!m && typeof m.id === 'string')
    .map(m => ({
      id: m.id,
      // OpenRouter returns a human `name`; OpenAI-compatible providers (NVIDIA NIM,
      // LM Studio, OpenAI, …) return only `id`. Fall back to the id so the option
      // label — and the sort below — never dereference `undefined`.
      name: m.name || m.id,
      description: m.description || m.owned_by,
      context_length: m.context_length,
      pricing: m.pricing,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
