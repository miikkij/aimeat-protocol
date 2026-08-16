/**
 * @file src/storage/providers/sqlite/methods/account-events.ts
 * @description SQLite method group for the per-owner event window (AccountEventRepository). Thin
 *   async wrappers over ../repos/account-events.ts, which holds the SQL.
 * @structure accountEventMethods
 * @usage Object.assign(SqliteStorage.prototype, accountEventMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
import type { SqliteStorage } from '../index.js';
import type {
  AccountEventRecord,
  AccountEventFilter,
  AccountEventTrimResult,
} from '../../../interface.js';
import * as repo from '../repos/account-events.js';

export const accountEventMethods = {
  async appendAccountEvent(this: SqliteStorage, event: AccountEventRecord): Promise<void> {
    return repo.appendAccountEvent(this.db, event);
  },
  async listAccountEvents(this: SqliteStorage, filter: AccountEventFilter): Promise<AccountEventRecord[]> {
    return repo.listAccountEvents(this.db, filter);
  },
  async listAccountEventArchive(this: SqliteStorage, filter: AccountEventFilter): Promise<AccountEventRecord[]> {
    return repo.listAccountEventArchive(this.db, filter);
  },
  async countAccountEventArchive(this: SqliteStorage, ownerGhii: string): Promise<number> {
    return repo.countAccountEventArchive(this.db, ownerGhii);
  },
  async trimAccountEvents(this: SqliteStorage, ownerGhii: string, keep: number): Promise<AccountEventTrimResult> {
    return repo.trimAccountEvents(this.db, ownerGhii, keep);
  },
};
