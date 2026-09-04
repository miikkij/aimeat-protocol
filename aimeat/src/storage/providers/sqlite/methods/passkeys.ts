/**
 * @file src/storage/providers/sqlite/methods/passkeys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for passkeys (repositories/passkey.repository.ts). `transports` is a
 *   JSON array in one column; everything else is a scalar.
 * @structure passkeyMethods — createPasskey · getPasskey · listPasskeysByOwner · touchPasskey ·
 *   renamePasskey · deletePasskey
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import type Database from 'better-sqlite3';
import type { PasskeyRecord } from '../../../types/passkeys.js';

/**
 * Only `db` is used here, so the `this` type names that field rather than the whole storage class.
 * Importing SqliteStorage from ../index.js would be a cycle — index.ts binds this module onto the
 * prototype — and dependency-cruiser is right to call one.
 */
type Db = { db: Database.Database };

/**
 * The transports hint, or none. A malformed column costs the browser a better prompt and nothing
 * else: the credential still works, this is read on every sign-in, and no caller could act on the
 * failure if it were surfaced.
 */
function parseTransports(raw: unknown): string[] {
  try {
    return JSON.parse((raw as string) || '[]') as string[];
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the hint is optional by design; see above.
    return [];
  }
}

function toRecord(row: Record<string, unknown>): PasskeyRecord {
  return {
    id: row.id as string,
    ghii: row.ghii as string,
    owner: row.owner as string,
    publicKey: row.publicKey as string,
    counter: Number(row.counter ?? 0),
    transports: parseTransports(row.transports),
    label: (row.label as string) ?? '',
    aaguid: (row.aaguid as string) ?? '',
    backedUp: Number(row.backedUp ?? 0) === 1,
    createdAt: row.createdAt as string,
    lastUsedAt: (row.lastUsedAt as string) ?? null,
  };
}

export const passkeyMethods = {
  async createPasskey(this: Db, record: PasskeyRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO passkeys (id, ghii, owner, publicKey, counter, transports, label, aaguid, backedUp, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id, record.ghii, record.owner, record.publicKey, record.counter,
      JSON.stringify(record.transports ?? []), record.label, record.aaguid,
      record.backedUp ? 1 : 0, record.createdAt, record.lastUsedAt,
    );
  },

  async getPasskey(this: Db, id: string): Promise<PasskeyRecord | null> {
    const row = this.db.prepare('SELECT * FROM passkeys WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : null;
  },

  async listPasskeysByOwner(this: Db, owner: string): Promise<PasskeyRecord[]> {
    const rows = this.db.prepare('SELECT * FROM passkeys WHERE owner = ? ORDER BY createdAt DESC')
      .all(owner) as Record<string, unknown>[];
    return rows.map(toRecord);
  },

  async touchPasskey(this: Db, id: string, counter: number, usedAt: string): Promise<void> {
    this.db.prepare('UPDATE passkeys SET counter = ?, lastUsedAt = ? WHERE id = ?').run(counter, usedAt, id);
  },

  async renamePasskey(this: Db, id: string, owner: string, label: string): Promise<boolean> {
    const r = this.db.prepare('UPDATE passkeys SET label = ? WHERE id = ? AND owner = ?').run(label, id, owner);
    return Number(r.changes ?? 0) > 0;
  },

  async deletePasskey(this: Db, id: string, owner: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM passkeys WHERE id = ? AND owner = ?').run(id, owner);
    return Number(r.changes ?? 0) > 0;
  },
};
