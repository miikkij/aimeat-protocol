/**
 * @file price.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one AI call cost, and what one model can do, from the model catalogue (System 2
 *   plan, V4; docs/internal/llmproviderintegrations/06, section 7). The order, strongest first:
 *   1. a local provider costs nothing;
 *   2. the charge the provider reported (OpenRouter's usage.cost) — `costSource: 'provider'`;
 *   3. the catalogue's price times the use (tokens, pictures, seconds, characters) — `'catalog'`,
 *      cited by the catalogue's snapshot id;
 *   4. the node's old price table (services/llm-pricing.ts) — `'table'`, until the catalogue has been
 *      in production for a month;
 *   5. the fallback rate — `'estimate'` for text, and `'none'` for audio and images, whose units no
 *      guess can be trusted with.
 *   Anthropic, OpenAI, xAI and Mistral report no cost in their answers, so step 3 is the only exact
 *   price a direct provider's call has.
 * @structure CallUse · CallPrice · callCost · servesCapability · textPricePerMtok
 * @version-history
 *   v1.1.0 — 2026-10-04 — `cachedPromptTokens`: the catalogue prices cached prompt tokens at its
 *     cache-read rate, not the input rate.
 *   v1.0.0 — 2026-09-28 — Initial (V4 of the System 2 plan).
 */
import { priceUsd } from '../../llm-pricing.js';
import type { AiCapability, CostSource } from '../types.js';
import { catalogModel, catalogSnapshot } from './store.js';
import type { CatalogModel } from './types.js';

/** The same fallback rates services/ai-completion.ts estimateCostUsd has always used. */
const FALLBACK_IN_PER_TOKEN = 0.000005;
const FALLBACK_OUT_PER_TOKEN = 0.000015;

export interface CallUse {
  /** The provider type, and the model the provider says answered (or the one asked for). */
  type: string;
  model: string;
  /** The model asked for, tried when the answered id is not in the catalogue. */
  requestedModel?: string;
  promptTokens?: number;
  /** How many of promptTokens the provider read from its prompt cache (prompt_tokens_details.cached_tokens). */
  cachedPromptTokens?: number;
  completionTokens?: number;
  images?: number;
  seconds?: number;
  characters?: number;
  /** The provider's own reported charge, when it gave one. */
  reported?: number;
}

export interface CallPrice { costUsd: number; costSource: CostSource; priceRef: string; exact: boolean }

const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** What the catalogue says this use cost, or undefined when it has no price for it. */
function fromCatalog(m: CatalogModel, u: CallUse): number | undefined {
  const p = m.price;
  if (u.images) return fin(p.perImage) ? p.perImage * u.images : undefined;
  if (u.seconds !== undefined) return fin(p.transcriptionPerSecond) ? p.transcriptionPerSecond * u.seconds : undefined;
  if (u.characters !== undefined) return fin(p.speechPerChar) ? p.speechPerChar * u.characters : undefined;
  if (!fin(p.inPerMtok) && !fin(p.outPerMtok)) return undefined;
  // Cached prompt tokens at the cache-read rate (a tenth of the input rate on DeepSeek), when the
  // catalogue has one; priced as input they doubled the chat's recorded spend once caching hit
  // (hosted place, 2026-10-04: 0.0464 recorded against 0.0254 charged).
  const prompt = u.promptTokens ?? 0;
  const cached = Math.min(prompt, u.cachedPromptTokens ?? 0);
  const cacheRate = fin(p.cacheReadPerMtok) ? p.cacheReadPerMtok : (p.inPerMtok ?? 0);
  return ((prompt - cached) * (p.inPerMtok ?? 0) + cached * cacheRate + (u.completionTokens ?? 0) * (p.outPerMtok ?? 0)) / 1e6;
}

export function callCost(u: CallUse): CallPrice {
  if (u.type === 'local') return { costUsd: 0, costSource: 'none', priceRef: 'local', exact: true };
  if (fin(u.reported)) return { costUsd: u.reported, costSource: 'provider', priceRef: `provider:${u.type}`, exact: true };
  const m = catalogModel(u.type, u.model) ?? (u.requestedModel ? catalogModel(u.type, u.requestedModel) : undefined);
  const snapshot = catalogSnapshot();
  if (m && snapshot) {
    const c = fromCatalog(m, u);
    if (c !== undefined) return { costUsd: c, costSource: 'catalog', priceRef: snapshot, exact: false };
  }
  const textUse = !u.images && u.seconds === undefined && u.characters === undefined;
  if (textUse) {
    const table = priceUsd({ model: u.model, provider: u.type, promptTokens: u.promptTokens ?? 0, completionTokens: u.completionTokens ?? 0 });
    if (fin(table.costUsd) && table.priceRef) return { costUsd: table.costUsd, costSource: 'table', priceRef: table.priceRef, exact: false };
    const est = (u.promptTokens ?? 0) * FALLBACK_IN_PER_TOKEN + (u.completionTokens ?? 0) * FALLBACK_OUT_PER_TOKEN;
    return { costUsd: est, costSource: 'estimate', priceRef: 'estimate', exact: false };
  }
  return { costUsd: 0, costSource: 'none', priceRef: 'none', exact: false };
}

/** Whether a catalogued model serves a capability. */
export function servesCapability(m: CatalogModel, cap: AiCapability): boolean {
  const c = m.caps;
  switch (cap) {
    case 'text': return c.textIn && c.textOut;
    case 'vision': return c.imageIn && c.textOut;
    case 'files': return c.fileIn && c.textOut;
    case 'image': return c.imageOut;
    case 'speech': return c.speech;
    case 'transcription': return c.transcription;
    case 'embed': return c.embeddings;
  }
}

/** A text model's price per million tokens, input and output together, for ordering by price. */
export function textPricePerMtok(type: string, model: string): number | undefined {
  const m = catalogModel(type, model);
  if (!m || (!fin(m.price.inPerMtok) && !fin(m.price.outPerMtok))) return undefined;
  return (m.price.inPerMtok ?? 0) + (m.price.outPerMtok ?? 0);
}
