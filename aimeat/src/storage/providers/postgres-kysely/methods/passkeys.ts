/**
 * @file src/storage/providers/postgres-kysely/methods/passkeys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres (Kysely) methods for passkeys (repositories/passkey.repository.ts). Table
 *   "Passkey" (migration 0068). `transports` is a JSON array in a text column rather than jsonb:
 *   it is a fixed list of five hint strings that nothing ever queries INTO, and text keeps the two
 *   backends reading the same bytes.
 * @structure passkeyMethods — createPasskey · getPasskey · listPasskeysByOwner · touchPasskey ·
 *   renamePasskey · deletePasskey
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import type { Kysely } from 'kysely';
import type { DB } from '../db-types.js';
import type { PasskeyRecord } from '../../../types/passkeys.js';

/**
 * Only `db` is used here, so the `this` type names that field rather than the whole storage class.
 * Importing PostgresKyselyStorage from ../index.js would be a cycle — index.ts binds this module
 * onto the prototype — and dependency-cruiser is right to call one: a leaf that names what it
 * actually needs has no reason to reach back up.
 */
type Db = { db: Kysely<DB> };

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

/** The counter is BIGINT, so pg hands it back as a string on some drivers. */
function toRecord(r: Record<string, unknown>): PasskeyRecord {
  return {
    id: r.id as string,
    ghii: r.ghii as string,
    owner: r.owner as string,
    publicKey: r.publicKey as string,
    counter: Number(r.counter ?? 0),
    transports: parseTransports(r.transports),
    label: (r.label as string) ?? '',
    aaguid: (r.aaguid as string) ?? '',
    backedUp: r.backedUp === true,
    createdAt: r.createdAt as string,
    lastUsedAt: (r.lastUsedAt as string) ?? null,
  };
}

export const passkeyMethods = {
  async createPasskey(this: Db, record: PasskeyRecord): Promise<void> {
    await this.db.insertInto('Passkey').values({
      id: record.id, ghii: record.ghii, owner: record.owner, publicKey: record.publicKey,
      counter: record.counter, transports: JSON.stringify(record.transports ?? []),
      label: record.label, aaguid: record.aaguid, backedUp: record.backedUp,
      createdAt: record.createdAt, lastUsedAt: record.lastUsedAt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
  },

  async getPasskey(this: Db, id: string): Promise<PasskeyRecord | null> {
    const r = await this.db.selectFrom('Passkey').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toRecord(r as unknown as Record<string, unknown>) : null;
  },

  async listPasskeysByOwner(this: Db, owner: string): Promise<PasskeyRecord[]> {
    const rows = await this.db.selectFrom('Passkey').selectAll()
      .where('owner', '=', owner).orderBy('createdAt', 'desc').execute();
    return rows.map(r => toRecord(r as unknown as Record<string, unknown>));
  },

  async touchPasskey(this: Db, id: string, counter: number, usedAt: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.updateTable('Passkey').set({ counter, lastUsedAt: usedAt } as any).where('id', '=', id).execute();
  },

  async renamePasskey(this: Db, id: string, owner: string, label: string): Promise<boolean> {
    const r = await this.db.updateTable('Passkey')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ label } as any).where('id', '=', id).where('owner', '=', owner).executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async deletePasskey(this: Db, id: string, owner: string): Promise<boolean> {
    const r = await this.db.deleteFrom('Passkey')
      .where('id', '=', id).where('owner', '=', owner).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },
};
