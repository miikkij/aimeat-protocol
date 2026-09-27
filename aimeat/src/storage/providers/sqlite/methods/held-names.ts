/**
 * @file src/storage/providers/sqlite/methods/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HeldAccountNameRepository on SQLite: the record of what the move to the full identity
 *   left for the operator, and the operator's decision on one name, in one transaction. The SQL is in
 *   repos/held-names.ts, which the boot half of the move shares.
 * @structure heldNameMethods — getHeldNamesRecord · saveHeldNamesRecord · resolveHeldAccountName
 * @usage Object.assign(SqliteStorage.prototype, heldNameMethods) in providers/sqlite/index.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type Database from 'better-sqlite3';
import type { HeldNamesRecord, HeldNameOutcome, HeldNameResolution } from '../../../types/held-names.js';
import { readHeldNamesRecord, writeHeldNamesRecord, resolveHeldNameIn } from '../repos/held-names.js';

/**
 * What these methods use of the provider: its connection. Named here rather than importing the
 * provider class, which imports this file (an import cycle, check:deps).
 */
interface ProviderHandle {
  readonly db: Database.Database;
}

export const heldNameMethods = {
  async getHeldNamesRecord(this: ProviderHandle): Promise<HeldNamesRecord | null> {
    return readHeldNamesRecord(this.db);
  },

  async saveHeldNamesRecord(this: ProviderHandle, record: HeldNamesRecord): Promise<void> {
    writeHeldNamesRecord(this.db, record);
  },

  async resolveHeldAccountName(this: ProviderHandle, input: {
    name: string; resolution: HeldNameResolution; holderGhii: string | null; namingBefore: string;
  }): Promise<HeldNameOutcome> {
    return this.db.transaction(() => resolveHeldNameIn(this.db, input))();
  },
};
