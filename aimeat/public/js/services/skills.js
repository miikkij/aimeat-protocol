/**
 * @file skills.js
 * @description Front-end service layer for the skills registry (/v1/skills +
 *   /v1/agents/:name/skills). Skills are a dedicated system, distinct from
 *   knowledge packages: SKILL.md packs in scoped registries (node/user),
 *   attached to agents by SkillRef.
 * @usage
 *   import * as skillsService from '/js/services/skills.js';
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial creation (Skills feature Phase 2b)
 */
import { apiGet, apiPost, apiDelete } from '/js/api.js';

/** The library: everything the caller can load, grouped by scope { node, user }. */
export async function getLibrary() {
  const res = await apiGet('/v1/skills?scope=library');
  return res?.data?.library ?? { node: [], user: [] };
}

/** One scope's listing (manifests only). */
export async function listScope(scope, owner) {
  const q = owner ? `&owner=${encodeURIComponent(owner)}` : '';
  const res = await apiGet(`/v1/skills?scope=${encodeURIComponent(scope)}${q}`);
  return res?.data?.skills ?? [];
}

/**
 * Resolve one skill (manifest + file bodies unless manifestOnly).
 * @param {string} name
 * @param {{ scope?: string, owner?: string, manifestOnly?: boolean }} [opts]
 */
export async function getSkill(name, { scope, owner, manifestOnly } = {}) {
  const params = new URLSearchParams();
  if (scope) params.set('scope', scope);
  if (owner) params.set('owner', owner);
  if (manifestOnly) params.set('manifest_only', 'true');
  const qs = params.toString();
  const res = await apiGet(`/v1/skills/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`);
  return res?.data?.skill ?? null;
}

/**
 * Publish or update a skill.
 * @param {{ skillMd: string, files?: Record<string, string>, scope?: string, visibility?: string }} opts
 */
export async function publishSkill({ skillMd, files, scope, visibility }) {
  const res = await apiPost('/v1/skills', {
    skill_md: skillMd,
    ...(files && Object.keys(files).length ? { files } : {}),
    ...(scope ? { scope } : {}),
    ...(visibility ? { visibility } : {}),
  });
  return res?.data?.skill ?? null;
}

export async function deleteSkill(name, scope) {
  const q = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  return apiDelete(`/v1/skills/${encodeURIComponent(name)}${q}`);
}

/** An agent's raw link records (refs only — cheap). */
export async function getAgentSkillLinks(agentName) {
  const res = await apiGet(`/v1/agents/${encodeURIComponent(agentName)}/skills/links`);
  return res?.data?.links ?? [];
}

/**
 * An agent's linked skills, resolved. Returns { skills, unresolved }.
 * @param {string} agentName
 * @param {{ manifestOnly?: boolean }} [opts]
 */
export async function getAgentSkills(agentName, { manifestOnly } = {}) {
  const q = manifestOnly ? '?manifest_only=true' : '';
  const res = await apiGet(`/v1/agents/${encodeURIComponent(agentName)}/skills${q}`);
  return { skills: res?.data?.skills ?? [], unresolved: res?.data?.unresolved ?? [] };
}

export async function linkSkill(agentName, ref) {
  const res = await apiPost(`/v1/agents/${encodeURIComponent(agentName)}/skills`, { ref });
  return res?.data?.links ?? [];
}

export async function unlinkSkill(agentName, ref) {
  const res = await apiDelete(`/v1/agents/${encodeURIComponent(agentName)}/skills?ref=${encodeURIComponent(ref)}`);
  return res?.data?.links ?? [];
}
