/**
 * @file secretary-policy.js
 * @description The Secretary's operating model (Phase 1): the capability taxonomy + autonomy bands
 *   that define what the Secretary may do on its own. Stored on the owner memory key `secretary.config`
 *   under `.policy` (NOT the generic agent-directives model — keeps the operating model in one
 *   secretary-specific place). This is the CONTRACT later phases enforce (Phase 3 inbox bands, Phase 4
 *   autonomous tick read it); for now it is authored + persisted here. Bands: act (do it + log) /
 *   draft (prepare, ask to approve) / ask (decision card) / off. `discover` is locked to act + free
 *   (read-only, never blocked by stop-spending). Full design: docs/plans/2026-06-23-secretary-feature.md §6/§9.
 * @structure BANDS · SECRETARY_CAPABILITIES · LIGHT_AUTONOMY_CAPS · defaultPolicy() · mergePolicy() · autonomyPreset() · autonomyLevelOf()
 * @usage import { SECRETARY_CAPABILITIES, BANDS, defaultPolicy, autonomyPreset, autonomyLevelOf } from '/js/services/secretary-policy.js';
 * @version-history
 *   v0.3.0 — 2026-07-01 — Light-vs-heavy seam: dropped `author_content` (heavy authoring is now a Work
 *     Brief a Builder executes, never a band). Added the two-state autonomy preset (autonomyPreset /
 *     autonomyLevelOf + LIGHT_AUTONOMY_CAPS) so the UI can show ONE toggle (suggest-only vs handle-the-
 *     small-stuff) that sets the underlying per-capability bands — the band machinery + parity tests are
 *     unchanged; the toggle is sugar over the same bands map.
 *   v0.2.0 — 2026-06-24 — Phase 3d: mark Enterprise-only capabilities (third-party messaging, transacting,
 *     spending) with `enterprise: true` — gated/locked in the Community Secretary (which lacks the
 *     messages:send / work:request / wallet scopes). The explicit third-party-send gate.
 *   v0.1.0 — 2026-06-23 — Phase 1 completion: operating-model taxonomy + bands.
 */

/** Autonomy bands, least → most restrictive in display order. */
export const BANDS = ['act', 'draft', 'ask', 'off'];

/**
 * The Secretary's operating surface. `defaultBand` is the conservative Community default; `locked`
 * capabilities cannot be changed by the user; `free` ones cost no morsels and are never blocked by the
 * stop-spending switch; `costs` flags money/outbound actions (shown with a cost hint in the UI);
 * `enterprise` capabilities require scopes the Community Secretary doesn't have (messages:send /
 * work:request / wallet) — they're gated/locked here and only unlocked by the company `ee/` edition.
 */
export const SECRETARY_CAPABILITIES = [
  { id: 'discover',            defaultBand: 'act',   locked: true, free: true },
  { id: 'file_intake',         defaultBand: 'act' },
  { id: 'briefing',            defaultBand: 'act' },
  { id: 'reminders',           defaultBand: 'act' },
  { id: 'curate_knowledge',    defaultBand: 'draft' },
  { id: 'draft_replies',       defaultBand: 'draft' },
  { id: 'create_resource',     defaultBand: 'ask' },
  { id: 'delegate',            defaultBand: 'ask',   costs: true },
  { id: 'resource_invoke',     defaultBand: 'ask',   costs: true, enterprise: true },
  { id: 'third_party_message', defaultBand: 'ask',   costs: true, enterprise: true },
  { id: 'spend',               defaultBand: 'ask',   costs: true, enterprise: true },
];

/** The LIGHT capabilities the one autonomy toggle flips: in "assist" they act, in "suggest" they only
 *  surface (ask). Everything else keeps its conservative default — heavy work is never a band, it's a Brief. */
export const LIGHT_AUTONOMY_CAPS = ['file_intake', 'briefing', 'reminders', 'curate_knowledge'];

/** The conservative default operating model seeded when the Secretary is hired. */
export function defaultPolicy() {
  const bands = {};
  for (const c of SECRETARY_CAPABILITIES) bands[c.id] = c.defaultBand;
  return { stopSpending: false, dailyMorselBudget: null, bands };
}

/** The two-state autonomy preset behind the single UI toggle. 'suggest' = the Secretary only surfaces
 *  things for you (light caps → ask); 'assist' = it handles the small stuff itself (light caps → act).
 *  Returns a full bands map (the other capabilities keep their conservative defaults). */
export function autonomyPreset(level) {
  const bands = {};
  for (const c of SECRETARY_CAPABILITIES) bands[c.id] = c.defaultBand;
  const lightBand = level === 'assist' ? 'act' : 'ask';
  for (const id of LIGHT_AUTONOMY_CAPS) if (bands[id] !== undefined) bands[id] = lightBand;
  return bands;
}

/** Which preset a stored bands map looks like: 'assist' iff every light cap is acting, else 'suggest'. */
export function autonomyLevelOf(bands) {
  const b = bands || {};
  return LIGHT_AUTONOMY_CAPS.every((id) => b[id] === 'act') ? 'assist' : 'suggest';
}

/** Merge a stored (possibly partial / older) policy onto the current defaults so new capabilities
 *  always have a band and locked ones stay correct. */
export function mergePolicy(stored) {
  const base = defaultPolicy();
  const p = stored && typeof stored === 'object' ? stored : {};
  const bands = { ...base.bands, ...(p.bands || {}) };
  // Locked capabilities are always forced to their default band.
  for (const c of SECRETARY_CAPABILITIES) if (c.locked) bands[c.id] = c.defaultBand;
  return {
    stopSpending: !!p.stopSpending,
    dailyMorselBudget: (typeof p.dailyMorselBudget === 'number' && p.dailyMorselBudget >= 0) ? p.dailyMorselBudget : null,
    bands,
  };
}
