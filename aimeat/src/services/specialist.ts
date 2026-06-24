/**
 * @file specialist.ts
 * @description Provisioning + lookup for SPECIALIST agents (Secretary P5 / S-A) — a reusable agent type
 *   ALONGSIDE the personal + company Secretaries (the secretary topology is unchanged; this only adds a
 *   new type). A specialist is a server-side-acting GAII agent (`<role-name>#<owner>@<node>`, NOT named
 *   "secretary") with its OWN brain (agent directives), its OWN operating-model policy (the same
 *   bands/cost-guard taxonomy as the Secretary — see specialist-policy.ts), and its OWN scope profile
 *   (mcp/catalog/scopes.ts). It reuses the Secretary's provisioning pattern via the shared
 *   provisionSystemAgent helper (not a fork). Tagged `system:specialist` + `unlisted` + `role:<role>`
 *   so it shows in the owner's Agents tab but never the public catalogue. Full design:
 *   docs/plans/2026-06-23-secretary-feature.md §19 (S-A) + memory usecase-templates-and-specialists.
 * @structure SPECIALIST_ROLE_TAG · specialistGaii() · validateSpecialistName() · specialistConfigKey() ·
 *   getSpecialist() · listSpecialists() · grantedSpecialistScopes() · ensureSpecialist() ·
 *   readSpecialistPolicy() · writeSpecialistPolicy()
 * @usage await ensureSpecialist(storage, config, ownerName, { name: 'sdr', role: 'sdr', approvedScopes })
 * @version-history
 *   v1.1.0 — 2026-06-25 — Scope-consent: ensureSpecialist accepts owner-approved requested EXTRAS
 *     (grantedSpecialistScopes = baseline ∪ approved, filtered ⊆ requestable, never wider); applies them
 *     on an idempotent re-provision. Default (no approval) stays conservative.
 *   v1.0.0 — 2026-06-24 — Initial: specialist agent type (Secretary P5 S-A)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { buildGAII, validateAgentName } from '../utils/gaii.js';
import { scopesForProfile, isSpecialistRole, requestedExtras, type SpecialistRole } from '../mcp/catalog/scopes.js';
import { provisionSystemAgent } from './system-agent.js';
import { UNLISTED_TAG } from './secretary.js';
import { mergeSpecialistPolicy, type SpecialistPolicy } from './specialist-policy.js';
import { logger } from '../utils/logger.js';

/** Tag identifying a specialist agent (so the owner's UI can find/badge it; never public-listed). */
export const SPECIALIST_ROLE_TAG = 'system:specialist';

/** The specialist GAII for an owner: bare role-name → `name#owner@node`. */
export function specialistGaii(name: string, ownerName: string, config: AimeatConfig): string {
  return buildGAII(name, ownerName, config.nodeId);
}

/** Owner-memory key holding a specialist's operating-model config (`specialist.<name>.config`). */
export function specialistConfigKey(name: string): string {
  return `specialist.${name}.config`;
}

/**
 * Validate a proposed specialist name: the standard agent-name rules, PLUS it may not be `secretary`
 * (the personal Secretary) or start with `secretary-` (a company Secretary) — so a specialist can never
 * collide with either secretary GAII. Returns an error string, or null when valid.
 */
export function validateSpecialistName(name: string): string | null {
  const base = validateAgentName(name);
  if (base) return base;
  if (name === 'secretary') return 'Name "secretary" is reserved for the personal Secretary';
  if (name.startsWith('secretary-')) return 'Names starting with "secretary-" are reserved for company Secretaries';
  return null;
}

/** Fetch a specialist agent record, or null. (Only returns it if it is actually tagged a specialist.) */
export async function getSpecialist(
  storage: Storage, config: AimeatConfig, ownerName: string, name: string,
): Promise<AgentRecord | null> {
  const agent = await storage.getAgent(specialistGaii(name, ownerName, config));
  if (!agent) return null;
  return (agent.tags ?? []).includes(SPECIALIST_ROLE_TAG) ? agent : null;
}

/** List the owner's specialist agents (filtered by the specialist tag). */
export async function listSpecialists(storage: Storage, ownerName: string): Promise<AgentRecord[]> {
  const agents = await storage.getAgentsByOwner(ownerName);
  return agents.filter(a => (a.tags ?? []).includes(SPECIALIST_ROLE_TAG));
}

/** The role of a specialist record (from its `role:<role>` tag), or the generic base. */
export function specialistRole(agent: AgentRecord): SpecialistRole {
  const tag = (agent.tags ?? []).find(t => t.startsWith('role:'));
  const role = tag ? tag.slice('role:'.length) : '';
  return isSpecialistRole(role) ? role : 'specialist';
}

/**
 * Compute the scopes a specialist is GRANTED: the conservative role baseline UNION the owner-approved
 * extras, where approved is intersected with the role's requestable extras so it can NEVER widen beyond
 * what was requested (mirrors the app-grant subset filter). `requestedAlso` lets a template specialist's
 * own declared `requestedScopes` participate in the requestable set.
 */
export function grantedSpecialistScopes(
  role: string, approvedScopes: string[] | undefined, requestedAlso: string[] = [],
): string[] {
  const baseline = scopesForProfile(role);
  const allowed = new Set(requestedExtras(role, requestedAlso));
  const extras = (approvedScopes ?? []).filter(s => typeof s === 'string' && allowed.has(s));
  return Array.from(new Set([...baseline, ...extras]));
}

/**
 * Idempotently provision a specialist agent. The role selects the scope profile (falls back to the
 * generic `specialist`). Reuses the Secretary's provisioning pattern via provisionSystemAgent (shared,
 * not forked). Tags it `system:specialist` + `unlisted` + `role:<role>`. When the owner has consented to
 * requested EXTRAS (`approvedScopes`, always filtered to a subset of the role's requestable extras — never
 * wider), they are granted on top of the conservative baseline and stored on the agent's defaultScopes; on
 * an idempotent re-provision with extras, the existing agent's scopes are updated to baseline ∪ approved.
 */
export async function ensureSpecialist(
  storage: Storage,
  config: AimeatConfig,
  ownerName: string,
  opts: { name: string; role?: string; displayName?: string; description?: string; approvedScopes?: string[]; requestedAlso?: string[] },
): Promise<{ record: AgentRecord; created: boolean; role: SpecialistRole }> {
  const role: SpecialistRole = isSpecialistRole(opts.role) ? opts.role : 'specialist';
  const gaii = specialistGaii(opts.name, ownerName, config);
  const defaultScopes = grantedSpecialistScopes(role, opts.approvedScopes, opts.requestedAlso);
  const { record, created } = await provisionSystemAgent(storage, config, {
    name: opts.name,
    owner: ownerName,
    gaii,
    displayName: opts.displayName || titleCase(opts.name),
    description: opts.description || `${titleCase(role)} specialist agent.`,
    defaultScopes,
    tags: [SPECIALIST_ROLE_TAG, UNLISTED_TAG, `role:${role}`],
  });
  if (created) {
    logger.info('[specialist] provisioned', { gaii, role, scopes: defaultScopes });
    return { record, created, role };
  }
  // Idempotent re-provision: apply newly-consented extras (only when explicitly provided) to the existing
  // agent — the consent step's "grant" path. Never narrows below the role baseline; never widens beyond
  // what was requested (grantedSpecialistScopes already filtered approved ⊆ requestable extras).
  if (opts.approvedScopes !== undefined) {
    const current = record.defaultScopes ?? [];
    const same = current.length === defaultScopes.length && defaultScopes.every(s => current.includes(s));
    if (!same) {
      const updated = await storage.updateAgent(gaii, { defaultScopes });
      if (updated) return { record: updated, created, role };
    }
  }
  return { record, created, role };
}

/** Read a specialist's stored policy (merged onto current defaults). */
export async function readSpecialistPolicy(
  storage: Storage, config: AimeatConfig, ownerName: string, name: string,
): Promise<SpecialistPolicy> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const rec = await storage.getMemory(ownerGhii, specialistConfigKey(name));
  const stored = (rec?.value as { policy?: unknown } | undefined)?.policy;
  return mergeSpecialistPolicy(stored);
}

/** Persist a specialist's policy (merged + normalized) into owner memory; returns the stored policy. */
export async function writeSpecialistPolicy(
  storage: Storage, config: AimeatConfig, ownerName: string, name: string,
  policy: unknown, role: string,
): Promise<SpecialistPolicy> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const key = specialistConfigKey(name);
  const merged = mergeSpecialistPolicy(policy);
  const existing = await storage.getMemory(ownerGhii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key,
    ownerGaii: ownerGhii,
    value: { role, policy: merged, updatedAt: now },
    visibility: 'private',
    tags: ['specialist'],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  return merged;
}

/** Delete a specialist's stored config (used when the specialist is removed). */
export async function deleteSpecialistConfig(
  storage: Storage, config: AimeatConfig, ownerName: string, name: string,
): Promise<void> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  await storage.deleteMemory(ownerGhii, specialistConfigKey(name)).catch(() => {});
}

/** "meeting-prep" → "Meeting Prep". */
function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
