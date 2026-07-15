/**
 * @file src/storage/providers/postgres-kysely/methods/system-extras.ts
 * @description System prompts (SystemPrompt + SystemPromptVersion) and the federation replication queue
 *   (ReplicationQueue) for the Postgres+Kysely backend. Translated to match the Prisma provider.
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 5: system prompts + replication queue on Postgres+Kysely.
 */
import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { ReplicationQueueEntry, SystemPromptRecord, SystemPromptVersionRecord } from '../../../interface.js';
import type { ReplicationQueue, SystemPrompt, SystemPromptVersion } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { jsonb } from '../helpers.js';

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
function toQueue(r: Selectable<ReplicationQueue>): ReplicationQueueEntry {
  return {
    id: r.id, type: r.type as ReplicationQueueEntry['type'], payload: r.payload ?? undefined, targetPeers: r.targetPeers ?? [],
    attempts: r.attempts, status: r.status as ReplicationQueueEntry['status'], createdAt: iso(r.createdAt), lastAttemptAt: isoN(r.lastAttemptAt),
  };
}

export const systemPromptMethods = {
  async listSystemPrompts(this: PostgresKyselyStorage, opts?: { group?: string }): Promise<SystemPromptRecord[]> {
    let q = this.db.selectFrom('SystemPrompt').selectAll();
    if (opts?.group) q = q.where('group', '=', opts.group);
    return (await q.execute()).map(toPrompt);
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
    }).returning('id').execute();
    return row.id;
  },
  async dequeueReplication(this: PostgresKyselyStorage, peerId: string, limit: number): Promise<ReplicationQueueEntry[]> {
    const rows = await this.db.selectFrom('ReplicationQueue').selectAll().where('status', '=', 'pending')
      .where(sql<boolean>`${peerId} = ANY("targetPeers")`).orderBy('createdAt', 'asc').limit(limit).execute();
    return rows.map(toQueue);
  },
  async markReplicationSent(this: PostgresKyselyStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.updateTable('ReplicationQueue').set({ status: 'sent', lastAttemptAt: new Date() }).where('id', 'in', ids).execute();
  },
  async markReplicationFailed(this: PostgresKyselyStorage, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.updateTable('ReplicationQueue').set({ status: 'failed', lastAttemptAt: new Date(), attempts: sql`"attempts" + 1` }).where('id', 'in', ids).execute();
  },
  async pruneReplicationQueue(this: PostgresKyselyStorage, maxAge: Date): Promise<number> {
    const r = await this.db.deleteFrom('ReplicationQueue').where('createdAt', '<', maxAge).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
  async replicationQueueSize(this: PostgresKyselyStorage): Promise<number> {
    const r = await this.db.selectFrom('ReplicationQueue').select(sql<number>`count(*)`.as('n')).where('status', '=', 'pending').executeTakeFirst();
    return Number(r?.n ?? 0);
  },
};
