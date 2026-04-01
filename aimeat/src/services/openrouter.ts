/**
 * @file openrouter.ts
 * @description Provider-agnostic AI client for OpenAI-compatible APIs (OpenRouter, LM Studio, etc.).
 * @structure
 *   - complete(apiKey, model, prompt, systemPrompt?, baseUrl?) — call chat completions
 *   - listModels(apiKey, baseUrl?) — fetch available models
 * @version-history
 *   v1.0.0 — 2026-03-20 — Initial implementation
 *   v1.1.0 — 2026-03-21 — Made provider-agnostic with baseUrl parameter; apiKey optional
 */
import { logger } from '../utils/logger.js';

export interface OpenRouterCompletionResult {
  content: string;
  model: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
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

export async function complete(
  apiKey: string | undefined,
  model: string,
  prompt: string,
  systemPrompt?: string,
  baseUrl: string = OPENROUTER_BASE,
  options?: CompletionOptions,
): Promise<OpenRouterCompletionResult> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

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
      const body = await resp.text().catch(() => '');
      const err = new Error(`OpenRouter ${resp.status}: ${body}`) as Error & { status: number };
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      model?: string;
      error?: { message?: string; code?: number };
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    logger.info(`[openrouter] Response: status=${resp.status}, model=${data.model}, choices=${data.choices?.length || 0}, finish=${data.choices?.[0]?.finish_reason}, promptTokens=${data.usage?.prompt_tokens}, completionTokens=${data.usage?.completion_tokens}, hasError=${!!data.error}`);

    // Check for error in response body (OpenRouter sometimes returns 200 with error)
    if (data.error) {
      const err = new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error)}`) as Error & { status: number };
      err.status = data.error.code || 502;
      throw err;
    }

    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) {
      console.warn(`[openrouter] EMPTY CONTENT: model=${model}, finish_reason=${data.choices?.[0]?.finish_reason}, raw=${JSON.stringify(data).slice(0, 500)}`);
    }
    return { content, model: data.model ?? model };
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

  const data = await resp.json() as { data?: OpenRouterModel[] };
  return (data.data ?? []).map(m => ({
    id: m.id,
    name: m.name,
    description: m.description,
    context_length: m.context_length,
    pricing: m.pricing,
  })).sort((a, b) => a.name.localeCompare(b.name));
}
