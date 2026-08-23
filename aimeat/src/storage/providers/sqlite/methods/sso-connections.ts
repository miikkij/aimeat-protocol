/**
 * @file src/storage/providers/sqlite/methods/sso-connections.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of SsoConnectionRepository (BR-04): CRUD over
 *   `sso_connections` with JSON serialization of domains and the saml block, plus the SCIM
 *   bearer-hash auth read (unique partial index).
 * @structure ssoConnectionMethods — create / get / list / update / delete / getByScimTokenHash
 * @usage Object.assign(SqliteStorage.prototype, ssoConnectionMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 1).
 */
import type { SsoConnectionRecord, SsoConnectionSaml } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

function toRecord(row: Record<string, unknown>): SsoConnectionRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    organismId: (row.organismId as string) ?? null,
    domains: JSON.parse((row.domains as string) || '[]') as string[],
    saml: row.saml ? JSON.parse(row.saml as string) as SsoConnectionSaml : null,
    allowIdpInitiated: row.allowIdpInitiated === 1,
    loginVisibility: row.loginVisibility === 'hidden' ? 'hidden' : 'listed',
    scimTokenHash: (row.scimTokenHash as string) ?? null,
    scimTokenCreatedAt: (row.scimTokenCreatedAt as string) ?? null,
    lastScimRequestAt: (row.lastScimRequestAt as string) ?? null,
    lastLoginAt: (row.lastLoginAt as string) ?? null,
    createdBy: row.createdBy as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

export const ssoConnectionMethods = {
  async createSsoConnection(this: SqliteStorage, record: SsoConnectionRecord): Promise<SsoConnectionRecord> {
    this.db.prepare(
      `INSERT INTO sso_connections (id, name, organismId, domains, saml, allowIdpInitiated,
         loginVisibility, scimTokenHash, scimTokenCreatedAt, lastScimRequestAt, lastLoginAt,
         createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.name, record.organismId ?? null,
      JSON.stringify(record.domains ?? []),
      record.saml ? JSON.stringify(record.saml) : null,
      record.allowIdpInitiated ? 1 : 0,
      record.loginVisibility,
      record.scimTokenHash ?? null, record.scimTokenCreatedAt ?? null,
      record.lastScimRequestAt ?? null, record.lastLoginAt ?? null,
      record.createdBy, record.createdAt, record.updatedAt,
    );
    return record;
  },

  async getSsoConnection(this: SqliteStorage, id: string): Promise<SsoConnectionRecord | null> {
    const row = this.db.prepare('SELECT * FROM sso_connections WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : null;
  },

  async listSsoConnections(this: SqliteStorage): Promise<SsoConnectionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM sso_connections ORDER BY createdAt ASC').all() as Record<string, unknown>[];
    return rows.map(toRecord);
  },

  async updateSsoConnection(this: SqliteStorage, id: string, updates: Partial<SsoConnectionRecord>): Promise<SsoConnectionRecord | null> {
    const existing = await this.getSsoConnection(id);
    if (!existing) return null;
    // id, createdBy and createdAt never change; everything else spreads over the existing row.
    const updated: SsoConnectionRecord = {
      ...existing, ...updates,
      id: existing.id, createdBy: existing.createdBy, createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.db.prepare(
      `UPDATE sso_connections SET name = ?, organismId = ?, domains = ?, saml = ?,
         allowIdpInitiated = ?, loginVisibility = ?, scimTokenHash = ?, scimTokenCreatedAt = ?,
         lastScimRequestAt = ?, lastLoginAt = ?, updatedAt = ? WHERE id = ?`
    ).run(
      updated.name, updated.organismId ?? null,
      JSON.stringify(updated.domains ?? []),
      updated.saml ? JSON.stringify(updated.saml) : null,
      updated.allowIdpInitiated ? 1 : 0,
      updated.loginVisibility,
      updated.scimTokenHash ?? null, updated.scimTokenCreatedAt ?? null,
      updated.lastScimRequestAt ?? null, updated.lastLoginAt ?? null,
      updated.updatedAt, id,
    );
    return updated;
  },

  async deleteSsoConnection(this: SqliteStorage, id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM sso_connections WHERE id = ?').run(id).changes > 0;
  },

  async getSsoConnectionByScimTokenHash(this: SqliteStorage, hash: string): Promise<SsoConnectionRecord | null> {
    const row = this.db.prepare('SELECT * FROM sso_connections WHERE scimTokenHash = ?').get(hash) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : null;
  },
};
