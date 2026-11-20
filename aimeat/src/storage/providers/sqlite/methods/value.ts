/**
 * @file src/storage/providers/sqlite/methods/value.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite method group for the value signals (ValueRepository). Thin async wrappers over
 *   ../repos/value.ts, which holds the SQL.
 * @structure valueMethods
 * @usage Object.assign(SqliteStorage.prototype, valueMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 1).
 */
import type { SqliteStorage } from '../index.js';
import type {
  ValueKeyRow, ValueKeyDelta, ValueDailyDelta, ValueDailyFilter, ValueDailyGroup, ValueDailySum,
} from '../../../types/value.js';
import * as repo from '../repos/value.js';

export const valueMethods = {
  async getValueKeys(this: SqliteStorage, pairs: Array<{ ownerGaii: string; key: string }>): Promise<ValueKeyRow[]> {
    return repo.getKeys(this.db, pairs);
  },
  async upsertValueKeys(this: SqliteStorage, rows: ValueKeyDelta[]): Promise<void> {
    repo.upsertKeys(this.db, rows);
  },
  async deleteValueKeys(this: SqliteStorage, pairs: Array<{ ownerGaii: string; key: string }>): Promise<void> {
    repo.deleteKeys(this.db, pairs);
  },
  async listValueKeys(
    this: SqliteStorage, filter: { ownerGaii: string; keyPrefix?: string; keys?: string[]; limit?: number },
  ): Promise<ValueKeyRow[]> {
    return repo.listKeys(this.db, filter);
  },
  async upsertValueDaily(this: SqliteStorage, rows: ValueDailyDelta[]): Promise<void> {
    repo.upsertDaily(this.db, rows);
  },
  async sumValueDaily(this: SqliteStorage, filter: ValueDailyFilter, groupBy: ValueDailyGroup[]): Promise<ValueDailySum[]> {
    return repo.sumDaily(this.db, filter, groupBy);
  },
  async foldValueDaily(this: SqliteStorage, beforeDay: string): Promise<number> {
    return repo.foldDaily(this.db, beforeDay);
  },
};
