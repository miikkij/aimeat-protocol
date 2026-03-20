/**
 * @file openrouter.ts
 * @description OpenRouter API client for making AI completions and listing models.
 * @structure
 *   - complete(apiKey, model, prompt, systemPrompt?) — call OpenRouter chat completions
 *   - listModels(apiKey) — fetch available models
 * @version-history
 *   v1.0.0 — 2026-03-20 — Initial implementation
 */

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
const TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Call OpenRouter chat completions API.
 */
export async function complete(
  apiKey: string,
  model: string,
  prompt: string,
  systemPrompt?: string,
): Promise<OpenRouterCompletionResult> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aimeat.io',
        'X-Title': 'AIMEAT Generator',
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err = new Error(`OpenRouter ${resp.status}: ${body}`) as Error & { status: number };
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content ?? '';
    return { content, model: data.model ?? model };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch available models from OpenRouter.
 */
export async function listModels(apiKey: string): Promise<OpenRouterModel[]> {
  const resp = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

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
  }));
}
