/**
 * @file src/services/workspace-meta-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The read half of a workspace's meta records: who registered a workspace, which copy
 *   of a meta record counts when the key is stored under several identities, the one reader every
 *   surface shares, and the two predicates that say where a space's data lives.
 *
 *   WHY IT IS ITS OWN MODULE. services/workspace-meta.ts held these beside updateWorkspaceMeta. The
 *   fenced-space rule (services/fenced-space.ts) reads the manifest through this reader, and since
 *   2026-10-13 updateWorkspaceMeta asks that rule before it writes a manifest (a change to a fenced
 *   space's list of extensions is a protected change). With both halves in one file the two modules
 *   imported each other, which `pnpm check:deps` refuses. The readers moved here unchanged;
 *   workspace-meta.ts re-exports every name, so no importer changed.
 * @structure
 *   - isMemoryBackedSpace() / isRowBackedSpace() — where a space's data lives
 *   - WorkspaceManifest, WorkspaceRegistryEntry, WorkspaceRegistration
 *   - workspaceRegistrations() / findWorkspaceRegistration() — who created a workspace
 *   - pickWorkspaceMetaCopy() — which copy of a meta record counts
 *   - WorkspaceMetaReader / workspaceMetaReader() / readWorkspaceMetaRecord() — the one reader
 * @usage
 *   const rec = await readWorkspaceMetaRecord(storage, orgId, wsId, 'meta.manifest', config.nodeId);
 * @version-history
 *   v1.1.0 — 2026-10-27 — workspaceRegistrations ranks registry copies that disagree by their writer's
 *     role now (manager, then a member's own registration, then the rest), so a copy written by an admin
 *     since demoted or removed no longer names the creator; `opts.archived` for a reader that never
 *     read archived copies (secaudit2026oct26, organism-meta-first-store-order-copy).
 *   v1.0.0 — 2026-10-13 — Extracted from services/workspace-meta.ts, a pure move, so that
 *     updateWorkspaceMeta can ask services/fenced-space.ts without an import cycle.
 */
import type { Storage, MemoryRecord, ArchiveFilter } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';

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

/** One entry in the organism's workspace registry (`organism.{id}.meta.workspaces`). */
export interface WorkspaceRegistryEntry { id: string; name?: string; createdBy?: string }

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
 * made them (`opts.archived` narrows that for a reader that never read archived copies). When more
 * than one copy lists a workspace, the answer must not depend on the order the store returns them in.
 * Only an organism manager or a workspace's provisioning writes a registry copy, so two that disagree
 * are an administrator's doing, and the copy that counts is, in this order (secaudit2026oct26,
 * organism-meta-first-store-order-copy):
 *   1. a copy whose writer is a creator or admin of the organism now, on this node;
 *   2. a copy whose entry names its own writer, who is an active member now (a member provisioned it);
 *   3. any other copy of this node, then any copy of another node;
 * and within one rank a self-named copy first, then owner-id order. A copy an admin wrote before
 * being demoted or removed therefore no longer outranks the copies of the people who run the
 * organism now; a workspace listed by one copy only keeps that copy's creator whatever its rank.
 */
export async function workspaceRegistrations(
  storage: Storage, orgId: string, opts: { archived?: ArchiveFilter; nodeId?: string } = {},
): Promise<Map<string, WorkspaceRegistration>> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000, archived: opts.archived ?? 'include' });
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
  // The writers' roles are read only where copies disagree, once per writer.
  const roles = new Map<string, string | null>();
  const roleOf = async (gaii: string): Promise<string | null> => {
    const name = bareOwnerOf(gaii);
    if (!roles.has(name)) {
      const m = await storage.getMembership(orgId, name);
      roles.set(name, m && m.status === 'active' ? m.role : null);
    }
    return roles.get(name) ?? null;
  };
  const localNode = opts.nodeId ?? null;
  const rank = async (r: WorkspaceRegistration): Promise<number> => {
    if (localNode && nodeOf(r.record.ownerGaii) !== localNode) return 3;
    const role = await roleOf(r.record.ownerGaii);
    if (role === 'creator' || role === 'admin') return 0;
    if (role && selfNamed(r) === 0) return 1;
    return 2;
  };
  const out = new Map<string, WorkspaceRegistration>();
  for (const [wsId, all] of found) {
    if (all.length === 1) { out.set(wsId, all[0]!); continue; }
    const ranked = await Promise.all(all.map(async r => ({ r, k: await rank(r) })));
    ranked.sort((a, b) => a.k - b.k || selfNamed(a.r) - selfNamed(b.r) || byOwnerId(a.r.record, b.r.record));
    out.set(wsId, ranked[0]!.r);
  }
  return out;
}

/** Find one workspace in the organism's registry, and the creator it names (workspaceRegistrations). */
export async function findWorkspaceRegistration(
  storage: Storage, orgId: string, wsId: string, opts: { archived?: ArchiveFilter; nodeId?: string } = {},
): Promise<WorkspaceRegistration | null> {
  return (await workspaceRegistrations(storage, orgId, opts)).get(wsId) ?? null;
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
