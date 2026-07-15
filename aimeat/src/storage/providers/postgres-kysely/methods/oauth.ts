/**
 * @file src/storage/providers/postgres-kysely/methods/oauth.ts
 * @description OAuth domain for the Postgres+Kysely backend (OAuthClient / OAuthRefreshToken /
 *   OAuthApproval): registered OAuth 2.1 clients, rotating refresh tokens, and remembered consent
 *   approvals, plus the bulk deletes by client, GAII, and owner. Approvals are keyed by the unique
 *   (clientId, gaii) pair. Translated 1:1 from the Prisma implementation.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: OAuth domain on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { OAuthClientRecord, OAuthRefreshTokenRecord, OAuthApprovalRecord } from '../../../interface.js';
import type { OAuthClient, OAuthRefreshToken, OAuthApproval } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function mapClient(r: Selectable<OAuthClient>): OAuthClientRecord {
  return {
    clientId: r.clientId, clientSecret: r.clientSecret, clientName: r.clientName,
    redirectUris: r.redirectUris ?? [], createdAt: iso(r.createdAt),
  };
}

function mapRefreshToken(r: Selectable<OAuthRefreshToken>): OAuthRefreshTokenRecord {
  return {
    tokenHash: r.tokenHash, clientId: r.clientId, gaii: r.gaii, owner: r.owner,
    roles: r.roles ?? [], createdAt: iso(r.createdAt),
  };
}

function mapApproval(r: Selectable<OAuthApproval>): OAuthApprovalRecord {
  return {
    clientId: r.clientId, gaii: r.gaii, owner: r.owner, scope: r.scope, approvedAt: iso(r.approvedAt),
  };
}

export const oauthMethods = {
  // ── Clients ──
  async createOAuthClient(this: PostgresKyselyStorage, client: OAuthClientRecord): Promise<void> {
    await this.db.insertInto('OAuthClient').values({
      clientId: client.clientId, clientSecret: client.clientSecret, clientName: client.clientName,
      redirectUris: client.redirectUris, createdAt: new Date(client.createdAt),
    }).execute();
  },

  async getOAuthClient(this: PostgresKyselyStorage, clientId: string): Promise<OAuthClientRecord | null> {
    const r = await this.db.selectFrom('OAuthClient').selectAll().where('clientId', '=', clientId).executeTakeFirst();
    return r ? mapClient(r) : null;
  },

  async deleteOAuthClient(this: PostgresKyselyStorage, clientId: string): Promise<boolean> {
    await this.db.deleteFrom('OAuthRefreshToken').where('clientId', '=', clientId).execute();
    await this.db.deleteFrom('OAuthApproval').where('clientId', '=', clientId).execute();
    const r = await this.db.deleteFrom('OAuthClient').where('clientId', '=', clientId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async listOAuthClients(this: PostgresKyselyStorage): Promise<OAuthClientRecord[]> {
    const rows = await this.db.selectFrom('OAuthClient').selectAll().orderBy('createdAt', 'desc').execute();
    return rows.map(mapClient);
  },

  // ── Refresh tokens ──
  async createOAuthRefreshToken(this: PostgresKyselyStorage, token: OAuthRefreshTokenRecord): Promise<void> {
    await this.db.insertInto('OAuthRefreshToken').values({
      tokenHash: token.tokenHash, clientId: token.clientId, gaii: token.gaii, owner: token.owner,
      roles: token.roles, createdAt: new Date(token.createdAt),
    }).execute();
  },

  async getOAuthRefreshToken(this: PostgresKyselyStorage, tokenHash: string): Promise<OAuthRefreshTokenRecord | null> {
    const r = await this.db.selectFrom('OAuthRefreshToken').selectAll().where('tokenHash', '=', tokenHash).executeTakeFirst();
    return r ? mapRefreshToken(r) : null;
  },

  async deleteOAuthRefreshToken(this: PostgresKyselyStorage, tokenHash: string): Promise<boolean> {
    const r = await this.db.deleteFrom('OAuthRefreshToken').where('tokenHash', '=', tokenHash).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async deleteOAuthRefreshTokensByClient(this: PostgresKyselyStorage, clientId: string): Promise<number> {
    const r = await this.db.deleteFrom('OAuthRefreshToken').where('clientId', '=', clientId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async deleteOAuthRefreshTokensByGaii(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('OAuthRefreshToken').where('gaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  // ── Approvals (remembered consent grants) ──
  async createOAuthApproval(this: PostgresKyselyStorage, approval: OAuthApprovalRecord): Promise<void> {
    await this.db.insertInto('OAuthApproval').values({
      clientId: approval.clientId, gaii: approval.gaii, owner: approval.owner,
      scope: approval.scope, approvedAt: new Date(approval.approvedAt),
    }).onConflict(oc => oc.columns(['clientId', 'gaii']).doUpdateSet({
      scope: approval.scope, approvedAt: new Date(approval.approvedAt),
    })).execute();
  },

  async getOAuthApproval(this: PostgresKyselyStorage, clientId: string, gaii: string): Promise<OAuthApprovalRecord | null> {
    const r = await this.db.selectFrom('OAuthApproval').selectAll().where('clientId', '=', clientId).where('gaii', '=', gaii).executeTakeFirst();
    return r ? mapApproval(r) : null;
  },

  async deleteOAuthApproval(this: PostgresKyselyStorage, clientId: string, gaii: string): Promise<boolean> {
    const r = await this.db.deleteFrom('OAuthApproval').where('clientId', '=', clientId).where('gaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async deleteOAuthApprovalsByClient(this: PostgresKyselyStorage, clientId: string): Promise<number> {
    const r = await this.db.deleteFrom('OAuthApproval').where('clientId', '=', clientId).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async deleteOAuthApprovalsByGaii(this: PostgresKyselyStorage, gaii: string): Promise<number> {
    const r = await this.db.deleteFrom('OAuthApproval').where('gaii', '=', gaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async listOAuthApprovalsByOwner(this: PostgresKyselyStorage, owner: string): Promise<OAuthApprovalRecord[]> {
    const rows = await this.db.selectFrom('OAuthApproval').selectAll().where('owner', '=', owner).orderBy('approvedAt', 'desc').execute();
    return rows.map(mapApproval);
  },
};
