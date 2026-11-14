/**
 * @file src/storage/providers/postgres-kysely/methods/secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SecretShareRepository on PostgreSQL (tables "SecretShare", "SecretShareEvent",
 *   "SecretShareMember", "VaultDeviceKey"; migration 0130). Mirrors the SQLite methods of the same
 *   file name. A pickup count, a deposit, a close and the expiry sweep are each ONE conditional
 *   UPDATE, so under READ COMMITTED a second writer re-reads the row the first one changed and its
 *   condition is tested against that: two pickers racing for the last pickup get one row between
 *   them. JSON fields are TEXT, read and written whole, so both backends store the same bytes. Times
 *   are ISO strings from the caller's clock and compare as TEXT.
 * @structure secretShareMethods · toShare · toEvent · parse helpers
 * @usage Object.assign(PostgresKyselyStorage.prototype, secretShareMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 *   2026-11-14 — record properties secretFormat, protectionLevel, fileType (field-reach vocabulary); columns unchanged.
 */
import { sql, type Kysely } from 'kysely';
import { logger } from '../../../../utils/logger.js';
import type { DB } from '../db-types.js';
import type {
  SecretShareRecord, SecretShareEvent, SecretShareMember, VaultDeviceKey, SecretShareRecipients,
  SecretShareCheck, SecretShareFormat,
} from '../../../types/secret-shares.js';

/**
 * Only `db` and `transaction` are used here, so the `this` type names those rather than the whole
 * storage class. Importing PostgresKyselyStorage from ../index.js would be an import cycle, because
 * index.ts binds this module onto the prototype.
 */
type Db = { db: Kysely<DB>; transaction<T>(fn: () => Promise<T>): Promise<T> };
type Row = Record<string, unknown>;

/** Parse a JSON text column; a missing or malformed value answers undefined. */
function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    // A malformed column reads as its empty default (repository contract), and the fault is logged.
    logger.warn('secret shares: a JSON column did not parse', { error: String(err) });
    return undefined;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The recipients, or nobody when the column is missing or malformed. */
function parseRecipients(raw: unknown): SecretShareRecipients {
  const v = parseJson(raw);
  const o = isObject(v) ? v : {};
  return {
    people: Array.isArray(o.people) ? o.people.filter((p): p is string => typeof p === 'string') : [],
    agents: o.agents === true,
    organism: o.organism === true,
    code: o.code === true,
  };
}

function parseCheck(raw: unknown): SecretShareCheck | null {
  const v = parseJson(raw);
  return isObject(v) ? v as unknown as SecretShareCheck : null;
}

function parseE2eKeys(raw: unknown): SecretShareRecord['e2eKeys'] {
  const v = parseJson(raw);
  if (!Array.isArray(v)) return null;
  return v.filter((k): k is { ghii: string; keyId: string; wrapped: string } =>
    isObject(k) && typeof k.ghii === 'string' && typeof k.keyId === 'string' && typeof k.wrapped === 'string');
}

function parseDetail(raw: unknown): Record<string, string> {
  const v = parseJson(raw);
  if (!isObject(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  return out;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toShare(r: Row): SecretShareRecord {
  return {
    id: r.id as string,
    ownerGhii: r.ownerGhii as string,
    createdBy: r.createdBy as string,
    organismId: str(r.organismId),
    kind: r.kind as SecretShareRecord['kind'],
    name: r.name as string,
    note: (r.note as string) ?? '',
    secretFormat: r.format as SecretShareFormat,
    fileName: str(r.fileName),
    fileType: str(r.contentType),
    ciphertext: str(r.ciphertext),
    sizeBytes: Number(r.sizeBytes ?? 0),
    protectionLevel: r.protection as SecretShareRecord['protectionLevel'],
    recipients: parseRecipients(r.recipients),
    codeHash: str(r.codeHash),
    codeLogin: r.codeLogin === true,
    codeSalt: str(r.codeSalt),
    retention: r.retention as SecretShareRecord['retention'],
    maxPickups: num(r.maxPickups),
    expiresAt: str(r.expiresAt),
    pickups: Number(r.pickups ?? 0),
    status: r.status as SecretShareRecord['status'],
    depositTokenHash: str(r.depositTokenHash),
    requestExpiresAt: str(r.requestExpiresAt),
    depositedAt: str(r.depositedAt),
    depositedBy: str(r.depositedBy),
    check: parseCheck(r.check),
    e2eKeys: parseE2eKeys(r.e2eKeys),
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    revokedAt: str(r.revokedAt),
    revokedBy: str(r.revokedBy),
  };
}

function toEvent(r: Row): SecretShareEvent {
  return {
    id: r.id as string,
    shareId: r.shareId as string,
    at: r.at as string,
    kind: r.kind as SecretShareEvent['kind'],
    actor: r.actor as string,
    onBehalfOf: r.onBehalfOf as string,
    detail: parseDetail(r.detail),
  };
}

const jsonOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : JSON.stringify(v));

export const secretShareMethods = {
  async createSecretShare(this: Db, record: SecretShareRecord, members: SecretShareMember[]): Promise<void> {
    await this.transaction(async () => {
      await this.db.insertInto('SecretShare').values({
        id: record.id, ownerGhii: record.ownerGhii, createdBy: record.createdBy, organismId: record.organismId,
        kind: record.kind, name: record.name, note: record.note ?? '', format: record.secretFormat,
        fileName: record.fileName, contentType: record.fileType, ciphertext: record.ciphertext,
        sizeBytes: record.sizeBytes, protection: record.protectionLevel, recipients: JSON.stringify(record.recipients),
        codeHash: record.codeHash, codeLogin: record.codeLogin, codeSalt: record.codeSalt,
        retention: record.retention, maxPickups: record.maxPickups, expiresAt: record.expiresAt,
        pickups: record.pickups, status: record.status, depositTokenHash: record.depositTokenHash,
        requestExpiresAt: record.requestExpiresAt, depositedAt: record.depositedAt, depositedBy: record.depositedBy,
        check: jsonOrNull(record.check), e2eKeys: jsonOrNull(record.e2eKeys),
        createdAt: record.createdAt, updatedAt: record.updatedAt, revokedAt: record.revokedAt, revokedBy: record.revokedBy,
      }).execute();
      if (members.length) {
        await this.db.insertInto('SecretShareMember')
          .values(members.map(m => ({ shareId: m.shareId, ghii: m.ghii, role: m.role })))
          .onConflict(oc => oc.columns(['shareId', 'ghii', 'role']).doNothing())
          .execute();
      }
    });
  },

  async getSecretShare(this: Db, id: string): Promise<SecretShareRecord | null> {
    const row = await this.db.selectFrom('SecretShare').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toShare(row as unknown as Row) : null;
  },

  async listSecretSharesByOwner(this: Db, ownerGhii: string): Promise<SecretShareRecord[]> {
    const rows = await this.db.selectFrom('SecretShare').selectAll().where('ownerGhii', '=', ownerGhii)
      .orderBy('createdAt', 'desc').orderBy('id', 'desc').execute();
    return rows.map(r => toShare(r as unknown as Row));
  },

  async listSecretSharesByOrganisms(this: Db, organismIds: string[]): Promise<SecretShareRecord[]> {
    if (organismIds.length === 0) return [];
    const rows = await this.db.selectFrom('SecretShare').selectAll().where('organismId', 'in', organismIds)
      .orderBy('createdAt', 'desc').orderBy('id', 'desc').execute();
    return rows.map(r => toShare(r as unknown as Row));
  },

  async listSecretSharesForMember(this: Db, ghii: string, role: SecretShareMember['role']): Promise<SecretShareRecord[]> {
    const rows = await this.db.selectFrom('SecretShare as s')
      .innerJoin('SecretShareMember as m', 'm.shareId', 's.id')
      .selectAll('s')
      .where('m.ghii', '=', ghii).where('m.role', '=', role)
      .orderBy('s.createdAt', 'desc').orderBy('s.id', 'desc')
      .execute();
    return rows.map(r => toShare(r as unknown as Row));
  },

  async listSecretShareMembers(this: Db, shareId: string): Promise<SecretShareMember[]> {
    const rows = await this.db.selectFrom('SecretShareMember').select(['shareId', 'ghii', 'role'])
      .where('shareId', '=', shareId).orderBy('role').orderBy('ghii').execute();
    return rows.map(r => ({ shareId: r.shareId, ghii: r.ghii, role: r.role as SecretShareMember['role'] }));
  },

  async depositSecretShare(this: Db, id: string, fill: {
    ciphertext: string; sizeBytes: number; secretFormat: SecretShareFormat; fileName: string | null;
    fileType: string | null; check: SecretShareCheck | null; e2eKeys: SecretShareRecord['e2eKeys'];
    codeSalt: string | null; depositedAt: string; depositedBy: string;
  }): Promise<boolean> {
    const r = await this.db.updateTable('SecretShare').set({
      ciphertext: fill.ciphertext, sizeBytes: fill.sizeBytes, format: fill.secretFormat, fileName: fill.fileName,
      contentType: fill.fileType, check: jsonOrNull(fill.check), e2eKeys: jsonOrNull(fill.e2eKeys),
      codeSalt: fill.codeSalt, depositedAt: fill.depositedAt, depositedBy: fill.depositedBy,
      status: 'ready', updatedAt: fill.depositedAt,
    }).where('id', '=', id).where('status', '=', 'waiting').executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async claimSecretSharePickup(this: Db, id: string, now: string): Promise<SecretShareRecord | null> {
    const row = await this.db.updateTable('SecretShare')
      .set({ pickups: sql`"pickups" + 1`, updatedAt: now })
      .where('id', '=', id)
      .where('status', '=', 'ready')
      .where(eb => eb.or([eb('maxPickups', 'is', null), eb('pickups', '<', eb.ref('maxPickups'))]))
      .where(eb => eb.or([eb('expiresAt', 'is', null), eb('expiresAt', '>', now)]))
      .returningAll()
      .executeTakeFirst();
    return row ? toShare(row as unknown as Row) : null;
  },

  async closeSecretShare(this: Db, id: string, status: 'ended' | 'revoked', at: string, by: string | null): Promise<boolean> {
    const r = await this.db.updateTable('SecretShare')
      .set({
        status, ciphertext: null, e2eKeys: null, updatedAt: at,
        ...(status === 'revoked' ? { revokedAt: at, revokedBy: by } : {}),
      })
      .where('id', '=', id).where('status', 'in', ['waiting', 'ready'])
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async endExpiredSecretShares(this: Db, now: string): Promise<string[]> {
    const rows = await this.db.updateTable('SecretShare')
      .set({ status: 'ended', ciphertext: null, e2eKeys: null, updatedAt: now })
      .where(eb => eb.or([
        eb.and([eb('status', '=', 'ready'), eb('expiresAt', 'is not', null), eb('expiresAt', '<=', now)]),
        eb.and([eb('status', '=', 'waiting'), eb('requestExpiresAt', 'is not', null), eb('requestExpiresAt', '<=', now)]),
      ]))
      .returning('id')
      .execute();
    return rows.map(r => r.id);
  },

  async addSecretShareEvent(this: Db, event: SecretShareEvent): Promise<void> {
    await this.db.insertInto('SecretShareEvent').values({
      id: event.id, shareId: event.shareId, at: event.at, kind: event.kind, actor: event.actor,
      onBehalfOf: event.onBehalfOf, detail: JSON.stringify(event.detail ?? {}),
    }).execute();
  },

  async listSecretShareEvents(this: Db, shareId: string, limit: number): Promise<SecretShareEvent[]> {
    const rows = await this.db.selectFrom('SecretShareEvent').selectAll().where('shareId', '=', shareId)
      .orderBy('at', 'desc').orderBy('id', 'desc').limit(Math.max(0, Math.floor(limit))).execute();
    return rows.map(r => toEvent(r as unknown as Row));
  },

  async deleteSecretSharesByOwner(this: Db, ownerGhii: string): Promise<number> {
    return this.transaction(async () => {
      const db = this.db;
      const own = db.selectFrom('SecretShare').select('id').where('ownerGhii', '=', ownerGhii);
      await db.deleteFrom('SecretShareEvent').where('shareId', 'in', own).execute();
      await db.deleteFrom('SecretShareMember')
        .where(eb => eb.or([eb('shareId', 'in', own), eb('ghii', '=', ownerGhii)]))
        .execute();
      const r = await db.deleteFrom('SecretShare').where('ownerGhii', '=', ownerGhii).executeTakeFirst();
      return Number(r.numDeletedRows ?? 0);
    });
  },

  async putVaultDeviceKey(this: Db, key: VaultDeviceKey): Promise<void> {
    await this.db.insertInto('VaultDeviceKey').values({
      ownerGhii: key.ownerGhii, keyId: key.keyId, publicKey: key.publicKey, label: key.label ?? '',
      createdAt: key.createdAt, lastUsedAt: key.lastUsedAt,
    }).onConflict(oc => oc.columns(['ownerGhii', 'keyId']).doUpdateSet({
      publicKey: () => sql`excluded."publicKey"`,
      label: () => sql`excluded."label"`,
      lastUsedAt: () => sql`excluded."lastUsedAt"`,
    })).execute();
  },

  async listVaultDeviceKeys(this: Db, ownerGhii: string): Promise<VaultDeviceKey[]> {
    const rows = await this.db.selectFrom('VaultDeviceKey').selectAll().where('ownerGhii', '=', ownerGhii)
      .orderBy('createdAt', 'desc').orderBy('keyId').execute();
    return rows.map(r => ({
      ownerGhii: r.ownerGhii, keyId: r.keyId, publicKey: r.publicKey, label: r.label ?? '',
      createdAt: r.createdAt, lastUsedAt: r.lastUsedAt ?? null,
    }));
  },

  async deleteVaultDeviceKey(this: Db, ownerGhii: string, keyId: string): Promise<boolean> {
    const r = await this.db.deleteFrom('VaultDeviceKey').where('ownerGhii', '=', ownerGhii).where('keyId', '=', keyId)
      .executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async deleteVaultDeviceKeysByOwner(this: Db, ownerGhii: string): Promise<number> {
    const r = await this.db.deleteFrom('VaultDeviceKey').where('ownerGhii', '=', ownerGhii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
