/**
 * @file public/views/profile/ecosystem-tab.helpers.js
 * @description Pure helpers + constants for the Ecosystem apps tab (scope presets, outbound events,
 *   key fingerprint, cadence⇄cron maps, trigger-glob / schedulable / cadence derivations,
 *   recommended-agent matching, organism-name resolution). Extracted from ecosystem-tab.js to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from ecosystem-tab.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Dropped knowledge:contribute and events:subscribe from the standard
 *     preset: nothing in src/ gates on either, so they were consent-screen text granting nothing.
 *     knowledge:contribute also shipped in the node's default eco scopes, so every ecosystem app on
 *     a default install was handed it.
 */

// Scope presets the owner picks at approval — lean read + deposit (ecosystem apps mostly deposit
// refined data + subscribe to events). 'full' grants the wildcard.
//
// `knowledge:contribute` and `events:subscribe` were removed on 2026-08-08: a whole-repo sweep
// found no gate reading either, so they were consent-screen text granting nothing. The first was
// worse than cosmetic — it also shipped in the node's default eco scopes, so every ecosystem app
// on a default install was handed it. Event SUBSCRIPTION is managed by the owner
// (requireRole('owner'), routes/ecosystem-events.ts:77) and an app never touches those routes;
// `events:emit` beside it is real, which is exactly why the dead one read as its counterpart.
export const ECO_PRESETS = {
  readonly: ['memory:read', 'organism:read'],
  standard: ['memory:read', 'memory:write', 'organism:read', 'events:emit'],
  full: ['*'],
};
export const OUTBOUND_EVENTS = ['memory.write', 'memory.delete', 'offer.ordered', 'workflow.step', 'binding.revoked', '*'];

export function keyFp(pub) {
  if (!pub) return '';
  return pub.length > 12 ? `${pub.slice(0, 8)}…${pub.slice(-4)}` : pub;
}

// ── Automation: cadence ⇄ cron ──────────────────────────────────────────────
// The UI offers three coarse cadences; each maps to a fixed 08:00 cron. The
// reverse map turns a known cron back into a human cadence label for the list.
export const CADENCES = [
  { key: 'daily', cron: '0 8 * * *' },
  { key: 'weekly', cron: '0 8 * * 1' },
  { key: 'monthly', cron: '0 8 1 * *' },
];
export const CRON_TO_CADENCE = Object.fromEntries(CADENCES.map(c => [c.cron, c.key]));

/**
 * Derive the default trigger keyGlob from the app's automation hint. Mirrors the node's
 * defaultKeyGlob (routes/ecosystem-apps.ts): prefer `produces_key` (the deposit KEY PREFIX,
 * e.g. `feedback.stats`) over `produces` (a SCHEMA ref, e.g. `feedback-stats@1`, which is NOT a
 * deposit key); turn a bare prefix into a glob, else fall back to `eco.{app}.*`.
 */
export function defaultTriggerGlob(app) {
  const schedulable = app?.automation?.schedulable || [];
  const entry = schedulable.find(s => s.produces_key) || schedulable.find(s => s.produces);
  const base = entry?.produces_key || entry?.produces;
  if (base) return base.includes('*') ? base : `${base}.*`;
  return `eco.${app?.app}.*`;
}

/**
 * Pick the app's PRIMARY schedulable capability — the one the unified flow centres on:
 * "this app produces X on a schedule". Prefers an entry that declares `produces` (so we can
 * show what it deposits); falls back to the first schedulable, else null.
 */
export function primarySchedulable(app) {
  const schedulable = (app?.automation && app.automation.schedulable) || [];
  return schedulable.find(s => s.produces || s.produces_key) || schedulable[0] || null;
}

/** Allowed cadences for a schedulable entry (restricted by its `cadences`, else all three). */
export function allowedCadencesFor(entry) {
  const allow = entry && Array.isArray(entry.cadences) ? entry.cadences : null;
  return allow ? CADENCES.filter(c => allow.includes(c.key)) : CADENCES;
}

// ── Recommended agents (the app declares which agent(s) fit it best) ─────────
/**
 * Collect the capability/tag strings an owner agent exposes for `match_tags` matching: its owner-set
 * `tags` PLUS its declared capability id lists (`capabilities` / `technical_capabilities` /
 * `domain_capabilities` from GET /v1/agents). Lower-cased + de-duped for a case-insensitive overlap.
 */
export function agentMatchStrings(agent) {
  const out = [];
  const push = (v) => { if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x.toLowerCase()); };
  push(agent?.tags);
  push(agent?.capabilities);
  push(agent?.technical_capabilities);
  push(agent?.domain_capabilities);
  return new Set(out);
}

/**
 * Decide whether an owner `agent` is RECOMMENDED by the app's `recommended_agents` declarations, and
 * if so WHY (the bilingual one-liner for the active locale). An agent matches a declaration when its
 * NAME equals the declaration's `name` (exact) OR ANY of the declaration's `match_tags` appears in the
 * agent's tags/capabilities. Returns `{ recommended, why }` — `why` is the first matching declaration's
 * reason in the active locale (en→fi fallback). Pure; safe when `recommended_agents` is absent.
 */
export function recommendationFor(agent, recommendedAgents, locale) {
  const decls = Array.isArray(recommendedAgents) ? recommendedAgents : [];
  if (decls.length === 0) return { recommended: false, why: '' };
  const agentStrings = agentMatchStrings(agent);
  for (const d of decls) {
    const byName = d?.name && d.name === agent?.name;
    const tags = Array.isArray(d?.match_tags) ? d.match_tags : [];
    const byTag = tags.some(tag => typeof tag === 'string' && agentStrings.has(tag.toLowerCase()));
    if (byName || byTag) {
      const why = d?.why ? (d.why[locale] || d.why.en || d.why.fi || '') : '';
      return { recommended: true, why };
    }
  }
  return { recommended: false, why: '' };
}

/**
 * Resolve the recipe's `organism` value (which may be an id OR a name) to a human-readable
 * display name using the owner's loaded organisms list. Falls back to the raw value when no
 * match is found, and to '' when nothing is set.
 */
export function resolveOrganismName(organism, orgs) {
  if (!organism) return '';
  const match = (orgs || []).find(o => o.id === organism || o.name === organism);
  return (match && (match.name || match.id)) || organism;
}
