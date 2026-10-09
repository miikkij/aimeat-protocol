/**
 * @file archive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism ARCHIVE service — flag an organism, a workspace, a record-table/document-space,
 *   or a single record as read-only + archived so it drops out of every AI-facing material assembly
 *   (structure overview, workspace read, organism search) yet stays resolvable by key and findable via
 *   an explicit archive search. Archiving CASCADES down a container (a workspace archives its records;
 *   an organism archives its workspaces + records) and uses SMART RESTORE: each cascade stamps every
 *   row it touches with the SAME `archivedRoot`, so unarchiving that root restores ONLY what that
 *   cascade flagged — a record (or workspace) archived independently earlier keeps its own root and
 *   stays archived. Already-archived rows are never re-stamped (the storage UPDATE filters `archived=0`).
 *
 *   Container markers: the organism row carries `archived` (organisms table column); a workspace carries
 *   `archived` on its entry in the `organism.{id}.meta.workspaces` registry; a record-table/space and a
 *   single record have no separate marker — their archived state is the flag on their rows, counted via
 *   countArchivedByKeyPrefix. The write guard (isKeyArchived) enforces read-only.
 * @structure ARCHIVE ROOT format; archiveTarget/unarchiveTarget; isKeyArchived; setRegistryWorkspaceArchived;
 *   archiveRoleOf (the creator-or-admin rule); archiveRecordsBatchOp (many records of one space)
 * @usage import { archiveTarget, unarchiveTarget, isKeyArchived } from '../services/archive.js';
 * @version-history
 *   v1.1.0 — 2026-10-09 — archiveRoleOf, which the archive route now asks, and archiveRecordsBatchOp,
 *     which ctx.workspace.archiveRecords runs: an extension keeps a space bounded by archiving what
 *     has stopped mattering (Lifecycle Central's closed claims, 771 of them, made every read 9 s).
 *   v1.0.0 — 2026-06-26 — Initial: record/space/workspace/organism archive + cascade + smart restore + guard.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';

/** What level a target sits at. The level fixes the key prefix archived and the `archivedRoot` stamp. */
export type ArchiveLevel = 'organism' | 'workspace' | 'space' | 'record';

export interface ArchiveTarget {
  level: ArchiveLevel;
  orgId: string;
  /** workspace id — required for `workspace`, `space`, `record`. */
  ws?: string;
  /** objectType namespace — required for `space`. */
  namespace?: string;
  /** the record/instance base key — required for `record` (absolute memory key). */
  key?: string;
}

export class ArchiveError extends Error {
  constructor(public code: 'BAD_TARGET', message: string) { super(message); this.name = 'ArchiveError'; }
}

/** The canonical `archivedRoot` string for a target — the handle unarchive restores by. Stable + opaque. */
export function archiveRootFor(t: ArchiveTarget): string {
  switch (t.level) {
    case 'organism': return `org:${t.orgId}`;
    case 'workspace': if (!t.ws) throw new ArchiveError('BAD_TARGET', 'workspace archive needs ws'); return `ws:${t.orgId}/${t.ws}`;
    case 'space': if (!t.ws || !t.namespace) throw new ArchiveError('BAD_TARGET', 'space archive needs ws + namespace'); return `space:${t.orgId}/${t.ws}/${t.namespace}`;
    case 'record': if (!t.key) throw new ArchiveError('BAD_TARGET', 'record archive needs key'); return `rec:${t.key}`;
  }
}

/** The memory key prefix (or instance base) + match mode the cascade flags for a target. */
function keyScopeFor(t: ArchiveTarget): { base: string; match: 'exact' | 'prefix' | 'subtree' } {
  switch (t.level) {
    case 'organism': return { base: `organism.${t.orgId}.`, match: 'prefix' };
    case 'workspace': return { base: `organism.${t.orgId}.w.${t.ws}.`, match: 'prefix' };
    case 'space': return { base: `organism.${t.orgId}.w.${t.ws}.${t.namespace}.`, match: 'prefix' };
    case 'record': return { base: t.key!, match: 'subtree' };
  }
}

/** Flip the `archived` flag on a workspace's entry in the per-creator `…meta.workspaces` registry
 *  (the workspace-level container marker). Best-effort across every creator's registry record. */
export async function setRegistryWorkspaceArchived(
  storage: Storage, orgId: string, ws: string, archived: boolean, actor: string, at: string,
): Promise<boolean> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const regItems = (await storage.listAllMemory({ prefix: regKey, limit: 1000, archived: 'include' })).items.filter(r => r.key === regKey);
  for (const rec of regItems) {
    const list = ((rec.value as { workspaces?: Array<Record<string, unknown>> } | null)?.workspaces) ?? [];
    const idx = list.findIndex(w => w.id === ws);
    if (idx === -1) continue;
    const entry = list[idx];
    list[idx] = archived
      ? { ...entry, archived: true, archivedAt: at, archivedBy: actor }
      : { ...entry, archived: false, archivedAt: undefined, archivedBy: undefined };
    await storage.setMemory({
      key: regKey, ownerGaii: rec.ownerGaii, value: { ...(rec.value as object), workspaces: list },
      visibility: rec.visibility, tags: rec.tags, ttlHours: rec.ttlHours,
      version: rec.version + 1, createdAt: rec.createdAt, updatedAt: at,
    });
    return true;
  }
  return false;
}

/** Read a workspace's archived state from the registry (the marker, not the row scan). */
export async function isWorkspaceArchived(storage: Storage, orgId: string, ws: string): Promise<boolean> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const regItems = (await storage.listAllMemory({ prefix: regKey, limit: 1000, archived: 'include' })).items.filter(r => r.key === regKey);
  for (const rec of regItems) {
    const list = ((rec.value as { workspaces?: Array<{ id: string; archived?: boolean }> } | null)?.workspaces) ?? [];
    const e = list.find(w => w.id === ws);
    if (e) return e.archived === true;
  }
  return false;
}

export interface ArchiveResult { root: string; count: number; level: ArchiveLevel }

/** ARCHIVE a target (cascading down). Returns the root handle + number of rows newly archived. */
export async function archiveTarget(storage: Storage, t: ArchiveTarget, actor: string): Promise<ArchiveResult> {
  const root = archiveRootFor(t);
  const at = new Date().toISOString();
  const { base, match } = keyScopeFor(t);
  const count = await storage.archiveMemoryByKey(base, { archivedRoot: root, archivedBy: actor, archivedAt: at, match });

  if (t.level === 'organism') {
    await storage.updateOrganism(t.orgId, { archived: true, archivedAt: at, archivedBy: actor, updatedAt: at });
  } else if (t.level === 'workspace') {
    await setRegistryWorkspaceArchived(storage, t.orgId, t.ws!, true, actor, at);
  }
  return { root, count, level: t.level };
}

/**
 * UNARCHIVE a target. CONTAINER levels (organism/workspace/space) use SMART RESTORE — restore only the
 * rows THIS container's archival flagged (by `archivedRoot`), leaving independently-archived items
 * archived. The RECORD level instead restores the WHOLE instance by key, regardless of which root
 * flagged each row: "make this record active" is unambiguous, and this also heals a record whose parts
 * were archived under different roots (e.g. an earlier container cascade, or a co-owner's copy in a
 * multi-writer workspace). Returns the number of rows restored.
 */
export async function unarchiveTarget(storage: Storage, t: ArchiveTarget, actor: string): Promise<ArchiveResult> {
  const root = archiveRootFor(t);
  const at = new Date().toISOString();
  const count = t.level === 'record'
    ? await storage.unarchiveMemoryByKey(t.key!, { match: 'subtree' })
    : await storage.unarchiveMemoryByRoot(root);

  if (t.level === 'organism') {
    await storage.updateOrganism(t.orgId, { archived: false, archivedAt: undefined, archivedBy: undefined, updatedAt: at });
  } else if (t.level === 'workspace') {
    await setRegistryWorkspaceArchived(storage, t.orgId, t.ws!, false, actor, at);
  }
  return { root, count, level: t.level };
}

export interface ArchivedState { archived: boolean; level?: ArchiveLevel; root?: string }

/**
 * WRITE GUARD — is a write/delete to `key` forbidden because the key, its workspace, or its organism is
 * archived (read-only)? Checks the cheap container markers first (organism column, workspace registry),
 * then the row itself when the writer's ownerGaii is known. A brand-new key under an archived
 * record-table/space is allowed (space archive seals existing content, not the namespace) — only
 * workspace/organism archive seals against new writes.
 */
export async function isKeyArchived(storage: Storage, key: string, ownerGaii?: string): Promise<ArchivedState> {
  const m = /^organism\.([^.]+)(?:\.w\.([^.]+))?/.exec(key);
  if (m) {
    const orgId = m[1];
    const ws = m[2];
    const org = await storage.getOrganism(orgId);
    if (org?.archived) return { archived: true, level: 'organism', root: `org:${orgId}` };
    if (ws && await isWorkspaceArchived(storage, orgId, ws)) return { archived: true, level: 'workspace', root: `ws:${orgId}/${ws}` };
  }
  if (ownerGaii) {
    const rec: MemoryRecord | null = await storage.getMemory(ownerGaii, key);
    if (rec?.archived) return { archived: true, level: 'record', root: rec.archivedRoot };
  }
  return { archived: false };
}

/** Who is asking to archive: the resolved principal and the bare account name it acts for. */
export interface ArchiveCaller { principal: string; ownerName: string }

/**
 * The caller's role in the organism, as the archive rule reads it: a principal listed among the
 * organism's own agents is a member; anyone else has the role their owner's active membership holds.
 * POST /v1/organisms/:id/archive and ctx.workspace.archiveRecords both ask this, so the creator-or-
 * admin rule is decided in one place.
 */
export async function archiveRoleOf(storage: Storage, organism: { id: string; agentGaiis: string[] }, who: ArchiveCaller): Promise<string | null> {
  if (who.principal && organism.agentGaiis.includes(who.principal)) return 'member';
  if (!who.ownerName) return null;
  const m = await storage.getMembership(organism.id, who.ownerName);
  return m && m.status === 'active' ? m.role : null;
}

/** The most records one archiveRecordsBatchOp call takes. */
export const ARCHIVE_BATCH_MAX = 500;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const NAMESPACE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

export type ArchiveBatchResult =
  | { ok: true; data: { archived: string[]; rows: number } }
  | { ok: false; status: number; code: string; message: string };

/**
 * ARCHIVE MANY RECORDS of one workspace space in one call: each id is archived at the record level
 * (its whole family, `.latest`, `.draft` and `.version.N`), exactly as POST /v1/organisms/:id/archive
 * with level 'record' archives one. The caller must be the organism's creator or an admin
 * (archiveRoleOf). Archiving is undoable (unarchiveTarget), which is why it needs no purge word.
 * Answers the ids that had rows to archive and the number of rows flagged.
 */
export async function archiveRecordsBatchOp(
  storage: Storage, who: ArchiveCaller,
  args: { organismId: string; ws: string; namespace: string; ids: string[] },
): Promise<ArchiveBatchResult> {
  const { organismId, ws, namespace, ids } = args;
  if (!SEGMENT.test(String(ws || ''))) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'ws must be a workspace id' };
  if (!NAMESPACE.test(String(namespace || ''))) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'namespace must be a dotted space namespace such as shared.claim' };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'ids must be a non-empty array of instance ids' };
  if (ids.length > ARCHIVE_BATCH_MAX) return { ok: false, status: 400, code: 'INVALID_INPUT', message: `at most ${ARCHIVE_BATCH_MAX} ids per call` };
  const bad = ids.find(id => !SEGMENT.test(String(id)));
  if (bad !== undefined) return { ok: false, status: 400, code: 'INVALID_INPUT', message: `not an instance id: ${String(bad).slice(0, 80)}` };
  const organism = await storage.getOrganism(organismId);
  if (!organism) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Organism not found' };
  const role = await archiveRoleOf(storage, organism, who);
  if (role !== 'creator' && role !== 'admin') {
    return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the creator or an admin can archive organism content' };
  }
  const archived: string[] = [];
  let rows = 0;
  for (const id of [...new Set(ids.map(String))]) {
    const key = `organism.${organismId}.w.${ws}.${namespace}.${id}`;
    const r = await archiveTarget(storage, { level: 'record', orgId: organismId, ws, key }, who.principal);
    if (r.count > 0) archived.push(id);
    rows += r.count;
  }
  return { ok: true, data: { archived, rows } };
}
