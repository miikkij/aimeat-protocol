/**
 * @file skills.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - agent links: skill-agent-links.ts (getAgentSkillLinks / linkSkillToAgent / unlinkSkillFromAgent / resolveAgentSkills)
 * @usage
 *   import { publishSkill, resolveSkillRef, listSkillLibrary } from '../services/skills.js';
 * @version-history
 *   v1.14.0 -- 2026-10-26 -- Agent Skills standard (wish-agent-skills-standardin-t-ysi-tuki-skill-rekisteriss):
 *     publishSkill stores a file that is not UTF-8 text as base64 with `encoding` on its index entry
 *     (skill-files.ts), refuses a NEW skill whose SKILL.md breaks a blocking rule of the standard
 *     (NOT_STANDARD) and names the issues on the answer otherwise, and keeps the files the publish does
 *     not name when asked (`keepFiles`). resolveSkillRef reads SKILL.md alone (`bodyOnly`) or one file
 *     (`path`, FILE_NOT_FOUND when the skill holds none of that name), the standard's progressive
 *     disclosure levels 2 and 3.
 *   v1.13.1 -- 2026-10-26 -- The agent attachment section moved to skill-agent-links.ts (pure
 *     extraction, max-file-lines); its importers import it from there.
 *   v1.13.0 -- 2026-10-22 -- deleteSkill settles a user skill's waiting publish requests `outdated`
 *     (secaudit 2026-10, apply-skill.ts:applySkillPublish:semver-restarts-on-delete-recreate).
 *   v1.12.0 -- 2026-10-20 -- The workspace readers (listSkills, listSkillLibraryPlain,
 *     resolveSkillRef) leave out a copy whose OWNER may not write that workspace's content
 *     (writtenByWsWriters in skill-records.ts), before freshest-wins. Defence in depth for secaudit
 *     2026-10: a package install wrote `organism.<id>.w.<ws>.skills.*` with a raw setMemory under
 *     the installer's identity, so an owner who is not a member of the organism planted a skill
 *     that the members' agents then loaded as instructions. The install is refused at its own check
 *     now (package-memory-component.ts), and a copy that reaches storage by any other path is no
 *     longer served. The cost is one access check per distinct copy OWNER per workspace, not per
 *     record, so a list of twenty skills from two publishers pays two.
 *   v1.11.0 -- 2026-10-20 -- A WORKSPACE SKILL IS WORKSPACE CONTENT, so publishSkill and deleteSkill
 *     ask the workspace WRITE rule (checkOrganismNamespaceAccess in write mode on the skill's
 *     manifest key) after the membership gate. Both authorized the write with mayReadWs /
 *     canReadWorkspace, which is the READ decision, so a `viewer` grant passed it: another member's
 *     agents load a workspace skill as their operating instructions, freshest-wins across owners let
 *     a viewer's copy replace the creator's, and the delete removed every member's copies (secaudit
 *     2026-10, defect 2). DECIDED with it: the delete no longer removes other owners' copies for
 *     everyone who may write. The workspace's registered creator and an organism manager remove
 *     every copy, which is what the workspace meta rule already says about who administers the
 *     workspace; a contributor removes their own copies and gets NOT_FOUND when they hold none. The
 *     session the rules decide on travels on SkillAccessor.caller (skill-types.ts), which the REST
 *     route and the MCP tool already build; a code path that hands none over is read as a scoped
 *     principal, the stricter of the two.
 *   v1.10.0 -- 2026-10-18 -- publishSkill and setSkillVisibility write the manifest on the version they
 *     read (setMemoryIfVersion / createMemoryIfAbsent) and make the write again on a fresh read when
 *     another writer came between, so two publishes at the same moment get two versions and two
 *     snapshots, and a visibility change beside a publish keeps both (atomic-write round).
 *   v1.9.0 -- 2026-10-17 -- A user skill may be read by `organism:<id>`, the active members of one
 *     organism (plan doc-mvcn6c7e4e5q, V3.9): publishSkill and setSkillVisibility take it, refused
 *     before any write unless the caller is in that organism; the read gate is mayReadSkill
 *     (skill-audience.ts), which asks services/audience.ts. The shapes and SkillAccessError moved to
 *     skill-types.ts (max-file-lines) and are re-exported here.
 *   v1.8.0 -- 2026-10-09 -- A user skill binds only to its publisher's own app (assertSkillBinding, skill-refs.ts); listSkillsByBinding leaves out a user skill whose owner does not own the bound app.
 *   v1.7.0 -- 2026-10-08 -- publishSkill records how SKILL.md was made (skill-provenance.ts) and sets
 *     the record on the SKILL.md file and the manifest; the summary names it (aiprov E12).
 *     listAcrossOwners and freshestByKey moved to skill-records.ts (max-file-lines).
 *   v1.6.0 -- 2026-10-02 -- `fromPackage` may carry the package's `author` and `originNode`.
 *   v1.5.0 -- 2026-09-30 -- `fromPackage` on the manifest and the summary: the package install that
 *     published a user skill (package-skill-component.ts). A republish without it keeps the tag.
 *   v1.4.0 -- 2026-09-29 -- TARGET-082 V4: every user and workspace record a list or a resolve returns
 *     (manifests, file bodies, version snapshots) passes the accessor's ContentReader through
 *     showSkillRecords (skill-reader.ts). A manifest the reader may not see reads as not found; a
 *     hidden file is left out of fileContents. Node skills are the node's own library and pass.
 *   v1.3.1 -- 2026-09-26 -- listSkillsByBinding takes a skill owner's account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.3.0 -- 2026-09-03 -- What the Skills page needed the registry to say (design canvas "AIMEAT
 *     Taidot-sivu"): setSkillVisibility() changes who may read a skill without a republish (no
 *     version bump, no snapshot); resolve carries `versions`, the retained snapshots a pin can
 *     name; the library carries `linkedBy` (the owner's agents holding the ref) on request and
 *     `builtin` on node skills the seeder stamped; frontmatter metadata.superseded_by is validated
 *     and mirrored to manifest.supersededBy, so a retired skill is a fact and not a sentence.
 *   v1.2.0 -- 2026-07-06 -- @{semver} ref pins (immutable per-version snapshots, newest 10 kept)
 *     + 2d app bindings (frontmatter metadata.binding -> manifest.binding, listSkillsByBinding).
 *   v1.1.0 -- 2026-07-06 -- Phase 2c: workspace scope (ws:{org}/{ws}/{name} refs, membership gate,
 *     member-GHII ownership + freshest-wins collapse, library workspace group via memberships).
 *   v1.0.0 -- 2026-07-05 -- Initial: Phase 2a registry core (node + user scopes, SkillRef resolver).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { validateSkillFiles, SkillValidationError, SKILL_NAME_RE } from './skill-md.js';
import { canReadWorkspace } from './workspace-access.js';
import { assertWsSkillWrite, mayActOnEveryWsSkillCopy, wsWriteCaller } from './skill-workspace-gate.js';
import { localAccountName } from '../utils/gaii.js';
import { showSkillRecords } from './skill-reader.js';
import { listAcrossOwners, freshestByKey, writtenByWsWriters } from './skill-records.js';
import { CAS_ATTEMPTS } from './record-cas.js';
import { skillProvenanceId, type SkillPublishProvenance } from './skill-provenance.js';
import { settleRequestsForRemovedTarget } from './publish-requests/store.js';
import { mayReadSkill, publisherMayName, skillVisibilityOf, storedSkillVisibility, type SkillVisibility } from './skill-audience.js';
import { getAgentSkillLinks } from './skill-agent-link-records.js';
import { storedSkillFile, skillFileBytes, type SkillFileEntry } from './skill-files.js';

// The addresses (ref grammar, scope owner, key conventions) live in skill-refs.ts since 2026-09-03.
import {
  parseSkillRef, formatSkillRef, scopeOwnerGhii,
  manifestKey, filePrefix, fileKey, VERSION_SNAPSHOTS_KEPT, versionPrefix, versionKey,
  wsVersionPrefix, wsVersionKey, assertSkillBinding, bindingOwner, wsManifestKey, wsFilePrefix, wsFileKey,
  MANIFEST_KEY_RE, WS_MANIFEST_KEY_RE, type SkillScope, type SkillRef,
} from './skill-refs.js';
export { parseSkillRef, formatSkillRef, scopeOwnerGhii, readNodeSkillBody, type SkillScope, type SkillRef } from './skill-refs.js';

// The stored and returned shapes and SkillAccessError live in skill-types.ts (max-file-lines).
import { SkillAccessError, type SkillVersionSnapshot, type SkillPackageTag, type SkillManifestValue, type SkillSummary, type ResolvedSkill, type SkillAccessor } from './skill-types.js';
export { SkillAccessError, type SkillPackageTag, type SkillManifestValue, type SkillSummary, type ResolvedSkill, type SkillAccessor } from './skill-types.js';

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
    visibility: skillVisibilityOf(record) as SkillSummary['visibility'],
    files: v.files ?? [],
    updatedAt: v.updatedAt ?? record.updatedAt,
  };
  if (org) { summary.org = org; summary.ws = ws; }
  if (v.license) summary.license = v.license;
  if (v.compatibility) summary.compatibility = v.compatibility;
  if (v.metadata) summary.metadata = v.metadata;
  if (v.binding) summary.binding = v.binding;
  if (v.supersededBy) summary.supersededBy = v.supersededBy;
  if (v.fromPackage) summary.fromPackage = v.fromPackage;
  if (record.aiProvenanceId) summary.aiProvenanceId = record.aiProvenanceId;
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

// The WRITE rule for a workspace skill is services/skill-workspace-gate.ts: reading a workspace is
// not writing it, and a workspace skill is workspace content (secaudit 2026-10, defect 2).

// The visibility gate shared by resolve and list is mayReadSkill (skill-audience.ts), with the
// organisation level; it was mayRead here until 2026-10-17.

// ── Publish / delete ──

export interface PublishSkillOpts {
  scope: SkillScope;
  /** Bare owner name — required for user + workspace scope (the publishing member). */
  owner?: string;
  /** GAII/GHII performing the publish (recorded on the manifest). */
  publisher: string;
  /** Relative path -> content. Must contain SKILL.md; layout validated against the contract. */
  files: Map<string, string | Buffer>;
  /** Registry visibility. Defaults: node -> 'members', user -> 'owner', workspace -> 'workspace'.
   *  `organism:<id>` is a user skill's only, and the publisher must be in that organism. */
  visibility?: SkillVisibility;
  /** When the files came from a wrapping directory (ZIP), its name — the frontmatter name must match. */
  expectedName?: string;
  /** Workspace scope only: target organism + workspace, and the accessor for the membership gate. */
  organismId?: string;
  workspaceId?: string;
  accessor?: SkillAccessor;
  /** User scope: the package install publishing this skill. Absent keeps the tag the skill had. */
  fromPackage?: SkillPackageTag;
  /** Who writes SKILL.md and what they declared (skill-provenance.ts). Absent records nothing. */
  provenance?: SkillPublishProvenance;
  /** Keep every file the skill already holds that `files` does not name, instead of removing it:
   *  an editor that changes SKILL.md alone republishes without dropping references/ or assets/. */
  keepFiles?: boolean;
  /**
   * What a rule of the Agent Skills standard that SKILL.md breaks does (skill-md.ts issues). Default
   * 'enforce-new': a skill new to its registry is refused with NOT_STANDARD for a blocking issue, and a
   * skill already there publishes with the issues named in `standardIssues`. 'warn' never refuses: a
   * package install carries a skill its author published under the older rules.
   */
  standard?: 'enforce-new' | 'warn';
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
  // export/clone; validated here (shape, and a user skill names its publisher's own app)
  // and copied to the manifest top level for filtering.
  const binding = parsed.frontmatter.metadata?.binding;
  assertSkillBinding(binding, opts.scope, opts.owner);

  // A retired skill names its successor the same way: in its own frontmatter, so the fact travels
  // with the file. A ref or a bare name; nothing else, since a reader will paste it into a load.
  const supersededBy = parsed.frontmatter.metadata?.superseded_by;
  if (supersededBy !== undefined && (typeof supersededBy !== 'string' || !(parseSkillRef(supersededBy) || SKILL_NAME_RE.test(supersededBy)))) {
    throw new SkillValidationError('BAD_FIELD',
      'metadata.superseded_by must be a skill ref (node:{name}, user:{owner}/{name}, ws:{org}/{ws}/{name}) or a bare skill name');
  }

  const isWs = opts.scope === 'workspace';
  let org = '', ws = '';
  if (isWs) {
    if (!opts.organismId || !opts.workspaceId) {
      throw new SkillValidationError('BAD_FIELD', 'A workspace-scope publish requires organismId and workspaceId');
    }
    org = opts.organismId; ws = opts.workspaceId;
    const accessor = opts.accessor ?? { ownerName: opts.owner ?? null };
    const gate = await mayReadWs(storage, config, org, ws, accessor);
    if (!gate) throw new SkillAccessError('FORBIDDEN', `Not a member of workspace ${org}/${ws}`);
    // mayReadWs is the READ decision, which a viewer grant passes. Writing the skill asks the
    // workspace WRITE rule as well, before the first record is written.
    await assertWsSkillWrite(storage, config, org, ws, name, accessor);
  }
  // An organisation level names an organism the publisher is in; refused before the first write.
  await assertSkillVisibility(storage, opts.scope, opts.visibility, opts.accessor ?? { ownerName: opts.owner ?? null, sub: opts.publisher });

  // Workspace records are keyed under the workspace prefix but OWNED by the publishing
  // member's GHII; multi-member republish forks collapse on read via freshest-wins.
  const ownerGaii = scopeOwnerGhii(config, isWs ? 'user' : opts.scope, opts.owner);
  const mKey = isWs ? wsManifestKey(org, ws, name) : manifestKey(name);
  const fKey = (path: string) => isWs ? wsFileKey(org, ws, name, path) : fileKey(name, path);

  // The skill as the registry holds it now: the caller's own copy, or a workspace's freshest copy
  // among those its writers made, as a reader of the workspace sees it.
  const prior = isWs
    ? freshestByKey(await writtenByWsWriters({ storage, config }, org, ws, await listAcrossOwners(storage, mKey))).get(mKey)
    : await storage.getMemory(ownerGaii, mKey);
  // The Agent Skills standard's stricter rules refuse a NEW skill, before anything is written; a
  // skill already in the registry was published under the older rules and keeps working.
  const blocking = parsed.issues.filter(i => i.blocking);
  if (blocking.length > 0 && !prior && opts.standard !== 'warn') {
    throw new SkillValidationError('NOT_STANDARD',
      `The skill does not follow the Agent Skills standard (agentskills.io/specification): ${blocking.map(i => i.message).join(' ')}`);
  }
  // keepFiles: the files the skill holds that this publish does not name stay as they are.
  const files = new Map(opts.files);
  if (opts.keepFiles && prior) {
    for (const f of (prior.value as SkillManifestValue).files ?? []) {
      if (files.has(f.path)) continue;
      const kept = await storage.getMemory(prior.ownerGaii, fKey(f.path));
      if (kept) files.set(f.path, skillFileBytes(String(kept.value), f.encoding));
    }
  }

  const workspaceRef = isWs ? `${org}/${ws}` : undefined;
  // How SKILL.md was made, decided before the first write so a refused declaration stores nothing.
  // Once per visibility, so a write made again below does not record it twice.
  const provenanceIds = new Map<string, Promise<string | undefined>>();
  const provenanceFor = (visibility: MemoryRecord['visibility']) => {
    if (!provenanceIds.has(visibility)) provenanceIds.set(visibility, skillProvenanceId(storage, config, opts.provenance, String(files.get('SKILL.md') ?? ''), visibility));
    return provenanceIds.get(visibility)!;
  };

  // The manifest is written on the version of the own record read at the start of the write. When
  // another publish or a visibility change wrote it meanwhile, the whole write is made again on a
  // fresh read, so two publishes at the same moment get two versions and two snapshots.
  const writeOnce = async () => {
    // For versioning look at the freshest existing manifest across owners (workspace) or own (node/user).
    const own = await storage.getMemory(ownerGaii, mKey);
    let existing = own;
    if (isWs) {
      const all = await listAcrossOwners(storage, mKey);
      const freshest = freshestByKey(all).get(mKey);
      if (freshest && (!existing || String(freshest.updatedAt) > String(existing.updatedAt))) existing = freshest;
    }
    const existingValue = existing?.value as SkillManifestValue | undefined;
    const version = existingValue?.version ? bumpPatch(existingValue.version) : '1.0.0';
    const chosen = opts.visibility ?? (existing ? skillVisibilityOf(existing) as SkillVisibility : undefined) ?? (opts.scope === 'node' ? 'members' : 'owner');
    const stored = storedSkillVisibility(chosen);
    const visibility: MemoryRecord['visibility'] = isWs ? 'workspace' : stored.record;
    const aiProvenanceId = await provenanceFor(visibility);

    // Write file records (mirroring the manifest's visibility), then remove stale ones (own copies).
    // A file that is not UTF-8 text is stored as base64 and its index entry says so (skill-files.ts).
    const fileIndex: SkillFileEntry[] = [];
    const fileTexts: Record<string, string> = {};
    for (const [path, content] of files) {
      const { value: text, size, encoding } = storedSkillFile(content);
      fileTexts[path] = text;
      fileIndex.push({ path, size, ...(encoding ? { encoding } : {}) });
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
        ...(path === 'SKILL.md' && aiProvenanceId ? { aiProvenanceId } : {}),
      });
    }
    const stale = (existingValue?.files ?? []).filter(f => !files.has(f.path));
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
    if (typeof supersededBy === 'string') manifest.supersededBy = supersededBy;
    // The owner editing a package's skill keeps it the package's: the update sees the edit, the uninstall removes it.
    const fromPackage = opts.fromPackage ?? (opts.scope === 'user' ? existingValue?.fromPackage : undefined);
    if (fromPackage) manifest.fromPackage = fromPackage;
    if (!isWs && stored.audience) manifest.audience = stored.audience;

    const next: MemoryRecord = {
      key: mKey,
      ownerGaii,
      value: manifest,
      visibility,
      ...(workspaceRef ? { workspaceRef } : {}),
      tags: ['skill', `scope:${opts.scope}`],
      ttlHours: null,
      version: (own?.version ?? 0) + 1,
      createdAt: own?.createdAt ?? now,
      updatedAt: now,
      ...(aiProvenanceId ? { aiProvenanceId } : {}),
    };
    const record = own
      ? (storage.setMemoryIfVersion ? await storage.setMemoryIfVersion(next, own.version) : await storage.setMemory(next))
      : (storage.createMemoryIfAbsent ? await storage.createMemoryIfAbsent(next) : await storage.setMemory(next));
    return record ? { record, manifest, version, visibility, fileTexts } : null;
  };
  let written: Awaited<ReturnType<typeof writeOnce>> = null;
  for (let attempt = 0; attempt < CAS_ATTEMPTS && !written; attempt++) written = await writeOnce();
  if (!written) throw new Error(`skill ${name} changed under every one of ${CAS_ATTEMPTS} attempts; try again`);
  const { record, manifest, version, visibility, fileTexts } = written;

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

  const summary = toSummary(record, opts.scope, opts.scope === 'user' ? opts.owner! : null, isWs ? org : undefined, isWs ? ws : undefined);
  if (parsed.issues.length > 0) summary.standardIssues = parsed.issues.map(({ code, field, message }) => ({ code, field, message }));
  return summary;
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
 *  workspace scope is membership- and write-gated here. The workspace's creator and an organism
 *  manager remove EVERY member's copies; a contributor removes their own. */
export async function deleteSkill(
  storage: Storage, config: AimeatConfig, scope: SkillScope, name: string, opts: DeleteSkillOpts = {},
): Promise<boolean> {
  if (scope === 'workspace') {
    if (!opts.org || !opts.ws) return false;
    const accessor = opts.accessor ?? { ownerName: opts.owner ?? null };
    const gate = await mayReadWs(storage, config, opts.org, opts.ws, accessor);
    if (!gate) throw new SkillAccessError('FORBIDDEN', `Not a member of workspace ${opts.org}/${opts.ws}`);
    // As on publish: reading the workspace is not writing it.
    await assertWsSkillWrite(storage, config, opts.org, opts.ws, name, accessor);
    const everyCopy = await mayActOnEveryWsSkillCopy(storage, config, opts.org, opts.ws, accessor);
    const mine = wsWriteCaller(config, accessor).owner;
    const records = [
      ...await listAcrossOwners(storage, wsManifestKey(opts.org, opts.ws, name)),
      ...await listAcrossOwners(storage, wsFilePrefix(opts.org, opts.ws, name)),
      ...await listAcrossOwners(storage, wsVersionPrefix(opts.org, opts.ws, name)),
    ].filter(r => everyCopy || localAccountName(r.ownerGaii) === mine);
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
  // A request waiting to make it public names content that is gone; one created again starts at 1.0.0.
  if (scope === 'user' && opts.owner) await settleRequestsForRemovedTarget({ storage, config }, ownerGaii, 'skill', { owner: opts.owner, name }, `the skill ${name}`);
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
    // A copy whose owner may not write this workspace's content is not one of its skills.
    const records = await writtenByWsWriters({ storage, config }, wsTarget.org, wsTarget.ws,
      (await listAcrossOwners(storage, prefix)).filter(r => WS_MANIFEST_KEY_RE.test(r.key)));
    // The check runs after freshest-wins, so a hidden newest copy never lets an older one through.
    return (await showSkillRecords({ storage, config }, accessor, [...freshestByKey(records).values()]))
      .map(r => toSummary(r, 'workspace', null, wsTarget.org, wsTarget.ws));
  }
  const skillOwner = scope === 'user' ? (owner ?? accessor.ownerName ?? undefined) : undefined;
  if (scope === 'user' && !skillOwner) return [];
  const ownerGaii = scopeOwnerGhii(config, scope, skillOwner);
  const manifests = (await storage.listMemory(ownerGaii, { prefix: 'skills.', tags: ['skill'] })).filter(r => MANIFEST_KEY_RE.test(r.key));
  const readable = await Promise.all(manifests.map(r => mayReadSkill(storage, r, scope, skillOwner ?? null, accessor)));
  const summaries = (await showSkillRecords({ storage, config }, accessor, manifests.filter((_, i) => readable[i])))
    .map(r => toSummary(r, scope, skillOwner ?? null));
  if (scope === 'node' && summaries.length > 0) {
    // The seeder leaves a stamp beside every skill it wrote; a stamped skill came with the build.
    const stamps = await storage.listMemory(ownerGaii, { prefix: 'skills.', tags: ['skill-seed'] });
    const seeded = new Set(stamps.map(s => s.key.replace(/^skills\.([a-z0-9-]+)\.seeded-from-repo$/, '$1')));
    for (const s of summaries) if (seeded.has(s.name)) s.builtin = true;
  }
  return summaries;
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
  const ownerOf = (r: MemoryRecord) => (r.ownerGaii === systemGhii ? null : localAccountName(r.ownerGaii));
  // A user skill counts only when its owner owns the app; one bound to another account's app
  // before publish refused it (2026-10-09) stays in its owner's registry and is not listed here.
  const own = records.filter(r => r.ownerGaii === systemGhii || ownerOf(r) === bindingOwner(binding));
  const readable = await Promise.all(own.map(r => mayReadSkill(storage, r, r.ownerGaii === systemGhii ? 'node' : 'user', ownerOf(r), accessor)));
  const gated = own.filter((_, i) => readable[i]);
  return (await showSkillRecords({ storage, config }, accessor, gated))
    .map(r => toSummary(r, r.ownerGaii === systemGhii ? 'node' : 'user', ownerOf(r)));
}

/**
 * The skill library — everything this accessor can load right now, grouped by scope:
 * the node-wide library, the owner's personal registry, and the skills of every
 * organism workspace the accessor's owner is an active member of. This is how an
 * agent knows which scopes it is working with and what is available to load.
 */
export async function listSkillLibrary(
  storage: Storage, config: AimeatConfig, accessor: SkillAccessor,
  opts: { links?: boolean } = {},
): Promise<{ node: SkillSummary[]; user: SkillSummary[]; workspace: SkillSummary[] }> {
  const library = await listSkillLibraryPlain(storage, config, accessor);
  if (opts.links && accessor.ownerName) {
    // Which of the owner's agents hold a ref to each skill. One keyed read per agent; a pinned
    // ref (`…@1.0.2`) counts for the skill it pins and keeps its pin in the answer.
    const agents = (await storage.listAgents()).filter(a => a.owner === accessor.ownerName);
    const byRef = new Map<string, SkillSummary>();
    for (const s of [...library.node, ...library.user, ...library.workspace]) byRef.set(s.ref, s);
    for (const agent of agents) {
      const links = await getAgentSkillLinks(storage, config, accessor.ownerName, agent.name);
      for (const link of links) {
        const skill = byRef.get(link.ref.replace(/@\d+\.\d+\.\d+$/, ''));
        if (!skill) continue;
        (skill.linkedBy ??= []).push({ agent: agent.name, ref: link.ref });
      }
    }
  }
  return library;
}

async function listSkillLibraryPlain(
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
        // A copy whose owner may not write this workspace's content is not one of its skills.
        const written = await writtenByWsWriters({ storage, config }, m.organismId, wsId, wsRecords);
        for (const r of await showSkillRecords({ storage, config }, accessor, [...freshestByKey(written).values()])) {
          workspace.push(toSummary(r, 'workspace', null, m.organismId, wsId));
        }
      }
    }
  }
  return { node, user, workspace };
}

/**
 * Which files a resolve reads, the Agent Skills standard's three levels: none (`manifestOnly`, the
 * name, description and file index), SKILL.md alone (`bodyOnly`, the instructions), or one file
 * (`path`, a resource loaded when the instructions call for it). Without any of them, every file.
 * A `path` the skill does not hold is FILE_NOT_FOUND, so a caller trying refs in turn stops there.
 */
export interface ResolveSkillOpts { manifestOnly?: boolean; bodyOnly?: boolean; path?: string }

function filesToRead(files: SkillFileEntry[], opts: ResolveSkillOpts, refStr: string): SkillFileEntry[] {
  if (opts.manifestOnly) return [];
  if (opts.path !== undefined) {
    const one = files.find(f => f.path === opts.path);
    if (!one) throw new SkillAccessError('FILE_NOT_FOUND', `The skill ${refStr} has no file "${opts.path}"; the files of its manifest are the paths it holds.`);
    return [one];
  }
  return opts.bodyOnly ? files.filter(f => f.path === 'SKILL.md') : files;
}

/**
 * THE choke point: resolve a SkillRef to its manifest plus the file bodies `opts` asks for
 * (filesToRead), enforcing scope access rules. Throws SkillAccessError (BAD_REF / NOT_FOUND /
 * FILE_NOT_FOUND / FORBIDDEN).
 */
export async function resolveSkillRef(
  storage: Storage, config: AimeatConfig, refStr: string, accessor: SkillAccessor,
  opts: ResolveSkillOpts = {},
): Promise<ResolvedSkill> {
  const ref = parseSkillRef(refStr);
  if (!ref) throw new SkillAccessError('BAD_REF', `Not a valid skill ref: ${refStr} (expected node:{name}, user:{owner}/{name}, or ws:{org}/{ws}/{name})`);

  if (ref.scope === 'workspace') {
    const { org, ws, name } = ref as Required<Pick<SkillRef, 'org' | 'ws' | 'name'>> & SkillRef;
    if (!await mayReadWs(storage, config, org!, ws!, accessor)) {
      throw new SkillAccessError('FORBIDDEN', `Not allowed to read skill: ${refStr}`);
    }
    // A copy whose owner may not write this workspace's content is not one of its skills.
    const copies = await writtenByWsWriters({ storage, config }, org!, ws!,
      await listAcrossOwners(storage, wsManifestKey(org!, ws!, name)));
    const freshest = freshestByKey(copies).get(wsManifestKey(org!, ws!, name));
    const [record] = freshest ? await showSkillRecords({ storage, config }, accessor, [freshest]) : [];
    if (!record) throw new SkillAccessError('NOT_FOUND', `Skill not found: ${refStr}`);
    if (ref.version && ref.version !== (record.value as SkillManifestValue).version) {
      return resolvePinned(storage, config, accessor, record, wsVersionKey(org!, ws!, name, ref.version), ref, opts);
    }
    const summary = toSummary(record, 'workspace', null, org, ws);
    // Read the file records published alongside THIS manifest copy (same owner).
    const fileContents = await readFileBodies(storage, config, accessor,
      record.ownerGaii, filesToRead(summary.files, opts, refStr).map(f => [f.path, wsFileKey(org!, ws!, name, f.path)]));
    const versions = retainedVersions(await writtenByWsWriters({ storage, config }, org!, ws!,
      await listAcrossOwners(storage, wsVersionPrefix(org!, ws!, name))), wsVersionPrefix(org!, ws!, name));
    return { ...summary, fileContents, versions };
  }

  const skillOwner = ref.scope === 'user' ? ref.owner! : null;
  const ownerGaii = scopeOwnerGhii(config, ref.scope, ref.owner);
  const stored = await storage.getMemory(ownerGaii, manifestKey(ref.name));
  if (!stored) throw new SkillAccessError('NOT_FOUND', `Skill not found: ${refStr}`);
  if (!(await mayReadSkill(storage, stored, ref.scope, skillOwner, accessor))) {
    throw new SkillAccessError('FORBIDDEN', `Not allowed to read skill: ${refStr}`);
  }
  // A manifest this reader may not see reads as absent, as a missing one does.
  const [record] = await showSkillRecords({ storage, config }, accessor, [stored]);
  if (!record) throw new SkillAccessError('NOT_FOUND', `Skill not found: ${refStr}`);
  if (ref.version && ref.version !== (record.value as SkillManifestValue).version) {
    return resolvePinned(storage, config, accessor, record, versionKey(ref.name, ref.version), ref, opts);
  }

  const summary = toSummary(record, ref.scope, skillOwner);
  if (ref.version) summary.ref = formatSkillRef(ref);
  const fileContents = await readFileBodies(storage, config, accessor,
    ownerGaii, filesToRead(summary.files, opts, refStr).map(f => [f.path, fileKey(ref.name, f.path)]));
  const versions = retainedVersions(await storage.listMemory(ownerGaii, { prefix: versionPrefix(ref.name) }), versionPrefix(ref.name));
  return { ...summary, fileContents, versions };
}

/** The file bodies of one manifest copy, path -> text, each record through the accessor's reader. */
async function readFileBodies(
  storage: Storage, config: AimeatConfig, accessor: SkillAccessor, ownerGaii: string, files: Array<[string, string]>,
): Promise<Record<string, string>> {
  const pathOf = new Map(files.map(([path, key]) => [key, path]));
  const found = (await Promise.all(files.map(([, key]) => storage.getMemory(ownerGaii, key)))).filter((r): r is MemoryRecord => !!r);
  const out: Record<string, string> = {};
  for (const r of await showSkillRecords({ storage, config }, accessor, found)) out[pathOf.get(r.key)!] = String(r.value);
  return out;
}

/** The retained snapshots under a version prefix as (version, publishedAt), oldest first. */
function retainedVersions(records: MemoryRecord[], prefix: string): Array<{ version: string; publishedAt: string }> {
  const semver = (v: string) => v.split('.').map(Number);
  return records
    .filter(r => r.key.startsWith(prefix) && /^\d+\.\d+\.\d+$/.test(r.key.slice(prefix.length)))
    .map(r => ({ version: r.key.slice(prefix.length), publishedAt: String(r.createdAt) }))
    .sort((a, b) => { const [a1, a2, a3] = semver(a.version); const [b1, b2, b3] = semver(b.version); return (a1 - b1) || (a2 - b2) || (a3 - b3); });
}

/** Resolve a version pin from its retained snapshot. The live manifest record has already
 *  passed the scope's access gate; the snapshot lives under the same owner. */
async function resolvePinned(
  storage: Storage, config: AimeatConfig, accessor: SkillAccessor, liveManifest: MemoryRecord, snapshotKey: string, ref: SkillRef,
  opts: ResolveSkillOpts,
): Promise<ResolvedSkill> {
  const stored = await storage.getMemory(liveManifest.ownerGaii, snapshotKey);
  const [snap] = stored ? await showSkillRecords({ storage, config }, accessor, [stored]) : [];
  if (!snap) {
    throw new SkillAccessError('NOT_FOUND',
      `Version ${ref.version} of ${formatSkillRef({ ...ref, version: undefined })} is not retained (the registry keeps the newest ${VERSION_SNAPSHOTS_KEPT} snapshots)`);
  }
  const { manifest, files } = snap.value as SkillVersionSnapshot;
  // Who reads it is the live skill's answer, not the snapshot's.
  const summary = toSummary(
    { ...liveManifest, value: { ...manifest, audience: (liveManifest.value as SkillManifestValue).audience } },
    ref.scope, ref.scope === 'user' ? ref.owner! : null, ref.org, ref.ws,
  );
  summary.ref = formatSkillRef(ref);
  const prefix = snapshotKey.slice(0, snapshotKey.length - ref.version!.length);
  const versions = retainedVersions(await storage.listMemory(liveManifest.ownerGaii, { prefix }), prefix);
  const fileContents: Record<string, string> = {};
  for (const f of filesToRead(summary.files, opts, summary.ref)) if (typeof files[f.path] === 'string') fileContents[f.path] = files[f.path];
  return { ...summary, fileContents, versions };
}

/**
 * Change a skill's visibility without a republish: the manifest and its file records take the
 * new visibility, the registry version stays, no snapshot is written. Node and user scopes only;
 * a workspace skill is always workspace-visible. The caller decides who may (own user skill;
 * node scope for operators). `organism:<id>` is refused here, before any write, unless the caller
 * (`accessor`, else the owner) is in that organism.
 */
export async function setSkillVisibility(
  storage: Storage, config: AimeatConfig, scope: 'node' | 'user', name: string,
  visibility: SkillVisibility, owner?: string, accessor?: SkillAccessor,
): Promise<SkillSummary | null> {
  await assertSkillVisibility(storage, scope, visibility, accessor ?? { ownerName: owner ?? null });
  const ownerGaii = scopeOwnerGhii(config, scope, owner);
  const stored = storedSkillVisibility(visibility);
  // Written on the manifest's version: when a publish wrote it meanwhile, the files and the manifest
  // are set again on a fresh read, so neither the new version nor the visibility is lost.
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const manifest = await storage.getMemory(ownerGaii, manifestKey(name));
    if (!manifest) return null;
    const now = new Date().toISOString();
    const files = await storage.listMemory(ownerGaii, { prefix: filePrefix(name) });
    for (const f of files) {
      await storage.setMemory({ ...f, visibility: stored.record, version: f.version + 1, updatedAt: now });
    }
    const value: SkillManifestValue = { ...(manifest.value as SkillManifestValue) };
    if (stored.audience) value.audience = stored.audience; else delete value.audience;
    const next = { ...manifest, key: manifestKey(name), value, visibility: stored.record, version: manifest.version + 1, updatedAt: now };
    const record = storage.setMemoryIfVersion ? await storage.setMemoryIfVersion(next, manifest.version) : await storage.setMemory(next);
    if (record) return toSummary(record, scope, scope === 'user' ? (owner ?? null) : null);
  }
  throw new Error(`skill ${name} changed under every one of ${CAS_ATTEMPTS} attempts; try again`);
}

/** Refuse the organisation level outside a user skill, or naming an organism the caller is not in. */
async function assertSkillVisibility(
  storage: Storage, scope: SkillScope, v: SkillVisibility | undefined, accessor: SkillAccessor,
): Promise<void> {
  if (!v || v === 'owner' || v === 'members' || v === 'public') return;
  if (scope !== 'user') throw new SkillAccessError('BAD_VISIBILITY', 'Only a skill in your own registry can be shared with an organisation.');
  if (!(await publisherMayName(storage, v, accessor))) {
    throw new SkillAccessError('NOT_ORGANISM_MEMBER', 'You can share a skill only with an organisation you are an active member of. Join it first, or choose another visibility.');
  }
}

// Agent attachment (getAgentSkillLinks, linkSkillToAgent, unlinkSkillFromAgent, resolveAgentSkills)
// lives in skill-agent-links.ts since 2026-10-26 (max-file-lines).
