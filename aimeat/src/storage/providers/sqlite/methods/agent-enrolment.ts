/**
 * @file src/storage/providers/sqlite/methods/agent-enrolment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite implementation of the Agent v2 enrolment-grant repository: the single-use
 *   permission one "create my basic agents" press produces.
 * @structure agentEnrolmentMethods — create / get / consume / cleanupExpired / deleteByOwner
 * @usage Object.assign(SqliteStorage.prototype, agentEnrolmentMethods)
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial, with the basic-agents button.
 */
import type { AgentEnrolmentGrantRecord } from '../../../interface.js';
import type { SqliteStorage } from '../index.js';

function toRecord(row: Record<string, unknown>): AgentEnrolmentGrantRecord {
  return {
    id: row.id as string,
    owner: row.owner as string,
    agents: JSON.parse((row.agents as string) || '[]') as string[],
    createdBy: row.createdBy as string,
    createdAt: row.createdAt as string,
    expiresAt: row.expiresAt as string,
    usedAt: (row.usedAt as string) ?? null,
    usedBy: (row.usedBy as string) ?? null,
  };
}

export const agentEnrolmentMethods = {
  async createAgentEnrolmentGrant(this: SqliteStorage, grant: AgentEnrolmentGrantRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO agent_enrolment_grants (id, owner, agents, createdBy, createdAt, expiresAt, usedAt, usedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      grant.id, grant.owner, JSON.stringify(grant.agents), grant.createdBy,
      grant.createdAt, grant.expiresAt, grant.usedAt ?? null, grant.usedBy ?? null,
    );
  },

  async getAgentEnrolmentGrant(this: SqliteStorage, id: string): Promise<AgentEnrolmentGrantRecord | null> {
    const row = this.db.prepare('SELECT * FROM agent_enrolment_grants WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? toRecord(row) : null;
  },

  /**
   * Conditional on `usedAt IS NULL`, so the answer is "did THIS call spend it" rather than "was it
   * unspent a moment ago". Two daemons racing on one grant is the case this exists for: a read
   * followed by a write would hand both of them credentials.
   */
  async consumeAgentEnrolmentGrant(this: SqliteStorage, id: string, usedBy: string, usedAt: string): Promise<boolean> {
    const res = this.db.prepare(
      'UPDATE agent_enrolment_grants SET usedAt = ?, usedBy = ? WHERE id = ? AND usedAt IS NULL'
    ).run(usedAt, usedBy, id);
    return res.changes > 0;
  },

  async cleanupExpiredAgentEnrolmentGrants(this: SqliteStorage): Promise<number> {
    const res = this.db.prepare('DELETE FROM agent_enrolment_grants WHERE expiresAt <= ?').run(new Date().toISOString());
    return res.changes;
  },

  async deleteAgentEnrolmentGrantsByOwner(this: SqliteStorage, owner: string): Promise<number> {
    const res = this.db.prepare('DELETE FROM agent_enrolment_grants WHERE owner = ?').run(owner);
    return res.changes;
  },
};
