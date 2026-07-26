/**
 * @file src/storage/providers/postgres-kysely/methods/otk.ts
 * @description One-Time-Key domain for the Postgres+Kysely backend (Otk table). Backs the OTK auth flow
 *   with the initial-key (timer-on-first-use) + post-use grace window semantics. Translated 1:1 from the
 *   Prisma provider (migration 0004 added the `initial` column the canonical PG schema was missing).
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: OTK on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { OtkRecord } from '../../../interface.js';
import type { Otk } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb, dbError } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toOtk(r: Selectable<Otk>): OtkRecord {
  return {
    key: r.key, ownerGaii: r.ownerGaii, action: r.action, params: (r.params ?? {}) as Record<string, unknown>,
    expiresAt: iso(r.expiresAt), initial: r.initial ?? false, used: r.used,
    usedAt: r.usedAt ? iso(r.usedAt) : null, sessionId: r.sessionId ?? null, createdAt: iso(r.createdAt),
  };
}

export const otkMethods = {
  async createOtk(this: PostgresKyselyStorage, otk: OtkRecord): Promise<OtkRecord> {
    await this.db.insertInto('Otk').values({
      key: otk.key, ownerGaii: otk.ownerGaii, action: otk.action, params: jsonb(otk.params), expiresAt: new Date(otk.expiresAt),
      used: otk.used, initial: otk.initial ?? false, usedAt: otk.usedAt ? new Date(otk.usedAt) : null,
      sessionId: otk.sessionId ?? null, createdAt: new Date(otk.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return otk;
  },
  async getOtk(this: PostgresKyselyStorage, key: string): Promise<OtkRecord | null> {
    const r = await this.db.selectFrom('Otk').selectAll().where('key', '=', key).executeTakeFirst();
    return r ? toOtk(r) : null;
  },
  async consumeOtk(this: PostgresKyselyStorage, key: string, graceMs = 60_000): Promise<OtkRecord | null> {
    try {
      const row = await this.db.selectFrom('Otk').selectAll().where('key', '=', key).executeTakeFirst();
      if (!row) return null;
      // Initial OTK: timer hasn't started — activate on first use (start the grace window now).
      if (row.initial && !row.used) {
        const [u] = await this.db.updateTable('Otk').set({ used: true, usedAt: new Date(), expiresAt: new Date(Date.now() + graceMs) }).where('key', '=', key).returningAll().execute();
        return toOtk(u);
      }
      if (new Date(iso(row.expiresAt)) < new Date()) {
        await this.db.deleteFrom('Otk').where('key', '=', key).execute();
        return null;
      }
      if (row.used && row.usedAt) {
        if (Date.now() - new Date(iso(row.usedAt)).getTime() > graceMs) {
          await this.db.deleteFrom('Otk').where('key', '=', key).execute();
          return null;
        }
        return toOtk(row);
      }
      const [u] = await this.db.updateTable('Otk').set({ used: true, usedAt: new Date() }).where('key', '=', key).returningAll().execute();
      return toOtk(u);
    } catch (err) { throw dbError('consumeOtk', err); }
  },
  async listOtksBySession(this: PostgresKyselyStorage, sessionId: string): Promise<OtkRecord[]> {
    return (await this.db.selectFrom('Otk').selectAll().where('sessionId', '=', sessionId).execute()).map(toOtk);
  },
  async expireSessionOtks(this: PostgresKyselyStorage, sessionId: string): Promise<number> {
    const r = await this.db.deleteFrom('Otk').where('sessionId', '=', sessionId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
