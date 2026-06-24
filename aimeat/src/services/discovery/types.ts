/**
 * @file types.ts
 * @description Core types for the unified cross-domain "master directory" discovery system.
 *   Defines the normalized `DiscoveryEntry` shape every domain maps into, the `DiscoverySource`
 *   adapter interface (the extension seam — adding a content type = registering one adapter), the
 *   per-call `DiscoveryContext`, query `DiscoveryFilters`, and the canonical type/visibility/gating
 *   enums. Pure types + enums only — no runtime logic, no storage access.
 * @structure
 *   - DiscoveryType / CanonicalVisibility / GatingKind — the controlled vocabularies
 *   - DiscoveryEntry — the one shape callers see
 *   - DiscoveryFilters / DiscoveryContext — query inputs
 *   - RawHit / DiscoverySource — the adapter contract (§7 of the design doc)
 * @usage
 *   import type { DiscoverySource, DiscoveryEntry } from '../discovery/types.js';
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 0: initial contract (design doc 2026-06-23-master-directory-discovery).
 */

/** The taxonomy an LLM filters on. Extend here + add an llms.txt word when a new kind ships (§7.3). */
export type DiscoveryType =
  | 'capability'
  | 'workflow'
  | 'knowledge'
  | 'decision'
  | 'research'
  | 'material'
  | 'company'
  | 'offering'
  | 'document'
  | 'organism'
  | 'app'
  | 'template'
  | 'memory';

/** Canonical visibility ladder; every domain's native enum collapses into this (design §5). */
export type CanonicalVisibility = 'private' | 'owner' | 'shared' | 'unlisted' | 'public';

/** How a hit from a source must be access-checked before it can enter a result (design §6). */
export type GatingKind = 'none' | 'visibility' | 'workspace' | 'consent';

/** The single normalized shape returned by `/v1/discover` regardless of source domain. */
export interface DiscoveryEntry {
  type: DiscoveryType;
  /** Coarse area within the type (e.g. knowledge content_type, app category); null when none. */
  segment: string | null;
  /** Stable id within the type. */
  id: string;
  title: string;
  /** Best-available human text: description | summary | ask | snippet. */
  description: string;
  /** Normalized, deduped tags (sourced from native `tags[]` / `interests[]`). */
  tags: string[];
  visibility: CanonicalVisibility;
  /** Always a full GHII `owner@node-id` (never a bare name). */
  owner: string;
  /** Origin node id (self in v1; federation later). */
  node: string;
  /** FTS rank for memory hits; recency-derived or 0 for table hits. */
  score: number;
  updatedAt: string;
  /** Canonical fetch URL for the full record. */
  href: string;
  /** Set when an entry was deduped from another representation (e.g. a company-listed offer that
   *  originates from a specific agent). Names the underlying producer. */
  provenance?: string;
}

/** Filters parsed from the query string; all optional. */
export interface DiscoveryFilters {
  q?: string;
  types?: DiscoveryType[];
  segments?: string[];
  /** ALL-match: an entry must carry every listed tag. */
  tags?: string[];
  owner?: string;
  limit?: number;
}

/** Resolved caller identity + scope for one discovery call. */
export interface DiscoveryContext {
  caller: {
    /** Bare owner name. */
    ownerName: string;
    /** Raw auth subject (`req.auth.sub`) — bare owner for owner sessions, full GAII for agents.
     *  Needed by the workspace gate to match org agent membership. */
    sub: string;
    /** Full GAII (agent) or GHII (owner session) — `resolveIdentity` result. */
    gaii: string;
    isOwnerSession: boolean;
    /** Granted read-scopes — used to filter an agent's view of the owner set (design §11.3). */
    scopes: string[];
  };
  scope: 'own' | 'public' | 'shared';
  filters: DiscoveryFilters;
  nodeId: string;
}

/** A source-native candidate row, pre-normalization. `record` is the domain's own record. */
export interface RawHit {
  sourceId: string;
  record: unknown;
  /** FTS score if applicable; adapters without ranking set 0. */
  score?: number;
  /** Per-hit gating override (may be stricter than the source default). */
  gating?: GatingKind;
}

/**
 * A discovery source adapter — the extension seam. Adding a new content type to AIMEAT means
 * implementing this interface and registering it (design §7). The `/v1/discover` handler contains
 * no domain-specific logic; it iterates registered sources.
 */
export interface DiscoverySource {
  /** Stable source id, e.g. "memory-fts", "capabilities", "apps". */
  id: string;
  /** Enumerate candidate rows for this caller + scope. Cheap; gating happens later. */
  enumerate(ctx: DiscoveryContext): Promise<RawHit[]>;
  /** Map one raw row → a normalized DiscoveryEntry. */
  toEntry(raw: RawHit, ctx: DiscoveryContext): DiscoveryEntry;
  /** Default gating requirement for hits from this source. */
  gating: GatingKind;
}

/** A facet bucket for map mode (`/v1/discover/facets`). */
export interface FacetCount {
  value: string;
  count: number;
}

/** The map-mode response shape (design §4.3). */
export interface DiscoveryFacets {
  types: FacetCount[];
  segments: Array<{ type: DiscoveryType; segment: string; count: number }>;
  tags: FacetCount[];
}
