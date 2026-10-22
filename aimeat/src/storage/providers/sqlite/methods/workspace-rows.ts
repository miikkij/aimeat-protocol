/**
 * @file src/storage/providers/sqlite/methods/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite method group for workspace row spaces (WorkspaceRowRepository). Thin async
 *   wrappers over ../repos/workspace-rows.ts, which holds the SQL.
 * @structure workspaceRowMethods
 * @usage Object.assign(SqliteStorage.prototype, workspaceRowMethods) in ../index.ts
 * @version-history
 *   v1.2.0 — 2026-10-22 — getWorkspaceRowsByIds and the row revision methods (secaudit 2026-10, v80).
 *   v1.1.0 — 2026-09-09 — deleteWorkspaceRowSpace deleted: no caller outside its unit test.
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { SqliteStorage } from '../index.js';
import type {
  WorkspaceRowRecord,
  WorkspaceRowFilter,
  WorkspaceRowPage,
  WorkspaceRowStats,
  WorkspaceRowUsage,
  WorkspaceRowScope,
  WorkspaceRowRevision,
} from '../../../interface.js';
import * as repo from '../repos/workspace-rows.js';
import * as revisionRepo from '../repos/workspace-row-revisions.js';

export const workspaceRowMethods = {
  async appendWorkspaceRows(this: SqliteStorage, rows: WorkspaceRowRecord[]): Promise<void> {
    return repo.appendWorkspaceRows(this.db, rows);
  },
  async getWorkspaceRow(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<WorkspaceRowRecord | null> {
    return repo.getWorkspaceRow(this.db, organismId, wsId, namespace, rowId);
  },
  async listWorkspaceRows(this: SqliteStorage, filter: WorkspaceRowFilter): Promise<WorkspaceRowPage> {
    return repo.listWorkspaceRows(this.db, filter);
  },
  async deleteWorkspaceRow(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<boolean> {
    return repo.deleteWorkspaceRow(this.db, organismId, wsId, namespace, rowId);
  },
  async deleteWorkspaceRowsBefore(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, before: string,
  ): Promise<number> {
    return repo.deleteWorkspaceRowsBefore(this.db, organismId, wsId, namespace, before);
  },
  async trimWorkspaceRows(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, keep: number,
  ): Promise<number> {
    return repo.trimWorkspaceRows(this.db, organismId, wsId, namespace, keep);
  },
  async workspaceRowStats(
    this: SqliteStorage, organismId: string, wsId: string, namespace?: string,
  ): Promise<WorkspaceRowStats[]> {
    return repo.workspaceRowStats(this.db, organismId, wsId, namespace);
  },
  async workspaceRowUsage(this: SqliteStorage, scope: WorkspaceRowScope): Promise<WorkspaceRowUsage> {
    return repo.workspaceRowUsage(this.db, scope);
  },
  async getWorkspaceRowsByIds(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, rowIds: string[],
  ): Promise<WorkspaceRowRecord[]> {
    return repo.getWorkspaceRowsByIds(this.db, organismId, wsId, namespace, rowIds);
  },
  async appendWorkspaceRowRevisions(this: SqliteStorage, revisions: WorkspaceRowRevision[]): Promise<void> {
    return revisionRepo.appendWorkspaceRowRevisions(this.db, revisions);
  },
  async listWorkspaceRowRevisions(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<WorkspaceRowRevision[]> {
    return revisionRepo.listWorkspaceRowRevisions(this.db, organismId, wsId, namespace, rowId);
  },
  async getWorkspaceRowRevision(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, revisionId: string,
  ): Promise<WorkspaceRowRevision | null> {
    return revisionRepo.getWorkspaceRowRevision(this.db, organismId, wsId, namespace, revisionId);
  },
  async deleteWorkspaceRowRevisions(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, rowId: string,
  ): Promise<number> {
    return revisionRepo.deleteWorkspaceRowRevisions(this.db, organismId, wsId, namespace, rowId);
  },
  async pruneWorkspaceRowRevisions(
    this: SqliteStorage, organismId: string, wsId: string, namespace: string, before: string, keepPerRow: number,
  ): Promise<number> {
    return revisionRepo.pruneWorkspaceRowRevisions(this.db, organismId, wsId, namespace, before, keepPerRow);
  },
};
