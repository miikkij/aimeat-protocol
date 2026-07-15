/**
 * @file src/storage/providers/postgres-kysely/methods/device-auth.ts
 * @description Device-authorization (RFC 8628) domain for the Postgres+Kysely backend (DeviceAuth table).
 *   Backs the agent-connect flow: agent requests a device+user code, owner approves, agent polls. The
 *   minted credentials live in the jsonb `agentCredentials`. Translated 1:1 from the Prisma provider.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: device-auth on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { DeviceAuthorizationRecord } from '../../../interface.js';
import type { DeviceAuth } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoOpt = (t: Date | string | null | undefined): string | undefined => (t == null ? undefined : iso(t));

function toRecord(r: Selectable<DeviceAuth>): DeviceAuthorizationRecord {
  return {
    deviceCode: r.deviceCode, userCode: r.userCode, ownerName: r.ownerName, agentName: r.agentName,
    displayName: r.displayName ?? undefined, description: r.description ?? undefined, status: r.status as DeviceAuthorizationRecord['status'],
    scopes: r.scopes ?? undefined, createdAt: iso(r.createdAt), expiresAt: iso(r.expiresAt), lastPolledAt: isoOpt(r.lastPolledAt),
    pollInterval: r.pollInterval, approvedBy: r.approvedBy ?? undefined, mode: (r.mode ?? undefined) as DeviceAuthorizationRecord['mode'],
    agentCredentials: (r.agentCredentials ?? undefined) as DeviceAuthorizationRecord['agentCredentials'],
  };
}

export const deviceAuthMethods = {
  async createDeviceAuth(this: PostgresKyselyStorage, req: DeviceAuthorizationRecord): Promise<void> {
    await this.db.insertInto('DeviceAuth').values({
      deviceCode: req.deviceCode, userCode: req.userCode, ownerName: req.ownerName, agentName: req.agentName,
      displayName: req.displayName ?? null, description: req.description ?? null, status: req.status, scopes: req.scopes ?? [],
      createdAt: new Date(req.createdAt), expiresAt: new Date(req.expiresAt), lastPolledAt: req.lastPolledAt ? new Date(req.lastPolledAt) : null,
      pollInterval: req.pollInterval, approvedBy: req.approvedBy ?? null, agentCredentials: jsonb(req.agentCredentials ?? null), mode: req.mode ?? 'interactive',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
  },
  async getDeviceAuthByDeviceCode(this: PostgresKyselyStorage, deviceCode: string): Promise<DeviceAuthorizationRecord | null> {
    const r = await this.db.selectFrom('DeviceAuth').selectAll().where('deviceCode', '=', deviceCode).executeTakeFirst();
    return r ? toRecord(r) : null;
  },
  async getDeviceAuthByUserCode(this: PostgresKyselyStorage, userCode: string): Promise<DeviceAuthorizationRecord | null> {
    const r = await this.db.selectFrom('DeviceAuth').selectAll().where('userCode', '=', userCode).executeTakeFirst();
    return r ? toRecord(r) : null;
  },
  async updateDeviceAuth(this: PostgresKyselyStorage, deviceCode: string, updates: Partial<DeviceAuthorizationRecord>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (updates.status !== undefined) data.status = updates.status;
    if (updates.scopes !== undefined) data.scopes = updates.scopes;
    if (updates.lastPolledAt !== undefined) data.lastPolledAt = updates.lastPolledAt ? new Date(updates.lastPolledAt) : null;
    if (updates.pollInterval !== undefined) data.pollInterval = updates.pollInterval;
    if (updates.approvedBy !== undefined) data.approvedBy = updates.approvedBy;
    if ('agentCredentials' in updates) data.agentCredentials = jsonb(updates.agentCredentials ?? null);
    if (Object.keys(data).length === 0) return;
    await this.db.updateTable('DeviceAuth').set(data as never).where('deviceCode', '=', deviceCode).execute();
  },
  async countPendingDeviceAuthByOwner(this: PostgresKyselyStorage, ownerName: string): Promise<number> {
    const r = await this.db.selectFrom('DeviceAuth').select(this.db.fn.countAll<number>().as('n'))
      .where('ownerName', '=', ownerName).where('status', '=', 'pending').where('expiresAt', '>', new Date()).executeTakeFirst();
    return Number(r?.n ?? 0);
  },
  async listPendingDeviceAuthByOwner(this: PostgresKyselyStorage, ownerName: string): Promise<DeviceAuthorizationRecord[]> {
    const rows = await this.db.selectFrom('DeviceAuth').selectAll().where('ownerName', '=', ownerName).where('status', '=', 'pending')
      .where('expiresAt', '>', new Date()).orderBy('createdAt', 'desc').execute();
    return rows.map(toRecord);
  },
  async cleanupExpiredDeviceAuth(this: PostgresKyselyStorage): Promise<number> {
    const r = await this.db.deleteFrom('DeviceAuth').where('status', '=', 'pending').where('expiresAt', '<=', new Date()).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async deleteDeviceAuthByOwner(this: PostgresKyselyStorage, ownerName: string): Promise<number> {
    const r = await this.db.deleteFrom('DeviceAuth').where('ownerName', '=', ownerName).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
