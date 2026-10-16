/**
 * @file src/storage/providers/postgres-kysely/methods/system-extras.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description System prompts (SystemPrompt + SystemPromptVersion) and the federation replication queue
 *   (ReplicationQueue) for the Postgres+Kysely backend. Translated to match the Prisma provider.
 * @version-history
 *   2026-10-16 — The replication queue's two times are written, compared and read as UTC in SQL (UTC_NOW,
 *     asUtc, readQueue). The column is a timestamp without zone: the default wrote UTC wall time, the
 *     driver read it as the Node process's local time and wrote a Date as local wall time, so on a
 *     machine east of UTC a row read hours off and a prune with a short cutoff deleted rows queued a
 *     moment before. enqueueReplication stores the entry's createdAt, as SQLite does.
 *   2026-10-16 — replicationQueueSize counts only pending rows, on both providers; the prune still removes sent
 *     rows (decision 2026-10-16, test/unit/replication-queue-parity.test.ts).
 *   2026-10-16 — listSystemPrompts by group and name, as on SQLite (QA audit D4-04).
 *   v1.1.0 — 2026-10-16 — The replication queue answers as the SQLite provider does: a payload comes
 *     back decoded from its JSON text, the depth counts every row on the queue, and a prune also removes
 *     the rows already sent. Found when e2e-federation-settlements-sync first ran its nodes on
 *     PostgreSQL (QA audit P1-02); test/unit/replication-queue-parity.test.ts holds both providers to it.
 *   v1.0.0 — 2026-07-15 — Phase 5: system prompts + replication queue on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { ReplicationQueueEntry, SystemPromptRecord, SystemPromptVersionRecord } from '../../../interface.js';
import type { ReplicationQueue, SystemPrompt, SystemPromptVersion } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';
import { logger } from '../../../../utils/logger.js';

const iso = (t: Date | string): string => (t instanceof Date ? t : new Date(t)).toISOString();
const isoN = (t: Date | string | null | undefined): string | null => (t == null ? null : iso(t));

function toPrompt(r: Selectable<SystemPrompt>): SystemPromptRecord {
  return {
    id: r.id, name: r.name, group: r.group, description: r.description, content: r.content,
    variables: r.variables ?? [], usedIn: r.usedIn ?? [], locales: (r.locales ?? undefined) as SystemPromptRecord['locales'],
    active: r.active, version: r.version, updatedBy: r.updatedBy, updatedAt: iso(r.updatedAt),
  };
}
function toVersion(r: Selectable<SystemPromptVersion>): SystemPromptVersionRecord {
  return {
    promptId: r.promptId, version: r.version, content: r.content, locales: (r.locales ?? undefined) as SystemPromptVersionRecord['locales'],
    changedBy: r.changedBy, changeNote: r.changeNote ?? undefined, changedAt: iso(r.changedAt),
  };
}
/** The payload as enqueued: stored as JSON text, decoded on the way out like the SQLite provider does. */
function decodePayload(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    // A payload enqueued as plain text is not JSON and stays text; said once in the log.
    logger.debug('replication queue: a payload that is not JSON is returned as text', { error: String(err) });
    return raw;
  }
}

/**
 * The replication queue's times in UTC, whatever the Node process's or the database session's zone.
 * "createdAt" and "lastAttemptAt" are timestamps without zone holding UTC wall time: written with
 * UTC_NOW or asUtc, compared against asUtc, and read through readQueue, which turns them back into
 * instants with AT TIME ZONE 'UTC'. The driver's own reading of a zoneless timestamp is local time,
 * which is what put a fresh row hours into the past on a machine east of UTC.
 */
const UTC_NOW = sql<Date>`(now() AT TIME ZONE 'UTC')`;
function asUtc(t: Date | string): ReturnType<typeof sql<Date>> {
  return sql<Date>`(${iso(t)}::timestamptz AT TIME ZONE 'UTC')`;
}
function readQueue(db: PostgresKyselyStorage['db']) {
  return db.selectFrom('ReplicationQueue').select([
    'id', 'type', 'targetPeers', 'payload', 'attempts', 'status',
    sql<Date>`"createdAt" AT TIME ZONE 'UTC'`.as('createdAt'),
    sql<Date | null>`"lastAttemptAt" AT TIME ZONE 'UTC'`.as('lastAttemptAt'),
  ]);
}

function toQueue(r: Selectable<ReplicationQueue>): ReplicationQueueEntry {
  return {
    id: r.id, type: r.type as ReplicationQueueEntry['type'], payload: decodePayload(r.payload), targetPeers: r.targetPeers ?? [],
    attempts: r.attempts, status: r.status as ReplicationQueueEntry['status'], createdAt: iso(r.createdAt), lastAttemptAt: isoN(r.lastAttemptAt),
  };
}

export const systemPromptMethods = {
  async listSystemPrompts(this: PostgresKyselyStorage, opts?: { group?: string }): Promise<SystemPromptRecord[]> {
    let q = this.db.selectFrom('SystemPrompt').selectAll();
    if (opts?.group) q = q.where('group', '=', opts.group);
    return (await q.orderBy('group').orderBy('name').execute()).map(toPrompt);
  },
  async getSystemPrompt(this: PostgresKyselyStorage, id: string): Promise<SystemPromptRecord | null> {
    const r = await this.db.selectFrom('SystemPrompt').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toPrompt(r) : null;
  },
  async upsertSystemPrompt(this: PostgresKyselyStorage, r: SystemPromptRecord): Promise<SystemPromptRecord> {
    const shared = { name: r.name, group: r.group, description: r.description ?? '', content: r.content, variables: r.variables ?? [], usedIn: r.usedIn ?? [], locales: jsonb(r.locales ?? null), active: r.active, version: r.version, updatedBy: r.updatedBy, updatedAt: new Date(r.updatedAt) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.db.insertInto('SystemPrompt').values({ id: r.id, ...shared } as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict(oc => oc.column('id').doUpdateSet(shared as any)).execute();
    return r;
  },
  async getSystemPromptVersions(this: PostgresKyselyStorage, promptId: string): Promise<SystemPromptVersionRecord[]> {
    return (await this.db.selectFrom('SystemPromptVersion').selectAll().where('promptId', '=', promptId).orderBy('version', 'desc').execute()).map(toVersion);
  },
  async getSystemPromptVersion(this: PostgresKyselyStorage, promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
    const r = await this.db.selectFrom('SystemPromptVersion').selectAll().where('promptId', '=', promptId).where('version', '=', version).executeTakeFirst();
    return r ? toVersion(r) : null;
  },
  async createSystemPromptVersion(this: PostgresKyselyStorage, r: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord> {
    await this.db.insertInto('SystemPromptVersion').values({
      promptId: r.promptId, version: r.version, content: r.content, locales: jsonb(r.locales ?? null), changedBy: r.changedBy, changeNote: r.changeNote ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).execute();
    return r;
  },
  async pruneSystemPromptVersions(this: PostgresKyselyStorage, promptId: string, keepCount: number): Promise<number> {
    const keep = await this.db.selectFrom('SystemPromptVersion').select('version').where('promptId', '=', promptId).orderBy('version', 'desc').limit(keepCount).execute();
    const keepVersions = keep.map(k => k.version);
    let q = this.db.deleteFrom('SystemPromptVersion').where('promptId', '=', promptId);
    if (keepVersions.length) q = q.where('version', 'not in', keepVersions);
    const r = await q.executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async deleteAllSystemPrompts(this: PostgresKyselyStorage): Promise<void> {
    await this.db.deleteFrom('SystemPromptVersion').execute();
    await this.db.deleteFrom('SystemPrompt').execute();
  },
};

export const replicationQueueMethods = {
  async enqueueReplication(this: PostgresKyselyStorage, entry: Omit<ReplicationQueueEntry, 'id' | 'attempts' | 'lastAttemptAt' | 'status'>): Promise<string> {
    const [row] = await this.db.insertInto('ReplicationQueue').values({
      type: entry.type, payload: entry.payload == null ? null : (typeof entry.payload === 'string' ? entry.payload : JSON.stringify(entry.payload)), targetPeers: entry.targetPeers ?? [], attempts: 0, status: 'pending',
      // The entry's own time, as SQLite stores it; now when it carries none that parses.
      createdAt: entry.createdAt && !Number.isNaN(Date.parse(entry.createdAt)) ? asUtc(entry.createdAt) : UTC_NOW,
    }).returning('id').execute();
    return row.id;
  },
  async dequeueReplication(this: PostgresKyselyStorage, peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
    const rows = await readQueue(this.db).where('status', '=', 'pending')
      .where(sql<boolean>`${peerId} = ANY("targetPeers")`).orderBy('createdAt', 'asc').limit(limit).execute();
    return rows.map(toQueue);
  },
  async markReplicationSent(this: PostgresKyselyStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.updateTable('ReplicationQueue').set({ status: 'sent', lastAttemptAt: UTC_NOW }).where('id', 'in', ids).execute();
  },
  async markReplicationFailed(this: PostgresKyselyStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.updateTable('ReplicationQueue').set({ status: 'failed', lastAttemptAt: UTC_NOW, attempts: sql`"attempts" + 1` }).where('id', 'in', ids).execute();
  },
  async pruneReplicationQueue(this: PostgresKyselyStorage, maxAge: Date): Promise<number> {
    // Aged rows and the rows already sent, as on SQLite: a sent row has done its work.
    const r = await this.db.deleteFrom('ReplicationQueue')
      .where(eb => eb.or([eb('createdAt', '<', asUtc(maxAge)), eb('status', '=', 'sent')])).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async replicationQueueSize(this: PostgresKyselyStorage): Promise<number> {
    // The rows not yet sent, as on SQLite: a sent or failed row is not waiting, and sync-health reads
    // the depth as the backlog it throttles on (decision 2026-10-16).
    const r = await this.db.selectFrom('ReplicationQueue').select(sql<number>`count(*)`.as('n')).where('status', '=', 'pending').executeTakeFirst();
    return Number(r?.n ?? 0);
  },
};
