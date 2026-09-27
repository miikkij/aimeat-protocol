/**
 * @file src/storage/providers/sqlite/methods/held-names.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description HeldAccountNameRepository on SQLite: the records of what the move to the full identity
 *   and the start step for the cortexes and ecosystem apps of deleted accounts left for the operator,
 *   the start step itself, and the operator's decision on one name, each in one transaction. The SQL
 *   is in repos/held-names.ts, which the boot half of the move shares.
 * @structure heldNameMethods — getHeldNamesRecord · saveHeldNamesRecord · settleInstallsOfDeletedAccounts ·
 *   resolveHeldAccountName
 * @usage Object.assign(SqliteStorage.prototype, heldNameMethods) in providers/sqlite/index.ts
 * @version-history
 *   v1.1.0 — 2026-09-26 — settleInstallsOfDeletedAccounts; the record methods take the key; a decision
 *     takes `nodeId`, `rows` and `installs`, and deletes an app's identity data through the provider's
 *     own cascade.
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type Database from 'better-sqlite3';
import type { HeldNamesRecord, HeldNameOutcome, HeldNameResolution } from '../../../types/held-names.js';
import { readHeldNamesRecord, writeHeldNamesRecord, resolveHeldNameIn, settleInstallsIn } from '../repos/held-names.js';

/**
 * What these methods use of the provider: its connection and its per-identity cascade. Named here
 * rather than importing the provider class, which imports this file (an import cycle, check:deps).
 */
interface ProviderHandle {
  readonly db: Database.Database;
  cascadeDeleteAgentData(gaii: string): void;
}

export const heldNameMethods = {
  async getHeldNamesRecord(this: ProviderHandle, key?: string): Promise<HeldNamesRecord | null> {
    return readHeldNamesRecord(this.db, key);
  },

  async saveHeldNamesRecord(this: ProviderHandle, record: HeldNamesRecord, key?: string): Promise<void> {
    writeHeldNamesRecord(this.db, record, key);
  },

  async settleInstallsOfDeletedAccounts(this: ProviderHandle, input: { nodeId: string }): Promise<HeldNamesRecord | null> {
    return this.db.transaction(() => settleInstallsIn(this.db, input, id => this.cascadeDeleteAgentData(id)))();
  },

  async resolveHeldAccountName(this: ProviderHandle, input: {
    name: string; resolution: HeldNameResolution; holderGhii: string | null; namingBefore: string;
    nodeId?: string; rows?: boolean; installs?: boolean;
  }): Promise<HeldNameOutcome> {
    return this.db.transaction(() => resolveHeldNameIn(this.db, input, id => this.cascadeDeleteAgentData(id)))();
  },
};
