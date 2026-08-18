/**
 * @file model.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shared IAM level/capability PRIMITIVES — one model used by platform structures
 *   (organism, workspace) AND, later, by apps (their own owner-defined schemas) and the node. This is
 *   Phase 1 of the IAM rework: PURE, ADDITIVE, ZERO enforcement change. Nothing here is wired into a
 *   gate yet — it defines the shapes (LevelSchema, Grade, Capability), ships the default platform
 *   schemas that REPRODUCE today's behavior exactly, and derives a principal's level from today's data
 *   (organism role / workspace-role consent) so a later phase can prove the model is faithful before
 *   any caller switches to it.
 *
 *   The model in one line: `allow(user, group, action) = neededCapability(key, action) ∈
 *   capabilitiesOf(gradeLevel(user, group), schemaOf(group))`. A LEVEL is an ordinal, BBS-spaced
 *   (0/10/20/30…), LOWER = MORE POWER — a distinct field, inverted vs GHIIRecord.verificationLevel
 *   (which stays higher = more and is untouched). Capabilities are a FIXED small set for platform
 *   groups; apps supply their own capability strings against the same shape (Phase 5, evolving the
 *   existing aimeat-iam package — do NOT rebuild it).
 * @structure
 *   - Capability / PLATFORM_CAPABILITIES — the fixed platform verb vocabulary
 *   - GroupType, LevelDef, LevelSchema, Grade — the shared shapes
 *   - DEFAULT_ORGANISM_SCHEMA / DEFAULT_WORKSPACE_SCHEMA — reproduce today's platform RBAC
 *   - capabilitiesOf(level, schema) — a level's capability set
 *   - deriveOrganismLevel / deriveWorkspaceLevel — today's role → level
 *   - scopeOf(key) — a memory key → (groupType, groupRef)
 *   - neededCapability(key, action) — which capability a platform action requires
 *   - modelAllowsPlatform(level, schema, key, action) — the pure decision (used by the parity test)
 * @usage import { capabilitiesOf, deriveOrganismLevel, modelAllowsPlatform } from './iam/model.js';
 * @version-history
 *   v1.0.0 — 2026-07-02 — Phase 1 slice 1: shared primitives + default platform schemas + derivation
 *     + the pure platform decision. No storage, no enforcement, no caller switched.
 */

/** Fixed platform capability vocabulary (apps supply their own strings against the same shape). */
export type PlatformCapability = 'read' | 'write' | 'manage-members' | 'manage-meta' | 'admin';
export const PLATFORM_CAPABILITIES: PlatformCapability[] = ['read', 'write', 'manage-members', 'manage-meta', 'admin'];

/** The four platform-structure group kinds the unified model spans (apps + node join later). */
export type GroupType = 'organism' | 'workspace' | 'app' | 'adhoc' | 'node';

/** One rung of a level ladder: an ordinal (BBS-spaced, lower = more power) → a capability set. */
export interface LevelDef {
  /** BBS-spaced ordinal, LOWER = MORE POWER (0 = most). Distinct from verificationLevel. */
  level: number;
  /** Stable machine key for the rung (also the legacy role name where one existed). */
  key: string;
  /** Human label. */
  label: string;
  /** The capabilities a member at this level holds (the FULL set, not incremental). */
  capabilities: string[];
}

/** A named level ladder for a group type. Default schemas are node-owned; apps/admins author custom. */
export interface LevelSchema {
  groupType: GroupType;
  name: string;
  levels: LevelDef[];
}

/**
 * A principal's level within one group. Replaces (Phase 4) the three parallel collections:
 * OrganismMembershipRecord.role, the workspace-role consents, and SharingGroupMember.
 * `member` is a GHII (human) OR a GAII (agent) — an agent may hold its OWN grade in a group
 * (independent of any owner) as well as inherit via the consent-cap when it is its owner's agent.
 */
export interface Grade {
  groupType: GroupType;
  /** organismId | `${organismId}/${ws}` | appId | adhocGroupId | 'node'. */
  groupRef: string;
  /** GHII or GAII the level is assigned to. */
  member: string;
  /** BBS ordinal, lower = more power. */
  level: number;
  status: 'active' | 'invited' | 'banned';
}

// ── Default platform schemas — REPRODUCE today's behavior exactly ─────────────────────────────

/**
 * Organism default schema. Maps today's creator/admin/member exactly:
 *   creator → manage everything incl. meta + transfer/schema (admin);
 *   admin   → write shared, write meta (manage-meta), promote/demote (manage-members);
 *   member  → read + write shared / own member namespace.
 * (The namespace-specific write rules — meta = admin-only, member.{self} = self — are expressed by
 * neededCapability(key) + the resolver's key routing, NOT by the level's capability list.)
 */
export const DEFAULT_ORGANISM_SCHEMA: LevelSchema = {
  groupType: 'organism',
  name: 'organism-default',
  levels: [
    { level: 0,  key: 'creator', label: 'Creator', capabilities: ['read', 'write', 'manage-members', 'manage-meta', 'admin'] },
    { level: 10, key: 'admin',   label: 'Admin',   capabilities: ['read', 'write', 'manage-members', 'manage-meta'] },
    { level: 20, key: 'member',  label: 'Member',  capabilities: ['read', 'write'] },
  ],
};

/**
 * Workspace default schema. Maps today's per-workspace roles exactly:
 *   lead (creator / same-owner) → read + write + manage access (manage-members);
 *   contributor → read + write; viewer → read only.
 */
export const DEFAULT_WORKSPACE_SCHEMA: LevelSchema = {
  groupType: 'workspace',
  name: 'workspace-default',
  levels: [
    { level: 0,  key: 'lead',        label: 'Lead',        capabilities: ['read', 'write', 'manage-members'] },
    { level: 10, key: 'contributor', label: 'Contributor', capabilities: ['read', 'write'] },
    { level: 20, key: 'viewer',      label: 'Viewer',      capabilities: ['read'] },
  ],
};

/** The capability set a given level holds under a schema (empty if the level is not in the ladder). */
export function capabilitiesOf(level: number, schema: LevelSchema): Set<string> {
  const def = schema.levels.find(l => l.level === level);
  return new Set(def ? def.capabilities : []);
}

// ── Derivation: today's role strings → a BBS level (Phase 1 faithfulness bridge) ──────────────

/** Organism membership role → organism level. */
export function deriveOrganismLevel(role: 'creator' | 'admin' | 'member'): number {
  return role === 'creator' ? 0 : role === 'admin' ? 10 : 20;
}

/**
 * Workspace-role consent → workspace level. `lead` is the creator / same-owner (no consent record —
 * the route short-circuits); `contributor`/`viewer` come from the consent `purpose`. Legacy
 * `workspace-access` = read-any = viewer.
 */
export function deriveWorkspaceLevel(role: 'lead' | 'contributor' | 'viewer'): number {
  return role === 'lead' ? 0 : role === 'contributor' ? 10 : 20;
}

// ── Key → scope + the capability a platform action needs ──────────────────────────────────────

/** Parse a platform memory key into its group scope, or null if it is not a platform-group key. */
export function scopeOf(key: string): { groupType: 'organism' | 'workspace'; groupRef: string } | null {
  const ws = key.match(/^organism\.([^.]+)\.w\.([^.]+)\./);
  if (ws) return { groupType: 'workspace', groupRef: `${ws[1]}/${ws[2]}` };
  const org = key.match(/^organism\.([^.]+)\./);
  if (org) return { groupType: 'organism', groupRef: org[1] };
  return null;
}

/**
 * Which platform capability an action on `key` requires. Read is always `read`. Write to an organism
 * `meta.*` namespace requires `manage-meta` (admin/creator only, today); every other write requires
 * `write`. (The member.{self} self-write and workspace-role routing are the resolver's key rules; this
 * function only names the capability the LEVEL must contain.)
 */
export function neededCapability(key: string, action: 'read' | 'write'): PlatformCapability {
  if (action === 'read') return 'read';
  if (/^organism\.[^.]+\.meta\./.test(key)) return 'manage-meta';
  return 'write';
}

/**
 * The pure platform decision: does a principal at `level` (under `schema`) hold the capability that
 * `action` on `key` requires? This is the level→capability half — membership/consent/scope reach are
 * decided elsewhere (the resolver). Used by the Phase-1 characterization test to prove the model
 * reproduces today's role-based allow/deny before any caller is switched to it.
 */
export function modelAllowsPlatform(level: number, schema: LevelSchema, key: string, action: 'read' | 'write'): boolean {
  return capabilitiesOf(level, schema).has(neededCapability(key, action));
}
