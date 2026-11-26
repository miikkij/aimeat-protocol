/**
 * @file src/storage/providers/postgres-kysely/methods/app-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AppPartyRepository on PostgreSQL (tables "AppParty", "AppPartyData"; migration 0132).
 *   Mirrors the SQLite methods of the same file name.
 *
 *   THE CAP. insertAppPartyCapped takes a transaction-scoped advisory lock named by the app before it
 *   counts, so two signups to one app run one after the other and cannot both take the last place; a
 *   signup to another app takes another lock and is not held up. putAppPartyData does the same per
 *   party for its collection count.
 *
 *   A row is replaced by ONE UPDATE conditional on its version, so under READ COMMITTED a second writer
 *   re-reads the row the first one changed and its version test fails. JSON is TEXT, read and written
 *   whole, so both backends store the same bytes. Times are ISO strings and compare as TEXT.
 * @structure appPartyMethods · toParty · toData · partyColumns · staleWhere · listLimit
 * @usage Object.assign(PostgresKyselyStorage.prototype, appPartyMethods) in ../index.ts
 * @version-history
 *   v1.1.0 — 2026-11-26 — countAppPartiesByApp().
 *   v1.0.0 — 2026-11-15 — Initial
 */
import { sql, type Kysely, type ExpressionBuilder } from 'kysely';
import { logger } from '../../../../utils/logger.js';
import type { DB } from '../db-types.js';
import type {
  AppPartyRow, AppPartyLiveRule, AppPartyInsertResult, AppPartyDataRow, AppPartyImportResult,
} from '../../../types/app-parties.js';

/**
 * Only `db` and `transaction` are used here, so the `this` type names those rather than the whole
 * storage class. Importing PostgresKyselyStorage from ../index.js would be an import cycle, because
 * index.ts binds this module onto the prototype.
 */
type Db = { db: Kysely<DB>; transaction<T>(fn: () => Promise<T>): Promise<T> };
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

/** The columns of one party row, without uid and version. */
function partyColumns(p: AppPartyRow) {
  return {
    ownerGhii: p.ownerGhii, appId: p.appId, name: p.name, emailHash: p.emailHash, status: p.status,
    linkHash: p.linkHash, linkExpiresAt: p.linkExpiresAt, verifiedAt: p.verifiedAt, pendingSince: p.pendingSince,
    epoch: p.epoch, record: JSON.stringify(p.record ?? {}), createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

/** A pending signup whose place has run out (types/app-parties.ts, LIVE AND STALE). */
function staleWhere(rule: AppPartyLiveRule) {
  return (eb: ExpressionBuilder<DB, 'AppParty'>) => eb.and([
    eb('status', '=', 'pending'),
    eb('verifiedAt', 'is', null),
    eb.or([eb('linkExpiresAt', 'is', null), eb('linkExpiresAt', '<=', rule.now)]),
    eb('pendingSince', '<', rule.staleBefore as string),
  ]);
}

/** The row count a list answers: opts.limit, 200 by default, between 1 and 1000. */
function listLimit(limit?: number): number {
  const n = Number(limit ?? 200);
  return Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.floor(n))) : 200;
}

export const appPartyMethods = {
  async insertAppPartyCapped(this: Db, row: AppPartyRow, cap: number, rule: AppPartyLiveRule): Promise<AppPartyInsertResult> {
    return this.transaction(async () => {
      const db = this.db;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`app-parties:${row.appId}`}))`.execute(db);
      const have = await db.selectFrom('AppParty').select('uid')
        .where('appId', '=', row.appId).where('emailHash', '=', row.emailHash).executeTakeFirst();
      if (have) return { outcome: 'exists' as const, dropped: [] };
      let live = db.selectFrom('AppParty').select(eb => eb.fn.countAll<string>().as('n')).where('appId', '=', row.appId);
      if (rule.staleBefore) live = live.where(eb => eb.not(staleWhere(rule)(eb)));
      const n = Number((await live.executeTakeFirst())?.n ?? 0);
      // Refused before anything is written: the stale rows stay until a signup that fits removes them.
      if (n >= cap) return { outcome: 'full' as const, dropped: [] };
      let dropped: AppPartyRow[] = [];
      if (rule.staleBefore) {
        dropped = (await db.selectFrom('AppParty').selectAll().where('appId', '=', row.appId).where(staleWhere(rule)).execute())
          .map(r => toParty(r as unknown as Row));
        for (const d of dropped) {
          await db.deleteFrom('AppPartyData').where('appId', '=', d.appId).where('partyUid', '=', d.uid).execute();
          await db.deleteFrom('AppParty').where('uid', '=', d.uid).execute();
        }
      }
      await db.insertInto('AppParty').values({ uid: row.uid, ...partyColumns(row), version: row.version || 1 }).execute();
      return { outcome: 'created' as const, dropped };
    });
  },

  async getAppParty(this: Db, appId: string, uid: string): Promise<AppPartyRow | null> {
    const r = await this.db.selectFrom('AppParty').selectAll().where('appId', '=', appId).where('uid', '=', uid).executeTakeFirst();
    return r ? toParty(r as unknown as Row) : null;
  },

  async findAppParty(this: Db, appId: string, by: { emailHash?: string; name?: string; linkHash?: string }): Promise<AppPartyRow | null> {
    let q = this.db.selectFrom('AppParty').selectAll().where('appId', '=', appId);
    if (by.emailHash) q = q.where('emailHash', '=', by.emailHash);
    else if (by.name) q = q.where('name', '=', by.name);
    else if (by.linkHash) q = q.where('linkHash', '=', by.linkHash);
    else return null;
    const r = await q.executeTakeFirst();
    return r ? toParty(r as unknown as Row) : null;
  },

  async listAppParties(this: Db, appId: string, opts?: { limit?: number; offset?: number }): Promise<AppPartyRow[]> {
    const rows = await this.db.selectFrom('AppParty').selectAll().where('appId', '=', appId)
      .orderBy('createdAt', 'asc').orderBy('uid', 'asc')
      .limit(listLimit(opts?.limit)).offset(Math.max(0, Math.floor(Number(opts?.offset ?? 0)) || 0)).execute();
    return rows.map(r => toParty(r as unknown as Row));
  },

  async countAppParties(this: Db, appId: string, rule?: AppPartyLiveRule): Promise<number> {
    let q = this.db.selectFrom('AppParty').select(eb => eb.fn.countAll<string>().as('n')).where('appId', '=', appId);
    if (rule?.staleBefore) q = q.where(eb => eb.not(staleWhere(rule)(eb)));
    return Number((await q.executeTakeFirst())?.n ?? 0);
  },

  async countAppPartiesByApp(this: Db): Promise<Record<string, number>> {
    const rows = await this.db.selectFrom('AppParty').select(['appId', eb => eb.fn.countAll<string>().as('n')]).groupBy('appId').execute();
    return Object.fromEntries(rows.map(r => [r.appId, Number(r.n)]));
  },

  async updateAppParty(this: Db, row: AppPartyRow, expectedVersion: number): Promise<boolean> {
    // The owner, the app, the name, the address and the creation time never change.
    const all = partyColumns(row);
    const cols = {
      status: all.status, linkHash: all.linkHash, linkExpiresAt: all.linkExpiresAt, verifiedAt: all.verifiedAt,
      pendingSince: all.pendingSince, epoch: all.epoch, record: all.record, updatedAt: all.updatedAt,
    };
    const res = await this.db.updateTable('AppParty').set({ ...cols, version: expectedVersion + 1 })
      .where('uid', '=', row.uid).where('appId', '=', row.appId).where('version', '=', expectedVersion)
      .executeTakeFirst();
    return Number(res.numUpdatedRows) === 1;
  },

  async deleteAppParty(this: Db, appId: string, uid: string): Promise<{ removed: boolean; data: number }> {
    return this.transaction(async () => {
      const data = await this.db.deleteFrom('AppPartyData').where('appId', '=', appId).where('partyUid', '=', uid).executeTakeFirst();
      const res = await this.db.deleteFrom('AppParty').where('appId', '=', appId).where('uid', '=', uid).executeTakeFirst();
      return { removed: Number(res.numDeletedRows) > 0, data: Number(data.numDeletedRows) };
    });
  },

  async deleteAppPartiesByApp(this: Db, appId: string): Promise<{ parties: AppPartyRow[]; data: number }> {
    return this.transaction(async () => {
      const parties = (await this.db.selectFrom('AppParty').selectAll().where('appId', '=', appId).execute())
        .map(r => toParty(r as unknown as Row));
      const data = await this.db.deleteFrom('AppPartyData').where('appId', '=', appId).executeTakeFirst();
      await this.db.deleteFrom('AppParty').where('appId', '=', appId).execute();
      return { parties, data: Number(data.numDeletedRows) };
    });
  },

  async deleteAppPartiesByOwner(this: Db, ownerGhii: string): Promise<number> {
    return this.transaction(async () => {
      const data = await this.db.deleteFrom('AppPartyData').where('ownerGhii', '=', ownerGhii).executeTakeFirst();
      const parties = await this.db.deleteFrom('AppParty').where('ownerGhii', '=', ownerGhii).executeTakeFirst();
      return Number(data.numDeletedRows) + Number(parties.numDeletedRows);
    });
  },

  async importAppParty(this: Db, row: AppPartyRow): Promise<AppPartyImportResult> {
    return this.transaction(async () => {
      const db = this.db;
      if (await db.selectFrom('AppParty').select('uid').where('uid', '=', row.uid).executeTakeFirst()) return 'present' as const;
      const taken = await db.selectFrom('AppParty').select('uid')
        .where(eb => eb.or([
          eb.and([eb('appId', '=', row.appId), eb('emailHash', '=', row.emailHash)]),
          eb.and([eb('ownerGhii', '=', row.ownerGhii), eb('name', '=', row.name)]),
        ])).executeTakeFirst();
      if (taken) return 'conflict' as const;
      await db.insertInto('AppParty').values({ uid: row.uid, ...partyColumns(row), version: row.version || 1 }).execute();
      return 'inserted' as const;
    });
  },

  async getAppPartyData(this: Db, appId: string, partyUid: string, key: string): Promise<AppPartyDataRow | null> {
    const r = await this.db.selectFrom('AppPartyData').selectAll()
      .where('appId', '=', appId).where('partyUid', '=', partyUid).where('key', '=', key).executeTakeFirst();
    return r ? toData(r as unknown as Row) : null;
  },

  async putAppPartyData(this: Db, row: Omit<AppPartyDataRow, 'version'>, maxCollections: number): Promise<{ stored: boolean; version: number }> {
    return this.transaction(async () => {
      const db = this.db;
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`app-party-data:${row.appId}:${row.partyUid}`}))`.execute(db);
      const cur = await db.selectFrom('AppPartyData').select('version')
        .where('appId', '=', row.appId).where('partyUid', '=', row.partyUid).where('key', '=', row.key).executeTakeFirst();
      const value = JSON.stringify(row.value ?? null);
      if (cur) {
        const version = Number(cur.version) + 1;
        await db.updateTable('AppPartyData').set({ value, bytes: row.bytes, version, updatedAt: row.updatedAt })
          .where('appId', '=', row.appId).where('partyUid', '=', row.partyUid).where('key', '=', row.key).execute();
        return { stored: true, version };
      }
      const n = Number((await db.selectFrom('AppPartyData').select(eb => eb.fn.countAll<string>().as('n'))
        .where('appId', '=', row.appId).where('partyUid', '=', row.partyUid).executeTakeFirst())?.n ?? 0);
      if (n >= maxCollections) return { stored: false, version: 0 };
      await db.insertInto('AppPartyData').values({
        appId: row.appId, partyUid: row.partyUid, key: row.key, ownerGhii: row.ownerGhii, value, bytes: row.bytes,
        version: 1, updatedAt: row.updatedAt,
      }).execute();
      return { stored: true, version: 1 };
    });
  },

  async deleteAppPartyData(this: Db, appId: string, partyUid: string, key: string): Promise<boolean> {
    const res = await this.db.deleteFrom('AppPartyData')
      .where('appId', '=', appId).where('partyUid', '=', partyUid).where('key', '=', key).executeTakeFirst();
    return Number(res.numDeletedRows) > 0;
  },
};
