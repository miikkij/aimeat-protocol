/**
 * @file src/storage/providers/sqlite/methods/device-auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the domain of postgres-kysely/methods/device-auth.ts (deviceAuthMethods),
 *   so a fix in one provider finds its twin by file name. Bodies moved verbatim from the files named in the
 *   version history; bound to SqliteStorage via the prototype merge in ../index.ts.
 * @structure deviceAuthMethods
 * @usage Object.assign(SqliteStorage.prototype, deviceAuthMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — 9 methods (createDeviceAuth, getDeviceAuthByDeviceCode, getDeviceAuthByUserCode, …)
 *     moved here from federation-oauth.ts so the file mirrors postgres-kysely/methods/device-auth.ts
 *     (secaudit 2026-10, M8).
 */
import type { DeviceAuthorizationRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

export const deviceAuthMethods = {

  // ══════════════════════════════════════════════════════════
  // ── Device Authorization (RFC 8628) ──
  // ══════════════════════════════════════════════════════════

  async createDeviceAuth(this: SqliteStorage, req: DeviceAuthorizationRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO device_auth (deviceCode, userCode, ownerName, agentName, displayName, description, status, scopes, requestedScopes, createdAt, expiresAt, lastPolledAt, pollInterval, approvedBy, agentCredentials, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.deviceCode, req.userCode, req.ownerName, req.agentName,
      req.displayName ?? null, req.description ?? null,
      req.status, req.scopes ? JSON.stringify(req.scopes) : null,
      req.requestedScopes ? JSON.stringify(req.requestedScopes) : null,
      req.createdAt, req.expiresAt, req.lastPolledAt ?? null,
      req.pollInterval, req.approvedBy ?? null,
      req.agentCredentials ? JSON.stringify(req.agentCredentials) : null,
      req.mode ?? 'interactive',
    );
  },

  async getDeviceAuthByDeviceCode(this: SqliteStorage, deviceCode: string): Promise<DeviceAuthorizationRecord | null> {
    const row = this.db.prepare('SELECT * FROM device_auth WHERE deviceCode = ?').get(deviceCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeDeviceAuth(row) : null;
  },

  async getDeviceAuthByUserCode(this: SqliteStorage, userCode: string): Promise<DeviceAuthorizationRecord | null> {
    const row = this.db.prepare('SELECT * FROM device_auth WHERE userCode = ?').get(userCode) as Record<string, unknown> | undefined;
    return row ? this.deserializeDeviceAuth(row) : null;
  },

  async updateDeviceAuth(this: SqliteStorage, deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.scopes !== undefined) { fields.push('scopes = ?'); values.push(JSON.stringify(updates.scopes)); }
    if (updates.requestedScopes !== undefined) { fields.push('requestedScopes = ?'); values.push(JSON.stringify(updates.requestedScopes)); }
    if (updates.lastPolledAt !== undefined) { fields.push('lastPolledAt = ?'); values.push(updates.lastPolledAt); }
    if (updates.pollInterval !== undefined) { fields.push('pollInterval = ?'); values.push(updates.pollInterval); }
    if (updates.approvedBy !== undefined) { fields.push('approvedBy = ?'); values.push(updates.approvedBy); }
    if ('agentCredentials' in updates) { fields.push('agentCredentials = ?'); values.push(updates.agentCredentials ? JSON.stringify(updates.agentCredentials) : null); }
    if (fields.length === 0) return;
    values.push(deviceCode);
    this.db.prepare(`UPDATE device_auth SET ${fields.join(', ')} WHERE deviceCode = ?`).run(...values);
  },

  async countPendingDeviceAuthByOwner(this: SqliteStorage, ownerName: string): Promise<number> {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ?`
    ).get(ownerName, new Date().toISOString()) as { cnt: number };
    return row.cnt;
  },

  async listPendingDeviceAuthByOwner(this: SqliteStorage, ownerName: string): Promise<DeviceAuthorizationRecord[]> {
    const rows = this.db.prepare(
      `SELECT * FROM device_auth WHERE ownerName = ? AND status = 'pending' AND expiresAt > ? ORDER BY createdAt DESC`
    ).all(ownerName, new Date().toISOString()) as Record<string, unknown>[];
    return rows.map(row => this.deserializeDeviceAuth(row));
  },

  async cleanupExpiredDeviceAuth(this: SqliteStorage): Promise<number> {
    const result = this.db.prepare(
      `DELETE FROM device_auth WHERE status = 'pending' AND expiresAt <= ?`
    ).run(new Date().toISOString());
    return result.changes;
  },

  async deleteDeviceAuthByOwner(this: SqliteStorage, ownerName: string): Promise<number> {
    const result = this.db.prepare(`DELETE FROM device_auth WHERE ownerName = ?`).run(ownerName);
    return result.changes;
  },

  deserializeDeviceAuth(this: SqliteStorage, row: Record<string, unknown>): DeviceAuthorizationRecord {
    return {
      deviceCode: row.deviceCode as string,
      userCode: row.userCode as string,
      ownerName: row.ownerName as string,
      agentName: row.agentName as string,
      displayName: row.displayName as string | undefined,
      description: row.description as string | undefined,
      status: row.status as DeviceAuthorizationRecord['status'],
      scopes: row.scopes ? JSON.parse(row.scopes as string) : undefined,
      requestedScopes: row.requestedScopes ? JSON.parse(row.requestedScopes as string) : undefined,
      createdAt: row.createdAt as string,
      expiresAt: row.expiresAt as string,
      lastPolledAt: row.lastPolledAt as string | undefined,
      pollInterval: row.pollInterval as number,
      approvedBy: row.approvedBy as string | undefined,
      agentCredentials: row.agentCredentials ? JSON.parse(row.agentCredentials as string) : undefined,
      mode: row.mode ? (row.mode as DeviceAuthorizationRecord['mode']) : undefined,
    };
  },
};
