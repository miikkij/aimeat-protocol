/**
 * @file src/services/workspace-rows/row-revisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an append does to a row it replaces, and how long the replaced content is kept.
 *
 *   THE HOLE THIS CLOSES (secaudit 2026-10, v80). An append with a caller-chosen rowId replaces the
 *   stored row, and a row space keeps no version history. Removing a row needs memory:purge on REST
 *   and MCP for exactly that reason, and an app or an extension never removes rows. A principal that
 *   held the append path and not that authority (an agent with organism:write and a contributor
 *   grant, a named app, a named extension) re-appended under another member's rowId and removed that
 *   member's content for good, with its own name in createdBy.
 *
 *   THE RULING (developer, 2026-10-22): no new refusal and no approval step. When a write replaces a
 *   row whose last writer is of another WRITER FAMILY, the node keeps the old content as a revision,
 *   the row keeps its original author in createdBy, and updatedBy names the new writer. The delete
 *   authority lists and restores a revision (row-service.ts listRowRevisions, restoreRowRevision).
 *   Within one family nothing changes: an ingest that re-sends its own rows, the refinery batch that
 *   re-files what it filed, an app that re-sends its own event, an agent that re-runs its own import.
 *
 *   A WRITER FAMILY is the owner GHII behind a principal: `alice@node`, `bot#alice@node` and
 *   `eco:app#alice@node` are one family, because an owner's agents and apps act for the owner
 *   (ruling 3), and an app grant writes as the owner GHII anyway. An extension writes as
 *   `ext:<name>`, and that name is its family: a name belongs to one installer at a time on a node.
 * @structure writerFamily · settleReplacements · revisionKeepDays · REVISIONS_PER_ROW
 * @usage const kept = await settleReplacements(storage, caller.identity, records, now);
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v80; developer ruling 2026-10-22).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, WorkspaceRowRecord, WorkspaceRowRevision } from '../../storage/interface.js';
import { ownerGhiiOf } from '../../utils/gaii.js';

/** How many earlier contents one row keeps. The same number a versioned memory record keeps. */
export const REVISIONS_PER_ROW = 20;

/** How long a revision is kept when the space declares no retention window of its own. */
export const REVISION_DEFAULT_DAYS = 30;

/** The days a revision is kept: the space's own retention window, or 30 days. */
export function revisionKeepDays(maxDays: number | null): number {
  return maxDays && maxDays > 0 ? maxDays : REVISION_DEFAULT_DAYS;
}

/**
 * The family a stored writer identity belongs to. See the file header. An identity that names no
 * node (an erasure's pseudonym, a bare name from an older row) is its own family, so a replacement
 * over it keeps a revision rather than guessing.
 */
export function writerFamily(identity: string): string {
  const id = (identity ?? '').trim();
  if (!id || id.startsWith('ext:') || !id.includes('@')) return id;
  return ownerGhiiOf(id);
}

/** The writer of a row's current content: updatedBy, or createdBy on a row written before it. */
export function lastWriterOf(row: Pick<WorkspaceRowRecord, 'createdBy' | 'updatedBy'>): string {
  return row.updatedBy || row.createdBy;
}

/** A revision of `old`, replaced now by `by`. */
export function revisionOf(old: WorkspaceRowRecord, by: string, at: string): WorkspaceRowRevision {
  return {
    revisionId: randomUUID(),
    organismId: old.organismId, wsId: old.wsId, namespace: old.namespace, rowId: old.rowId, id: old.id,
    occurredAt: old.occurredAt, createdAt: old.createdAt, updatedAt: old.updatedAt,
    createdBy: old.createdBy, updatedBy: lastWriterOf(old),
    body: old.body, bytes: old.bytes,
    replacedAt: at, replacedBy: by,
  };
}

/**
 * Settle the rows an append is about to write against the rows they replace, and keep a revision
 * of every replaced content whose last writer is of another family. Mutates `records`: each gets
 * `updatedBy` = the writer, and a replacement across families keeps the stored createdBy. Within a
 * family createdBy is the new writer, as it always was. Returns the rowIds whose content was kept.
 *
 * Called after every gate in appendRows has answered, so nothing is kept for a write that is then
 * refused.
 */
export async function settleReplacements(
  storage: Storage, writer: string, records: WorkspaceRowRecord[], at: string,
): Promise<string[]> {
  for (const r of records) r.updatedBy = writer;
  if (!records.length) return [];
  const { organismId, wsId, namespace } = records[0];
  const existing = await storage.getWorkspaceRowsByIds(organismId, wsId, namespace, records.map(r => r.rowId));
  if (!existing.length) return [];
  const family = writerFamily(writer);
  const byRowId = new Map(existing.map(o => [o.rowId, o]));
  const revisions: WorkspaceRowRevision[] = [];
  for (const r of records) {
    const old = byRowId.get(r.rowId);
    if (!old) continue;
    if (writerFamily(old.createdBy) !== family) r.createdBy = old.createdBy;
    if (writerFamily(lastWriterOf(old)) !== family) revisions.push(revisionOf(old, writer, at));
  }
  await storage.appendWorkspaceRowRevisions(revisions);
  return revisions.map(v => v.rowId);
}
