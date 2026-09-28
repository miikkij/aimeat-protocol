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
 *   v1.1.1 — 2026-09-28 — CostSource comment: `catalog` and `table` are in use (V4).
 *   v1.1.0 — 2026-09-28 — The provider types of V3 (openai, anthropic, mistral, xai), their fixed
 *     addresses, and `allowOrigins` on a target.
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
 * Which adapter builds the model for a provider, which is the provider's type. `local` and
 * `openai-compatible` speak the same protocol; they differ in whether data leaves the machine. The
 * five fixed types are reached only at their official address (FIXED_BASE_URLS), which is what makes
 * the type's name true: "anthropic" means Anthropic. `extension` arrives in V6.
 */
export type AiAdapterType = 'openrouter' | 'openai' | 'anthropic' | 'mistral' | 'xai' | 'local' | 'openai-compatible';

/** The types whose address is fixed, and the address. The values are the provider packages' own defaults. */
export const FIXED_BASE_URLS = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
} as const;
export type FixedProviderType = keyof typeof FIXED_BASE_URLS;
export const FIXED_PROVIDER_TYPES = Object.keys(FIXED_BASE_URLS) as FixedProviderType[];
export const isFixedType = (t: string): t is FixedProviderType => Object.prototype.hasOwnProperty.call(FIXED_BASE_URLS, t);

/** One resolved destination for a call. Built by prepareAiCall, never from a request body. */
export interface AiTarget {
  type: AiAdapterType;
  /** The provider's API root, e.g. https://openrouter.ai/api/v1. */
  baseUrl: string;
  /** The decrypted key that pays. Undefined only for a provider that needs none. Never logged. */
  key: string | undefined;
  /**
   * Private origins this call may reach: the operator's own local server at an origin they listed in
   * AIMEAT_AI_PROVIDER_EGRESS. Never set for an owner's provider (services/ai/providers.ts).
   */
  allowOrigins?: readonly string[];
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
 * `catalog`: the model catalogue's price, cited by its snapshot. `table`: the node's old price table.
 */
export type CostSource = 'provider' | 'catalog' | 'table' | 'estimate' | 'none';
