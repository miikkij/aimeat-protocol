/**
 * @file src/storage/providers/postgres-kysely/methods/secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres (Kysely) methods for the owner's secrets vault
 *   (repositories/secret.repository.ts). Table "Secret" (migration 0071). `usedBy` is a JSON object
 *   in a text column rather than jsonb: nothing queries INTO it, it is read whole and written
 *   whole, and text keeps the two backends storing the same bytes.
 *
 *   `setSecret` KEEPS THE EXISTING setAt. Replacing a secret is a rotation, not a new secret, and
 *   "since when do I hold this" is a different question from "when did the value last change". The
 *   same reason `usedBy` is carried forward: rotating a key does not forget who was using it.
 * @structure secretMethods — listSecrets · getSecret · setSecret · deleteSecret · noteSecretUse ·
 *   deleteSecretsByOwner
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import type { SecretRecord, SecretUseStamps } from '../../../types/secrets.js';

/**
 * Only `db` is used here, so the `this` type names that field rather than the whole storage class.
 * Importing PostgresKyselyStorage from ../index.js would be a cycle — index.ts binds this module
 * onto the prototype — and dependency-cruiser is right to call one.
 */
type Db = { db: Kysely<DB> };

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

function toRecord(r: Record<string, unknown>): SecretRecord {
  return {
    ownerGaii: r.ownerGaii as string,
    name: r.name as string,
    ciphertext: r.ciphertext as string,
    setAt: r.setAt as string,
    updatedAt: r.updatedAt as string,
    usedBy: parseUsedBy(r.usedBy),
  };
}

export const secretMethods = {
  async listSecrets(this: Db, ownerGaii: string): Promise<SecretRecord[]> {
    const rows = await this.db.selectFrom('Secret').selectAll()
      .where('ownerGaii', '=', ownerGaii).orderBy('name', 'asc').execute();
    return rows.map(r => toRecord(r as unknown as Record<string, unknown>));
  },

  async getSecret(this: Db, ownerGaii: string, name: string): Promise<SecretRecord | null> {
    const r = await this.db.selectFrom('Secret').selectAll()
      .where('ownerGaii', '=', ownerGaii).where('name', '=', name).executeTakeFirst();
    return r ? toRecord(r as unknown as Record<string, unknown>) : null;
  },

  async setSecret(this: Db, record: SecretRecord): Promise<SecretRecord> {
    const existing = await this.db.selectFrom('Secret').selectAll()
      .where('ownerGaii', '=', record.ownerGaii).where('name', '=', record.name).executeTakeFirst();
    const prior = existing ? toRecord(existing as unknown as Record<string, unknown>) : null;
    // A rotation keeps when the name was first set and who has been using it. Only the value and
    // updatedAt move.
    const stored: SecretRecord = {
      ...record,
      setAt: prior?.setAt ?? record.setAt,
      usedBy: prior?.usedBy ?? record.usedBy ?? {},
    };
    if (prior) {
      await this.db.updateTable('Secret')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ ciphertext: stored.ciphertext, updatedAt: stored.updatedAt } as any)
        .where('ownerGaii', '=', stored.ownerGaii).where('name', '=', stored.name).execute();
    } else {
      await this.db.insertInto('Secret').values({
        ownerGaii: stored.ownerGaii, name: stored.name, ciphertext: stored.ciphertext,
        setAt: stored.setAt, updatedAt: stored.updatedAt, usedBy: JSON.stringify(stored.usedBy ?? {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any).execute();
    }
    return stored;
  },

  async deleteSecret(this: Db, ownerGaii: string, name: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Secret')
      .where('ownerGaii', '=', ownerGaii).where('name', '=', name).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async noteSecretUse(this: Db, ownerGaii: string, name: string, extName: string, at: string): Promise<void> {
    const existing = await this.db.selectFrom('Secret').select(['usedBy'])
      .where('ownerGaii', '=', ownerGaii).where('name', '=', name).executeTakeFirst();
    // The owner may have deleted the secret between the resolution and this stamp. Nothing to
    // record, and nothing to complain about.
    if (!existing) return;
    const usedBy = { ...parseUsedBy((existing as unknown as Record<string, unknown>).usedBy), [extName]: at };
    await this.db.updateTable('Secret')
      // `updatedAt` is untouched on purpose: it means "the value changed", and a use is not that.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ usedBy: JSON.stringify(usedBy) } as any)
      .where('ownerGaii', '=', ownerGaii).where('name', '=', name).execute();
  },

  async deleteSecretsByOwner(this: Db, ownerGaii: string): Promise<number> {
    const r = await this.db.deleteFrom('Secret').where('ownerGaii', '=', ownerGaii).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
