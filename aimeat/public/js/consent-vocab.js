/**
 * @file public/js/consent-vocab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONE vocabulary every consent surface reads: the plain-language sentence for a
 *   scope, the friendly name for a scope family, the "Works with:" line, the one-line summary of a
 *   permission preset, and the three boundary sentences (what a grant can NEVER reach). Four
 *   surfaces consume it — the app-grant page, the MCP OAuth consent page, the standalone device-auth
 *   page and the SPA's AgentConsent panel — and none of them keeps a private copy, because a copied
 *   consent sentence is how one door tells the truth while another keeps the old wording. A real
 *   user read "storage" on one of these screens as their own hard drive; the boundary sentence
 *   exists so that reading can never happen again.
 *
 *   Preset summaries are generated FROM the actual SCOPE_TEMPLATES sets, so the description can not
 *   drift from what the preset grants. `t` is injected so the module stays pure and unit-testable,
 *   like scope-model.js beneath it.
 * @structure scopeSentence · familyName · areaLine · presetSummary · boundaryLines
 * @usage
 *   import { scopeSentence, boundaryLines } from '/js/consent-vocab.js';
 *   scopeSentence('storage:write', t)  // "Upload, replace and delete files in your storage."
 * @version-history
 *   v1.0.0 — 2026-08-17 — Extracted the vocabulary the surfaces had each half-invented: the area
 *     line from app-grant.js, the preset sets from agent-consent.html's private (and divergent)
 *     copy, the scope sentences from the scopeUi tree the other surfaces never read.
 */
import { SCOPE_TEMPLATES, NOT_IN_WILDCARD } from '/views/profile/agents/scope-model.js';

export { SCOPE_TEMPLATES, NOT_IN_WILDCARD };

/**
 * The plain-language sentence for one scope token. App-context overrides win over the agent
 * sentences (a few scopeUi sentences say "its own tasks", which is agent phrasing), then the shared
 * scopeUi tree, then whatever description the server sent, then the raw token as the last resort.
 */
export function scopeSentence(scope, t, serverDescription = '') {
  const [family, perm] = String(scope).split(':');
  for (const key of [
    `appGrant.scopeText.${family}.${perm}`,
    `profile.agents.scopeUi.scopeText.${family}.${perm}`,
  ]) {
    const v = t(key);
    if (v && v !== key) return v;
  }
  return serverDescription || scope;
}

/** The friendly name of one scope family ("storage" → "the files you keep here"). */
export function familyName(family, t) {
  const key = `appGrant.area.${family}`;
  const v = t(key);
  return v && v !== key ? v : family;
}

/** The one-line "Works with:" summary, families in first-appearance order. */
export function areaLine(scopes, t) {
  const families = [];
  for (const s of scopes) {
    const f = String(s).split(':')[0];
    if (!families.includes(f)) families.push(f);
  }
  return families.map((f) => familyName(f, t)).join(', ');
}

/**
 * One sentence describing a permission preset. For readonly/standard the {areas} are generated from
 * the preset's REAL scope set, so adding a scope to the template changes this sentence on every
 * surface at once.
 */
export function presetSummary(preset, t) {
  if (preset === 'keep') return t('consent.preset.keep');
  if (preset === 'custom') return t('consent.preset.custom');
  if (preset === 'full') return t('consent.preset.full');
  const tpl = SCOPE_TEMPLATES[preset];
  if (!tpl) return '';
  return t(`consent.preset.${preset}`, { areas: areaLine(tpl, t) });
}

/**
 * The three boundary sentences, in the order they answer fear: what this can never reach (not the
 * person's computer, files on disk, or outside accounts), who can see it (nobody, until shared),
 * and who stays in control (every action recorded, revocable at Profile › Access).
 */
export function boundaryLines(t) {
  return ['reach', 'visibility', 'control'].map((k) => t(`consent.boundary.${k}`));
}
