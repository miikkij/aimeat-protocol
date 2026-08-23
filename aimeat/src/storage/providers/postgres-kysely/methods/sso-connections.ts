/**
 * @file src/storage/providers/postgres-kysely/methods/sso-connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres implementation of SsoConnectionRepository (BR-04): CRUD over
 *   "SsoConnection" plus the SCIM bearer-hash auth read (unique partial index).
 * @structure ssoConnectionMethods — create / get / list / update / delete / getByScimTokenHash
 * @usage Object.assign(PostgresKyselyStorage.prototype, ssoConnectionMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 1).
 */
import type { Selectable } from 'kysely';
import type { SsoConnectionRecord, SsoConnectionSaml } from '../../../interface.js';
import type { SsoConnection } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | null => (t == null ? null : iso(t));

function toRecord(r: Selectable<SsoConnection>): SsoConnectionRecord {
  return {
    id: r.id,
    name: r.name,
    organismId: r.organismId ?? null,
    domains: (r.domains as string[] | null) ?? [],
    saml: (r.saml as SsoConnectionSaml | null) ?? null,
    allowIdpInitiated: r.allowIdpInitiated ?? false,
    loginVisibility: (r.loginVisibility === 'hidden' ? 'hidden' : 'listed'),
    scimTokenHash: r.scimTokenHash ?? null,
    scimTokenCreatedAt: isoOpt(r.scimTokenCreatedAt),
    lastScimRequestAt: isoOpt(r.lastScimRequestAt),
    lastLoginAt: isoOpt(r.lastLoginAt),
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

const dateOrNull = (v: string | null | undefined): Date | null => (v == null ? null : new Date(v));

export const ssoConnectionMethods = {
  async createSsoConnection(this: PostgresKyselyStorage, record: SsoConnectionRecord): Promise<SsoConnectionRecord> {
    const [row] = await this.db.insertInto('SsoConnection').values({
      id: record.id,
      name: record.name,
      organismId: record.organismId ?? null,
      domains: jsonb(record.domains),
      saml: record.saml ? jsonb(record.saml) : null,
      allowIdpInitiated: record.allowIdpInitiated,
      loginVisibility: record.loginVisibility,
      scimTokenHash: record.scimTokenHash ?? null,
      scimTokenCreatedAt: dateOrNull(record.scimTokenCreatedAt),
      lastScimRequestAt: dateOrNull(record.lastScimRequestAt),
      lastLoginAt: dateOrNull(record.lastLoginAt),
      createdBy: record.createdBy,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    }).returningAll().execute();
    return toRecord(row);
  },

  async getSsoConnection(this: PostgresKyselyStorage, id: string): Promise<SsoConnectionRecord | null> {
    const r = await this.db.selectFrom('SsoConnection').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toRecord(r) : null;
  },

  async listSsoConnections(this: PostgresKyselyStorage): Promise<SsoConnectionRecord[]> {
    const rows = await this.db.selectFrom('SsoConnection').selectAll().orderBy('createdAt', 'asc').execute();
    return rows.map(toRecord);
  },

  async updateSsoConnection(this: PostgresKyselyStorage, id: string, updates: Partial<SsoConnectionRecord>): Promise<SsoConnectionRecord | null> {
    const data: Record<string, unknown> = {};
    if (updates.name !== undefined) data.name = updates.name;
    if (updates.organismId !== undefined) data.organismId = updates.organismId;
    if (updates.domains !== undefined) data.domains = jsonb(updates.domains);
    if (updates.saml !== undefined) data.saml = updates.saml ? jsonb(updates.saml) : null;
    if (updates.allowIdpInitiated !== undefined) data.allowIdpInitiated = updates.allowIdpInitiated;
    if (updates.loginVisibility !== undefined) data.loginVisibility = updates.loginVisibility;
    if (updates.scimTokenHash !== undefined) data.scimTokenHash = updates.scimTokenHash;
    if (updates.scimTokenCreatedAt !== undefined) data.scimTokenCreatedAt = dateOrNull(updates.scimTokenCreatedAt);
    if (updates.lastScimRequestAt !== undefined) data.lastScimRequestAt = dateOrNull(updates.lastScimRequestAt);
    if (updates.lastLoginAt !== undefined) data.lastLoginAt = dateOrNull(updates.lastLoginAt);
    if (Object.keys(data).length === 0) return this.getSsoConnection(id);
    data.updatedAt = new Date();
    const rows = await this.db.updateTable('SsoConnection').set(data).where('id', '=', id).returningAll().execute();
    return rows[0] ? toRecord(rows[0]) : null;
  },

  async deleteSsoConnection(this: PostgresKyselyStorage, id: string): Promise<boolean> {
    const result = await this.db.deleteFrom('SsoConnection').where('id', '=', id).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0) > 0;
  },

  async getSsoConnectionByScimTokenHash(this: PostgresKyselyStorage, hash: string): Promise<SsoConnectionRecord | null> {
    const r = await this.db.selectFrom('SsoConnection').selectAll().where('scimTokenHash', '=', hash).executeTakeFirst();
    return r ? toRecord(r) : null;
  },
};
