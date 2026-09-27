/**
 * @file types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shared vocabulary of the System 2 AI layer: what a call does (the operation),
 *   what a person asks for (the capability), which kind of provider answers it, and where a call is
 *   sent. A leaf module: every other file under services/ai/ imports from here and it imports nothing
 *   from the node.
 * @structure
 *   - AiOp — what the gateway does for one call
 *   - AiCapability — what a caller asks for (docs/internal/llmproviderintegrations/11, section 3)
 *   - AiAdapterType — which adapter builds the model for a provider
 *   - AiTarget — one resolved destination: adapter type, address and the key that pays
 *   - adapterTypeOf() — the owner's legacy provider setting mapped to an adapter type
 *   - CostSource — where the cost recorded for a call came from
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial, with the gateway (V1 of the System 2 plan).
 */

/**
 * What the gateway does for one call. `speak` and `embed` are named now so the vocabulary is
 * whole; the gateway implements `text`, `image` and `transcribe` (voice streams keep their own
 * transport, services/ai-voice.ts, because they emit audio before the provider has finished).
 */
export type AiOp = 'text' | 'image' | 'speak' | 'transcribe' | 'embed';

/** What a caller asks for. A call names at least this; provider and model only narrow it. */
export type AiCapability = 'text' | 'vision' | 'files' | 'image' | 'speech' | 'transcription' | 'embed';

/**
 * Which adapter builds the model for a provider. `local` and `openai-compatible` speak the same
 * protocol; they differ in whether data leaves the machine, which the provider records carry from
 * V3 on.
 */
export type AiAdapterType = 'openrouter' | 'local' | 'openai-compatible';

/** One resolved destination for a call. Built by prepareAiCall, never from a request body. */
export interface AiTarget {
  type: AiAdapterType;
  /** The provider's API root, e.g. https://openrouter.ai/api/v1. */
  baseUrl: string;
  /** The decrypted key that pays. Undefined only for a provider that needs none. Never logged. */
  key: string | undefined;
}

/** True when a URL names this machine, which is what `local` means. */
function isLoopback(baseUrl: string): boolean {
  if (!URL.canParse(baseUrl)) return false;
  const host = new URL(baseUrl).hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || host === '::1' || /^127\./.test(host);
}

/**
 * The owner's legacy `openrouter.settings.provider` as an adapter type. `lmstudio` is `local` only
 * when its address really is this machine; an LM Studio somewhere else on the network is an
 * OpenAI-compatible provider like any other.
 */
export function adapterTypeOf(provider: string, baseUrl: string): AiAdapterType {
  if (provider === 'openrouter') return 'openrouter';
  if (provider === 'lmstudio' && isLoopback(baseUrl)) return 'local';
  return 'openai-compatible';
}

/**
 * Where a recorded cost came from. `provider`: the provider reported the charge. `estimate`: the
 * node's fallback rate per token. `none`: nothing was known and zero was recorded, flagged as
 * inexact (an image or a transcription whose provider reported no cost; audio prices in the
 * catalogue use different units per provider, so an estimate would be confidently wrong).
 * `catalog` and `table` arrive with the model catalogue (V4).
 */
export type CostSource = 'provider' | 'catalog' | 'table' | 'estimate' | 'none';
