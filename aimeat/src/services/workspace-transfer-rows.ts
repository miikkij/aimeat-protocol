/**
 * @file src/services/workspace-transfer-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The row spaces of a workspace (`backing: 'rows'`, services/workspace-rows/) in a
 *   workspace export and a workspace import. A row space lives in its own table, not in memory keys,
 *   so the memory scan of the export never met it: until 2026-10-15 a backup carried the space in
 *   the manifest and none of its rows, and the import then made the space empty without a word
 *   (feature-list audit #68).
 *
 *   THE EXPORT reads every row of every row space the manifest declares, oldest first, through the
 *   same classification reader the records pass (show, then leave with the destination `export`),
 *   and names what it kept back. It stops at the most a workspace may hold
 *   (config.wsRowsMaxPerWorkspace) and says so in `truncated`.
 *
 *   THE IMPORT builds every row before anything is written, so the workspace and organism quotas
 *   (enforceQuota, the check every row write makes) refuse a bundle that does not fit before the
 *   first key of the new workspace exists. A row keeps its id, its body and when it happened; it is
 *   written now, by the importer. A row of a space the bundle's manifest does not declare as a row
 *   space is not written and is named.
 * @structure ExportRow · ExportTruncation · collectRowSpaces() · prepareRowRestore() · writeRestoredRows()
 * @usage
 *   const { rows, leftOut, truncated } = await collectRowSpaces(deps, { orgId, ws, manifest, reader });
 *   const plan = await prepareRowRestore(deps, { orgId, ws: newWs, manifest, rows, importerIdentity });
 * @version-history
 *   2026-10-27 — A row's classification label is read at its rowId, where it is set; the surrogate id
 *     found none, so a row label never kept a row out of the export (secaudit2026oct26).
 *   2026-10-15 — Initial (feature-list audit #68).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, WorkspaceRowRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { ContentReader } from './classification/reader.js';
import { rowTarget } from './classification/labels.js';
import { leftOutOf, type LeftOut } from './classification-exits.js';
import { isRowBackedSpace } from './workspace-meta-read.js';
import { resolveRowSpace, columnsForBody, type RowObjectType } from './workspace-rows/row-space.js';
import { enforceQuota } from './workspace-rows/row-service.js';

/** One row as a workspace export carries it. */
export interface ExportRow {
  namespace: string; rowId: string; occurredAt: string; createdAt: string; updatedAt: string; createdBy: string;
  body: Record<string, unknown>;
}

/** Something the export did not carry in full: what it was, how many it carried, how many there are. */
export interface ExportTruncation { what: 'records' | 'rows'; namespace?: string; exported: number; total: number }

interface Deps { storage: Storage; config: AimeatConfig }

const PAGE = 500;

const rowSpacesOf = (manifest: unknown): RowObjectType[] =>
  (((manifest as { objectTypes?: RowObjectType[] } | null)?.objectTypes) ?? []).filter((t) => isRowBackedSpace(t) && (t.namespace || t.name));

/** Every row of every row space the manifest declares, as the exporter may take them out. */
export async function collectRowSpaces(
  deps: Deps, opts: { orgId: string; ws: string; manifest: unknown; reader: ContentReader },
): Promise<{ rows: ExportRow[]; leftOut: LeftOut[]; truncated: ExportTruncation[] }> {
  const { storage, config } = deps;
  const { orgId, ws, reader } = opts;
  const limit = Math.max(1, config.wsRowsMaxPerWorkspace);
  const rows: ExportRow[] = [];
  const leftOut: LeftOut[] = [];
  const truncated: ExportTruncation[] = [];
  for (const ot of rowSpacesOf(opts.manifest)) {
    const space = resolveRowSpace([ot], (ot.name ?? ot.namespace) as string);
    if (rows.length >= limit) {
      const total = (await storage.workspaceRowStats(orgId, ws, space.namespace))[0]?.rows ?? 0;
      if (total > 0) truncated.push({ what: 'rows', namespace: space.namespace, exported: 0, total });
      continue;
    }
    let cursor: string | null = null;
    let taken = 0;
    do {
      const page = await storage.listWorkspaceRows({
        organismId: orgId, wsId: ws, namespace: space.namespace, order: 'asc',
        limit: Math.min(PAGE, limit - rows.length), ...(cursor ? { cursor } : {}),
      });
      // A row label is set at the caller-visible rowId (classification/labels.ts targetOf).
      const target = (r: WorkspaceRowRecord) => rowTarget(orgId, ws, space.name, r.rowId);
      const shown = await reader.show(page.rows, target);
      const { kept, left } = await reader.leave(shown, target, { kind: 'export', organismId: orgId });
      leftOut.push(...leftOutOf(left, (r) => `${space.namespace}/${r.rowId}`));
      for (const r of kept) {
        rows.push({ namespace: space.namespace, rowId: r.rowId, occurredAt: r.occurredAt, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, body: r.body });
      }
      taken += page.rows.length;
      cursor = page.cursor;
    } while (cursor && rows.length < limit);
    if (cursor) {
      // A cursor can follow a full last page, so the count decides whether anything was left.
      const total = (await storage.workspaceRowStats(orgId, ws, space.namespace))[0]?.rows ?? taken;
      if (total > taken) truncated.push({ what: 'rows', namespace: space.namespace, exported: taken, total });
    }
  }
  return { rows, leftOut, truncated };
}

/**
 * The rows a bundle carries, built as they will be stored in the new workspace, with the quotas
 * checked. Nothing is written here; a quota refusal (WorkspaceRowError QUOTA_EXCEEDED) throws
 * before the caller writes anything.
 */
export async function prepareRowRestore(
  deps: Deps,
  opts: { orgId: string; ws: string; manifest: unknown; rows: unknown; importerIdentity: string },
): Promise<{ records: WorkspaceRowRecord[]; skipped: Array<{ namespace: string; id: string; role: string }> }> {
  const list = Array.isArray(opts.rows) ? opts.rows as Array<Partial<ExportRow>> : [];
  const spaces = rowSpacesOf(opts.manifest);
  const byNamespace = new Map(spaces.map((ot) => {
    const s = resolveRowSpace([ot], (ot.name ?? ot.namespace) as string);
    return [s.namespace, s] as const;
  }));
  const now = new Date().toISOString();
  const records: WorkspaceRowRecord[] = [];
  const skipped: Array<{ namespace: string; id: string; role: string }> = [];
  for (const r of list) {
    const namespace = typeof r?.namespace === 'string' ? r.namespace : '';
    const rowId = typeof r?.rowId === 'string' && r.rowId ? r.rowId.slice(0, 200) : randomUUID();
    const space = byNamespace.get(namespace);
    const body = r?.body && typeof r.body === 'object' && !Array.isArray(r.body) ? r.body : null;
    if (!space || !body) { skipped.push({ namespace, id: rowId, role: 'row' }); continue; }
    const occurred = typeof r.occurredAt === 'string' && !Number.isNaN(Date.parse(r.occurredAt)) ? new Date(r.occurredAt).toISOString() : now;
    records.push({
      id: randomUUID(), organismId: opts.orgId, wsId: opts.ws, namespace, rowId,
      ...columnsForBody(space, body), occurredAt: occurred, createdAt: now, updatedAt: now,
      createdBy: opts.importerIdentity, body, bytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
    });
  }
  // One row id once per space: the last copy wins, as an append does.
  const deduped = [...new Map(records.map((x) => [`${x.namespace}\u0000${x.rowId}`, x])).values()];
  if (deduped.length) await enforceQuota(deps, opts.orgId, opts.ws, deduped);
  return { records: deduped, skipped };
}

/** Write prepared rows in batches. Answers how many were written. */
export async function writeRestoredRows(storage: Storage, records: WorkspaceRowRecord[]): Promise<number> {
  for (let i = 0; i < records.length; i += PAGE) await storage.appendWorkspaceRows(records.slice(i, i + PAGE));
  return records.length;
}
