/**
 * @file src/services/skill-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The skills registry's stored and returned shapes, and its access error. Moved out of
 *   services/skills.ts (max-file-lines), which re-exports every one of them, so its importers are
 *   unchanged.
 * @structure SkillVersionSnapshot · SkillPackageTag · SkillManifestValue · SkillSummary · ResolvedSkill ·
 *   SkillAccessor · SkillAccessError
 * @usage import { type SkillSummary, SkillAccessError } from './skills.js';   // through the re-export
 * @version-history
 *   v1.1.0 — 2026-10-20 — SkillAccessor.caller: the session (CallerContext) the workspace WRITE rule
 *     for a workspace skill decides on (secaudit 2026-10, defect 2).
 *   v1.0.0 — 2026-10-17 — Extracted from skills.ts (pure extraction), with the organisation level's
 *     additions of the same change: SkillManifestValue.audience, SkillAccessor.auth, the
 *     BAD_VISIBILITY and NOT_ORGANISM_MEMBER codes (plan doc-mvcn6c7e4e5q, V3.9).
 */
import type { MemoryRecord } from '../storage/interface.js';
import type { ContentReader } from './classification/reader.js';
import type { SkillScope } from './skill-refs.js';
import type { SkillVisibility } from './skill-audience.js';
import type { AudienceAuth } from './audience.js';
import type { CallerContext } from './caller-context.js';

export interface SkillVersionSnapshot {
  manifest: SkillManifestValue;
  files: Record<string, string>;
}

/** Which package install published a skill: the package group and the installed copy. */
/**
 * The package install that published a skill. `author` and `originNode` say who wrote the package and
 * which node it came from (package sale design, T5): the skill is instructions the owner's AI follows,
 * and its reader is told whose. Absent on a skill a package installed before 2026-10-02.
 */
export interface SkillPackageTag { groupId: string; instanceId: string; author?: string; originNode?: string }


// ── Stored shapes ──

export interface SkillManifestValue {
  type: 'skill';
  name: string;
  description: string;
  /** Registry semver — starts 1.0.0, patch-bumped on every republish. */
  version: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  /** 2d: the app this skill teaches, `app:{owner}/{filename}` — copied up from
   *  frontmatter metadata.binding for cheap filtering. */
  binding?: string;
  /** The skill that replaces this one — copied up from frontmatter metadata.superseded_by
   *  (a ref such as `user:alice/new-name`, or a bare name in the same registry), so the
   *  registry knows a skill is retired instead of the reader having to spot it in prose. */
  supersededBy?: string;
  /** Installed by a package (package-skill-component.ts); kept across the owner's own republish. */
  fromPackage?: SkillPackageTag;
  /** `organism:<id>` when a user skill is read by one organism's members; its records then sit at 'owner' (skill-audience.ts). */
  audience?: string;
  /** File index (paths + sizes) — bodies live in the per-file records, never here. */
  files: Array<{ path: string; size: number }>;
  /** GAII/GHII that performed the (last) publish. */
  publishedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSummary {
  ref: string;
  scope: SkillScope;
  /** Bare owner name for user scope; null for node/workspace scope. */
  owner: string | null;
  /** Organism + workspace ids — workspace scope only. */
  org?: string;
  ws?: string;
  name: string;
  description: string;
  version: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  /** 2d: app binding, when the skill teaches a specific app. */
  binding?: string;
  /** The skill that replaces this one, when it is retired (frontmatter metadata.superseded_by). */
  supersededBy?: string;
  /** The package install that published this skill; only such a skill is replaced or removed by it. */
  fromPackage?: SkillPackageTag;
  /** Node scope: shipped with this build and kept in step by the seeder (a stamp record exists). */
  builtin?: boolean;
  /** Library view with links: the accessor's own agents that link this skill, with the ref they
   *  hold (a pinned ref keeps its `@version`). */
  linkedBy?: Array<{ agent: string; ref: string }>;
  visibility: MemoryRecord['visibility'] | SkillVisibility;
  files: Array<{ path: string; size: number }>;
  updatedAt: string;
  /** The provenance record of SKILL.md, from the manifest row; absent is UNSTATED (skill-provenance.ts). */
  aiProvenanceId?: string;
}

export interface ResolvedSkill extends SkillSummary {
  /** path -> content (utf-8). Present when resolve loads bodies. */
  fileContents: Record<string, string>;
  /** The retained version snapshots, oldest first; a `@version` pin resolves any of these. */
  versions: Array<{ version: string; publishedAt: string }>;
}

/** Who is asking — null accessor = anonymous/unauthenticated. */
export interface SkillAccessor {
  /** Bare owner name of the caller (owner sessions and agent sessions both resolve to this). */
  ownerName: string | null;
  isOperator?: boolean;
  /** Raw auth subject (bare owner / full GAII) — used by the workspace membership gate.
   *  Derived from ownerName when absent. */
  sub?: string;
  /** Full GHII/GAII — used by the workspace read gate. Derived from ownerName when absent. */
  gaii?: string;
  /** The caller's classification reader; made from ownerName/gaii when absent (skill-reader.ts). */
  reader?: ContentReader;
  /** The session's auth for the organisation level (audienceAllows); made from ownerName/sub when absent. */
  auth?: AudienceAuth | null;
  /**
   * The session itself (services/caller-context.ts), which the workspace WRITE rule decides on: the
   * principal, the owner, the roles and the scopes in one object the route and the MCP tool already
   * build. A code path that hands over none is read as a scoped principal, the stricter of the two.
   */
  caller?: CallerContext;
}

export class SkillAccessError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REF' | 'BAD_VISIBILITY' | 'NOT_ORGANISM_MEMBER', message: string) {
    super(message);
    this.name = 'SkillAccessError';
  }
}
