/**
 * @file sdk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds an AI SDK model instance for one call, from a resolved target. A new provider
 *   instance per call is the point: the key belongs to the person paying for THIS call, and an
 *   instance held across calls would hold someone's key. The factories are light (an object and a
 *   few closures), and every one of them is handed `aiFetch()`, so nothing built here can reach the
 *   network except through safeFetch.
 *
 *   EVERY FACTORY GETS THE KEY AND THE ADDRESS EXPLICITLY. Without them each package reads the
 *   process environment (measured on the installed versions, 2026-09-28: OPENROUTER_API_KEY,
 *   OPENAI_API_KEY and OPENAI_BASE_URL, ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL, XAI_API_KEY,
 *   MISTRAL_API_KEY), which would put an operator's own key on an owner's call. A fixed type is
 *   never built without a key: requireKey() refuses rather than letting the package fall back.
 * @structure
 *   - languageModel() — a LanguageModelV4 for every type
 *   - sdkImageModel() — an ImageModelV4 for openai and xai
 *   - sdkTranscriptionModel() — a TranscriptionModelV4 for openai, xai and mistral
 *   - embeddingModel() — an EmbeddingModelV4 for openrouter, openai, mistral, local and openai-compatible
 *   - OPENROUTER_ATTRIBUTION — the two headers OpenRouter's own address receives
 *   - COMPATIBLE_OPTIONS_KEY — where extra body fields for an OpenAI-compatible provider are filed
 * @version-history
 *   v1.2.0 — 2026-09-28 — embeddingModel() (System 2 plan, V5).
 *   v1.1.0 — 2026-09-28 — The direct providers (System 2 plan, V3): openai, anthropic, xai and mistral,
 *     each with an explicit key and address; a target's allowOrigins reaches aiFetch.
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan).
 */
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createXai } from '@ai-sdk/xai';
import { createMistral } from '@ai-sdk/mistral';
import type { EmbeddingModelV4, ImageModelV4, LanguageModelV4, TranscriptionModelV4 } from '@ai-sdk/provider';
import { FIXED_BASE_URLS, type AiTarget } from '../types.js';
import { aiFetch } from '../fetch.js';

/** The headers OpenRouter's dashboard uses to attribute traffic, as the node has always sent them. */
const OPENROUTER_ATTRIBUTION = { 'HTTP-Referer': 'https://aimeat.io', 'X-Title': 'AIMEAT' };

/**
 * The name the OpenAI-compatible factory files provider options under. A caller's
 * `providerOptions[COMPATIBLE_OPTIONS_KEY]` keys that the package does not know itself are sent in
 * the request body as they are, which is how OpenRouter's `reasoning` parameter reaches a custom
 * provider exactly as the transport sent it before.
 */
export const COMPATIBLE_OPTIONS_KEY = 'compatible';

/** The transport for this target: safeFetch, with the operator's listed origin when there is one. */
function fetchOf(target: AiTarget): typeof fetch {
  return aiFetch(target.allowOrigins?.length ? { allowOrigins: target.allowOrigins } : {});
}

/** A fixed type's call needs a key; without one its package would read the process environment. */
function requireKey(target: AiTarget): string {
  if (!target.key) throw Object.assign(new Error(`A ${target.type} call needs a key.`), { status: 400 });
  return target.key;
}

/** A language model for this target. */
export function languageModel(target: AiTarget, modelId: string): LanguageModelV4 {
  const common = { baseURL: target.baseUrl, fetch: fetchOf(target) };
  switch (target.type) {
    case 'openrouter':
      return createOpenRouter({
        apiKey: requireKey(target), ...common,
        // The attribution headers go to OpenRouter's own address and nowhere else, as before.
        headers: target.baseUrl === FIXED_BASE_URLS.openrouter ? OPENROUTER_ATTRIBUTION : {},
      }).chat(modelId) as LanguageModelV4;
    // Chat Completions, the protocol every other OpenAI-dialect provider here speaks as well.
    case 'openai': return createOpenAI({ apiKey: requireKey(target), ...common }).chat(modelId);
    case 'anthropic': return createAnthropic({ apiKey: requireKey(target), ...common }).languageModel(modelId);
    case 'xai': return createXai({ apiKey: requireKey(target), ...common }).languageModel(modelId);
    case 'mistral': return createMistral({ apiKey: requireKey(target), ...common }).chat(modelId);
    case 'local':
    case 'openai-compatible':
      return createOpenAICompatible({
        name: COMPATIBLE_OPTIONS_KEY, ...common,
        // A self-hosted server legitimately has no key; the factory then sends no Authorization at all.
        ...(target.key ? { apiKey: target.key } : {}),
      }).chatModel(modelId) as LanguageModelV4;
    case 'extension':
      // An extension has no package: adapters/extension.ts builds its model (adapterFor('extension')).
      throw Object.assign(new Error('An extension provider has no AI SDK package; use adapters/extension.ts.'), { status: 500 });
  }
}

/** An image model from a direct provider's own package. */
export function sdkImageModel(target: AiTarget, modelId: string): ImageModelV4 {
  const common = { apiKey: requireKey(target), baseURL: target.baseUrl, fetch: fetchOf(target) };
  if (target.type === 'openai') return createOpenAI(common).image(modelId);
  if (target.type === 'xai') return createXai(common).image(modelId);
  throw Object.assign(new Error(`A ${target.type} provider does not make images here.`), { status: 400 });
}

/** An embedding model for this target. Anthropic and xAI make none. */
export function embeddingModel(target: AiTarget, modelId: string): EmbeddingModelV4 {
  const common = { baseURL: target.baseUrl, fetch: fetchOf(target) };
  switch (target.type) {
    case 'openrouter':
      return createOpenRouter({
        apiKey: requireKey(target), ...common,
        headers: target.baseUrl === FIXED_BASE_URLS.openrouter ? OPENROUTER_ATTRIBUTION : {},
      }).textEmbeddingModel(modelId) as EmbeddingModelV4;
    case 'openai': return createOpenAI({ apiKey: requireKey(target), ...common }).embedding(modelId);
    case 'mistral': return createMistral({ apiKey: requireKey(target), ...common }).embedding(modelId);
    case 'local':
    case 'openai-compatible':
      return createOpenAICompatible({
        name: COMPATIBLE_OPTIONS_KEY, ...common,
        ...(target.key ? { apiKey: target.key } : {}),
      }).embeddingModel(modelId);
    default:
      throw Object.assign(new Error(`A ${target.type} provider does not make embeddings.`), { status: 400 });
  }
}

/** A transcription model from a direct provider's own package. xAI has one model and takes no id. */
export function sdkTranscriptionModel(target: AiTarget, modelId: string): TranscriptionModelV4 {
  const common = { apiKey: requireKey(target), baseURL: target.baseUrl, fetch: fetchOf(target) };
  if (target.type === 'openai') return createOpenAI(common).transcription(modelId);
  if (target.type === 'mistral') return createMistral(common).transcription(modelId);
  if (target.type === 'xai') return createXai(common).transcription();
  throw Object.assign(new Error(`A ${target.type} provider does not transcribe here.`), { status: 400 });
}
