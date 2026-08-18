/**
 * @file src/storage/providers/postgres-kysely/methods/pat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Personal Access Token domain for the Postgres+Kysely backend (PersonalAccessToken table).
 *   The raw token is never stored — only its SHA-256 hash. Translated 1:1 from the Prisma provider.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: PAT on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { PatRecord } from '../../../repositories/pat.repository.js';
import type { PersonalAccessToken } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const isoN = (d: Date | string | null | undefined): string | null => (d == null ? null : (d instanceof Date ? d.toISOString() : new Date(d).toISOString()));

function toPat(p: Selectable<PersonalAccessToken>): PatRecord {
  return {
    id: p.id, tokenHash: p.tokenHash, label: p.label, owner: p.owner, scopes: p.scopes ?? [],
    grantOwner: p.grantOwner, grantOperator: p.grantOperator, readOwnerData: p.readOwnerData, gaii: p.gaii,
    createdAt: isoN(p.createdAt) as string, expiresAt: isoN(p.expiresAt), lastUsedAt: isoN(p.lastUsedAt), revoked: p.revoked,
  };
}

export const patMethods = {
  async createPat(this: PostgresKyselyStorage, pat: PatRecord): Promise<void> {
    await this.db.insertInto('PersonalAccessToken').values({
      id: pat.id, tokenHash: pat.tokenHash, label: pat.label, owner: pat.owner, scopes: pat.scopes ?? [],
      grantOwner: pat.grantOwner, grantOperator: pat.grantOperator, readOwnerData: pat.readOwnerData, gaii: pat.gaii,
      createdAt: new Date(pat.createdAt), expiresAt: pat.expiresAt ? new Date(pat.expiresAt) : null,
      lastUsedAt: pat.lastUsedAt ? new Date(pat.lastUsedAt) : null, revoked: false,
    }).execute();
  },
  async getPatByHash(this: PostgresKyselyStorage, tokenHash: string): Promise<PatRecord | null> {
    const p = await this.db.selectFrom('PersonalAccessToken').selectAll().where('tokenHash', '=', tokenHash).where('revoked', '=', false).executeTakeFirst();
    return p ? toPat(p) : null;
  },
  async listPats(this: PostgresKyselyStorage, owner: string): Promise<PatRecord[]> {
    return (await this.db.selectFrom('PersonalAccessToken').selectAll().where('owner', '=', owner).execute()).map(toPat);
  },
  async revokePat(this: PostgresKyselyStorage, id: string, owner: string): Promise<boolean> {
    const existing = await this.db.selectFrom('PersonalAccessToken').select('id').where('id', '=', id).where('owner', '=', owner).where('revoked', '=', false).executeTakeFirst();
    if (!existing) return false;
    await this.db.updateTable('PersonalAccessToken').set({ revoked: true }).where('id', '=', id).execute();
    return true;
  },
  async touchPat(this: PostgresKyselyStorage, id: string, usedAtIso: string): Promise<void> {
    await this.db.updateTable('PersonalAccessToken').set({ lastUsedAt: new Date(usedAtIso) }).where('id', '=', id).execute();
  },
};
