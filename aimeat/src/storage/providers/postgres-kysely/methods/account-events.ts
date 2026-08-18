/**
 * @file src/storage/providers/postgres-kysely/methods/account-events.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres implementation of the per-owner event window and its archive.
 * @structure accountEventMethods — append / list / listArchive / countArchive / trim
 * @usage Object.assign(PostgresKyselyStorage.prototype, accountEventMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
import { sql } from 'kysely';
import type {
  AccountEventRecord,
  AccountEventFilter,
  AccountEventTrimResult,
  AccountEventKind,
} from '../../../interface.js';
import type { PostgresKyselyStorage } from '../index.js';

function toEvent(r: Record<string, unknown>): AccountEventRecord {
  const data = r.data && typeof r.data === 'object' && !Array.isArray(r.data)
    ? (r.data as Record<string, string>) : {};
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    at: r.at as string,
    kind: r.kind as AccountEventKind,
    actorGaii: (r.actorGaii as string) ?? '',
    data,
    link: (r.link as string) ?? '',
    subject: (r.subject as string) ?? '',
  };
}

/** Shared shape of both reads — the archive answers the same question about older rows. */
function applyFilter<T>(q: T, filter: AccountEventFilter): T {
  let out = q as unknown as {
    where: (a: string, b: string, c: unknown) => unknown;
  };
  out = out.where('ownerGhii', '=', filter.ownerGhii) as typeof out;
  if (filter.kind) out = out.where('kind', '=', filter.kind) as typeof out;
  if (filter.from) out = out.where('at', '>=', filter.from) as typeof out;
  if (filter.to) out = out.where('at', '<=', filter.to) as typeof out;
  return out as unknown as T;
}

const bounded = (n: number | undefined, fallback: number): number =>
  Math.min(Math.max(n ?? fallback, 1), 500);

export const accountEventMethods = {
  async appendAccountEvent(this: PostgresKyselyStorage, e: AccountEventRecord): Promise<void> {
    await this.db.insertInto('AccountEvent').values({
      id: e.id, ownerGhii: e.ownerGhii, at: e.at, kind: e.kind,
      actorGaii: e.actorGaii, data: JSON.stringify(e.data), link: e.link, subject: e.subject,
    }).execute();
  },

  async listAccountEvents(this: PostgresKyselyStorage, filter: AccountEventFilter): Promise<AccountEventRecord[]> {
    let q = this.db.selectFrom('AccountEvent').selectAll();
    q = applyFilter(q, filter);
    const rows = await q.orderBy('at', 'desc')
      .limit(bounded(filter.limit, 100)).offset(Math.max(filter.offset ?? 0, 0)).execute();
    return rows.map(r => toEvent(r as unknown as Record<string, unknown>));
  },

  async listAccountEventArchive(this: PostgresKyselyStorage, filter: AccountEventFilter): Promise<AccountEventRecord[]> {
    let q = this.db.selectFrom('AccountEventArchive').selectAll();
    q = applyFilter(q, filter);
    const rows = await q.orderBy('at', 'desc')
      .limit(bounded(filter.limit, 100)).offset(Math.max(filter.offset ?? 0, 0)).execute();
    return rows.map(r => toEvent(r as unknown as Record<string, unknown>));
  },

  async countAccountEventArchive(this: PostgresKyselyStorage, ownerGhii: string): Promise<number> {
    const row = await this.db.selectFrom('AccountEventArchive')
      .select(({ fn }) => [fn.countAll<string>().as('n')])
      .where('ownerGhii', '=', ownerGhii).executeTakeFirst();
    return Number(row?.n ?? 0);
  },

  async trimAccountEvents(
    this: PostgresKyselyStorage, ownerGhii: string, keep: number,
  ): Promise<AccountEventTrimResult> {
    // One transaction: a row is never in both tables or in neither. `ON CONFLICT DO NOTHING` makes a
    // replayed trim idempotent, since the id carries across.
    return this.transaction(async () => {
      const overflow = await this.db.selectFrom('AccountEvent').select('id')
        .where('ownerGhii', '=', ownerGhii)
        .orderBy('at', 'desc').offset(Math.max(keep, 0)).limit(500).execute();
      const ids = overflow.map(r => r.id);
      if (!ids.length) return { archived: 0 };

      const archivedAt = new Date().toISOString();
      // Columns named rather than `SELECT *`: a positional copy works until someone ALTERs the hot
      // table, and then it writes values into the wrong archive columns.
      await sql`
        INSERT INTO "AccountEventArchive"
          ("id","ownerGhii","at","kind","actorGaii","data","link","subject","archivedAt")
        SELECT "id","ownerGhii","at","kind","actorGaii","data","link","subject", ${archivedAt}
        FROM "AccountEvent" WHERE "id" = ANY(${ids})
        ON CONFLICT ("id") DO NOTHING
      `.execute(this.db);
      await this.db.deleteFrom('AccountEvent').where('id', 'in', ids).execute();
      return { archived: ids.length };
    });
  },
};
