/**
 * @file classify.ts
 * @description The classifier — the "different perspectives" engine (design §4.2). Maps a memory key
 *   pattern (and, as a fallback, a `kind:` tag convention) to a `DiscoveryType` + `segment`. This is
 *   the single place new memory-keyed content types are taught to the directory: add a pattern here
 *   and the FTS adapter surfaces them automatically (design §7.2, path 1). Pure functions only.
 * @structure
 *   - classifyMemoryKey() — key pattern → { type, segment }
 *   - kindTagType() — `kind:` tag → DiscoveryType | null (research/material taxonomy, §11.1)
 *   - key matchers (ORG / PKG / WF / ORG_META / ORG_OFFERS / AGENT_OFFERS)
 * @usage
 *   const { type, segment } = classifyMemoryKey(key, { tags, contentType });
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 0: key-pattern + kind-tag classifier (design doc 2026-06-23).
 */
import type { DiscoveryType } from './types.js';

const ORG_KEY = /^organism\.([^.]+)\.w\.([^.]+)\.([^.]+)/; // organism.{id}.w.{ws}.{space}…
const PKG_KEY = /^packages\/([^/]+)\//; // packages/{id}/…
const WF_KEY = /^workflows\.def\.([^.]+)/; // workflows.def.{id}
const ORG_META = /^org\.([^.]+)\.meta$/; // org.{slug}.meta
const ORG_OFFERS = /^org\.([^.]+)\.offerings$/; // org.{slug}.offerings
const AGENT_OFFERS = /^agents\.([^.]+)\.offers$/; // agents.{name}.offers

export interface ClassifyHints {
  /** Native tags on the record (used for the `kind:` fallback). */
  tags?: string[];
  /** Knowledge manifest content_type, when the caller already has it. */
  contentType?: string;
}

/**
 * Map a `kind:` tag to a type. Only the free-text taxonomy is tag-driven (research/material);
 * everything else is key-pattern classified. Returns null when no recognized `kind:` tag is present.
 */
export function kindTagType(tags: string[] | undefined): DiscoveryType | null {
  if (!tags) return null;
  for (const t of tags) {
    if (typeof t !== 'string' || !t.toLowerCase().startsWith('kind:')) continue;
    const suffix = t.slice(t.indexOf(':') + 1).trim().toLowerCase();
    switch (suffix) {
      case 'research':
        return 'research';
      case 'material':
      case 'deliverable':
      case 'output':
        return 'material';
      default:
        return null;
    }
  }
  return null;
}

/**
 * Classify a memory record by its key (and tags as a fallback) into a type + segment.
 * Key patterns win; unrecognized keys fall back to the `kind:` tag, then to plain `memory`.
 */
export function classifyMemoryKey(
  key: string,
  hints: ClassifyHints = {},
): { type: DiscoveryType; segment: string | null } {
  let m: RegExpMatchArray | null;

  if (PKG_KEY.test(key)) {
    return { type: 'knowledge', segment: hints.contentType ?? null };
  }

  if ((m = key.match(ORG_KEY))) {
    const workspace = m[2];
    const space = m[3];
    if (space === 'decision') return { type: 'decision', segment: workspace };
    return { type: 'document', segment: space };
  }

  if (WF_KEY.test(key)) {
    return { type: 'workflow', segment: null };
  }

  if (ORG_META.test(key)) {
    return { type: 'company', segment: null };
  }

  if (ORG_OFFERS.test(key) || AGENT_OFFERS.test(key)) {
    return { type: 'offering', segment: null };
  }

  const kind = kindTagType(hints.tags);
  if (kind) return { type: kind, segment: null };

  return { type: 'memory', segment: null };
}
