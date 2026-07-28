/**
 * @file src/storage/providers/postgres-kysely/methods/app-grants.ts
 * @description App-grant OAuth tokens for the Postgres+Kysely backend (AppGrant table): the revocable,
 *   scoped grant an owner issues to a hosted app so its app-origin token resolves to `role:'app'` fenced
 *   to approved scopes (H-2 app-origin isolation). Backs POST /token (authorization_code + refresh_token),
 *   the owner's grant list, and revoke. Translated 1:1 from the SQLite/Prisma implementations — `scopes`
 *   is a native Postgres text[] column; timestamps are ISO on the record, Date in the column.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 5: app-grant tokens on Postgres+Kysely.
 *   v1.1.0 — 2026-07-25 — Add getAppGrantByOwnerAndApp for the one-live-grant-per-(owner, app)
 *     invariant (migration 0012 dedupes + enforces it with a partial unique index).
 */
import type { Selectable } from 'kysely';
import type { AppGrantRecord } from '../../../interface.js';
import type { AppGrant } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoN = (t: Date | string | null | undefined): string | null => (t == null ? null : iso(t));

function toGrant(r: Selectable<AppGrant>): AppGrantRecord {
  return {
    grantId: r.grantId, app: r.app, appName: r.appName, appOrigin: r.appOrigin, owner: r.owner, gaii: r.gaii,
    scopes: r.scopes ?? [], refreshTokenHash: r.refreshTokenHash ?? null,
    spendCapMorsels: r.spendCapMorsels ?? null, spentMorsels: r.spentMorsels ?? 0,
    createdAt: iso(r.createdAt), lastUsedAt: isoN(r.lastUsedAt), revoked: r.revoked,
  };
}

export const appGrantMethods = {
  async createAppGrant(this: PostgresKyselyStorage, grant: AppGrantRecord): Promise<AppGrantRecord> {
    await this.db.insertInto('AppGrant').values({
      grantId: grant.grantId, app: grant.app, appName: grant.appName, appOrigin: grant.appOrigin,
      owner: grant.owner, gaii: grant.gaii, scopes: grant.scopes ?? [], refreshTokenHash: grant.refreshTokenHash ?? null,
      spendCapMorsels: grant.spendCapMorsels ?? null, spentMorsels: grant.spentMorsels ?? 0,
      createdAt: new Date(grant.createdAt), lastUsedAt: grant.lastUsedAt ? new Date(grant.lastUsedAt) : null,
      revoked: grant.revoked ?? false,
    }).execute();
    return grant;
  },
  async getAppGrant(this: PostgresKyselyStorage, grantId: string): Promise<AppGrantRecord | null> {
    const r = await this.db.selectFrom('AppGrant').selectAll().where('grantId', '=', grantId).executeTakeFirst();
    return r ? toGrant(r) : null;
  },
  async getAppGrantByRefreshHash(this: PostgresKyselyStorage, tokenHash: string): Promise<AppGrantRecord | null> {
    const r = await this.db.selectFrom('AppGrant').selectAll().where('refreshTokenHash', '=', tokenHash).executeTakeFirst();
    return r ? toGrant(r) : null;
  },
  async getAppGrantByOwnerAndApp(this: PostgresKyselyStorage, owner: string, app: string): Promise<AppGrantRecord | null> {
    // Ordered + first rather than a bare lookup: the partial unique index guarantees at most one live
    // row, but a DB that predates the index (pre-dedupe boot) must still resolve deterministically to
    // the freshest grant instead of an arbitrary leftover. NULLS LAST — an unused grant never wins.
    const r = await this.db.selectFrom('AppGrant').selectAll()
      .where('owner', '=', owner).where('app', '=', app).where('revoked', '=', false)
      .orderBy('lastUsedAt', (ob) => ob.desc().nullsLast()).orderBy('createdAt', 'desc')
      .executeTakeFirst();
    return r ? toGrant(r) : null;
  },
  async listAppGrantsByOwner(this: PostgresKyselyStorage, owner: string): Promise<AppGrantRecord[]> {
    return (await this.db.selectFrom('AppGrant').selectAll().where('owner', '=', owner).orderBy('createdAt', 'desc').execute()).map(toGrant);
  },
  async updateAppGrant(
    this: PostgresKyselyStorage,
    grantId: string,
    updates: Partial<Pick<AppGrantRecord, 'refreshTokenHash' | 'lastUsedAt' | 'revoked' | 'scopes' | 'spendCapMorsels' | 'spentMorsels'>>,
  ): Promise<AppGrantRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.refreshTokenHash !== undefined) data.refreshTokenHash = updates.refreshTokenHash;
    if (updates.lastUsedAt !== undefined) data.lastUsedAt = updates.lastUsedAt ? new Date(updates.lastUsedAt) : null;
    if (updates.revoked !== undefined) data.revoked = updates.revoked;
    if (updates.scopes !== undefined) data.scopes = updates.scopes;
    if (updates.spendCapMorsels !== undefined) data.spendCapMorsels = updates.spendCapMorsels;
    if (updates.spentMorsels !== undefined) data.spentMorsels = updates.spentMorsels;
    if (Object.keys(data).length === 0) return this.getAppGrant(grantId);
    const rows = await this.db.updateTable('AppGrant').set(data as never).where('grantId', '=', grantId).returningAll().execute();
    return rows[0] ? toGrant(rows[0]) : null;
  },
  async deleteAppGrant(this: PostgresKyselyStorage, grantId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('AppGrant').where('grantId', '=', grantId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
