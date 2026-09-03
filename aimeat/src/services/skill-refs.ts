/**
 * @file skill-refs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The skills registry's addresses: the scope type, the ref grammar (node:{name},
 *   user:{owner}/{name}, ws:{org}/{ws}/{name}, an optional @semver pin) and its parser and
 *   formatter, the GHII a scope's records live under, and every memory-key convention the
 *   registry writes (manifest, files, version snapshots, workspace-prefixed forms). Moved out of
 *   skills.ts unchanged when that file crossed 800 lines; skills.ts re-exports the public part.
 * @structure SkillScope / SkillRef, parseSkillRef / formatSkillRef, scopeOwnerGhii,
 *   readNodeSkillBody, key helpers and regexes
 * @usage import { parseSkillRef, manifestKey } from './skill-refs.js';
 * @version-history
 *   v1.0.0 -- 2026-09-03 -- Extracted from services/skills.ts (pure move).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { SKILL_NAME_RE } from './skill-md.js';

// ── Refs & scopes ──

export type SkillScope = 'node' | 'user' | 'workspace';

export interface SkillRef {
  scope: SkillScope;
  /** Bare owner name — only for user scope. */
  owner?: string;
  /** Organism + workspace ids — only for workspace scope. */
  org?: string;
  ws?: string;
  name: string;
  /** Version pin (`…@1.2.0`) — resolves the retained snapshot instead of latest. */
  version?: string;
}

export const USER_REF_RE = /^user:([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9-]*)$/;
export const NODE_REF_RE = /^node:([a-z0-9][a-z0-9-]*)$/;
export const WS_REF_RE = /^ws:([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/([a-z0-9][a-z0-9-]*)$/;
export const PIN_RE = /^(.+)@(\d+\.\d+\.\d+)$/;

export function parseSkillRef(refStr: string): SkillRef | null {
  let version: string | undefined;
  let base = refStr;
  const pin = refStr.match(PIN_RE);
  if (pin) { base = pin[1]; version = pin[2]; }
  let ref: SkillRef | null = null;
  let m = base.match(NODE_REF_RE);
  if (m && SKILL_NAME_RE.test(m[1])) ref = { scope: 'node', name: m[1] };
  if (!ref) {
    m = base.match(USER_REF_RE);
    if (m && SKILL_NAME_RE.test(m[2])) ref = { scope: 'user', owner: m[1], name: m[2] };
  }
  if (!ref) {
    m = base.match(WS_REF_RE);
    if (m && SKILL_NAME_RE.test(m[3])) ref = { scope: 'workspace', org: m[1], ws: m[2], name: m[3] };
  }
  if (ref && version) ref.version = version;
  return ref;
}

export function formatSkillRef(ref: SkillRef): string {
  const pin = ref.version ? `@${ref.version}` : '';
  if (ref.scope === 'node') return `node:${ref.name}${pin}`;
  if (ref.scope === 'workspace') return `ws:${ref.org}/${ref.ws}/${ref.name}${pin}`;
  return `user:${ref.owner}/${ref.name}${pin}`;
}

/** The GHII a scope's records are stored under (node/user; workspace records are member-GHII-owned). */
export function scopeOwnerGhii(config: AimeatConfig, scope: SkillScope, owner?: string): string {
  return scope === 'node' ? `system@${config.nodeId}` : `${owner}@${config.nodeId}`;
}

/**
 * The SKILL.md a node-scope skill currently holds, or null when there is none.
 *
 * Here rather than in the caller because the key convention lives here: skill-seeds.ts has to
 * compare what the node holds against what the repo ships, and a second copy of
 * `skills.{name}.files.SKILL.md` in another file is a second place for that convention to drift.
 */
export async function readNodeSkillBody(
  storage: Storage, config: AimeatConfig, name: string,
): Promise<string | null> {
  const ownerGaii = scopeOwnerGhii(config, 'node');
  if (!await storage.getMemory(ownerGaii, manifestKey(name))) return null;
  const file = await storage.getMemory(ownerGaii, fileKey(name, 'SKILL.md'));
  return file ? String(file.value) : null;
}

export const manifestKey = (name: string): string => `skills.${name}.manifest`;
export const filePrefix = (name: string): string => `skills.${name}.files.`;
export const fileKey = (name: string, path: string): string => `${filePrefix(name)}${path}`;

// Immutable per-version snapshots ({ manifest, files }) written on every publish so
// `ref@{semver}` pins resolve exactly what was approved; pruned to the newest N.
export const VERSION_SNAPSHOTS_KEPT = 10;
export const versionPrefix = (name: string): string => `skills.${name}.versions.`;
export const versionKey = (name: string, v: string): string => `${versionPrefix(name)}${v}`;
export const wsVersionPrefix = (org: string, ws: string, name: string): string => `organism.${org}.w.${ws}.skills.${name}.versions.`;
export const wsVersionKey = (org: string, ws: string, name: string, v: string): string => `${wsVersionPrefix(org, ws, name)}${v}`;

/** Binding target for 2d app-bound skills: app:{ownerName}/{filename}. */
export const BINDING_RE = /^app:[a-z0-9][a-z0-9_-]*\/[A-Za-z0-9._-]+$/;

// Workspace scope: keys live under the workspace prefix (so they ride workspace
// export/import/templates), OWNED by the publishing member's GHII (the organism
// content-ownership invariant: keyed organism.*, owned by member GHII).
export const wsManifestKey = (org: string, ws: string, name: string): string => `organism.${org}.w.${ws}.skills.${name}.manifest`;
export const wsFilePrefix = (org: string, ws: string, name: string): string => `organism.${org}.w.${ws}.skills.${name}.files.`;
export const wsFileKey = (org: string, ws: string, name: string, path: string): string => `${wsFilePrefix(org, ws, name)}${path}`;

export const MANIFEST_KEY_RE = /^skills\.([a-z0-9-]+)\.manifest$/;
export const WS_MANIFEST_KEY_RE = /^organism\.([^.]+)\.w\.([^.]+)\.skills\.([a-z0-9-]+)\.manifest$/;
