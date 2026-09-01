/**
 * @file src/storage/providers/sqlite/methods/agent-v2-messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the Agent v2 messaging repository: the turns, and the
 *   delivery targets a principal registers for them.
 * @structure agentV2MessagingMethods — messages: create / get / list / deleteByOwner; push configs:
 *   upsert / get / list / delete / recordAttempt / deleteByOwner
 * @usage Object.assign(SqliteStorage.prototype, agentV2MessagingMethods)
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import type { AgentV2MessageRecord, AgentV2PushConfigRecord } from '../../../interface.js';
import type { AgentV2MessageQuery } from '../../../repositories/agent-v2-messaging.repository.js';
import type { SqliteStorage } from '../index.js';

function toMessage(row: Record<string, unknown>): AgentV2MessageRecord {
  return {
    messageId: row.messageId as string,
    role: row.role as AgentV2MessageRecord['role'],
    parts: JSON.parse((row.parts as string) || '[]') as AgentV2MessageRecord['parts'],
    contextId: row.contextId as string,
    taskId: (row.taskId as string) ?? null,
    from: row.fromPrincipal as string,
    to: row.toPrincipal as string,
    owner: row.owner as string,
    createdAt: row.createdAt as string,
    metadata: row.metadata ? JSON.parse(row.metadata as string) as Record<string, unknown> : null,
  };
}

function toConfig(row: Record<string, unknown>): AgentV2PushConfigRecord {
  return {
    id: row.id as string,
    principal: row.principal as string,
    owner: row.owner as string,
    url: row.url as string,
    token: (row.token as string) ?? null,
    authSchemes: JSON.parse((row.authSchemes as string) || '[]') as string[],
    authCredentials: (row.authCredentials as string) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    lastSuccessAt: (row.lastSuccessAt as string) ?? null,
    lastFailureAt: (row.lastFailureAt as string) ?? null,
    failCount: Number(row.failCount ?? 0),
    disabledAt: (row.disabledAt as string) ?? null,
  };
}

export const agentV2MessagingMethods = {
  async createAgentV2Message(this: SqliteStorage, m: AgentV2MessageRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO agent_v2_messages
         (messageId, role, parts, contextId, taskId, fromPrincipal, toPrincipal, owner, createdAt, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      m.messageId, m.role, JSON.stringify(m.parts), m.contextId, m.taskId ?? null,
      m.from, m.to, m.owner, m.createdAt, m.metadata ? JSON.stringify(m.metadata) : null,
    );
  },

  async getAgentV2Message(this: SqliteStorage, owner: string, messageId: string): Promise<AgentV2MessageRecord | null> {
    const row = this.db.prepare('SELECT * FROM agent_v2_messages WHERE owner = ? AND messageId = ?')
      .get(owner, messageId) as Record<string, unknown> | undefined;
    return row ? toMessage(row) : null;
  },

  async listAgentV2Messages(this: SqliteStorage, owner: string, q: AgentV2MessageQuery): Promise<AgentV2MessageRecord[]> {
    const where: string[] = ['owner = ?'];
    const args: unknown[] = [owner];
    if (q.contextId) { where.push('contextId = ?'); args.push(q.contextId); }
    if (q.taskId) { where.push('taskId = ?'); args.push(q.taskId); }
    if (q.to) { where.push('toPrincipal = ?'); args.push(q.to); }
    if (q.from) { where.push('fromPrincipal = ?'); args.push(q.from); }
    if (q.since) { where.push('createdAt > ?'); args.push(q.since); }
    args.push(Math.max(1, q.limit ?? 50));
    const rows = this.db.prepare(
      `SELECT * FROM agent_v2_messages WHERE ${where.join(' AND ')} ORDER BY createdAt ASC, messageId ASC LIMIT ?`
    ).all(...args) as Record<string, unknown>[];
    return rows.map(toMessage);
  },

  async deleteAgentV2MessagesByOwner(this: SqliteStorage, owner: string): Promise<number> {
    return this.db.prepare('DELETE FROM agent_v2_messages WHERE owner = ?').run(owner).changes;
  },

  async upsertAgentV2PushConfig(this: SqliteStorage, c: AgentV2PushConfigRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO agent_v2_push_configs
         (id, principal, owner, url, token, authSchemes, authCredentials, createdAt, updatedAt,
          lastSuccessAt, lastFailureAt, failCount, disabledAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         principal = excluded.principal, url = excluded.url, token = excluded.token,
         authSchemes = excluded.authSchemes, authCredentials = excluded.authCredentials,
         updatedAt = excluded.updatedAt,
         lastFailureAt = NULL, failCount = 0, disabledAt = NULL`
    ).run(
      c.id, c.principal, c.owner, c.url, c.token ?? null, JSON.stringify(c.authSchemes),
      c.authCredentials ?? null, c.createdAt, c.updatedAt,
      c.lastSuccessAt ?? null, c.lastFailureAt ?? null, c.failCount, c.disabledAt ?? null,
    );
  },

  async getAgentV2PushConfig(this: SqliteStorage, owner: string, id: string): Promise<AgentV2PushConfigRecord | null> {
    const row = this.db.prepare('SELECT * FROM agent_v2_push_configs WHERE owner = ? AND id = ?')
      .get(owner, id) as Record<string, unknown> | undefined;
    return row ? toConfig(row) : null;
  },

  async listAgentV2PushConfigs(this: SqliteStorage, owner: string, principal?: string): Promise<AgentV2PushConfigRecord[]> {
    const rows = principal
      ? this.db.prepare('SELECT * FROM agent_v2_push_configs WHERE owner = ? AND principal = ? ORDER BY createdAt ASC').all(owner, principal)
      : this.db.prepare('SELECT * FROM agent_v2_push_configs WHERE owner = ? ORDER BY createdAt ASC').all(owner);
    return (rows as Record<string, unknown>[]).map(toConfig);
  },

  async deleteAgentV2PushConfig(this: SqliteStorage, owner: string, id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM agent_v2_push_configs WHERE owner = ? AND id = ?').run(owner, id).changes > 0;
  },

  async recordAgentV2PushAttempt(this: SqliteStorage, id: string, ok: boolean, at: string, disabledAt?: string | null): Promise<void> {
    if (ok) {
      this.db.prepare('UPDATE agent_v2_push_configs SET lastSuccessAt = ?, failCount = 0, disabledAt = NULL WHERE id = ?').run(at, id);
      return;
    }
    this.db.prepare(
      'UPDATE agent_v2_push_configs SET lastFailureAt = ?, failCount = failCount + 1, disabledAt = ? WHERE id = ?'
    ).run(at, disabledAt ?? null, id);
  },

  async deleteAgentV2PushConfigsByOwner(this: SqliteStorage, owner: string): Promise<number> {
    return this.db.prepare('DELETE FROM agent_v2_push_configs WHERE owner = ?').run(owner).changes;
  },
};
