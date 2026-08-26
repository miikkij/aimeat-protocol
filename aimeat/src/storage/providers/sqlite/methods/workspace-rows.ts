/**
 * @file src/storage/providers/sqlite/methods/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite method group for workspace row spaces (WorkspaceRowRepository). Thin async
 *   wrappers over ../repos/workspace-rows.ts, which holds the SQL.
 * @structure workspaceRowMethods
 * @usage Object.assign(SqliteStorage.prototype, workspaceRowMethods) in ../index.ts
 * @version-history
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
} from '../../../interface.js';
import * as repo from '../repos/workspace-rows.js';

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
  async deleteWorkspaceRowSpace(
    this: SqliteStorage, organismId: string, wsId: string, namespace?: string,
  ): Promise<number> {
    return repo.deleteWorkspaceRowSpace(this.db, organismId, wsId, namespace);
  },
};
