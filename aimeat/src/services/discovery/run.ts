/**
 * @file run.ts
 * @description The discovery orchestrator — the domain-agnostic core of `/v1/discover`. It iterates a
 *   `DiscoveryRegistry`, fans `enumerate()` across every registered source, maps rows to
 *   `DiscoveryEntry` via each source's `toEntry()`, applies the gating pass (§6 — Phase 1 covers
 *   scope=own/public; cross-member `workspace`/`consent` gating arrives in Phase 3), then filters,
 *   ranks and returns the unified set. Contains NO domain-specific logic — that all lives in adapters.
 * @structure
 *   - runDiscovery() — registry + context → ranked DiscoveryEntry[]
 *   - rankEntries() — relevance (score) then recency
 * @usage const entries = await runDiscovery(registry, ctx);
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 1: fan-out + filter + rank (design doc 2026-06-23). Phase-3 gating TODO.
 */
import type { DiscoveryContext, DiscoveryEntry } from './types.js';
import type { DiscoveryRegistry } from './registry.js';
import { applyFilters } from './facets.js';

/** Rank by relevance (FTS score desc) then recency (updatedAt desc). */
function rankEntries(entries: DiscoveryEntry[]): DiscoveryEntry[] {
  return entries.sort((a, b) => b.score - a.score || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/**
 * Fan across all registered sources and return the gated, filtered, ranked entry set.
 * Phase 1: gating is satisfied at the source (own = caller-owned; public = visibility-filtered).
 * Phase 3 will insert a per-hit `canReadWorkspace`/consent pass here for scope=shared.
 */
export async function runDiscovery(
  registry: DiscoveryRegistry,
  ctx: DiscoveryContext,
): Promise<DiscoveryEntry[]> {
  const sources = registry.all();
  const perSource = await Promise.all(
    sources.map(async src => {
      const raws = await src.enumerate(ctx);
      return raws.map(raw => src.toEntry(raw, ctx));
    }),
  );
  const all = perSource.flat();
  return rankEntries(applyFilters(all, ctx.filters));
}
