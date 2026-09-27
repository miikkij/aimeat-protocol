/**
 * @file sdk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds an AI SDK model instance for one call, from a resolved target. A new provider
 *   instance per call is the point: the key belongs to the person paying for THIS call, and an
 *   instance held across calls would hold someone's key. The factories are light (an object and a
 *   few closures), and every one of them is handed `aiFetch()`, so nothing built here can reach the
 *   network except through safeFetch.
 * @structure
 *   - languageModel() — a LanguageModelV4 for openrouter, local and openai-compatible targets
 *   - OPENROUTER_ATTRIBUTION — the two headers OpenRouter's own address receives
 *   - COMPATIBLE_OPTIONS_KEY — where extra body fields for an OpenAI-compatible provider are filed
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan).
 */
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import type { AiTarget } from '../types.js';
import { aiFetch } from '../fetch.js';
import { DEFAULT_BASE_URLS } from '../../openrouter.js';

/** The headers OpenRouter's dashboard uses to attribute traffic, as the node has always sent them. */
const OPENROUTER_ATTRIBUTION = { 'HTTP-Referer': 'https://aimeat.io', 'X-Title': 'AIMEAT' };

/**
 * The name the OpenAI-compatible factory files provider options under. A caller's
 * `providerOptions[COMPATIBLE_OPTIONS_KEY]` keys that the package does not know itself are sent in
 * the request body as they are, which is how OpenRouter's `reasoning` parameter reaches a custom
 * provider exactly as the transport sent it before.
 */
export const COMPATIBLE_OPTIONS_KEY = 'compatible';

/** A language model for this target. Throws on a target no language adapter speaks. */
export function languageModel(target: AiTarget, modelId: string): LanguageModelV4 {
  if (target.type === 'openrouter') {
    // Without an explicit key the OpenRouter factory reads OPENROUTER_API_KEY from the process
    // environment, which would put an operator's own key on an owner's call. prepareAiCall never
    // builds an openrouter target without a key; this refuses rather than trusting that.
    if (!target.key) throw Object.assign(new Error('An OpenRouter call needs a key.'), { status: 400 });
    return createOpenRouter({
      apiKey: target.key,
      baseURL: target.baseUrl,
      // The attribution headers go to OpenRouter's own address and nowhere else, as before.
      headers: target.baseUrl === DEFAULT_BASE_URLS.openrouter ? OPENROUTER_ATTRIBUTION : {},
      fetch: aiFetch(),
    }).chat(modelId) as LanguageModelV4;
  }
  return createOpenAICompatible({
    name: COMPATIBLE_OPTIONS_KEY,
    baseURL: target.baseUrl,
    // A self-hosted server legitimately has no key; the factory then sends no Authorization at all.
    ...(target.key ? { apiKey: target.key } : {}),
    fetch: aiFetch(),
  }).chatModel(modelId) as LanguageModelV4;
}
