/**
 * @file src/storage/providers/sqlite/methods/app-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AppPartyRepository on SQLite (tables app_parties, app_party_data; schema-app-parties.ts).
 *   Mirrors the PostgreSQL methods of the same file name.
 *
 *   THE CAP. insertAppPartyCapped and putAppPartyData run their count and their write in one
 *   better-sqlite3 transaction with no await inside, so nothing else on the one connection runs
 *   between them (a savepoint when a storage transaction is already open). A row is replaced by ONE
 *   UPDATE conditional on its version. JSON is TEXT, read and written whole; times are ISO strings.
 * @structure appPartyMethods · toParty · toData · partyParams · STALE · listLimit
 * @usage Object.assign(SqliteStorage.prototype, appPartyMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial
 */
import type Database from 'better-sqlite3';
import { logger } from '../../../../utils/logger.js';
import type {
  AppPartyRow, AppPartyLiveRule, AppPartyInsertResult, AppPartyDataRow, AppPartyImportResult,
} from '../../../types/app-parties.js';

/**
 * Only `db` is used here, so the `this` type names that field rather than the whole storage class.
 * Importing SqliteStorage from ../index.js would be an import cycle, because index.ts binds this
 * module onto the prototype.
 */
type Db = { db: Database.Database };
type Row = Record<string, unknown>;

function parseJson(raw: unknown, what: string): unknown {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    // A malformed column reads as empty (repository contract), and the fault is logged.
    logger.warn(`app-parties: the ${what} column did not parse`, { error: String(err) });
    return undefined;
  }
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toParty(r: Row): AppPartyRow {
  const rec = parseJson(r.record, 'record');
  return {
    uid: r.uid as string, ownerGhii: r.ownerGhii as string, appId: r.appId as string, name: r.name as string,
    emailHash: r.emailHash as string, status: r.status as string, linkHash: str(r.linkHash),
    linkExpiresAt: str(r.linkExpiresAt), verifiedAt: str(r.verifiedAt), pendingSince: r.pendingSince as string,
    epoch: Number(r.epoch ?? 0),
    record: rec && typeof rec === 'object' && !Array.isArray(rec) ? rec as Record<string, unknown> : {},
    createdAt: r.createdAt as string, updatedAt: r.updatedAt as string, version: Number(r.version ?? 1),
  };
}

function toData(r: Row): AppPartyDataRow {
  return {
    appId: r.appId as string, partyUid: r.partyUid as string, key: r.key as string, ownerGhii: r.ownerGhii as string,
    value: parseJson(r.value, 'value') ?? null, bytes: Number(r.bytes ?? 0), version: Number(r.version ?? 1),
    updatedAt: r.updatedAt as string,
  };
}

function partyParams(p: AppPartyRow) {
  return {
    uid: p.uid, ownerGhii: p.ownerGhii, appId: p.appId, name: p.name, emailHash: p.emailHash, status: p.status,
    linkHash: p.linkHash, linkExpiresAt: p.linkExpiresAt, verifiedAt: p.verifiedAt, pendingSince: p.pendingSince,
    epoch: p.epoch, record: JSON.stringify(p.record ?? {}), createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

const INSERT_PARTY = `INSERT INTO app_parties (uid, ownerGhii, appId, name, emailHash, status, linkHash, linkExpiresAt,
    verifiedAt, pendingSince, epoch, record, createdAt, updatedAt, version)
  VALUES (@uid, @ownerGhii, @appId, @name, @emailHash, @status, @linkHash, @linkExpiresAt,
    @verifiedAt, @pendingSince, @epoch, @record, @createdAt, @updatedAt, @version)`;

/** A pending signup whose place has run out (types/app-parties.ts, LIVE AND STALE); binds @now and @staleBefore. */
const STALE = `(status = 'pending' AND verifiedAt IS NULL AND (linkExpiresAt IS NULL OR linkExpiresAt <= @now) AND pendingSince < @staleBefore)`;

function listLimit(limit?: number): number {
  const n = Number(limit ?? 200);
  return Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.floor(n))) : 200;
}

export const appPartyMethods = {
  async insertAppPartyCapped(this: Db, row: AppPartyRow, cap: number, rule: AppPartyLiveRule): Promise<AppPartyInsertResult> {
    const run = this.db.transaction((): AppPartyInsertResult => {
      if (this.db.prepare('SELECT uid FROM app_parties WHERE appId = ? AND emailHash = ?').get(row.appId, row.emailHash)) {
        return { outcome: 'exists', dropped: [] };
      }
      const n = rule.staleBefore
        ? (this.db.prepare(`SELECT COUNT(*) AS n FROM app_parties WHERE appId = @appId AND NOT ${STALE}`)
            .get({ appId: row.appId, now: rule.now, staleBefore: rule.staleBefore }) as { n: number }).n
        : (this.db.prepare('SELECT COUNT(*) AS n FROM app_parties WHERE appId = ?').get(row.appId) as { n: number }).n;
      // Refused before anything is written: the stale rows stay until a signup that fits removes them.
      if (Number(n) >= cap) return { outcome: 'full', dropped: [] };
      let dropped: AppPartyRow[] = [];
      if (rule.staleBefore) {
        dropped = (this.db.prepare(`SELECT * FROM app_parties WHERE appId = @appId AND ${STALE}`)
          .all({ appId: row.appId, now: rule.now, staleBefore: rule.staleBefore }) as Row[]).map(toParty);
        for (const d of dropped) {
          this.db.prepare('DELETE FROM app_party_data WHERE appId = ? AND partyUid = ?').run(d.appId, d.uid);
          this.db.prepare('DELETE FROM app_parties WHERE uid = ?').run(d.uid);
        }
      }
      this.db.prepare(INSERT_PARTY).run({ ...partyParams(row), version: row.version || 1 });
      return { outcome: 'created', dropped };
    });
    return run();
  },

  async getAppParty(this: Db, appId: string, uid: string): Promise<AppPartyRow | null> {
    const r = this.db.prepare('SELECT * FROM app_parties WHERE appId = ? AND uid = ?').get(appId, uid) as Row | undefined;
    return r ? toParty(r) : null;
  },

  async findAppParty(this: Db, appId: string, by: { emailHash?: string; name?: string; linkHash?: string }): Promise<AppPartyRow | null> {
    const [col, val] = by.emailHash ? ['emailHash', by.emailHash] : by.name ? ['name', by.name] : by.linkHash ? ['linkHash', by.linkHash] : [null, null];
    if (!col) return null;
    const r = this.db.prepare(`SELECT * FROM app_parties WHERE appId = ? AND ${col} = ?`).get(appId, val) as Row | undefined;
    return r ? toParty(r) : null;
  },

  async listAppParties(this: Db, appId: string, opts?: { limit?: number; offset?: number }): Promise<AppPartyRow[]> {
    const offset = Math.max(0, Math.floor(Number(opts?.offset ?? 0)) || 0);
    return (this.db.prepare('SELECT * FROM app_parties WHERE appId = ? ORDER BY createdAt ASC, uid ASC LIMIT ? OFFSET ?')
      .all(appId, listLimit(opts?.limit), offset) as Row[]).map(toParty);
  },

  async countAppParties(this: Db, appId: string, rule?: AppPartyLiveRule): Promise<number> {
    const r = rule?.staleBefore
      ? this.db.prepare(`SELECT COUNT(*) AS n FROM app_parties WHERE appId = @appId AND NOT ${STALE}`)
          .get({ appId, now: rule.now, staleBefore: rule.staleBefore }) as { n: number }
      : this.db.prepare('SELECT COUNT(*) AS n FROM app_parties WHERE appId = ?').get(appId) as { n: number };
    return Number(r.n);
  },

  async updateAppParty(this: Db, row: AppPartyRow, expectedVersion: number): Promise<boolean> {
    // The owner, the app, the name, the address and the creation time never change.
    const res = this.db.prepare(
      `UPDATE app_parties SET status = @status, linkHash = @linkHash, linkExpiresAt = @linkExpiresAt,
         verifiedAt = @verifiedAt, pendingSince = @pendingSince, epoch = @epoch, record = @record,
         updatedAt = @updatedAt, version = @nextVersion
       WHERE uid = @uid AND appId = @appId AND version = @expectedVersion`,
    ).run({ ...partyParams(row), nextVersion: expectedVersion + 1, expectedVersion });
    return res.changes === 1;
  },

  async deleteAppParty(this: Db, appId: string, uid: string): Promise<{ removed: boolean; data: number }> {
    const run = this.db.transaction(() => {
      const data = this.db.prepare('DELETE FROM app_party_data WHERE appId = ? AND partyUid = ?').run(appId, uid).changes;
      return { removed: this.db.prepare('DELETE FROM app_parties WHERE appId = ? AND uid = ?').run(appId, uid).changes > 0, data };
    });
    return run();
  },

  async deleteAppPartiesByApp(this: Db, appId: string): Promise<{ parties: AppPartyRow[]; data: number }> {
    const run = this.db.transaction(() => {
      const parties = (this.db.prepare('SELECT * FROM app_parties WHERE appId = ?').all(appId) as Row[]).map(toParty);
      const data = this.db.prepare('DELETE FROM app_party_data WHERE appId = ?').run(appId).changes;
      this.db.prepare('DELETE FROM app_parties WHERE appId = ?').run(appId);
      return { parties, data };
    });
    return run();
  },

  async deleteAppPartiesByOwner(this: Db, ownerGhii: string): Promise<number> {
    const run = this.db.transaction((): number => {
      const data = this.db.prepare('DELETE FROM app_party_data WHERE ownerGhii = ?').run(ownerGhii).changes;
      return data + this.db.prepare('DELETE FROM app_parties WHERE ownerGhii = ?').run(ownerGhii).changes;
    });
    return run();
  },

  async importAppParty(this: Db, row: AppPartyRow): Promise<AppPartyImportResult> {
    const run = this.db.transaction((): AppPartyImportResult => {
      if (this.db.prepare('SELECT uid FROM app_parties WHERE uid = ?').get(row.uid)) return 'present';
      const taken = this.db.prepare(
        'SELECT uid FROM app_parties WHERE (appId = ? AND emailHash = ?) OR (ownerGhii = ? AND name = ?)',
      ).get(row.appId, row.emailHash, row.ownerGhii, row.name);
      if (taken) return 'conflict';
      this.db.prepare(INSERT_PARTY).run({ ...partyParams(row), version: row.version || 1 });
      return 'inserted';
    });
    return run();
  },

  async getAppPartyData(this: Db, appId: string, partyUid: string, key: string): Promise<AppPartyDataRow | null> {
    const r = this.db.prepare('SELECT * FROM app_party_data WHERE appId = ? AND partyUid = ? AND key = ?')
      .get(appId, partyUid, key) as Row | undefined;
    return r ? toData(r) : null;
  },

  async putAppPartyData(this: Db, row: Omit<AppPartyDataRow, 'version'>, maxCollections: number): Promise<{ stored: boolean; version: number }> {
    const value = JSON.stringify(row.value ?? null);
    const run = this.db.transaction((): { stored: boolean; version: number } => {
      const cur = this.db.prepare('SELECT version FROM app_party_data WHERE appId = ? AND partyUid = ? AND key = ?')
        .get(row.appId, row.partyUid, row.key) as { version: number } | undefined;
      if (cur) {
        const version = Number(cur.version) + 1;
        this.db.prepare('UPDATE app_party_data SET value = ?, bytes = ?, version = ?, updatedAt = ? WHERE appId = ? AND partyUid = ? AND key = ?')
          .run(value, row.bytes, version, row.updatedAt, row.appId, row.partyUid, row.key);
        return { stored: true, version };
      }
      const n = (this.db.prepare('SELECT COUNT(*) AS n FROM app_party_data WHERE appId = ? AND partyUid = ?')
        .get(row.appId, row.partyUid) as { n: number }).n;
      if (Number(n) >= maxCollections) return { stored: false, version: 0 };
      this.db.prepare(
        'INSERT INTO app_party_data (appId, partyUid, key, ownerGhii, value, bytes, version, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      ).run(row.appId, row.partyUid, row.key, row.ownerGhii, value, row.bytes, row.updatedAt);
      return { stored: true, version: 1 };
    });
    return run();
  },

  async deleteAppPartyData(this: Db, appId: string, partyUid: string, key: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM app_party_data WHERE appId = ? AND partyUid = ? AND key = ?')
      .run(appId, partyUid, key).changes > 0;
  },
};
