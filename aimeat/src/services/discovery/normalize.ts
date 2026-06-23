/**
 * @file normalize.ts
 * @description Pure normalization helpers that collapse each domain's divergent fields into the
 *   canonical `DiscoveryEntry` vocabulary (design §5): visibility enums → one ladder, `tags[]` /
 *   `interests[]` → one deduped tag list, and any bare-name / GHII / GAII owner → a full
 *   `owner@node-id` GHII. No storage access, no side effects — trivially unit-testable.
 * @structure
 *   - normalizeVisibility() / parkedToVisibility() / listedToVisibility() — visibility mapping
 *   - normalizeTags() — merge + clean tags and interests
 *   - toFullOwner() — any identity form → owner@node-id
 *   - bestDescription() / bestTitle() — schema-agnostic text extraction
 * @usage
 *   import { normalizeVisibility, normalizeTags, toFullOwner } from '../discovery/normalize.js';
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 0: initial mapping tables (design doc 2026-06-23).
 */
import { parseGaiiLoose } from '../../utils/gaii.js';
import type { CanonicalVisibility } from './types.js';

/** Map any domain's native visibility string to the canonical ladder. Unknown → 'private' (safe). */
export function normalizeVisibility(raw: string | null | undefined): CanonicalVisibility {
  switch ((raw ?? '').toLowerCase()) {
    case 'public':
      return 'public';
    case 'unlisted':
    case 'listed': // organism "listed" = discoverable-but-not-promoted
      return 'unlisted';
    case 'group':
    case 'shared':
      return 'shared';
    case 'owner':
      return 'owner';
    case 'private':
      return 'private';
    default:
      return 'private';
  }
}

/** App visibility derives from the `parked` flag (parked = hidden from catalogue). */
export function parkedToVisibility(parked: boolean | undefined): CanonicalVisibility {
  return parked ? 'owner' : 'public';
}

/** Company visibility derives from the `listed` flag (listed=false → off the public directory). */
export function listedToVisibility(listed: boolean | undefined): CanonicalVisibility {
  return listed === false ? 'owner' : 'public';
}

/** Merge native `tags[]` and `interests[]` into one trimmed, de-duplicated, order-preserving list. */
export function normalizeTags(rec: { tags?: unknown; interests?: unknown } | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const field of [rec?.tags, rec?.interests]) {
    if (!Array.isArray(field)) continue;
    for (const t of field) {
      if (typeof t !== 'string') continue;
      const v = t.trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/**
 * Coerce any identity form to a full owner GHII `owner@node-id`:
 *   - bare name "alice"            → "alice@<nodeId>"
 *   - GHII   "alice@node"          → "alice@node"
 *   - GAII   "claude#alice@node"   → "alice@node" (agent part dropped)
 * Falls back to `<idOrName>@<nodeId>` if the string can't be parsed.
 */
export function toFullOwner(idOrName: string, nodeId: string): string {
  if (!idOrName) return `@${nodeId}`;
  if (idOrName.includes('@')) {
    const { owner, node } = parseGaiiLoose(idOrName);
    if (owner) return `${owner}@${node || nodeId}`;
  }
  return `${idOrName}@${nodeId}`;
}

/** Schema-agnostic title: first non-empty of common title-ish fields, else the fallback. */
export function bestTitle(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const k of ['title', 'name', 'displayName', 'label', 'heading']) {
      const s = v[k];
      if (typeof s === 'string' && s.trim()) return s.trim();
    }
  }
  return fallback;
}

/** Schema-agnostic description: first non-empty of common description-ish fields, else ''. */
export function bestDescription(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const k of ['description', 'summary', 'ask', 'desc', 'body', 'text']) {
      const s = v[k];
      if (typeof s === 'string' && s.trim()) return s.trim();
    }
  }
  return '';
}
