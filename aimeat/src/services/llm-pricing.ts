/**
 * @file llm-pricing.ts
 * @description Versioned LLM price table for the usage ledger (LEDGER / TARGET-016).
 *   Turns (model, provider, tokens) into a USD cost locked at record time, stamped with
 *   a price_ref so historical events are never recomputed when prices change.
 *
 *   Precedence: local provider → $0; else an authoritative provider-reported cost (e.g.
 *   OpenRouter's usage.cost) → used as-is; else this table; else NULL (unpriced — a
 *   missing price stays visible and is never guessed, per the LEDGER spec).
 *
 *   This is a small v1 seed. The authoritative source is POI_003 (LLM_MODELS_PRICING) in
 *   the MACHINE ROOM organism; a periodic sync into this table (bumping PRICE_REF) is a
 *   TARGET-016 follow-up. Until then, provider-reported cost (OpenRouter) is exact and
 *   direct-provider calls for listed models use these seeded rates.
 * @structure
 *   - PRICE_REF            -- version tag stamped onto table-priced events
 *   - priceUsd(input)      -- { costUsd, priceRef } for one call
 * @version-history
 *   v1.0.0 -- 2026-07-10 -- Initial seed table for LEDGER TARGET-016
 */

/** Bump when the seeded rates below change, so historical price_refs stay meaningful. */
export const PRICE_REF = 'poi003@2026-07-10';

interface Rate {
  /** Lowercased substrings; a model matches if it contains ANY of these. */
  match: string[];
  /** USD per 1M prompt tokens. */
  promptPerM: number;
  /** USD per 1M completion tokens. */
  completionPerM: number;
}

/**
 * Seed rates (USD per 1M tokens). Ordered most-specific first — first match wins, so
 * e.g. "haiku" is checked before the generic "claude" family would be. Keep the list
 * small and specific; unknown models fall through to unpriced (null), never guessed.
 */
const RATES: Rate[] = [
  { match: ['claude-opus', 'opus-4', 'opus4'], promptPerM: 15, completionPerM: 75 },
  { match: ['claude-haiku', 'haiku-4', 'haiku4'], promptPerM: 1, completionPerM: 5 },
  { match: ['claude-sonnet', 'sonnet-4', 'sonnet4', 'sonnet-5', 'sonnet5'], promptPerM: 3, completionPerM: 15 },
  { match: ['gpt-4o-mini', '4o-mini'], promptPerM: 0.15, completionPerM: 0.6 },
  { match: ['gpt-4o', 'gpt4o'], promptPerM: 2.5, completionPerM: 10 },
  { match: ['gpt-4.1-mini', '4.1-mini'], promptPerM: 0.4, completionPerM: 1.6 },
  { match: ['gpt-4.1'], promptPerM: 2, completionPerM: 8 },
  { match: ['o3-mini'], promptPerM: 1.1, completionPerM: 4.4 },
  { match: ['gemini-2.5-pro', 'gemini-1.5-pro'], promptPerM: 1.25, completionPerM: 10 },
  { match: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'], promptPerM: 0.15, completionPerM: 0.6 },
  { match: ['llama-3.1-70b', 'llama-3.3-70b'], promptPerM: 0.35, completionPerM: 0.4 },
];

export interface PriceInput {
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  /** Authoritative cost reported by the provider (e.g. OpenRouter usage.cost), if any. */
  providerCostUsd?: number | null;
}

export interface PriceResult {
  /** null = unpriced (no rate, no provider cost) — never coerced to 0. */
  costUsd: number | null;
  priceRef: string | null;
}

/** Round to 6 decimal places (sub-cent LLM costs) to avoid float noise in aggregates. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Price one LLM call. See file header for precedence. A provider-reported cost always
 * wins over the table (it reflects the actual charge, incl. discounts/routing).
 */
export function priceUsd(input: PriceInput): PriceResult {
  if (input.provider === 'local') {
    return { costUsd: 0, priceRef: 'local' };
  }

  const reported = input.providerCostUsd;
  if (typeof reported === 'number' && isFinite(reported) && reported >= 0) {
    return { costUsd: round6(reported), priceRef: `provider:${input.provider}` };
  }

  const model = (input.model || '').toLowerCase();
  const rate = RATES.find(r => r.match.some(m => model.includes(m)));
  if (rate) {
    const cost = (input.promptTokens / 1e6) * rate.promptPerM
      + (input.completionTokens / 1e6) * rate.completionPerM;
    return { costUsd: round6(cost), priceRef: PRICE_REF };
  }

  return { costUsd: null, priceRef: null };
}
