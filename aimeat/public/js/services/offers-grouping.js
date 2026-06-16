/**
 * @file offers-grouping.js
 * @description Pure, deterministic helpers for the Agent Offers "Do" surface — turning a flat offer
 *   list into something you can grasp by NEED, not by reading every row. No DOM, no i18n, no fetch:
 *   labels are resolved by the caller, so this whole module is unit-testable in isolation. It powers
 *   (1) need-verb classification (the primary group-by axis), (2) facet filtering (cost/latency/
 *   verification/dataHandling/outcome), (3) a "standing" sort that ranks by likely VALUE/dependability
 *   — NOT by run count (one agent's single scheduled deliverable can matter more than another's 100),
 *   (4) grouping by a chosen axis, and (5) a deterministic Mermaid map source. The LLM need-router
 *   (offers.js rankOffersByNeed) layers on top; this is the always-on, free, instant layer beneath it.
 * @structure
 *   - NEED_BUCKETS / NEED_DISPLAY_ORDER · classifyNeed(offer)
 *   - FACETS · offerFacetValue(offer, key) · availableFacetValues(items) · matchesFacets(offer, active)
 *   - isAuto(offer) · standingScore(offer) · sortOffers(items, mode)
 *   - groupByAxis(items, axis) -> [{ key, items }]
 *   - buildMermaid(rootLabel, groups) -> mermaid flowchart source (labels pre-resolved by caller)
 * @usage import { classifyNeed, groupByAxis, sortOffers, buildMermaid } from '/js/services/offers-grouping.js';
 * @version-history
 *   v1.0.0 -- 2026-06-16 -- Initial: need-verb classification, facets, standing sort, axis grouping,
 *     deterministic Mermaid map. Pairs with the AI need-router (offers.js) + the richer Offerings tab.
 */

// ── Need-verb classification ─────────────────────────────────────────────────
// Each offer maps to ONE "need" bucket from its title + ask (+ deliverable format as a tiebreak).
// MATCH ORDER matters: the first bucket whose keywords hit wins. Order is chosen so the more specific
// intent wins over the generic "write/create" — e.g. "Map the fleet's deliverables" is INSPECT, not
// BUILD (both mention "fleet"), because inspect is checked first. Unmatched → 'create' (the catch-all
// for generative work) only if it has a generative cue, else 'other'.
export const NEED_BUCKETS = [
  { id: 'analyze',     keywords: ['rate', 'estimate', 'assess', 'evaluat', 'feasibilit', 'stress-test', 'stress test', 'analyz', 'analys', 'probabilit', 'judge', 'spectrum', 'decide', 'score', 'odds', 'risk'] },
  { id: 'inspect',     keywords: ['list', 'status', 'show', 'map', 'report', 'monitor', 'inspect', 'scan', 'audit', 'deliverable', 'running', 'overview', 'which'] },
  { id: 'build',       keywords: ['build', 'agent', 'crew', 'workflow', 'automat', 'schedule', 'pipeline', 'fleet', 'orchestrat', 'delegate', 'fan', 'synthesize', 'register', 'deploy'] },
  { id: 'communicate', keywords: ['translat', 'summari', 'message', 'reply', 'email', 'tagline', 'announce', 'rewrite'] },
  { id: 'create',      keywords: ['write', 'generat', 'create', 'make', 'draft', 'compose', 'jingle', 'copy', 'image', 'riff', 'comedian', 'design', 'story', 'poem'] },
];

// The order sections are SHOWN in (UX reading order), independent of match order above.
export const NEED_DISPLAY_ORDER = ['create', 'analyze', 'communicate', 'build', 'inspect', 'other'];

// Precompile one word-boundary matcher per bucket. Boundary matching avoids false hits where a short
// keyword is a substring of another word (e.g. "rate" inside "generate", "map" inside "roadmap").
const _esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const b of NEED_BUCKETS) b._re = new RegExp('(^|[^a-z])(' + b.keywords.map(_esc).join('|') + ')', 'i');

/** Classify one offer into a need bucket id (deterministic). Falls back by deliverable format, then 'other'. */
export function classifyNeed(offer) {
  const hay = `${offer?.title || ''} ${offer?.ask || ''} ${offer?.example || ''}`.toLowerCase();
  for (const b of NEED_BUCKETS) {
    if (b._re.test(hay)) return b.id;
  }
  // Format tiebreak: an image/json deliverable with no verb cue is still "create".
  const fmt = offer?.deliverable?.format;
  if (fmt === 'image' || fmt === 'app') return 'create';
  if (fmt === 'record' || fmt === 'board-post') return 'communicate';
  return 'other';
}

// ── Facets ───────────────────────────────────────────────────────────────────
// Each facet reads one offer field; the UI shows a chip per VALUE that actually appears in the feed.
export const FACETS = [
  { key: 'cost',         field: 'cost' },
  { key: 'latency',      field: 'latency' },
  { key: 'verification', field: 'verification' },
  { key: 'dataHandling', field: 'dataHandling' },
  { key: 'format',       field: null },   // special: deliverable.format
];

/** The value of one facet on one offer (string | undefined). */
export function offerFacetValue(offer, facetKey) {
  if (facetKey === 'format') return offer?.deliverable?.format;
  return offer?.[facetKey];
}

/** Map of facetKey → ordered unique values present across the given items (each item is {offer}). */
export function availableFacetValues(items) {
  const out = {};
  for (const f of FACETS) {
    const seen = [];
    for (const { offer } of items) {
      const v = offerFacetValue(offer, f.key);
      if (v && !seen.includes(v)) seen.push(v);
    }
    if (seen.length) out[f.key] = seen;
  }
  return out;
}

/**
 * Does an offer pass the active facet filter? `active` is { facetKey: Set(values) }. AND across
 * facets, OR within a facet. An empty/absent set for a facet = no constraint on that facet.
 */
export function matchesFacets(offer, active) {
  for (const f of FACETS) {
    const set = active?.[f.key];
    if (!set || set.size === 0) continue;
    const v = offerFacetValue(offer, f.key);
    if (!v || !set.has(v)) return false;
  }
  return true;
}

// ── Standing (value/dependability) — NOT activity ──────────────────────────────
/** True when the offer runs on a cadence / is schedule-born (server sets offer.auto). */
export function isAuto(offer) {
  return !!offer?.auto || !!offer?.availability?.scheduleBorn;
}

const VERIFICATION_WEIGHT = { deterministic: 3, gated: 2, ungated: 0 };

/**
 * A deterministic "standing" score: how likely this offer is VALUABLE + dependable, deliberately
 * independent of how many times it ran. Automatic/scheduled offers rank highest (they produce on a
 * cadence), then stronger verification, a concrete deliverable location, and being productized
 * (priced). This is the default sort so the list leads with substance, not busyness.
 */
export function standingScore(offer) {
  let s = 0;
  if (isAuto(offer)) s += 100;
  s += VERIFICATION_WEIGHT[offer?.verification] ?? 0;
  if (offer?.deliverable?.location?.key || offer?.deliverable?.location?.url) s += 1;
  if (offer?.price?.morsels > 0) s += 1;
  if ((offer?.workflows || []).length) s += 2;   // part of a real chain
  return s;
}

const COST_RANK = { free: 0, cheap: 1, expensive: 2 };
const LATENCY_RANK = { seconds: 0, minutes: 1, 'long-running': 2 };

/** Sort a copy of items ({entry, offer}) by mode: 'standing' (default) | 'cost' | 'speed' | 'name'. */
export function sortOffers(items, mode = 'standing') {
  const by = [...items];
  const name = (it) => (it.offer?.title || '').toLowerCase();
  if (mode === 'cost') {
    by.sort((a, b) => (COST_RANK[a.offer?.cost] ?? 9) - (COST_RANK[b.offer?.cost] ?? 9) || name(a).localeCompare(name(b)));
  } else if (mode === 'speed') {
    by.sort((a, b) => (LATENCY_RANK[a.offer?.latency] ?? 9) - (LATENCY_RANK[b.offer?.latency] ?? 9) || name(a).localeCompare(name(b)));
  } else if (mode === 'name') {
    by.sort((a, b) => name(a).localeCompare(name(b)));
  } else { // standing
    by.sort((a, b) => standingScore(b.offer) - standingScore(a.offer) || name(a).localeCompare(name(b)));
  }
  return by;
}

// ── Grouping ───────────────────────────────────────────────────────────────────
/**
 * Group items ({entry, offer}) by an axis. Returns ordered [{ key, items }]:
 *   - 'need'       → need-verb bucket (NEED_DISPLAY_ORDER)
 *   - 'agent'      → entry.agent (alpha)
 *   - 'tag'        → first machine tag, or '∅' (alpha; tags are sparse in practice)
 *   - 'capability' → callable.action_id present? its id : '∅'
 *   - 'auto'       → 'auto' | 'manual'
 * The caller resolves `key` → a human label.
 */
export function groupByAxis(items, axis) {
  const buckets = new Map();
  const push = (key, it) => { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(it); };

  for (const it of items) {
    if (axis === 'agent') push(it.entry?.agent || '∅', it);
    else if (axis === 'tag') push((it.offer?.tags || [])[0] || '∅', it);
    else if (axis === 'capability') push(it.offer?.callable?.action_id || '∅', it);
    else if (axis === 'auto') push(isAuto(it.offer) ? 'auto' : 'manual', it);
    else push(classifyNeed(it.offer), it); // 'need'
  }

  let keys = [...buckets.keys()];
  if (axis === 'need') {
    keys.sort((a, b) => NEED_DISPLAY_ORDER.indexOf(a) - NEED_DISPLAY_ORDER.indexOf(b));
  } else if (axis === 'auto') {
    keys.sort((a, b) => (a === 'auto' ? -1 : 1) - (b === 'auto' ? -1 : 1));
  } else {
    // alpha, but a literal empty marker sinks to the bottom
    keys.sort((a, b) => (a === '∅' ? 1 : 0) - (b === '∅' ? 1 : 0) || String(a).localeCompare(String(b)));
  }
  return keys.map(key => ({ key, items: buckets.get(key) }));
}

// ── Deterministic Mermaid map ───────────────────────────────────────────────────
/** Strip characters that would break a quoted Mermaid node label; cap length. */
function mmdLabel(s) {
  return String(s ?? '').replace(/["\n\r]/g, ' ').replace(/[<>|{}]/g, '').trim().slice(0, 60) || '—';
}

/**
 * Build a Mermaid `flowchart LR` source: root → one node per group → a leaf per offer. Labels are
 * pre-resolved by the caller (groups = [{ label, items:[{ offer }] }]), so this stays i18n-free and
 * unit-testable. Rendered with securityLevel:'strict' (no click handlers) — it's an ORIENTATION map;
 * acting on an offer happens in the list. Caps leaves per group so a huge fleet stays legible.
 */
export function buildMermaid(rootLabel, groups, { maxPerGroup = 12 } = {}) {
  const lines = ['flowchart LR', `  root["${mmdLabel(rootLabel)}"]`];
  groups.forEach((g, gi) => {
    const gid = `g${gi}`;
    lines.push(`  root --> ${gid}["${mmdLabel(g.label)} (${g.items.length})"]`);
    const shown = g.items.slice(0, maxPerGroup);
    shown.forEach((it, oi) => {
      lines.push(`  ${gid} --> ${gid}o${oi}["${mmdLabel(it.offer?.title)}"]`);
    });
    const hidden = g.items.length - shown.length;
    if (hidden > 0) lines.push(`  ${gid} --> ${gid}more["+${hidden}…"]`);
  });
  return lines.join('\n');
}
