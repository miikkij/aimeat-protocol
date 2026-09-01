/**
 * @file src/storage/providers/postgres-kysely/methods/agent-v2-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the Agent v2 messaging repository: the turns, and
 *   the delivery targets a principal registers for them (migration 0059).
 * @structure agentV2MessagingMethods — messages: create / get / list / deleteByOwner; push configs:
 *   upsert / get / list / delete / recordAttempt / deleteByOwner
 * @usage Object.assign(PostgresKyselyStorage.prototype, agentV2MessagingMethods)
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import { sql, type Selectable } from 'kysely';
import type { AgentV2MessageRecord, AgentV2PushConfigRecord } from '../../../interface.js';
import type { AgentV2MessageQuery } from '../../../repositories/agent-v2-messaging.repository.js';
import type { AgentV2Message, AgentV2PushConfig } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { dbError } from '../helpers.js';

function toMessage(r: Selectable<AgentV2Message>): AgentV2MessageRecord {
  return {
    messageId: r.messageId,
    role: r.role as AgentV2MessageRecord['role'],
    parts: (r.parts ?? []) as AgentV2MessageRecord['parts'],
    contextId: r.contextId,
    taskId: r.taskId ?? null,
    from: r.fromPrincipal,
    to: r.toPrincipal,
    owner: r.owner,
    createdAt: r.createdAt,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  };
}

function toConfig(r: Selectable<AgentV2PushConfig>): AgentV2PushConfigRecord {
  return {
    id: r.id, principal: r.principal, taskId: r.taskId ?? null, owner: r.owner, url: r.url,
    token: r.token ?? null,
    authSchemes: r.authSchemes ?? [],
    authCredentials: r.authCredentials ?? null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
    lastSuccessAt: r.lastSuccessAt ?? null,
    lastFailureAt: r.lastFailureAt ?? null,
    failCount: Number(r.failCount ?? 0),
    disabledAt: r.disabledAt ?? null,
  };
}

export const agentV2MessagingMethods = {
  async createAgentV2Message(this: PostgresKyselyStorage, m: AgentV2MessageRecord): Promise<void> {
    try {
      await this.db.insertInto('AgentV2Message').values({
        messageId: m.messageId, role: m.role, parts: JSON.stringify(m.parts) as never,
        contextId: m.contextId, taskId: m.taskId ?? null,
        fromPrincipal: m.from, toPrincipal: m.to, owner: m.owner, createdAt: m.createdAt,
        metadata: (m.metadata ? JSON.stringify(m.metadata) : null) as never,
      }).execute();
    } catch (err) { throw dbError('createAgentV2Message', err); }
  },

  async getAgentV2Message(this: PostgresKyselyStorage, owner: string, messageId: string): Promise<AgentV2MessageRecord | null> {
    const r = await this.db.selectFrom('AgentV2Message').selectAll()
      .where('owner', '=', owner).where('messageId', '=', messageId).executeTakeFirst();
    return r ? toMessage(r) : null;
  },

  async listAgentV2Messages(this: PostgresKyselyStorage, owner: string, q: AgentV2MessageQuery): Promise<AgentV2MessageRecord[]> {
    let query = this.db.selectFrom('AgentV2Message').selectAll().where('owner', '=', owner);
    if (q.contextId) query = query.where('contextId', '=', q.contextId);
    if (q.taskId) query = query.where('taskId', '=', q.taskId);
    if (q.to) query = query.where('toPrincipal', '=', q.to);
    if (q.from) query = query.where('fromPrincipal', '=', q.from);
    if (q.since) query = query.where('createdAt', '>', q.since);
    const rows = await query.orderBy('createdAt', 'asc').orderBy('messageId', 'asc')
      .limit(Math.max(1, q.limit ?? 50)).execute();
    return rows.map(toMessage);
  },

  async deleteAgentV2MessagesByOwner(this: PostgresKyselyStorage, owner: string): Promise<number> {
    const r = await this.db.deleteFrom('AgentV2Message').where('owner', '=', owner).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async upsertAgentV2PushConfig(this: PostgresKyselyStorage, c: AgentV2PushConfigRecord): Promise<void> {
    try {
      await this.db.insertInto('AgentV2PushConfig').values({
        id: c.id, principal: c.principal, taskId: c.taskId ?? null, owner: c.owner, url: c.url,
        token: c.token ?? null, authSchemes: c.authSchemes,
        authCredentials: c.authCredentials ?? null,
        createdAt: c.createdAt, updatedAt: c.updatedAt,
        lastSuccessAt: c.lastSuccessAt ?? null, lastFailureAt: c.lastFailureAt ?? null,
        failCount: c.failCount, disabledAt: c.disabledAt ?? null,
      }).onConflict((oc) => oc.column('id').doUpdateSet({
        principal: c.principal, taskId: c.taskId ?? null, url: c.url, token: c.token ?? null,
        authSchemes: c.authSchemes, authCredentials: c.authCredentials ?? null,
        updatedAt: c.updatedAt,
        // Re-registering is how a person clears a target the node gave up on.
        lastFailureAt: null, failCount: 0, disabledAt: null,
      })).execute();
    } catch (err) { throw dbError('upsertAgentV2PushConfig', err); }
  },

  async getAgentV2PushConfig(this: PostgresKyselyStorage, owner: string, id: string): Promise<AgentV2PushConfigRecord | null> {
    const r = await this.db.selectFrom('AgentV2PushConfig').selectAll()
      .where('owner', '=', owner).where('id', '=', id).executeTakeFirst();
    return r ? toConfig(r) : null;
  },

  async listAgentV2PushConfigs(this: PostgresKyselyStorage, owner: string, principal?: string): Promise<AgentV2PushConfigRecord[]> {
    let query = this.db.selectFrom('AgentV2PushConfig').selectAll().where('owner', '=', owner);
    if (principal) query = query.where('principal', '=', principal);
    return (await query.orderBy('createdAt', 'asc').execute()).map(toConfig);
  },

  async deleteAgentV2PushConfig(this: PostgresKyselyStorage, owner: string, id: string): Promise<boolean> {
    const r = await this.db.deleteFrom('AgentV2PushConfig')
      .where('owner', '=', owner).where('id', '=', id).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0) > 0;
  },

  async recordAgentV2PushAttempt(this: PostgresKyselyStorage, id: string, ok: boolean, at: string, disabledAt?: string | null): Promise<void> {
    if (ok) {
      await this.db.updateTable('AgentV2PushConfig')
        .set({ lastSuccessAt: at, failCount: 0, disabledAt: null }).where('id', '=', id).execute();
      return;
    }
    await this.db.updateTable('AgentV2PushConfig')
      .set({ lastFailureAt: at, failCount: sql`"failCount" + 1`, disabledAt: disabledAt ?? null })
      .where('id', '=', id).execute();
  },

  async deleteAgentV2PushConfigsByOwner(this: PostgresKyselyStorage, owner: string): Promise<number> {
    const r = await this.db.deleteFrom('AgentV2PushConfig').where('owner', '=', owner).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
