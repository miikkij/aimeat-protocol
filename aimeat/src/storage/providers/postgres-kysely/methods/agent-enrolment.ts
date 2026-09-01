/**
 * @file src/storage/providers/postgres-kysely/methods/agent-enrolment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Postgres+Kysely implementation of the Agent v2 enrolment-grant repository: the
 *   single-use permission one "create my basic agents" press produces (migration 0058).
 * @structure agentEnrolmentMethods — create / get / consume / cleanupExpired / deleteByOwner
 * @usage Object.assign(PostgresKyselyStorage.prototype, agentEnrolmentMethods)
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial, with the basic-agents button.
 */
import type { Selectable } from 'kysely';
import type { AgentEnrolmentGrantRecord } from '../../../interface.js';
import type { AgentEnrolmentGrant } from '../db-types.js';
import type { PostgresKyselyStorage } from '../index.js';
import { dbError } from '../helpers.js';

function toRecord(r: Selectable<AgentEnrolmentGrant>): AgentEnrolmentGrantRecord {
  return {
    id: r.id, owner: r.owner, agents: r.agents ?? [],
    kind: ((r.kind ?? 'create') as 'create' | 'migrate'),
    createdBy: r.createdBy,
    createdAt: r.createdAt, expiresAt: r.expiresAt,
    usedAt: r.usedAt ?? null, usedBy: r.usedBy ?? null,
  };
}

export const agentEnrolmentMethods = {
  async createAgentEnrolmentGrant(this: PostgresKyselyStorage, grant: AgentEnrolmentGrantRecord): Promise<void> {
    try {
      await this.db.insertInto('AgentEnrolmentGrant').values({
        id: grant.id, owner: grant.owner, agents: grant.agents, kind: grant.kind ?? 'create',
        createdBy: grant.createdBy, createdAt: grant.createdAt, expiresAt: grant.expiresAt,
        usedAt: grant.usedAt ?? null, usedBy: grant.usedBy ?? null,
      }).execute();
    } catch (err) { throw dbError('createAgentEnrolmentGrant', err); }
  },

  async getAgentEnrolmentGrant(this: PostgresKyselyStorage, id: string): Promise<AgentEnrolmentGrantRecord | null> {
    const r = await this.db.selectFrom('AgentEnrolmentGrant').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? toRecord(r) : null;
  },

  /**
   * Conditional on `usedAt IS NULL`, so the answer is "did THIS call spend it" rather than "was it
   * unspent a moment ago". Two daemons racing on one grant is the case this exists for: a read
   * followed by a write would hand both of them credentials.
   */
  async consumeAgentEnrolmentGrant(this: PostgresKyselyStorage, id: string, usedBy: string, usedAt: string): Promise<boolean> {
    const r = await this.db.updateTable('AgentEnrolmentGrant')
      .set({ usedAt, usedBy })
      .where('id', '=', id)
      .where('usedAt', 'is', null)
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0) > 0;
  },

  async cleanupExpiredAgentEnrolmentGrants(this: PostgresKyselyStorage): Promise<number> {
    const r = await this.db.deleteFrom('AgentEnrolmentGrant')
      .where('expiresAt', '<=', new Date().toISOString()).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },

  async deleteAgentEnrolmentGrantsByOwner(this: PostgresKyselyStorage, owner: string): Promise<number> {
    const r = await this.db.deleteFrom('AgentEnrolmentGrant').where('owner', '=', owner).executeTakeFirst();
    return Number(r.numDeletedRows ?? 0);
  },
};
