/**
 * @file src/storage/providers/sqlite/methods/secret-shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SecretShareRepository on SQLite (tables secret_shares, secret_share_events,
 *   secret_share_members, vault_device_keys; schema-secret-shares.ts). Mirrors the PostgreSQL methods
 *   of the same file name. A pickup count, a deposit, a close and the expiry sweep are each ONE
 *   conditional UPDATE, so the condition and the change cannot be separated by another writer.
 *   Times are ISO strings from the caller's clock and compare as TEXT. "check" is a reserved word in
 *   SQL and is quoted wherever a statement names it.
 * @structure secretShareMethods · toShare · toEvent · listLimit · parse helpers
 * @usage Object.assign(SqliteStorage.prototype, secretShareMethods) in ../index.ts
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial
 *   2026-11-14 — record properties secretFormat, protectionLevel, fileType (field-reach vocabulary); columns unchanged.
 *   2026-11-14 — share lists take opts.limit (500, at most 1000); purgeClosedSecretShares.
 */
import type Database from 'better-sqlite3';
import { logger } from '../../../../utils/logger.js';
import type {
  SecretShareRecord, SecretShareEvent, SecretShareMember, VaultDeviceKey, SecretShareRecipients,
  SecretShareCheck, SecretShareFormat, SecretShareListOptions,
} from '../../../types/secret-shares.js';

/**
 * Only `db` is used here, so the `this` type names that field rather than the whole storage class.
 * Importing SqliteStorage from ../index.js would be an import cycle, because index.ts binds this
 * module onto the prototype.
 */
type Db = { db: Database.Database };
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
    codeLogin: Number(r.codeLogin) === 1,
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

/** The row count a share list answers: opts.limit, 500 by default, between 1 and 1000. */
function listLimit(opts?: SecretShareListOptions): number {
  const n = Number(opts?.limit ?? 500);
  return Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.floor(n))) : 500;
}

export const secretShareMethods = {
  async createSecretShare(this: Db, record: SecretShareRecord, members: SecretShareMember[]): Promise<void> {
    const insertShare = this.db.prepare(
      `INSERT INTO secret_shares (id, ownerGhii, createdBy, organismId, kind, name, note, format, fileName,
         contentType, ciphertext, sizeBytes, protection, recipients, codeHash, codeLogin, codeSalt, retention,
         maxPickups, expiresAt, pickups, status, depositTokenHash, requestExpiresAt, depositedAt, depositedBy,
         "check", e2eKeys, createdAt, updatedAt, revokedAt, revokedBy)
       VALUES (@id, @ownerGhii, @createdBy, @organismId, @kind, @name, @note, @secretFormat, @fileName,
         @fileType, @ciphertext, @sizeBytes, @protectionLevel, @recipients, @codeHash, @codeLogin, @codeSalt, @retention,
         @maxPickups, @expiresAt, @pickups, @status, @depositTokenHash, @requestExpiresAt, @depositedAt, @depositedBy,
         @check, @e2eKeys, @createdAt, @updatedAt, @revokedAt, @revokedBy)`,
    );
    const insertMember = this.db.prepare(
      'INSERT OR IGNORE INTO secret_share_members (shareId, ghii, role) VALUES (?, ?, ?)',
    );
    this.db.transaction(() => {
      insertShare.run({
        ...record,
        note: record.note ?? '',
        recipients: JSON.stringify(record.recipients),
        codeLogin: record.codeLogin ? 1 : 0,
        check: jsonOrNull(record.check),
        e2eKeys: jsonOrNull(record.e2eKeys),
      });
      for (const m of members) insertMember.run(m.shareId, m.ghii, m.role);
    })();
  },

  async getSecretShare(this: Db, id: string): Promise<SecretShareRecord | null> {
    const row = this.db.prepare('SELECT * FROM secret_shares WHERE id = ?').get(id) as Row | undefined;
    return row ? toShare(row) : null;
  },

  async listSecretSharesByOwner(this: Db, ownerGhii: string, opts?: SecretShareListOptions): Promise<SecretShareRecord[]> {
    const rows = this.db.prepare('SELECT * FROM secret_shares WHERE ownerGhii = ? ORDER BY createdAt DESC, id DESC LIMIT ?')
      .all(ownerGhii, listLimit(opts)) as Row[];
    return rows.map(toShare);
  },

  async listSecretSharesByOrganisms(this: Db, organismIds: string[], opts?: SecretShareListOptions): Promise<SecretShareRecord[]> {
    if (organismIds.length === 0) return [];
    const marks = organismIds.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT * FROM secret_shares WHERE organismId IN (${marks}) ORDER BY createdAt DESC, id DESC LIMIT ?`,
    ).all(...organismIds, listLimit(opts)) as Row[];
    return rows.map(toShare);
  },

  async listSecretSharesForMember(this: Db, ghii: string, role: SecretShareMember['role'], opts?: SecretShareListOptions): Promise<SecretShareRecord[]> {
    const rows = this.db.prepare(
      `SELECT s.* FROM secret_shares s
       JOIN secret_share_members m ON m.shareId = s.id
       WHERE m.ghii = ? AND m.role = ?
       ORDER BY s.createdAt DESC, s.id DESC
       LIMIT ?`,
    ).all(ghii, role, listLimit(opts)) as Row[];
    return rows.map(toShare);
  },

  async listSecretShareMembers(this: Db, shareId: string): Promise<SecretShareMember[]> {
    const rows = this.db.prepare('SELECT shareId, ghii, role FROM secret_share_members WHERE shareId = ? ORDER BY role, ghii')
      .all(shareId) as Row[];
    return rows.map(r => ({ shareId: r.shareId as string, ghii: r.ghii as string, role: r.role as SecretShareMember['role'] }));
  },

  async depositSecretShare(this: Db, id: string, fill: {
    ciphertext: string; sizeBytes: number; secretFormat: SecretShareFormat; fileName: string | null;
    fileType: string | null; check: SecretShareCheck | null; e2eKeys: SecretShareRecord['e2eKeys'];
    codeSalt: string | null; depositedAt: string; depositedBy: string;
  }): Promise<boolean> {
    const r = this.db.prepare(
      `UPDATE secret_shares SET ciphertext = ?, sizeBytes = ?, format = ?, fileName = ?, contentType = ?,
         "check" = ?, e2eKeys = ?, codeSalt = ?, depositedAt = ?, depositedBy = ?, status = 'ready', updatedAt = ?
       WHERE id = ? AND status = 'waiting'`,
    ).run(fill.ciphertext, fill.sizeBytes, fill.secretFormat, fill.fileName, fill.fileType,
      jsonOrNull(fill.check), jsonOrNull(fill.e2eKeys), fill.codeSalt, fill.depositedAt, fill.depositedBy,
      fill.depositedAt, id);
    return r.changes > 0;
  },

  async claimSecretSharePickup(this: Db, id: string, now: string): Promise<SecretShareRecord | null> {
    const row = this.db.prepare(
      `UPDATE secret_shares SET pickups = pickups + 1, updatedAt = ?
       WHERE id = ? AND status = 'ready'
         AND (maxPickups IS NULL OR pickups < maxPickups)
         AND (expiresAt IS NULL OR expiresAt > ?)
       RETURNING *`,
    ).get(now, id, now) as Row | undefined;
    return row ? toShare(row) : null;
  },

  async closeSecretShare(this: Db, id: string, status: 'ended' | 'revoked', at: string, by: string | null): Promise<boolean> {
    const revoked = status === 'revoked';
    const r = this.db.prepare(
      `UPDATE secret_shares SET status = ?, ciphertext = NULL, e2eKeys = NULL, updatedAt = ?,
         revokedAt = CASE WHEN ? = 1 THEN ? ELSE revokedAt END,
         revokedBy = CASE WHEN ? = 1 THEN ? ELSE revokedBy END
       WHERE id = ? AND status IN ('waiting', 'ready')`,
    ).run(status, at, revoked ? 1 : 0, at, revoked ? 1 : 0, by, id);
    return r.changes > 0;
  },

  async endExpiredSecretShares(this: Db, now: string): Promise<string[]> {
    const rows = this.db.prepare(
      `UPDATE secret_shares SET status = 'ended', ciphertext = NULL, e2eKeys = NULL, updatedAt = ?
       WHERE (status = 'ready' AND expiresAt IS NOT NULL AND expiresAt <= ?)
          OR (status = 'waiting' AND requestExpiresAt IS NOT NULL AND requestExpiresAt <= ?)
       RETURNING id`,
    ).all(now, now, now) as Array<{ id: string }>;
    return rows.map(r => r.id);
  },

  async addSecretShareEvent(this: Db, event: SecretShareEvent): Promise<void> {
    this.db.prepare(
      'INSERT INTO secret_share_events (id, shareId, at, kind, actor, onBehalfOf, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(event.id, event.shareId, event.at, event.kind, event.actor, event.onBehalfOf, JSON.stringify(event.detail ?? {}));
  },

  async listSecretShareEvents(this: Db, shareId: string, limit: number): Promise<SecretShareEvent[]> {
    const rows = this.db.prepare('SELECT * FROM secret_share_events WHERE shareId = ? ORDER BY at DESC, id DESC LIMIT ?')
      .all(shareId, Math.max(0, Math.floor(limit))) as Row[];
    return rows.map(toEvent);
  },

  async deleteSecretSharesByOwner(this: Db, ownerGhii: string): Promise<number> {
    return this.db.transaction(() => {
      const own = 'SELECT id FROM secret_shares WHERE ownerGhii = ?';
      this.db.prepare(`DELETE FROM secret_share_events WHERE shareId IN (${own})`).run(ownerGhii);
      this.db.prepare(`DELETE FROM secret_share_members WHERE shareId IN (${own}) OR ghii = ?`).run(ownerGhii, ownerGhii);
      return this.db.prepare('DELETE FROM secret_shares WHERE ownerGhii = ?').run(ownerGhii).changes;
    })();
  },

  async purgeClosedSecretShares(this: Db, before: string): Promise<number> {
    // ended and revoked are final states, and no statement changes updatedAt on them, so the three
    // deletes see the same set of shares.
    return this.db.transaction(() => {
      const closed = `SELECT id FROM secret_shares WHERE status IN ('ended', 'revoked') AND updatedAt < ?`;
      this.db.prepare(`DELETE FROM secret_share_events WHERE shareId IN (${closed})`).run(before);
      this.db.prepare(`DELETE FROM secret_share_members WHERE shareId IN (${closed})`).run(before);
      return this.db.prepare(`DELETE FROM secret_shares WHERE status IN ('ended', 'revoked') AND updatedAt < ?`)
        .run(before).changes;
    })();
  },

  async putVaultDeviceKey(this: Db, key: VaultDeviceKey): Promise<void> {
    this.db.prepare(
      `INSERT INTO vault_device_keys (ownerGhii, keyId, publicKey, label, createdAt, lastUsedAt) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(ownerGhii, keyId) DO UPDATE SET publicKey = excluded.publicKey, label = excluded.label,
         lastUsedAt = excluded.lastUsedAt`,
    ).run(key.ownerGhii, key.keyId, key.publicKey, key.label ?? '', key.createdAt, key.lastUsedAt);
  },

  async listVaultDeviceKeys(this: Db, ownerGhii: string): Promise<VaultDeviceKey[]> {
    const rows = this.db.prepare('SELECT * FROM vault_device_keys WHERE ownerGhii = ? ORDER BY createdAt DESC, keyId')
      .all(ownerGhii) as Row[];
    return rows.map(r => ({
      ownerGhii: r.ownerGhii as string,
      keyId: r.keyId as string,
      publicKey: r.publicKey as string,
      label: (r.label as string) ?? '',
      createdAt: r.createdAt as string,
      lastUsedAt: str(r.lastUsedAt),
    }));
  },

  async deleteVaultDeviceKey(this: Db, ownerGhii: string, keyId: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM vault_device_keys WHERE ownerGhii = ? AND keyId = ?').run(ownerGhii, keyId).changes > 0;
  },

  async deleteVaultDeviceKeysByOwner(this: Db, ownerGhii: string): Promise<number> {
    return this.db.prepare('DELETE FROM vault_device_keys WHERE ownerGhii = ?').run(ownerGhii).changes;
  },
};
