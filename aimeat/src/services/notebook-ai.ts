/**
 * @file notebook-ai.ts
 * @description Shared owner-model plumbing for the notebook AI features (classify, plan). Resolves the
 *   caller's own OpenRouter key + model from their per-owner settings (the same `openrouter.apikey` /
 *   `openrouter.settings` memory the /v1/openrouter routes use), decrypts the key server-side, and
 *   wraps the provider call so transient provider failures map to stable error codes. Extracted from
 *   notebook-classify.ts so the classifier and the planner never drift on key handling.
 * @structure
 *   - NotebookAiError — stable code + HTTP status for the route envelope
 *   - resolveOwnerModel() — { apiKey, model, baseUrl } from owner settings (throws on missing key)
 *   - completeOwner() — call the provider, mapping 401/429/other to NotebookAiError codes
 * @usage const { apiKey, model, baseUrl } = await resolveOwnerModel(storage, config, gaii);
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial: extracted shared key/model resolution + completion wrapper.
 *   v1.1.0 — 2026-07-01 — Vendor-neutral default: replace the hardcoded anthropic/claude-sonnet-4
 *     fallback with OpenRouter's free-models router 'openrouter/free'.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { complete, type CompletionOptions, type OpenRouterCompletionResult } from './openrouter.js';
import { decrypt, getEncryptionKey } from './encryption.js';

/** Raised with a stable `code` so routes can map it to the right HTTP status + envelope. */
export class NotebookAiError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export interface OwnerModel {
  /** Decrypted provider key, or undefined for keyless local providers (e.g. LM Studio). */
  apiKey: string | undefined;
  model: string;
  baseUrl: string;
}

/** Resolve the caller's own OpenRouter (or OpenAI-compatible) key + model from their settings.
 *  Throws NotebookAiError('NO_OPENROUTER_KEY') when an OpenRouter provider has no key configured. */
export async function resolveOwnerModel(
  storage: Storage,
  config: AimeatConfig,
  gaii: string,
): Promise<OwnerModel> {
  const [apiKeyRecord, prefsRecord] = await Promise.all([
    storage.getMemory(gaii, 'openrouter.apikey'),
    storage.getMemory(gaii, 'openrouter.settings'),
  ]);
  const prefs = (prefsRecord?.value as Record<string, unknown>) ?? {};
  const provider = (prefs.provider as string) || 'openrouter';
  const baseUrl = (prefs.baseUrl as string) || 'https://openrouter.ai/api/v1';
  const encrypted = (apiKeyRecord?.value as { encrypted?: string })?.encrypted;
  let apiKey: string | undefined;
  if (encrypted) {
    const encKey = getEncryptionKey(config);
    if (!encKey) throw new NotebookAiError('ENCRYPTION_NOT_CONFIGURED', 'Encryption key not configured on this node.', 503);
    apiKey = decrypt(encrypted, encKey);
  } else if (provider === 'openrouter') {
    throw new NotebookAiError('NO_OPENROUTER_KEY', 'No OpenRouter API key configured. Add one in the OpenRouter settings to use AI sorting.', 400);
  }
  const model = (prefs.model as string) || (prefs.reasoningModel as string) || (prefs.executionModel as string) || 'openrouter/free';
  return { apiKey, model, baseUrl };
}

/** Call the provider, mapping provider failures to NotebookAiError codes the routes understand. */
export async function completeOwner(
  owner: OwnerModel,
  prompt: string,
  systemPrompt: string,
  options?: CompletionOptions,
): Promise<OpenRouterCompletionResult> {
  try {
    return await complete(owner.apiKey, owner.model, prompt, systemPrompt, owner.baseUrl, options);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new NotebookAiError('INVALID_API_KEY', 'OpenRouter rejected the API key.', 401);
    if (status === 429) throw new NotebookAiError('RATE_LIMITED', 'OpenRouter rate limit hit. Try again shortly.', 429);
    throw new NotebookAiError('OPENROUTER_ERROR', (e as Error).message, 502);
  }
}
