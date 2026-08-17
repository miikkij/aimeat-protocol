/**
 * @file skills.ts
 * @description The skills registry — a dedicated system (NOT knowledge packages) that stores
 *   SKILL.md packs as memory records under scoped namespaces and resolves them for consumers.
 *   Core principle: skill (content) ≠ registry (scope) ≠ attachment (consumer).
 *
 *   Scopes (2a: node + user; 2c: workspace; app-binding reserved):
 *     - node      : `skills.{name}.*` under `system@{nodeId}` — operator-managed, node-wide library
 *     - user      : `skills.{name}.*` under the owner's GHII — personal registry; public = federated
 *     - workspace : `organism.{org}.w.{ws}.skills.{name}.*` — member-GHII-owned (organism content
 *       invariant), membership-gated via canReadWorkspace, freshest-wins across member copies;
 *       rides workspace export/import/templates automatically (export scans the ws key prefix)
 *   Storage layout per skill:
 *     - `skills.{name}.manifest`      — SkillManifestValue (frontmatter + file index, NO bodies)
 *     - `skills.{name}.files.{path}`  — one record per file (SKILL.md body, scripts/, references/, assets/)
 *   Progressive disclosure is structural: listings read manifests only; bodies load on resolve.
 *
 *   SkillRef — attachments store references, never copies:
 *     `node:{name}` | `user:{owner}/{name}`   (future: `ws:{org}/{ws}/{name}`, `@{version}` pins,
 *     federated `skill:{name}#{owner}@{node}`)
 *   Agent links live at `agents.{agentName}.skills` (owner-GHII-owned array of link entries).
 *   resolveSkillRef() is the single access-control + materialization choke point — every consumer
 *   (REST, MCP, crewaimeat connector, Claude-as-operator) goes through it.
 * @structure
 *   - SkillRef / parseSkillRef / formatSkillRef
 *   - SkillManifestValue / SkillSummary / ResolvedSkill / SkillAccessor
 *   - publishSkill / deleteSkill / listSkills / listSkillLibrary
 *   - resolveSkillRef — access-checked manifest+files materialization
 *   - getAgentSkillLinks / linkSkillToAgent / unlinkSkillFromAgent / resolveAgentSkills
 * @usage
 *   import { publishSkill, resolveSkillRef, listSkillLibrary } from '../services/skills.js';
 * @version-history
 *   v1.2.0 -- 2026-07-06 -- @{semver} ref pins (immutable per-version snapshots, newest 10 kept)
 *     + 2d app bindings (frontmatter metadata.binding -> manifest.binding, listSkillsByBinding).
 *   v1.1.0 -- 2026-07-06 -- Phase 2c: workspace scope (ws:{org}/{ws}/{name} refs, membership gate,
 *     member-GHII ownership + freshest-wins collapse, library workspace group via memberships).
 *   v1.0.0 -- 2026-07-05 -- Initial: Phase 2a registry core (node + user scopes, SkillRef resolver).
 */
import type { AimeatConfig } from '../config.js';
import { recordAccountEvent } from './account-events.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { validateSkillFiles, SkillValidationError, SKILL_NAME_RE } from './skill-md.js';
import { canReadWorkspace } from './workspace-access.js';

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

const USER_REF_RE = /^user:([a-z0-9][a-z0-9_-]*)\/([a-z0-9][a-z0-9-]*)$/;
const NODE_REF_RE = /^node:([a-z0-9][a-z0-9-]*)$/;
const WS_REF_RE = /^ws:([A-Za-z0-9-]+)\/([A-Za-z0-9-]+)\/([a-z0-9][a-z0-9-]*)$/;
const PIN_RE = /^(.+)@(\d+\.\d+\.\d+)$/;

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

const manifestKey = (name: string): string => `skills.${name}.manifest`;
const filePrefix = (name: string): string => `skills.${name}.files.`;
const fileKey = (name: string, path: string): string => `${filePrefix(name)}${path}`;

// Immutable per-version snapshots ({ manifest, files }) written on every publish so
// `ref@{semver}` pins resolve exactly what was approved; pruned to the newest N.
const VERSION_SNAPSHOTS_KEPT = 10;
const versionPrefix = (name: string): string => `skills.${name}.versions.`;
const versionKey = (name: string, v: string): string => `${versionPrefix(name)}${v}`;
const wsVersionPrefix = (org: string, ws: string, name: string): string => `organism.${org}.w.${ws}.skills.${name}.versions.`;
const wsVersionKey = (org: string, ws: string, name: string, v: string): string => `${wsVersionPrefix(org, ws, name)}${v}`;

interface SkillVersionSnapshot {
  manifest: SkillManifestValue;
  files: Record<string, string>;
}

/** Binding target for 2d app-bound skills: app:{ownerName}/{filename}. */
const BINDING_RE = /^app:[a-z0-9][a-z0-9_-]*\/[A-Za-z0-9._-]+$/;

// Workspace scope: keys live under the workspace prefix (so they ride workspace
// export/import/templates), OWNED by the publishing member's GHII (the organism
// content-ownership invariant: keyed organism.*, owned by member GHII).
const wsManifestKey = (org: string, ws: string, name: string): string => `organism.${org}.w.${ws}.skills.${name}.manifest`;
const wsFilePrefix = (org: string, ws: string, name: string): string => `organism.${org}.w.${ws}.skills.${name}.files.`;
const wsFileKey = (org: string, ws: string, name: string, path: string): string => `${wsFilePrefix(org, ws, name)}${path}`;

const MANIFEST_KEY_RE = /^skills\.([a-z0-9-]+)\.manifest$/;
const WS_MANIFEST_KEY_RE = /^organism\.([^.]+)\.w\.([^.]+)\.skills\.([a-z0-9-]+)\.manifest$/;

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
  visibility: MemoryRecord['visibility'];
  files: Array<{ path: string; size: number }>;
  updatedAt: string;
}

export interface ResolvedSkill extends SkillSummary {
  /** path -> content (utf-8). Present when resolve loads bodies. */
  fileContents: Record<string, string>;
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
}

export class SkillAccessError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'BAD_REF', message: string) {
    super(message);
    this.name = 'SkillAccessError';
  }
}

// ── Internals ──

function toSummary(record: MemoryRecord, scope: SkillScope, owner: string | null, org?: string, ws?: string): SkillSummary {
  const v = record.value as SkillManifestValue;
  const summary: SkillSummary = {
    ref: formatSkillRef({ scope, owner: owner ?? undefined, org, ws, name: v.name }),
    scope,
    owner,
    name: v.name,
    description: v.description,
    version: v.version,
    visibility: record.visibility,
    files: v.files ?? [],
    updatedAt: v.updatedAt ?? record.updatedAt,
  };
  if (org) { summary.org = org; summary.ws = ws; }
  if (v.license) summary.license = v.license;
  if (v.compatibility) summary.compatibility = v.compatibility;
  if (v.metadata) summary.metadata = v.metadata;
  if (v.binding) summary.binding = v.binding;
  return summary;
}

/** Fill sub/gaii defaults so owner-only accessors work with the workspace gate. */
function fullAccessor(config: AimeatConfig, accessor: SkillAccessor): Required<Pick<SkillAccessor, 'sub' | 'gaii'>> & SkillAccessor {
  const owner = accessor.ownerName ?? '';
  return {
    ...accessor,
    sub: accessor.sub ?? owner,
    gaii: accessor.gaii ?? `${owner}@${config.nodeId}`,
  };
}

/** Workspace read gate (membership + manifest read) for an accessor. */
async function mayReadWs(
  storage: Storage, config: AimeatConfig, org: string, ws: string, accessor: SkillAccessor,
): Promise<boolean> {
  if (!accessor.ownerName) return false;
  const organism = await storage.getOrganism(org);
  if (!organism) return false;
  const a = fullAccessor(config, accessor);
  return canReadWorkspace(storage, config, organism, a.sub, a.ownerName ?? undefined, a.gaii, ws);
}

/** All owners' copies of the records under a key prefix (workspace records may be
 *  published by different members — the organism content-ownership invariant). */
async function listAcrossOwners(storage: Storage, prefix: string): Promise<MemoryRecord[]> {
  const { items } = await storage.listAllMemory({ prefix, limit: 2000 });
  return items;
}

/** Collapse multi-owner copies of the same key to the freshest one (freshest-wins). */
function freshestByKey(records: MemoryRecord[]): Map<string, MemoryRecord> {
  const best = new Map<string, MemoryRecord>();
  for (const r of records) {
    const cur = best.get(r.key);
    if (!cur || String(r.updatedAt) > String(cur.updatedAt)) best.set(r.key, r);
  }
  return best;
}

/** Visibility gate shared by resolve/list. Owner of the skill always reads their own. */
function mayRead(record: MemoryRecord, scope: SkillScope, skillOwner: string | null, accessor: SkillAccessor): boolean {
  if (scope === 'node') {
    // Node skills are the node-wide library: readable by any authenticated identity
    // ('members' default); 'public' additionally allows anonymous/federated reads.
    if (record.visibility === 'public') return true;
    return accessor.ownerName !== null;
  }
  if (accessor.ownerName !== null && accessor.ownerName === skillOwner) return true;
  if (record.visibility === 'public') return true;
  if (record.visibility === 'members') return accessor.ownerName !== null;
  return false;
}

// ── Publish / delete ──

export interface PublishSkillOpts {
  scope: SkillScope;
  /** Bare owner name — required for user + workspace scope (the publishing member). */
  owner?: string;
  /** GAII/GHII performing the publish (recorded on the manifest). */
  publisher: string;
  /** Relative path -> content. Must contain SKILL.md; layout validated against the contract. */
  files: Map<string, string | Buffer>;
  /** Registry visibility. Defaults: node -> 'members', user -> 'owner', workspace -> 'workspace'. */
  visibility?: 'owner' | 'members' | 'public';
  /** When the files came from a wrapping directory (ZIP), its name — the frontmatter name must match. */
  expectedName?: string;
  /** Workspace scope only: target organism + workspace, and the accessor for the membership gate. */
  organismId?: string;
  workspaceId?: string;
  accessor?: SkillAccessor;
}

export async function publishSkill(
  storage: Storage, config: AimeatConfig, opts: PublishSkillOpts,
): Promise<SkillSummary> {
  if (opts.scope !== 'node' && !opts.owner) {
    throw new SkillValidationError('BAD_FIELD', 'A user/workspace-scope publish requires the owner name');
  }
  const { parsed } = validateSkillFiles(opts.files, opts.expectedName);
  const name = parsed.frontmatter.name;
  const now = new Date().toISOString();

  // 2d: an app binding travels in the frontmatter (metadata.binding) so it survives
  // export/clone; validated here and copied to the manifest top level for filtering.
  const binding = parsed.frontmatter.metadata?.binding;
  if (binding !== undefined && (typeof binding !== 'string' || !BINDING_RE.test(binding))) {
    throw new SkillValidationError('BAD_FIELD',
      'metadata.binding must be "app:{owner}/{filename}" (lowercase owner, the app file name)');
  }

  const isWs = opts.scope === 'workspace';
  let org = '', ws = '';
  if (isWs) {
    if (!opts.organismId || !opts.workspaceId) {
      throw new SkillValidationError('BAD_FIELD', 'A workspace-scope publish requires organismId and workspaceId');
    }
    org = opts.organismId; ws = opts.workspaceId;
    const gate = await mayReadWs(storage, config, org, ws, opts.accessor ?? { ownerName: opts.owner ?? null });
    if (!gate) throw new SkillAccessError('FORBIDDEN', `Not a member of workspace ${org}/${ws}`);
  }

  // Workspace records are keyed under the workspace prefix but OWNED by the publishing
  // member's GHII; multi-member republish forks collapse on read via freshest-wins.
  const ownerGaii = scopeOwnerGhii(config, isWs ? 'user' : opts.scope, opts.owner);
  const mKey = isWs ? wsManifestKey(org, ws, name) : manifestKey(name);
  const fKey = (path: string) => isWs ? wsFileKey(org, ws, name, path) : fileKey(name, path);

  // For versioning look at the freshest existing manifest across owners (workspace) or own (node/user).
  let existing = await storage.getMemory(ownerGaii, mKey);
  if (isWs) {
    const all = await listAcrossOwners(storage, mKey);
    const freshest = freshestByKey(all).get(mKey);
    if (freshest && (!existing || String(freshest.updatedAt) > String(existing.updatedAt))) existing = freshest;
  }
  const existingValue = existing?.value as SkillManifestValue | undefined;
  const version = existingValue?.version ? bumpPatch(existingValue.version) : '1.0.0';
  const visibility: MemoryRecord['visibility'] = isWs
    ? 'workspace'
    : (opts.visibility ?? existing?.visibility ?? (opts.scope === 'node' ? 'members' : 'owner'));
  const workspaceRef = isWs ? `${org}/${ws}` : undefined;

  // Write file records (mirroring the manifest's visibility), then remove stale ones (own copies).
  const fileIndex: Array<{ path: string; size: number }> = [];
  const fileTexts: Record<string, string> = {};
  for (const [path, content] of opts.files) {
    const text = content.toString();
    fileTexts[path] = text;
    fileIndex.push({ path, size: Buffer.byteLength(text) });
    const prior = await storage.getMemory(ownerGaii, fKey(path));
    await storage.setMemory({
      key: fKey(path),
      ownerGaii,
      value: text,
      visibility,
      ...(workspaceRef ? { workspaceRef } : {}),
      tags: ['skill-file'],
      ttlHours: null,
      version: (prior?.version ?? 0) + 1,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    });
  }
  const stale = (existingValue?.files ?? []).filter(f => !opts.files.has(f.path));
  for (const f of stale) {
    await storage.deleteMemory(ownerGaii, fKey(f.path));
  }

  const manifest: SkillManifestValue = {
    type: 'skill',
    name,
    description: parsed.frontmatter.description,
    version,
    files: fileIndex,
    publishedBy: opts.publisher,
    createdAt: existingValue?.createdAt ?? now,
    updatedAt: now,
  };
  if (parsed.frontmatter.license) manifest.license = parsed.frontmatter.license;
  if (parsed.frontmatter.compatibility) manifest.compatibility = parsed.frontmatter.compatibility;
  if (parsed.frontmatter.metadata) manifest.metadata = parsed.frontmatter.metadata;
  if (typeof binding === 'string') manifest.binding = binding;

  const ownExisting = await storage.getMemory(ownerGaii, mKey);
  const record = await storage.setMemory({
    key: mKey,
    ownerGaii,
    value: manifest,
    visibility,
    ...(workspaceRef ? { workspaceRef } : {}),
    tags: ['skill', `scope:${opts.scope}`],
    ttlHours: null,
    version: (ownExisting?.version ?? 0) + 1,
    createdAt: ownExisting?.createdAt ?? now,
    updatedAt: now,
  });

  // Version snapshot for `@{semver}` pins: an immutable {manifest, files} copy per publish,
  // pruned to the newest VERSION_SNAPSHOTS_KEPT (own copies only).
  const vKey = isWs ? wsVersionKey(org, ws, name, version) : versionKey(name, version);
  const snapshot: SkillVersionSnapshot = { manifest, files: fileTexts };
  await storage.setMemory({
    key: vKey,
    ownerGaii,
    value: snapshot,
    visibility,
    ...(workspaceRef ? { workspaceRef } : {}),
    tags: ['skill-version'],
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const vPrefix = isWs ? wsVersionPrefix(org, ws, name) : versionPrefix(name);
  const snapshots = await storage.listMemory(ownerGaii, { prefix: vPrefix });
  if (snapshots.length > VERSION_SNAPSHOTS_KEPT) {
    const bySemver = (k: string) => k.slice(vPrefix.length).split('.').map(Number);
    const sorted = snapshots.sort((a, b) => {
      const [a1, a2, a3] = bySemver(a.key); const [b1, b2, b3] = bySemver(b.key);
      return (a1 - b1) || (a2 - b2) || (a3 - b3);
    });
    for (const old of sorted.slice(0, sorted.length - VERSION_SNAPSHOTS_KEPT)) {
      await storage.deleteMemory(ownerGaii, old.key);
    }
  }

  return toSummary(record, opts.scope, opts.scope === 'user' ? opts.owner! : null, isWs ? org : undefined, isWs ? ws : undefined);
}

function bumpPatch(version: string): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return '1.0.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export interface DeleteSkillOpts {
  /** Bare owner name — user scope. */
  owner?: string;
  /** Workspace scope target + accessor for the membership gate. */
  org?: string;
  ws?: string;
  accessor?: SkillAccessor;
}

/** Delete a skill (manifest + all file records). Caller enforces node/user authorization;
 *  workspace scope is membership-gated here and removes EVERY member's copies. */
export async function deleteSkill(
  storage: Storage, config: AimeatConfig, scope: SkillScope, name: string, opts: DeleteSkillOpts = {},
): Promise<boolean> {
  if (scope === 'workspace') {
    if (!opts.org || !opts.ws) return false;
    const gate = await mayReadWs(storage, config, opts.org, opts.ws, opts.accessor ?? { ownerName: opts.owner ?? null });
    if (!gate) throw new SkillAccessError('FORBIDDEN', `Not a member of workspace ${opts.org}/${opts.ws}`);
    const records = [
      ...await listAcrossOwners(storage, wsManifestKey(opts.org, opts.ws, name)),
      ...await listAcrossOwners(storage, wsFilePrefix(opts.org, opts.ws, name)),
      ...await listAcrossOwners(storage, wsVersionPrefix(opts.org, opts.ws, name)),
    ];
    if (records.length === 0) return false;
    for (const r of records) await storage.deleteMemory(r.ownerGaii, r.key);
    return true;
  }
  const ownerGaii = scopeOwnerGhii(config, scope, opts.owner);
  const existing = await storage.getMemory(ownerGaii, manifestKey(name));
  if (!existing) return false;
  const files = await storage.listMemory(ownerGaii, { prefix: filePrefix(name) });
  for (const f of files) await storage.deleteMemory(ownerGaii, f.key);
  const snapshots = await storage.listMemory(ownerGaii, { prefix: versionPrefix(name) });
  for (const s of snapshots) await storage.deleteMemory(ownerGaii, s.key);
  await storage.deleteMemory(ownerGaii, manifestKey(name));
  return true;
}

// ── List / resolve ──

/** List one scope's skills (manifests only — never loads bodies). Applies the read gate. */
export async function listSkills(
  storage: Storage, config: AimeatConfig, scope: SkillScope, accessor: SkillAccessor, owner?: string,
  wsTarget?: { org: string; ws: string },
): Promise<SkillSummary[]> {
  if (scope === 'workspace') {
    if (!wsTarget) return [];
    const gate = await mayReadWs(storage, config, wsTarget.org, wsTarget.ws, accessor);
    if (!gate) return [];
    const prefix = `organism.${wsTarget.org}.w.${wsTarget.ws}.skills.`;
    const records = (await listAcrossOwners(storage, prefix)).filter(r => WS_MANIFEST_KEY_RE.test(r.key));
    return [...freshestByKey(records).values()]
      .map(r => toSummary(r, 'workspace', null, wsTarget.org, wsTarget.ws));
  }
  const skillOwner = scope === 'user' ? (owner ?? accessor.ownerName ?? undefined) : undefined;
  if (scope === 'user' && !skillOwner) return [];
  const ownerGaii = scopeOwnerGhii(config, scope, skillOwner);
  const records = await storage.listMemory(ownerGaii, { prefix: 'skills.', tags: ['skill'] });
  return records
    .filter(r => MANIFEST_KEY_RE.test(r.key))
    .filter(r => mayRead(r, scope, skillOwner ?? null, accessor))
    .map(r => toSummary(r, scope, skillOwner ?? null));
}

/**
 * 2d: skills bound to one app (`app:{owner}/{filename}`), across node + user scopes and
 * all publishers — gated per record by the normal scope read rules. Used by the app-detail
 * surface (GET /v1/apps/:owner/:filename/skills) and aimeat_skill_list?binding=.
 */
export async function listSkillsByBinding(
  storage: Storage, config: AimeatConfig, binding: string, accessor: SkillAccessor,
): Promise<SkillSummary[]> {
  const systemGhii = scopeOwnerGhii(config, 'node');
  const records = (await listAcrossOwners(storage, 'skills.'))
    .filter(r => MANIFEST_KEY_RE.test(r.key))
    .filter(r => (r.value as SkillManifestValue)?.binding === binding);
  const out: SkillSummary[] = [];
  for (const r of records) {
    const isNode = r.ownerGaii === systemGhii;
    const skillOwner = isNode ? null : (r.ownerGaii.includes('@') ? r.ownerGaii.split('@')[0] : r.ownerGaii);
    if (!mayRead(r, isNode ? 'node' : 'user', skillOwner, accessor)) continue;
    out.push(toSummary(r, isNode ? 'node' : 'user', skillOwner));
  }
  return out;
}

/**
 * The skill library — everything this accessor can load right now, grouped by scope:
 * the node-wide library, the owner's personal registry, and the skills of every
 * organism workspace the accessor's owner is an active member of. This is how an
 * agent knows which scopes it is working with and what is available to load.
 */
export async function listSkillLibrary(
  storage: Storage, config: AimeatConfig, accessor: SkillAccessor,
): Promise<{ node: SkillSummary[]; user: SkillSummary[]; workspace: SkillSummary[] }> {
  const node = await listSkills(storage, config, 'node', accessor);
  const user = accessor.ownerName
    ? await listSkills(storage, config, 'user', accessor, accessor.ownerName)
    : [];
  const workspace: SkillSummary[] = [];
  if (accessor.ownerName) {
    const memberships = (await storage.listMembershipsByGhii(accessor.ownerName)).filter(m => m.status === 'active');
    for (const m of memberships) {
      // One prefix scan per organism; workspace manifests carry org+ws in their key.
      const records = (await listAcrossOwners(storage, `organism.${m.organismId}.w.`))
        .filter(r => WS_MANIFEST_KEY_RE.test(r.key));
      const byWs = new Map<string, MemoryRecord[]>();
      for (const r of records) {
        const km = r.key.match(WS_MANIFEST_KEY_RE)!;
        const wsId = km[2];
        (byWs.get(wsId) ?? byWs.set(wsId, []).get(wsId)!).push(r);
      }
      for (const [wsId, wsRecords] of byWs) {
        const gate = await mayReadWs(storage, config, m.organismId, wsId, accessor);
        if (!gate) continue;
        for (const r of freshestByKey(wsRecords).values()) {
          workspace.push(toSummary(r, 'workspace', null, m.organismId, wsId));
        }
      }
    }
  }
  return { node, user, workspace };
}

/**
 * THE choke point: resolve a SkillRef to its manifest (+ file bodies unless `manifestOnly`),
 * enforcing scope access rules. Throws SkillAccessError (BAD_REF / NOT_FOUND / FORBIDDEN).
 */
export async function resolveSkillRef(
  storage: Storage, config: AimeatConfig, refStr: string, accessor: SkillAccessor,
  opts: { manifestOnly?: boolean } = {},
): Promise<ResolvedSkill> {
  const ref = parseSkillRef(refStr);
  if (!ref) throw new SkillAccessError('BAD_REF', `Not a valid skill ref: ${refStr} (expected node:{name}, user:{owner}/{name}, or ws:{org}/{ws}/{name})`);

  if (ref.scope === 'workspace') {
    const { org, ws, name } = ref as Required<Pick<SkillRef, 'org' | 'ws' | 'name'>> & SkillRef;
    if (!await mayReadWs(storage, config, org!, ws!, accessor)) {
      throw new SkillAccessError('FORBIDDEN', `Not allowed to read skill: ${refStr}`);
    }
    const copies = await listAcrossOwners(storage, wsManifestKey(org!, ws!, name));
    const record = freshestByKey(copies).get(wsManifestKey(org!, ws!, name));
    if (!record) throw new SkillAccessError('NOT_FOUND', `Skill not found: ${refStr}`);
    if (ref.version && ref.version !== (record.value as SkillManifestValue).version) {
      return resolvePinned(storage, record, wsVersionKey(org!, ws!, name, ref.version), ref, opts);
    }
    const summary = toSummary(record, 'workspace', null, org, ws);
    const fileContents: Record<string, string> = {};
    if (!opts.manifestOnly) {
      // Read the file records published alongside THIS manifest copy (same owner).
      for (const f of summary.files) {
        const rec = await storage.getMemory(record.ownerGaii, wsFileKey(org!, ws!, name, f.path));
        if (rec) fileContents[f.path] = String(rec.value);
      }
    }
    return { ...summary, fileContents };
  }

  const skillOwner = ref.scope === 'user' ? ref.owner! : null;
  const ownerGaii = scopeOwnerGhii(config, ref.scope, ref.owner);
  const record = await storage.getMemory(ownerGaii, manifestKey(ref.name));
  if (!record) throw new SkillAccessError('NOT_FOUND', `Skill not found: ${refStr}`);
  if (!mayRead(record, ref.scope, skillOwner, accessor)) {
    throw new SkillAccessError('FORBIDDEN', `Not allowed to read skill: ${refStr}`);
  }
  if (ref.version && ref.version !== (record.value as SkillManifestValue).version) {
    return resolvePinned(storage, record, versionKey(ref.name, ref.version), ref, opts);
  }

  const summary = toSummary(record, ref.scope, skillOwner);
  if (ref.version) summary.ref = formatSkillRef(ref);
  const fileContents: Record<string, string> = {};
  if (!opts.manifestOnly) {
    for (const f of summary.files) {
      const rec = await storage.getMemory(ownerGaii, fileKey(ref.name, f.path));
      if (rec) fileContents[f.path] = String(rec.value);
    }
  }
  return { ...summary, fileContents };
}

/** Resolve a version pin from its retained snapshot. The live manifest record has already
 *  passed the scope's access gate; the snapshot lives under the same owner. */
async function resolvePinned(
  storage: Storage, liveManifest: MemoryRecord, snapshotKey: string, ref: SkillRef,
  opts: { manifestOnly?: boolean },
): Promise<ResolvedSkill> {
  const snap = await storage.getMemory(liveManifest.ownerGaii, snapshotKey);
  if (!snap) {
    throw new SkillAccessError('NOT_FOUND',
      `Version ${ref.version} of ${formatSkillRef({ ...ref, version: undefined })} is not retained (the registry keeps the newest ${VERSION_SNAPSHOTS_KEPT} snapshots)`);
  }
  const { manifest, files } = snap.value as SkillVersionSnapshot;
  const summary = toSummary(
    { ...liveManifest, value: manifest },
    ref.scope, ref.scope === 'user' ? ref.owner! : null, ref.org, ref.ws,
  );
  summary.ref = formatSkillRef(ref);
  return { ...summary, fileContents: opts.manifestOnly ? {} : files };
}

// ── Agent attachment (links are refs, never copies) ──

export interface AgentSkillLink {
  ref: string;
  name: string;
  description: string;
  linkedAt: string;
  linkedBy: string;
}

const agentSkillsKey = (agentName: string): string => `agents.${agentName}.skills`;

export async function getAgentSkillLinks(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string,
): Promise<AgentSkillLink[]> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const record = await storage.getMemory(ownerGhii, agentSkillsKey(agentName));
  return Array.isArray(record?.value) ? record.value as AgentSkillLink[] : [];
}

/**
 * Link a skill to an agent: validates the ref resolves for this owner, then appends to the
 * owner-GHII-owned `agents.{name}.skills` record (idempotent per ref).
 */
export async function linkSkillToAgent(
  storage: Storage, config: AimeatConfig,
  ownerName: string, agentName: string, refStr: string, linkedBy: string,
  accessor?: SkillAccessor,
): Promise<AgentSkillLink[]> {
  const resolved = await resolveSkillRef(storage, config, refStr, accessor ?? { ownerName }, { manifestOnly: true });
  const links = await getAgentSkillLinks(storage, config, ownerName, agentName);
  if (!links.some(l => l.ref === resolved.ref)) {
    links.push({
      ref: resolved.ref,
      name: resolved.name,
      description: resolved.description,
      linkedAt: new Date().toISOString(),
      linkedBy,
    });
    await writeAgentSkillLinks(storage, config, ownerName, agentName, links);
    // Inside the `if`, so re-linking a skill an agent already has says nothing. The event is the
    // agent gaining a capability it did not have, not the request having been made.
    void recordAccountEvent(storage, {
      ownerGhii: `${ownerName}@${config.nodeId}`,
      kind: 'skill_installed',
      actorGaii: linkedBy,
      subject: resolved.ref,
      link: '/v1/profile?tab=skills',
      data: { name: resolved.name || resolved.ref, agent: agentName },
    }, config);
  }
  return links;
}

export async function unlinkSkillFromAgent(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string, refStr: string,
): Promise<AgentSkillLink[]> {
  const links = await getAgentSkillLinks(storage, config, ownerName, agentName);
  const next = links.filter(l => l.ref !== refStr);
  if (next.length !== links.length) {
    await writeAgentSkillLinks(storage, config, ownerName, agentName, next);
  }
  return next;
}

async function writeAgentSkillLinks(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string, links: AgentSkillLink[],
): Promise<void> {
  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const key = agentSkillsKey(agentName);
  const existing = await storage.getMemory(ownerGhii, key);
  const now = new Date().toISOString();
  await storage.setMemory({
    key,
    ownerGaii: ownerGhii,
    value: links,
    visibility: existing?.visibility ?? 'owner',
    tags: existing?.tags ?? ['skill-links'],
    ttlHours: null,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Resolve everything linked to an agent — the read crewaimeat's run_crew consumes. Unresolvable
 * links (deleted skill, revoked visibility) are reported, never silently dropped.
 */
export async function resolveAgentSkills(
  storage: Storage, config: AimeatConfig, ownerName: string, agentName: string,
  opts: { manifestOnly?: boolean; accessor?: SkillAccessor } = {},
): Promise<{ skills: ResolvedSkill[]; unresolved: Array<{ ref: string; error: string }> }> {
  const links = await getAgentSkillLinks(storage, config, ownerName, agentName);
  const skills: ResolvedSkill[] = [];
  const unresolved: Array<{ ref: string; error: string }> = [];
  for (const link of links) {
    try {
      skills.push(await resolveSkillRef(storage, config, link.ref, opts.accessor ?? { ownerName }, opts));
    } catch (err) {
      unresolved.push({ ref: link.ref, error: (err as Error).message });
    }
  }
  return { skills, unresolved };
}
