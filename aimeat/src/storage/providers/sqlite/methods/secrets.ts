/**
 * @file src/storage/providers/sqlite/methods/secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite methods for the owner's secrets vault (repositories/secret.repository.ts).
 *   `usedBy` is a JSON object in one column; everything else is a scalar. Mirrors the Postgres
 *   methods table for table, including the rule that replacing a secret keeps its `setAt` and its
 *   `usedBy`: a rotation is not a new secret and does not forget who was using the old one.
 * @structure secretMethods — listSecrets · getSecret · setSecret · deleteSecret · noteSecretUse ·
 *   deleteSecretsByOwner
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial.
 */
import type Database from 'better-sqlite3';
import type { SecretRecord, SecretUseStamps } from '../../../types/secrets.js';

/**
 * Only `db` is used here, so the `this` type names that field rather than the whole storage class.
 * Importing SqliteStorage from ../index.js would be a cycle — index.ts binds this module onto the
 * prototype — and dependency-cruiser is right to call one.
 */
type Db = { db: Database.Database };

/**
 * The use stamps, or none. A malformed column costs the owner the "used by" line on the list and
 * nothing else — the secret still resolves, and refusing the whole row over a decoration would be
 * the wrong trade.
 */
function parseUsedBy(raw: unknown): SecretUseStamps {
  try {
    const parsed = JSON.parse((raw as string) || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SecretUseStamps : {};
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the use record is informational; see above.
    return {};
  }
}

function toRecord(row: Record<string, unknown>): SecretRecord {
  return {
    ownerGaii: row.ownerGaii as string,
    name: row.name as string,
    ciphertext: row.ciphertext as string,
    setAt: row.setAt as string,
    updatedAt: row.updatedAt as string,
    usedBy: parseUsedBy(row.usedBy),
  };
}

export const secretMethods = {
  async listSecrets(this: Db, ownerGaii: string): Promise<SecretRecord[]> {
    const rows = this.db.prepare('SELECT * FROM secrets WHERE ownerGaii = ? ORDER BY name ASC')
      .all(ownerGaii) as Record<string, unknown>[];
    return rows.map(toRecord);
  },

  async getSecret(this: Db, ownerGaii: string, name: string): Promise<SecretRecord | null> {
    const row = this.db.prepare('SELECT * FROM secrets WHERE ownerGaii = ? AND name = ?')
      .get(ownerGaii, name) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : null;
  },

  async setSecret(this: Db, record: SecretRecord): Promise<SecretRecord> {
    const row = this.db.prepare('SELECT * FROM secrets WHERE ownerGaii = ? AND name = ?')
      .get(record.ownerGaii, record.name) as Record<string, unknown> | undefined;
    const prior = row ? toRecord(row) : null;
    const stored: SecretRecord = {
      ...record,
      setAt: prior?.setAt ?? record.setAt,
      usedBy: prior?.usedBy ?? record.usedBy ?? {},
    };
    if (prior) {
      this.db.prepare('UPDATE secrets SET ciphertext = ?, updatedAt = ? WHERE ownerGaii = ? AND name = ?')
        .run(stored.ciphertext, stored.updatedAt, stored.ownerGaii, stored.name);
    } else {
      this.db.prepare(
        'INSERT INTO secrets (ownerGaii, name, ciphertext, setAt, updatedAt, usedBy) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(stored.ownerGaii, stored.name, stored.ciphertext, stored.setAt, stored.updatedAt,
        JSON.stringify(stored.usedBy ?? {}));
    }
    return stored;
  },

  async deleteSecret(this: Db, ownerGaii: string, name: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM secrets WHERE ownerGaii = ? AND name = ?').run(ownerGaii, name);
    return Number(r.changes ?? 0) > 0;
  },

  async noteSecretUse(this: Db, ownerGaii: string, name: string, extName: string, at: string): Promise<void> {
    const row = this.db.prepare('SELECT usedBy FROM secrets WHERE ownerGaii = ? AND name = ?')
      .get(ownerGaii, name) as Record<string, unknown> | undefined;
    // The owner may have deleted the secret between the resolution and this stamp. Nothing to
    // record, and nothing to complain about.
    if (!row) return;
    const usedBy = { ...parseUsedBy(row.usedBy), [extName]: at };
    // `updatedAt` is untouched on purpose: it means "the value changed", and a use is not that.
    this.db.prepare('UPDATE secrets SET usedBy = ? WHERE ownerGaii = ? AND name = ?')
      .run(JSON.stringify(usedBy), ownerGaii, name);
  },

  async deleteSecretsByOwner(this: Db, ownerGaii: string): Promise<number> {
    const r = this.db.prepare('DELETE FROM secrets WHERE ownerGaii = ?').run(ownerGaii);
    return Number(r.changes ?? 0);
  },
};
