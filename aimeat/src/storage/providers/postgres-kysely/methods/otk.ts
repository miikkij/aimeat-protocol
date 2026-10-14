/**
 * @file src/storage/providers/postgres-kysely/methods/otk.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One-Time-Key domain for the Postgres+Kysely backend (Otk table): create and read. No
 *   route mints or redeems a key any more; stored rows are deleted with their account (owner cascade).
 * @version-history
 *   v1.1.0 — 2026-10-14 — consumeOtk removed with POST /v1/agents/connect, its only caller
 *     (feature-list audit row 202).
 *   v1.0.0 — 2026-07-15 — Phase 5: OTK on Postgres+Kysely.
 */
import type { Selectable } from 'kysely';
import type { OtkRecord } from '../../../interface.js';
import type { Otk } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();

function toOtk(r: Selectable<Otk>): OtkRecord {
  return {
    key: r.key, ownerGaii: r.ownerGaii, action: r.action, params: (r.params ?? {}) as Record<string, unknown>,
    expiresAt: iso(r.expiresAt), initial: r.initial ?? false, used: r.used,
    usedAt: r.usedAt ? iso(r.usedAt) : null, sessionId: r.sessionId ?? null, createdAt: iso(r.createdAt),
  };
}

export const otkMethods = {
  async createOtk(this: PostgresKyselyStorage, otk: OtkRecord): Promise<OtkRecord> {
    await this.db.insertInto('Otk').values({
      key: otk.key, ownerGaii: otk.ownerGaii, action: otk.action, params: jsonb(otk.params), expiresAt: new Date(otk.expiresAt),
      used: otk.used, initial: otk.initial ?? false, usedAt: otk.usedAt ? new Date(otk.usedAt) : null,
      sessionId: otk.sessionId ?? null, createdAt: new Date(otk.createdAt),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return otk;
  },
  async getOtk(this: PostgresKyselyStorage, key: string): Promise<OtkRecord | null> {
    const r = await this.db.selectFrom('Otk').selectAll().where('key', '=', key).executeTakeFirst();
    return r ? toOtk(r) : null;
  },
};
