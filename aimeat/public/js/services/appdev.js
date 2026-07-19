/**
 * @file appdev.js
 * @description API service for the profile AppDev tab — the human-facing window into the
 *   AppDev knowledge base: learned pitfalls (list/share/outdated/delete), agent-proposed
 *   template proposals (list/get/delete), the curated pitfall registry, and the copyable
 *   research-first prompts (appdev-flow + build-app) for starting a coding agent right.
 * @structure getFlowPromptText · getBuildPromptText · getCuratedPitfalls · getLearnedPitfalls ·
 *   updateLearnedPitfall · deleteLearnedPitfall · getTemplateProposals · deleteTemplateProposal
 * @usage import { getLearnedPitfalls } from '/js/services/appdev.js';
 * @version-history
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

/** Own learned entries (+ optionally other owners' shared ones). */
export async function getLearnedPitfalls(includeShared) {
  const data = await apiGet(`/v1/appdev/pitfalls/learned${includeShared ? '?include_shared=1' : ''}`);
  return data?.data || { pitfalls: [], total: 0 };
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
