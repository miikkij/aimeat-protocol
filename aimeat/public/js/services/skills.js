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

/** One workspace's skills (manifests only; organism membership required). */
export async function listWorkspaceSkills(orgId, wsId) {
  const res = await apiGet(`/v1/skills?scope=workspace&organism=${encodeURIComponent(orgId)}&ws=${encodeURIComponent(wsId)}`);
  return res?.data?.skills ?? [];
}

/** Skills bound to one app (app:{owner}/{filename}) — 2d. */
export async function listAppSkills(owner, filename) {
  const res = await apiGet(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/skills`);
  return res?.data?.skills ?? [];
}

/**
 * Resolve one skill (manifest + file bodies unless manifestOnly).
 * @param {string} name
 * @param {{ scope?: string, owner?: string, organism?: string, ws?: string, manifestOnly?: boolean }} [opts]
 */
export async function getSkill(name, { scope, owner, organism, ws, manifestOnly } = {}) {
  const params = new URLSearchParams();
  if (scope) params.set('scope', scope);
  if (owner) params.set('owner', owner);
  if (organism) params.set('organism', organism);
  if (ws) params.set('ws', ws);
  if (manifestOnly) params.set('manifest_only', 'true');
  const qs = params.toString();
  const res = await apiGet(`/v1/skills/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`);
  return res?.data?.skill ?? null;
}

/**
 * Publish or update a skill.
 * @param {{ skillMd: string, files?: Record<string, string>, scope?: string, visibility?: string, organism?: string, ws?: string }} opts
 */
export async function publishSkill({ skillMd, files, scope, visibility, organism, ws }) {
  const res = await apiPost('/v1/skills', {
    skill_md: skillMd,
    ...(files && Object.keys(files).length ? { files } : {}),
    ...(scope ? { scope } : {}),
    ...(visibility ? { visibility } : {}),
    ...(organism ? { organism } : {}),
    ...(ws ? { ws } : {}),
  });
  return res?.data?.skill ?? null;
}

/**
 * Set or clear a skill's app binding (2d) by rewriting the SKILL.md frontmatter and republishing.
 * Textual rewrite (no YAML lib in the SPA): handles the three shapes the contract allows.
 * @param {string} name  skill name (user scope)
 * @param {string|null} binding  "app:{owner}/{filename}" to set, null to clear
 */
export async function setSkillBinding(name, binding) {
  const skill = await getSkill(name, { scope: 'user' });
  if (!skill) throw new Error('Skill not found: ' + name);
  const md = skill.fileContents?.['SKILL.md'] ?? '';
  const m = md.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
  if (!m) throw new Error('SKILL.md has no frontmatter');
  let fm = m[2];
  const hasBindingLine = /^\s{2,}binding:.*$/m.test(fm);
  const hasMetadata = /^metadata:\s*$/m.test(fm);
  if (binding) {
    if (hasBindingLine) fm = fm.replace(/^(\s{2,})binding:.*$/m, `$1binding: ${binding}`);
    else if (hasMetadata) fm = fm.replace(/^metadata:\s*$/m, `metadata:\n  binding: ${binding}`);
    else fm = `${fm}\nmetadata:\n  binding: ${binding}`;
  } else {
    fm = fm.replace(/^\s{2,}binding:.*\r?\n?/m, '');
    // An emptied metadata block would be YAML null (invalid per contract) — drop the header too.
    if (/^metadata:\s*$/m.test(fm) && !/^metadata:\s*\r?\n\s{2,}\S/m.test(fm)) {
      fm = fm.replace(/^metadata:\s*\r?\n?/m, '');
    }
  }
  const files = { ...skill.fileContents };
  delete files['SKILL.md'];
  return publishSkill({ skillMd: `${m[1]}${fm}${m[3]}${m[4]}`, files });
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
