/**
 * @file src/storage/repositories/workspace-row.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for workspace row spaces.
 *
 *   THE PRIMITIVES ARE WORKLOAD-SHAPED, not a generic `findMany`. That is the storage architecture's
 *   own rule (Application-DB-Service -> Repository -> Adapter): each method here is one thing a
 *   caller actually does, so a backend can index for it and neither backend can drift into being
 *   the fast one by accident.
 *
 *   RETENTION IS TWO METHODS, not one, because the two questions differ. `deleteWorkspaceRowsBefore`
 *   answers "nothing older than N days", which keys on `createdAt` — a retention promise is about
 *   how long we keep a row. `trimWorkspaceRows` answers "at most N rows", which keys on the same
 *   order the reads use. A space may declare either, both, or neither.
 * @structure
 *   - appendWorkspaceRows(rows)               -- bulk insert, one statement
 *   - getWorkspaceRow(...)                    -- one row by its caller-visible id
 *   - listWorkspaceRows(filter)               -- one keyset-cursored page
 *   - deleteWorkspaceRow(...)                 -- one row
 *   - deleteWorkspaceRowsBefore(...)          -- retention by age
 *   - trimWorkspaceRows(...)                  -- retention by count
 *   - workspaceRowStats(...)                  -- count/bytes/span without reading rows
 *   - workspaceRowUsage(scope)                -- what the quota gate reads
 *   - deleteWorkspaceRowSpace(...)            -- the whole namespace, when a space is removed
 * @usage import type { WorkspaceRowRepository } from './repositories/workspace-row.repository.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type {
  WorkspaceRowRecord,
  WorkspaceRowFilter,
  WorkspaceRowPage,
  WorkspaceRowStats,
  WorkspaceRowUsage,
  WorkspaceRowScope,
} from '../interface.js';

export interface WorkspaceRowRepository {
  /**
   * Insert many rows as one statement. A repeated `rowId` within the same space REPLACES the stored
   * row and refreshes `updatedAt`, keeping `createdAt` — so a re-run of an ingest that already
   * landed is idempotent rather than a duplicate, which is the behaviour every scheduled importer
   * needs and none of them would build for themselves.
   */
  appendWorkspaceRows(rows: WorkspaceRowRecord[]): Promise<void>;

  getWorkspaceRow(
    organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<WorkspaceRowRecord | null>;

  /** One page, keyset-cursored on (occurredAt, id) so a page boundary cannot skip or repeat a row. */
  listWorkspaceRows(filter: WorkspaceRowFilter): Promise<WorkspaceRowPage>;

  /** True when a row was there to remove. */
  deleteWorkspaceRow(
    organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<boolean>;

  /** Retention by age: everything whose `createdAt` is strictly older than `before`. Returns the count. */
  deleteWorkspaceRowsBefore(
    organismId: string, wsId: string, namespace: string, before: string,
  ): Promise<number>;

  /** Retention by count: everything past the newest `keep`, in the read order. Returns the count. */
  trimWorkspaceRows(
    organismId: string, wsId: string, namespace: string, keep: number,
  ): Promise<number>;

  /**
   * Count, bytes and time span. Omit `namespace` for every row space in the workspace, which is what
   * the workspace index shows instead of rows.
   */
  workspaceRowStats(
    organismId: string, wsId: string, namespace?: string,
  ): Promise<WorkspaceRowStats[]>;

  /** Rows and bytes for a scope. The quota gate's only read. */
  workspaceRowUsage(scope: WorkspaceRowScope): Promise<WorkspaceRowUsage>;

  /** Remove an entire namespace. Used when a space leaves the manifest or a workspace is deleted. */
  deleteWorkspaceRowSpace(organismId: string, wsId: string, namespace?: string): Promise<number>;
}
