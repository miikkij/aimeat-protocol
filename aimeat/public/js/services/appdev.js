/**
 * @file appdev.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description API service for the profile AppDev tab — the human-facing window into the
 *   AppDev knowledge base: learned pitfalls (list/share/outdated/delete), agent-proposed
 *   template proposals (list/get/delete), the curated pitfall registry, and the copyable
 *   research-first prompts (appdev-flow + build-app) for starting a coding agent right.
 * @structure getFlowPromptText · getBuildPromptText · getCuratedPitfalls · queryLearnedPitfalls ·
 *   updateLearnedPitfall · deleteLearnedPitfall · getTemplateProposals · deleteTemplateProposal
 * @usage import { queryLearnedPitfalls } from '/js/services/appdev.js';
 * @version-history
 *   v1.1.0 — 2026-09-03 — queryLearnedPitfalls() replaces getLearnedPitfalls(): one page with
 *     filters, search and facets instead of every entry with its body (AppDev page, poster face).
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB UI phase).
 */
import { api, apiGet, apiPatch, apiDelete } from '/js/api.js';

/** The paste-able research-first flow prompt (plain text). */
export async function getFlowPromptText() {
  const res = await fetch('/v1/prompts/appdev-flow?format=txt');
  if (!res.ok) throw new Error('flow prompt ' + res.status);
  return res.text();
}

/** The canonical build-app prompt (plain text; lang follows the UI locale). */
export async function getBuildPromptText(lang) {
  const res = await fetch(`/v1/prompts/build-app?format=txt${lang === 'fi' ? '&lang=fi' : ''}`);
  if (!res.ok) throw new Error('build prompt ' + res.status);
  return res.text();
}

/** Curated node registry (public). Returns { pitfalls, total, facets }. */
export async function getCuratedPitfalls(params = {}) {
  const q = new URLSearchParams();
  if (params.applies_to) q.set('applies_to', params.applies_to);
  if (params.severity) q.set('severity', params.severity);
  q.set('limit', String(params.limit ?? 100));
  const data = await apiGet(`/v1/appdev/pitfalls?${q}`);
  return data?.data || { pitfalls: [], total: 0, facets: {} };
}

/**
 * One page of the learned entries with the counts around it: { pitfalls, total, offset, limit,
 * facets (the whole scope), filtered_facets (what the filter left), community (what other owners
 * shared) }. Params: include_shared, status (active|outdated|all), severity, category, model,
 * applies_to, shared (true|false), q, sort (updated|severity), limit, offset.
 */
export async function queryLearnedPitfalls(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    q.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const data = await apiGet(`/v1/appdev/pitfalls/learned?${q}`);
  return data?.data || { pitfalls: [], total: 0, offset: 0, limit: 25, facets: {}, filtered_facets: {}, community: 0 };
}

/** Toggle share (platform-wide) / status (active|outdated) on an own entry. */
export async function updateLearnedPitfall(category, slug, flags) {
  const data = await apiPatch(`/v1/appdev/pitfalls/learned/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`, flags);
  return data?.data?.pitfall || null;
}

export async function deleteLearnedPitfall(category, slug) {
  await apiDelete(`/v1/appdev/pitfalls/learned/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`);
  return true;
}

/** Owner-scope template proposals (full manifests). */
export async function getTemplateProposals() {
  const data = await apiGet('/v1/appdev/templates');
  return data?.data || { templates: [], total: 0 };
}

export async function deleteTemplateProposal(id) {
  await apiDelete(`/v1/appdev/templates/${encodeURIComponent(id)}`);
  return true;
}

export { api };
