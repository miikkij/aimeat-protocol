/**
 * @file workspace-meta.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Update a workspace's definition IN PLACE — its name, readme, and/or its whole
 *   structure (the manifest: objectTypes/spaces, policy/gate, settings) plus record schemas — without
 *   changing its id or orphaning references. Editing structure is just editing the manifest, so the
 *   ONE update path covers add/remove space, gate, settings and schema locks (no per-operation tools).
 *   The name is kept in sync across the manifest and the organism's workspace registry. The records
 *   stay owned by the workspace creator; only the creator (or an org admin) may update them. Shared by
 *   the `aimeat_workspace_update` MCP tool and PUT /v1/organisms/:id/workspace.
 * @structure updateWorkspaceMeta(storage, config, opts); WorkspaceMetaError; the reader every surface
 *   shares for a workspace's meta records: workspaceMetaReader / readWorkspaceMetaRecord /
 *   readWorkspaceManifest over workspaceRegistrations + pickWorkspaceMetaCopy; unionObjectTypes (the
 *   additive space union) and writeWorkspaceMetaRecord (the one meta write); the workspace's rule for
 *   its members' changes: MemberChangeRule / normalizeMemberChangeRule / readMemberChangeRule
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: in-place name + readme update.
 *   v1.1.0 — 2026-06-09 — Manifest + schemas: one update path for structure (spaces/gate/settings).
 *   v1.2.0 — 2026-06-09 — Additive `addObjectTypes`: the server UNIONS new spaces into the manifest
 *     (skip-if-exists), filling sensible objectType defaults, so an agent provisions its contract's
 *     spaces deterministically without sending (and risking) the whole manifest. Returns {added, skipped}.
 *   v1.3.0 — 2026-06-10 — Backing gate + shared read predicate. normalizeObjectTypes() rejects
 *     backing:'storage'/'knowledge' loudly (they were accepted silently while every read surface
 *     skipped the space — published content became invisible) and infers mode:'document' from a
 *     kind:'document' objectType (old clients used `kind`; the open envelope swallowed it and the
 *     space fell into records mode). isMemoryBackedSpace() is THE predicate every read path shares.
 *   v1.4.0 — 2026-07-02 — Workspace app bindings: optional `apps` (FULL replace, [] clears) pins
 *     published apps ({owner, filename}) to the workspace. Stored as its OWN meta record
 *     (`…meta.apps`, like the readme) so a manifest full-replace can never clobber the bindings.
 *   v1.5.0 — 2026-07-10 — Add listOrganismWorkspaceEntries(): THE shared cross-member aggregation of
 *     the per-creator workspace registry (dedupe by id). Organism export read only the exporter's own
 *     registry record and produced empty bundles for promoted admins / transferred creators.
 *   v1.6.0 — 2026-07-25 — Add backfillManifestEnvelope(): the shared "fill the envelope the model omits"
 *     helper (manifestVersion/id/name/kind/status). Every create path (server MCP, connector MCP, REST
 *     provision) used to backfill only id+status, so a manifest built from the tool's own documented
 *     example — which never showed manifestVersion — was rejected on the first call and agents had to
 *     iterate. A create with just objectTypes now validates first try.
 *   v1.7.0 — 2026-08-26 — backing:'rows' joins the supported set, with isRowBackedSpace() as its
 *     shared predicate and normalizeObjectTypes() refusing the three ways a row space can be
 *     declared wrong (indexOn/retention on a memory space, more than three indexed fields, and
 *     versioned:true). readWorkspaceManifest() is lifted here from the MCP tool's local copy so
 *     every surface resolves a space through one read.
 *   v1.8.0 — 2026-09-03 — readWorkspaceSchemas(): the locked schemas, keyed by namespace, in the
 *     shape `schemas` takes back. An agent could REPLACE a workspace's schemas over MCP but had no
 *     way to READ them: the tool's own advice was to fetch GET /v1/memory/{key}/schema first, which
 *     an MCP-only client cannot do, so the safe round-trip was impossible and an update dropped
 *     whatever the previous schema said. Both read surfaces now return them.
 *   v1.9.0 — 2026-09-14 — The additive path fills the defaults of the backing it is adding. They
 *     were the memory ones for every space, so `add_spaces` with `backing:'rows'` failed on the
 *     `versioned: true` it had just stamped itself, and a row space that got through carried
 *     `mode: 'records'` — a memory space's storage mode, on a space that stores neither records nor
 *     documents. Reported 2026-09-14 from a node building an eCOA diary on row spaces.
 *   v1.10.0 — 2026-09-24 — readWorkspaceManifest reads the workspace creator's copy, whatever order
 *     the store returns the copies in (secaudit 2026-09, A6-9). It took the first row, with no owner
 *     filter, and a row space takes its writeRole and its app allowlist from that manifest.
 *     findWorkspaceRegistration() and pickWorkspaceMetaCopy() are the shared halves: the first says
 *     who created a workspace, the second which copy counts, and updateWorkspaceMeta writes the copy
 *     the read takes. It takes the node id to tell this node's identities from a visitor's.
 *   v1.11.0 — 2026-09-24 — workspaceMetaReader() / readWorkspaceMetaRecord(): the one reader for every
 *     workspace meta record (manifest, share, readme, apps, intake), so the readers that decide who
 *     reads a workspace, what it shares and how a space publishes take the copy that counts too.
 *     workspaceRegistrations() reads the registry once for a whole organism, archived copies
 *     included; updateWorkspaceMeta writes the readme and apps copies the readers take.
 *   v1.12.0 — 2026-09-25 — The workspace's rule for its plain members' changes, `member_changes`
 *     ('direct' | 'suggest', default 'suggest'), as its own meta record (`…meta.rules`) that a manifest
 *     replace cannot clobber; updateWorkspaceMeta sets it, creator or admin only, and
 *     readMemberChangeRule reads the copy that counts. unionObjectTypes() and writeWorkspaceMetaRecord()
 *     are the additive space union and the meta write, moved out unchanged so the member change doors
 *     (services/workspace-member-changes.ts) add a space the way this path does. NOT_CREATOR names
 *     those doors.
 *   v1.12.1 — 2026-09-26 — bareOwnerOf takes the account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 */
import type { Storage, MemoryRecord, ArchiveFilter } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { localAccountName } from '../utils/gaii.js';
import { validateMemoryWrite } from './schema-validator.js';

export class WorkspaceMetaError extends Error {
  constructor(public code: 'WS_NOT_FOUND' | 'NOT_CREATOR' | 'NOTHING_TO_UPDATE' | 'INVALID_MANIFEST' | 'INVALID_APPS' | 'INVALID_RULE', message: string) {
    super(message);
    this.name = 'WorkspaceMetaError';
  }
}

/**
 * How a workspace takes a change from a plain member (neither its creator nor an organism admin):
 * adding a space, or changing the sections of a document space. 'direct' writes it at once into the
 * workspace's own records with the member's name on it; 'suggest' files it as a suggestion that the
 * creator or an admin approves or declines. The default is 'suggest': nothing a member does changes
 * someone else's structure until its owner has chosen that it may.
 */
export type MemberChangeRule = 'direct' | 'suggest';
export const DEFAULT_MEMBER_CHANGE_RULE: MemberChangeRule = 'suggest';

/** The rule a value names, or null when it names none. */
export function normalizeMemberChangeRule(v: unknown): MemberChangeRule | null {
  return v === 'direct' || v === 'suggest' ? v : null;
}

/** The rule in force on one workspace: the copy of `…meta.rules` that counts, else the default. */
export async function readMemberChangeRule(
  storage: Storage, orgId: string, wsId: string, nodeId: string,
): Promise<MemberChangeRule> {
  const rec = await readWorkspaceMetaRecord(storage, orgId, wsId, 'meta.rules', nodeId);
  return normalizeMemberChangeRule((rec?.value as { member_changes?: unknown } | null)?.member_changes) ?? DEFAULT_MEMBER_CHANGE_RULE;
}

/** Backings the workspace tooling actually implements. 'memory' spaces hold records/documents as
 *  workspace memory keys; 'tasks' is a declarative POINTER to the task system (no workspace records);
 *  'rows' spaces hold many rows in a table, for what a GROUP accumulates rather than what one person
 *  authored. 'storage'/'knowledge' are intentionally NOT here: files and knowledge packages attach to
 *  a workspace via Sources or embedded document images, never as a backed space. */
export const SUPPORTED_BACKINGS = new Set(['memory', 'tasks', 'rows']);

/** How many fields a row space may promote to indexed columns. Three is the whole budget. */
export const MAX_INDEX_ON = 3;

/** Does this space's data live in workspace memory keys (so reads must list them)? A missing
 *  backing counts as memory — the write path stores memory keys regardless. This is THE shared
 *  predicate for every read surface (MCP workspace_read, REST GET /workspace, the UI via the REST
 *  response); three hand-rolled variants of this check is how published content once went invisible. */
export function isMemoryBackedSpace(ot: { backing?: unknown }): boolean {
  return !ot.backing || ot.backing === 'memory';
}

/** Does this space's data live in the row table? THE shared predicate, for the same reason as above:
 *  a read surface that hand-rolls this check is a surface a row space eventually goes missing from. */
export function isRowBackedSpace(ot: { backing?: unknown }): boolean {
  return ot.backing === 'rows';
}

/** The manifest as a caller resolving a space needs it. Everything else in it is somebody else's. */
export type WorkspaceManifest = { objectTypes?: Array<Record<string, unknown>> } & Record<string, unknown>;

/**
 * Read a workspace's manifest from the member who created it.
 *
 * The prefix read rather than a single-owner get is the point: the registry is per creator, so a
 * member who did not create the workspace must still be able to resolve its spaces. Every surface
 * that resolves a space shares this, because two copies is two chances for one door to see a space
 * the other does not.
 *
 * WHICH COPY. A memory key is unique per owner, not per node, so the manifest can be stored under
 * more than one identity. This took the first row the store returned, and a row space takes its
 * writeRole and its app allowlist from here, so the copy that sorted first decided who may write
 * the space; on Postgres, rows that share a key come back in no defined order. pickWorkspaceMetaCopy
 * says which copy counts. `nodeId` is this node's, so a copy under another node's identity counts
 * for nothing.
 */
export async function readWorkspaceManifest(
  storage: Storage, organismId: string, wsId: string, nodeId: string,
): Promise<WorkspaceManifest | null> {
  const rec = await readWorkspaceMetaRecord(storage, organismId, wsId, 'meta.manifest', nodeId);
  return rec ? (rec.value as WorkspaceManifest) : null;
}

/**
 * The JSON Schemas locked on a workspace's record spaces, keyed by NAMESPACE.
 *
 * The shape is deliberately the one `updateWorkspaceMeta`'s `schemas` option takes, so a caller can
 * read, edit one entry and send the map straight back. That symmetry is the whole point: `schemas`
 * REPLACES rather than merges, and until this existed the only way to see the current schema was
 * `GET /v1/memory/{key}/schema`, which an MCP-only agent cannot call. A tool that can overwrite what
 * it cannot read is a tool that quietly drops whatever the old schema said.
 *
 * Locks live in the schema store (keyPattern `organism.{id}.w.{ws}.{namespace}`, applyTo 'prefix'),
 * not in the manifest, which is why this is a second read rather than a field on the manifest.
 */
export async function readWorkspaceSchemas(
  storage: Storage, organismId: string, wsId?: string,
): Promise<Record<string, Record<string, unknown>>> {
  const root = wsId ? `organism.${organismId}.w.${wsId}.` : `organism.${organismId}.`;
  const out: Record<string, Record<string, unknown>> = {};
  for (const lock of await storage.listSchemas(root)) {
    const namespace = lock.keyPattern.slice(root.length);
    // A lock on the root itself carries no namespace, and a workspace-scoped read must not surface
    // another workspace's locks — `organism.{id}.` is a prefix of `organism.{id}.w.{other}.` too.
    if (!namespace || (!wsId && namespace.startsWith('w.'))) continue;
    out[namespace] = lock.schemaJson;
  }
  return out;
}

/** Gate + normalize a manifest's objectTypes before any manifest write (create, full replace,
 *  additive). Rejects unsupported backings with an instructive error instead of accepting a space
 *  no read path will ever show, and infers mode:'document' when an objectType declares
 *  kind:'document' without a mode. Returns a new array; throws WorkspaceMetaError. */
export function normalizeObjectTypes(objectTypes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return objectTypes.map(ot => {
    const name = String(ot?.name ?? '?');
    const backing = ot?.backing;
    if (typeof backing === 'string' && backing && !SUPPORTED_BACKINGS.has(backing)) {
      throw new WorkspaceMetaError('INVALID_MANIFEST',
        `objectType "${name}": backing '${backing}' is not supported. A space holding records or documents is backing:'memory'; a space accumulating many rows a group adds to is backing:'rows'; the task system is referenced with backing:'tasks'. Files and knowledge packages attach via workspace Sources or embedded document images, not as a backed space.`);
    }

    // indexOn and retention are row-space vocabulary. Accepting them on a memory space would
    // advertise filtering and a retention promise that nothing implements — the same "a space no
    // read path serves" mistake that removed 'storage' and 'knowledge' from the backing enum.
    const isRows = isRowBackedSpace(ot);
    if (!isRows && (ot.indexOn !== undefined || ot.retention !== undefined)) {
      throw new WorkspaceMetaError('INVALID_MANIFEST',
        `objectType "${name}": indexOn and retention belong to a row space. Set backing:'rows' if this space accumulates rows, or drop them — on a memory space they would promise filtering and a retention window that nothing enforces.`);
    }
    if (isRows && ot.indexOn !== undefined) {
      const cols = ot.indexOn;
      if (!Array.isArray(cols) || cols.some(c => typeof c !== 'string' || !c.trim())) {
        throw new WorkspaceMetaError('INVALID_MANIFEST',
          `objectType "${name}": indexOn is the list of field names to promote to indexed columns, so every entry must be a non-empty field name.`);
      }
      if (cols.length > MAX_INDEX_ON) {
        // A refusal rather than a silent truncation: dropping the fourth would leave a caller
        // filtering on a field that is quietly never indexed, and finding out by watching it be slow.
        throw new WorkspaceMetaError('INVALID_MANIFEST',
          `objectType "${name}": a row space may promote at most ${MAX_INDEX_ON} fields to columns, and this one names ${cols.length}. Pick the three a reader actually filters by; the rest stay readable inside the row.`);
      }
      if (new Set(cols.map(c => String(c))).size !== cols.length) {
        throw new WorkspaceMetaError('INVALID_MANIFEST',
          `objectType "${name}": indexOn names the same field twice, which spends one of only ${MAX_INDEX_ON} columns on nothing.`);
      }
    }
    // A row space is never versioned: history is what 20 full copies per row would be, and that
    // multiplier is one of the four reasons this backing exists.
    if (isRows && ot.versioned === true) {
      throw new WorkspaceMetaError('INVALID_MANIFEST',
        `objectType "${name}": a row space keeps no version history. Twenty copies of every row is the cost this backing exists to avoid; a row that must not change belongs in a memory space.`);
    }

    if (!ot.mode && ot.kind === 'document') return { ...ot, mode: 'document' };
    return ot;
  });
}

/** Backfill the manifest envelope fields a model routinely omits — manifestVersion, id, name, kind,
 *  status — so a create/replace that supplies only `objectTypes` validates on the FIRST call instead
 *  of bouncing off the meta-schema's required-field check (organism.*.meta.manifest requires all five).
 *  The same defaults-are-filled contract that `addObjectTypes` already offers per space. An
 *  agent-supplied value ALWAYS wins; `id` is forced to the organism id. `fallbackName` is the create
 *  tool's separate workspace-name param, used when the manifest itself omits a name. */
export function backfillManifestEnvelope(
  man: Record<string, unknown>,
  opts: { orgId: string; fallbackName?: string },
): Record<string, unknown> {
  const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    ...man,
    manifestVersion: nonEmpty(man.manifestVersion) ?? '1.0',
    id: opts.orgId,
    name: nonEmpty(man.name) ?? nonEmpty(opts.fallbackName) ?? 'Workspace',
    kind: nonEmpty(man.kind) ?? 'project',
    status: nonEmpty(man.status) ?? 'active',
  };
}

/** One entry in the organism's workspace registry (`organism.{id}.meta.workspaces`). */
export interface WorkspaceRegistryEntry { id: string; name?: string; createdBy?: string }

/** List every workspace of an organism, aggregated across ALL members' registry records. Each
 *  workspace is registered under its CREATOR's own GHII copy of `organism.{id}.meta.workspaces`,
 *  so any consumer that reads only one identity's record sees only the workspaces that member
 *  created (this exact bug produced empty workspace lists and empty organism exports). Dedupes by
 *  workspace id, first record wins. */
export async function listOrganismWorkspaceEntries(storage: Storage, orgId: string): Promise<WorkspaceRegistryEntry[]> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
  const seen = new Set<string>();
  const out: WorkspaceRegistryEntry[] = [];
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = ((rec.value as { workspaces?: WorkspaceRegistryEntry[] } | null)?.workspaces) ?? [];
    for (const w of list) {
      if (!w || typeof w.id !== 'string' || seen.has(w.id)) continue;
      seen.add(w.id);
      out.push(w);
    }
  }
  return out;
}

/** Where a workspace is registered, and who the registry names as its creator. */
export interface WorkspaceRegistration {
  entry: WorkspaceRegistryEntry;
  /** The registry record that lists the workspace. Its owner is the identity that registered it. */
  record: MemoryRecord;
  /** The creator's bare owner name: the entry's `createdBy`, else the owner of the registry record. */
  creator: string;
}

/** The bare owner behind a memory owner id: `agent#owner@node` and `owner@node` both give `owner`. */
function bareOwnerOf(gaii: string): string {
  return localAccountName(gaii);
}

/** The node an owner id belongs to: what follows its last `@`. */
function nodeOf(gaii: string): string {
  return gaii.slice(gaii.lastIndexOf('@') + 1);
}

/** Owner-id order, the tie-break that makes a choice between copies the same on every backend. */
function byOwnerId(a: MemoryRecord, b: MemoryRecord): number {
  return a.ownerGaii < b.ownerGaii ? -1 : a.ownerGaii > b.ownerGaii ? 1 : 0;
}

/** Newest write first, then owner-id order. */
function freshestFirst(a: MemoryRecord, b: MemoryRecord): number {
  const at = String(a.updatedAt);
  const bt = String(b.updatedAt);
  return at > bt ? -1 : at < bt ? 1 : byOwnerId(a, b);
}

/**
 * Every workspace of an organism, each with its registration: one registry scan for all of them.
 *
 * The registry is one record per creator, so every copy is read, as updateWorkspaceMeta always has,
 * archived copies included, because an archived organism's workspaces still have the creators who
 * made them. When more than one copy lists a workspace, the answer must not depend on the order the
 * store returns them in: a copy whose entry names its own owner as the creator wins over one that
 * names somebody else, and owner-id order breaks a remaining tie. Only an organism manager or a
 * workspace's provisioning writes a registry copy, so two that disagree are an administrator's doing.
 */
export async function workspaceRegistrations(
  storage: Storage, orgId: string,
): Promise<Map<string, WorkspaceRegistration>> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000, archived: 'include' });
  const found = new Map<string, WorkspaceRegistration[]>();
  for (const record of items) {
    if (record.key !== regKey) continue;
    const list = ((record.value as { workspaces?: WorkspaceRegistryEntry[] } | null)?.workspaces) ?? [];
    for (const entry of list) {
      if (!entry || typeof entry.id !== 'string') continue;
      const all = found.get(entry.id) ?? [];
      all.push({ entry, record, creator: entry.createdBy ?? bareOwnerOf(record.ownerGaii) });
      found.set(entry.id, all);
    }
  }
  const selfNamed = (r: WorkspaceRegistration) => (r.creator === bareOwnerOf(r.record.ownerGaii) ? 0 : 1);
  const out = new Map<string, WorkspaceRegistration>();
  for (const [wsId, all] of found) {
    out.set(wsId, all.sort((a, b) => selfNamed(a) - selfNamed(b) || byOwnerId(a.record, b.record))[0]);
  }
  return out;
}

/** Find one workspace in the organism's registry, and the creator it names (workspaceRegistrations). */
export async function findWorkspaceRegistration(
  storage: Storage, orgId: string, wsId: string,
): Promise<WorkspaceRegistration | null> {
  return (await workspaceRegistrations(storage, orgId)).get(wsId) ?? null;
}

/**
 * Which copy of a workspace meta record counts, when the key is stored under several identities.
 *
 * A copy counts when its writer is someone the organism namespace rule lets write there
 * (services/organism-namespace-access.ts): the workspace's registered creator, and after them an
 * organism creator or admin. The creator's copies come first, including one under an agent of
 * theirs, and the newest of those wins, because they are all the same person's. Only when the creator
 * holds no copy does an organism manager's count, newest first. A plain member's copy never counts,
 * and neither does a copy under another node's identity. Returns null when no copy counts.
 *
 * The order the store returned the copies in plays no part: that order is what decided this before,
 * and on Postgres it is not defined for rows that share a key. `roles` caches the members' roles
 * across calls; a reader that picks for many workspaces passes one map.
 */
export async function pickWorkspaceMetaCopy(
  storage: Storage, orgId: string, copies: MemoryRecord[], nodeId: string,
  registration: WorkspaceRegistration | null, roles: Map<string, string | null> = new Map(),
): Promise<MemoryRecord | null> {
  const local = copies.filter(r => nodeOf(r.ownerGaii) === nodeId);
  if (registration) {
    const creators = local.filter(r => bareOwnerOf(r.ownerGaii) === registration.creator);
    if (creators.length) return creators.sort(freshestFirst)[0];
  }
  const managers: MemoryRecord[] = [];
  for (const rec of local) {
    const name = bareOwnerOf(rec.ownerGaii);
    if (!roles.has(name)) {
      const m = await storage.getMembership(orgId, name);
      roles.set(name, m && m.status === 'active' ? m.role : null);
    }
    const role = roles.get(name);
    if (role === 'creator' || role === 'admin') managers.push(rec);
  }
  return managers.sort(freshestFirst)[0] ?? null;
}

/**
 * The meta records of one organism's workspaces, read the one way every reader shares: for each key
 * the copy that counts (pickWorkspaceMetaCopy), never the first row the store returns and never the
 * freshest whoever wrote it. The manifest decides who reads a workspace and how its spaces behave,
 * the share record what the public reads, an intake record what a public form does, so a reader that
 * took whichever copy came first let a member's own copy decide all of that. The registry and the
 * members' roles are looked up once per reader, so a list of workspaces costs one registry scan.
 */
export interface WorkspaceMetaReader {
  /** The copy of `organism.{org}.w.{ws}.{rel}` that counts, among records the caller already read. */
  pick(wsId: string, rel: string, records: MemoryRecord[]): Promise<MemoryRecord | null>;
  /** Read `organism.{org}.w.{ws}.{rel}` and pick the copy that counts. */
  read(wsId: string, rel: string, opts?: { archived?: ArchiveFilter }): Promise<MemoryRecord | null>;
}

export function workspaceMetaReader(storage: Storage, orgId: string, nodeId: string): WorkspaceMetaReader {
  let registrations: Promise<Map<string, WorkspaceRegistration>> | undefined;
  const roles = new Map<string, string | null>();
  const pick = async (wsId: string, rel: string, records: MemoryRecord[]): Promise<MemoryRecord | null> => {
    const key = `organism.${orgId}.w.${wsId}.${rel}`;
    const copies = records.filter(r => r.key === key);
    if (!copies.length) return null;
    registrations ??= workspaceRegistrations(storage, orgId);
    return pickWorkspaceMetaCopy(storage, orgId, copies, nodeId, (await registrations).get(wsId) ?? null, roles);
  };
  return {
    pick,
    async read(wsId, rel, opts) {
      const key = `organism.${orgId}.w.${wsId}.${rel}`;
      const { items } = await storage.listAllMemory({ prefix: key, limit: 100, ...(opts?.archived ? { archived: opts.archived } : {}) });
      return pick(wsId, rel, items);
    },
  };
}

/** One meta record of one workspace (`rel` such as 'meta.manifest'): the copy that counts, or null. */
export function readWorkspaceMetaRecord(
  storage: Storage, orgId: string, wsId: string, rel: string, nodeId: string,
  opts?: { archived?: ArchiveFilter },
): Promise<MemoryRecord | null> {
  return workspaceMetaReader(storage, orgId, nodeId).read(wsId, rel, opts);
}

/**
 * Write one workspace meta record over `prev`, the copy the readers take, keeping its owner, its
 * visibility and its tags. The one meta write: updateWorkspaceMeta and the member change doors both
 * land here, so a change goes into the workspace's own record and never beside it.
 */
export async function writeWorkspaceMetaRecord(
  storage: Storage, key: string, ownerGaii: string, value: unknown, prev: MemoryRecord | null,
): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii, value,
    visibility: prev?.visibility ?? 'private', tags: prev?.tags ?? [], ttlHours: prev?.ttlHours ?? null,
    version: (prev?.version ?? 0) + 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
  });
}

/**
 * The additive union: `addObjectTypes` joined to a manifest's objectTypes, skipping any whose name OR
 * namespace already exists (idempotent), never touching an existing space, and filling the defaults
 * of the backing each one is added with. `stamp` is merged into every space this adds, which is where
 * the member change doors record who added it and when. Throws WorkspaceMetaError on an entry
 * without a name and a namespace, or one normalizeObjectTypes refuses.
 */
export function unionObjectTypes(
  current: Record<string, unknown>,
  addObjectTypes: Array<Record<string, unknown>>,
  stamp?: Record<string, unknown>,
): { objectTypes: Array<Record<string, unknown>>; added: string[]; skipped: string[] } {
  const added: string[] = [];
  const skipped: string[] = [];
  const existing = ((current.objectTypes as Array<Record<string, unknown>> | undefined) ?? []).slice();
  const haveName = new Set(existing.map(o => o.name));
  const haveNs = new Set(existing.map(o => o.namespace));
  for (const raw of addObjectTypes) {
    if (!raw || typeof raw !== 'object' || !raw.name || !raw.namespace) throw new WorkspaceMetaError('INVALID_MANIFEST', 'Each add_spaces entry needs a name and a namespace.');
    if (haveName.has(raw.name) || haveNs.has(raw.namespace)) { skipped.push(String(raw.name)); continue; }
    // The defaults belong to the KIND of space being added, and they were the memory ones for
    // everybody until 2026-09-14. A row space arrived carrying `versioned: true`, which its own
    // rule refuses, so add_spaces rejected every row space whose caller had not thought to pass
    // `versioned: false` — a refusal naming a field the caller never set. And `mode` is how a
    // MEMORY space stores what it holds (a schema-locked record or a markdown page); a row space
    // has neither, so stamping `mode: 'records'` on it tells every reader whose test is the mode
    // that this is a records space.
    const isRows = (raw.backing ?? 'memory') === 'rows';
    const defaults: Record<string, unknown> = isRows
      ? { backing: 'rows', writeRole: 'member', cardinality: 'many', versioned: false }
      : { mode: raw.kind === 'document' ? 'document' : 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true };
    const ot: Record<string, unknown> = normalizeObjectTypes([{
      ...defaults, ...raw, schemaRef: raw.schemaRef || `schema:${String(raw.name)}@1`,
    }])[0];
    existing.push(stamp ? { ...ot, ...stamp } : ot); haveName.add(raw.name); haveNs.add(raw.namespace); added.push(String(raw.name));
  }
  return { objectTypes: existing, added, skipped };
}

export interface UpdateWorkspaceOpts {
  orgId: string;
  ws: string;
  callerOwner: string;
  isAdmin: boolean;
  name?: string;
  readme?: string;
  /** Full replacement manifest (objectTypes + policy/gate + settings). Add/remove a space by
   *  including/excluding its objectType. Validated against the manifest meta-schema. */
  manifest?: Record<string, unknown>;
  /** ADDITIVE: objectTypes to UNION into the existing manifest (skip any whose name/namespace already
   *  exists). The server fills sensible defaults (mode/backing/writeRole/cardinality/versioned/schemaRef),
   *  so a caller can pass just { name, namespace, mode } and provision deterministically — never sending
   *  (or risking) the whole manifest. Cannot remove/rename — use `manifest` for that. */
  addObjectTypes?: Array<Record<string, unknown>>;
  /** Map of namespace → JSON Schema, locked (strict) for that space's records. */
  schemas?: Record<string, Record<string, unknown>>;
  /** App bindings pinned to this workspace (FULL replace; [] clears). Each entry references a
   *  published app by { owner, filename } (+ optional label). Binding is presentation/launch-context
   *  only — access to workspace DATA stays enforced per call by the workspace gates. */
  apps?: Array<Record<string, unknown>>;
  /** The workspace's rule for its plain members' changes ('direct' | 'suggest'), stored as `…meta.rules`. */
  memberChanges?: unknown;
}

export async function updateWorkspaceMeta(
  storage: Storage,
  config: AimeatConfig,
  opts: UpdateWorkspaceOpts,
): Promise<{ updated: string[]; creator: string; name?: string; added?: string[]; skipped?: string[]; member_changes?: MemberChangeRule }> {
  const { orgId, ws, callerOwner, isAdmin } = opts;
  const name = typeof opts.name === 'string' ? opts.name.trim() : undefined;
  const readme = typeof opts.readme === 'string' ? opts.readme : undefined;
  const manifest = (opts.manifest && typeof opts.manifest === 'object' && !Array.isArray(opts.manifest)) ? opts.manifest : undefined;
  const addObjectTypes = (Array.isArray(opts.addObjectTypes) && opts.addObjectTypes.length) ? opts.addObjectTypes : undefined;
  const schemas = (opts.schemas && typeof opts.schemas === 'object') ? opts.schemas : undefined;
  const apps = Array.isArray(opts.apps) ? opts.apps : undefined;
  const memberChanges = opts.memberChanges === undefined ? undefined : normalizeMemberChangeRule(opts.memberChanges);
  if (opts.memberChanges !== undefined && !memberChanges) throw new WorkspaceMetaError('INVALID_RULE', "member_changes is 'direct' (members change the workspace at once) or 'suggest' (members suggest, and the creator or an admin approves).");
  if (!name && readme === undefined && !manifest && !addObjectTypes && !schemas && apps === undefined && !memberChanges) throw new WorkspaceMetaError('NOTHING_TO_UPDATE', 'Provide a new name, readme, manifest, add_spaces, schemas, apps and/or member_changes.');

  const root = `organism.${orgId}.w.${ws}`;
  // The workspace's registry entry lives in its creator's registry record — find it across members.
  const regKey = `organism.${orgId}.meta.workspaces`;
  const registration = await findWorkspaceRegistration(storage, orgId, ws);
  if (!registration) throw new WorkspaceMetaError('WS_NOT_FOUND', 'Workspace not found');
  const regRec: MemoryRecord = registration.record;
  const entry = registration.entry;
  if (entry.createdBy !== callerOwner && !isAdmin) {
    throw new WorkspaceMetaError('NOT_CREATOR', 'Only the workspace creator (or an org admin) can update it. A member adds a space with aimeat_workspace_space_add and changes the sections of a document space with aimeat_workspace_sections_set; the workspace\'s own rule decides whether that lands at once or waits for an admin to approve it.');
  }

  const meta = (await storage.listAllMemory({ prefix: `${root}.meta.`, limit: 200 })).items;
  // The copies the readers read (workspaceMetaReader), so an edit lands where every reader looks.
  const roles = new Map<string, string | null>();
  const pickMeta = (rel: string) => pickWorkspaceMetaCopy(storage, orgId,
    meta.filter(r => r.key === `${root}.${rel}`), config.nodeId, registration, roles);
  const manRec = await pickMeta('meta.manifest');
  const readmeRec = await pickMeta('meta.readme');
  const appsRec = await pickMeta('meta.apps');
  const creatorGhii = regRec.ownerGaii;

  const now = new Date().toISOString();
  const updated: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];
  const write = (key: string, ownerGaii: string, value: unknown, prev: MemoryRecord | null) =>
    writeWorkspaceMetaRecord(storage, key, ownerGaii, value, prev);
  const syncRegistryName = async (newName: string) => {
    const list = (((regRec!.value as { workspaces?: Array<Record<string, unknown>> }).workspaces) ?? []).map(w => (w.id === ws ? { ...w, name: newName } : w));
    await write(regKey, regRec!.ownerGaii, { workspaces: list }, regRec);
    updated.push('registry');
  };

  // 1. Lock record schemas first (so a new space's manifest references an existing lock).
  if (schemas) {
    for (const [ns, schema] of Object.entries(schemas)) {
      if (!schema || typeof schema !== 'object') continue;
      await storage.setSchema({ keyPattern: `${root}.${ns}`, applyTo: 'prefix', schemaJson: schema, schemaMode: 'strict', lockedBy: creatorGhii, setAt: now, updatedAt: now });
    }
    updated.push('schemas');
  }

  // 2. Manifest = the structure. A full replace covers add/remove space, policy/gate and settings.
  if (manifest) {
    if (!Array.isArray((manifest as { objectTypes?: unknown }).objectTypes)) throw new WorkspaceMetaError('INVALID_MANIFEST', 'manifest must have an objectTypes array.');
    const normalizedTypes = normalizeObjectTypes(manifest.objectTypes as Array<Record<string, unknown>>);
    const manifestValue: Record<string, unknown> = { ...manifest, objectTypes: normalizedTypes, id: orgId, status: (manifest.status as string) || 'active' };
    if (name) manifestValue.name = name;
    const valid = await validateMemoryWrite(`${root}.meta.manifest`, manifestValue, storage);
    if (!valid.valid) throw new WorkspaceMetaError('INVALID_MANIFEST', 'Manifest rejected by schema: ' + JSON.stringify(valid.errors));
    await write(`${root}.meta.manifest`, manRec?.ownerGaii ?? creatorGhii, manifestValue, manRec);
    updated.push('manifest');
    const newName = typeof manifestValue.name === 'string' ? manifestValue.name : entry.name;
    if (newName) await syncRegistryName(newName);
  } else if (addObjectTypes) {
    // ADDITIVE: union the new objectTypes into the existing manifest. Skip any whose name OR namespace
    // already exists (idempotent). Never touches existing spaces, can't remove/rename — the safe,
    // deterministic path for an agent to provision its contract's spaces. Defaults are filled so a
    // caller can pass just { name, namespace, mode (+ a schema) }.
    const current = (manRec?.value && typeof manRec.value === 'object' && !Array.isArray(manRec.value)) ? { ...(manRec.value as Record<string, unknown>) } : null;
    if (!current || !Array.isArray(current.objectTypes)) throw new WorkspaceMetaError('WS_NOT_FOUND', 'Workspace has no manifest to extend.');
    const union = unionObjectTypes(current, addObjectTypes);
    added.push(...union.added); skipped.push(...union.skipped);
    if (added.length) {
      const manifestValue: Record<string, unknown> = { ...current, objectTypes: union.objectTypes, id: orgId, status: (current.status as string) || 'active' };
      if (name) manifestValue.name = name;
      const valid = await validateMemoryWrite(`${root}.meta.manifest`, manifestValue, storage);
      if (!valid.valid) throw new WorkspaceMetaError('INVALID_MANIFEST', 'Manifest rejected by schema: ' + JSON.stringify(valid.errors));
      await write(`${root}.meta.manifest`, manRec?.ownerGaii ?? creatorGhii, manifestValue, manRec);
      updated.push('manifest');
      if (name) await syncRegistryName(name);
    } else if (name) {
      await syncRegistryName(name);
    }
  } else if (name) {
    // Name-only: patch the manifest's name + the registry, leaving structure untouched.
    if (manRec && manRec.value && typeof manRec.value === 'object') { await write(manRec.key, manRec.ownerGaii, { ...(manRec.value as object), name }, manRec); updated.push('manifest'); }
    await syncRegistryName(name);
  }

  // 3. Readme.
  if (readme !== undefined) { await write(`${root}.meta.readme`, readmeRec?.ownerGaii ?? creatorGhii, readme, readmeRec); updated.push('readme'); }

  // 4. App bindings (full replace; [] clears). Own meta record so a manifest replace never clobbers
  // the pinned-apps list; ownership stays with the creator like the manifest/readme records.
  if (apps !== undefined) {
    if (apps.length > 50) throw new WorkspaceMetaError('INVALID_APPS', 'Too many app bindings (max 50).');
    const cleaned = apps.map(a => {
      const owner = typeof a?.owner === 'string' ? a.owner.trim() : '';
      const filename = typeof a?.filename === 'string' ? a.filename.trim() : '';
      if (!owner || !filename) throw new WorkspaceMetaError('INVALID_APPS', 'Each apps entry needs an owner and a filename (a published app reference).');
      const cleanedEntry: Record<string, unknown> = { owner, filename };
      if (typeof a.label === 'string' && a.label.trim()) cleanedEntry.label = a.label.trim();
      return cleanedEntry;
    });
    await write(`${root}.meta.apps`, appsRec?.ownerGaii ?? creatorGhii, { apps: cleaned }, appsRec);
    updated.push('apps');
  }

  // 5. The rule for the members' changes. Its own record, like the readme and the apps, so a manifest
  // replace never resets it; written into the copy the readers take, with who set it and when.
  if (memberChanges) {
    const rulesRec = await pickMeta('meta.rules');
    const prevRules = (rulesRec?.value && typeof rulesRec.value === 'object' && !Array.isArray(rulesRec.value)) ? rulesRec.value as Record<string, unknown> : {};
    await write(`${root}.meta.rules`, rulesRec?.ownerGaii ?? creatorGhii, { ...prevRules, member_changes: memberChanges, updatedBy: callerOwner, updatedAt: now }, rulesRec);
    updated.push('rules');
  }

  return { updated, creator: entry.createdBy ?? '', name, ...(addObjectTypes ? { added, skipped } : {}), ...(memberChanges ? { member_changes: memberChanges } : {}) };
}
