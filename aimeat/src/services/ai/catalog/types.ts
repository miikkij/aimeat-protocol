/**
 * @file types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of the model catalogue (System 2 plan, V4; docs/internal/
 *   llmproviderintegrations/06): one form for every provider type, answering three questions about
 *   each model: what it can do, how much it takes, and what it costs. A leaf module.
 *
 *   UNITS. Every token price is USD per million tokens, whatever the source said (models.dev gives $
 *   per M, OpenRouter and LiteLLM $ per token). Per-image, per-character and per-second prices stay
 *   per unit. An audio price whose unit the source does not state is kept in `raw` and never turned
 *   into a rate: the same whisper model is 0.0015 on one provider and 0.111 on another, in different
 *   units, with nothing in the API to say which (measured 2026-08-01).
 * @structure CatalogType · CATALOG_TYPES · ModelCaps · ModelPrice · CatalogModel · CatalogStatus ·
 *   CatalogSource · CatalogMeta · CatalogRecord
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */

/** The provider types the catalogue covers. Local servers are never in it: their models are a person's. */
export const CATALOG_TYPES = ['openrouter', 'openai', 'anthropic', 'xai', 'mistral', 'deepseek'] as const;
export type CatalogType = (typeof CATALOG_TYPES)[number];

export interface ModelCaps {
  textIn: boolean; imageIn: boolean; fileIn: boolean; audioIn: boolean; videoIn: boolean;
  textOut: boolean; imageOut: boolean; audioOut: boolean;
  tools: boolean; reasoning: boolean; structuredOutput: boolean;
  embeddings: boolean; speech: boolean; transcription: boolean;
  /** OpenRouter's supported_voices, for a speech model. */
  voices?: string[];
}

export interface ModelPrice {
  inPerMtok?: number; outPerMtok?: number;
  cacheReadPerMtok?: number; cacheWritePerMtok?: number;
  reasoningPerMtok?: number;
  /** An image as output, per picture. */
  perImage?: number;
  /** An image as output, per image token. */
  imageOutPerMtok?: number;
  audioInPerMtok?: number; audioOutPerMtok?: number;
  /** LiteLLM input_cost_per_character, for speech. */
  speechPerChar?: number;
  /** LiteLLM input_cost_per_second, for transcription. */
  transcriptionPerSecond?: number;
  /** The source's own number when its unit is not certain (an OpenRouter audio model), by field name. */
  raw?: Record<string, number>;
}

export type CatalogStatus = 'active' | 'retiring' | 'retired';
export type CatalogSource = 'models.dev' | 'openrouter' | 'litellm' | 'operator';

export interface CatalogModel {
  type: CatalogType;
  /** The id the provider itself uses: 'claude-opus-5-5', 'anthropic/claude-opus-5.5'. */
  id: string;
  name: string;
  /** models.dev family, e.g. 'claude-opus'. */
  family?: string;
  /** ISO date. */
  released?: string;
  caps: ModelCaps;
  limits: { context?: number; output?: number };
  price: ModelPrice;
  status: CatalogStatus;
  /** OpenRouter expiration_date, or a LiteLLM deprecation_date. */
  retiresAt?: string;
  sources: CatalogSource[];
  /** When a source last listed it. Kept while a model is missing, so retirement can count weeks. */
  seenAt: string;
  /** When it was first found missing from every source; cleared when it is seen again. */
  missingSince?: string;
}

/** One stored record: every model of one type. `ai.catalog.<type>` under the node's own identity. */
export interface CatalogRecord {
  type: CatalogType;
  models: CatalogModel[];
  updatedAt: string;
}

/** `ai.catalog.meta`: when each source last answered, and the snapshot id that prices cite. */
export interface CatalogMeta {
  /** The id stamped on a catalogue-priced usage row: 'catalog@<ISO time of the refresh>'. */
  snapshot: string;
  refreshedAt: string;
  /** Where the current records came from: the seed in the repo, or a refresh. */
  origin: 'seed' | 'refresh';
  sources: Partial<Record<CatalogSource, { lastOkAt?: string; lastError?: { at: string; message: string }; count?: number }>>;
  /** Bytes per stored record, so growth is visible before it meets the 1024 kB value limit. */
  sizes: Partial<Record<CatalogType, number>>;
}
