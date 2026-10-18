/**
 * @file src/services/operator-admin-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Once per node: every agent of the node operator that holds "Full access" (`*`) is
 *   given operator:admin, so it keeps the node's administration tools.
 *
 *   WHY IT EXISTS. operator:admin arrived on 2026-09-24 (security audit A8-1), outside every
 *   wildcard, and no agent was given it, so every agent an operator had connected lost the admin
 *   tools at once, the claude.ai connector among them. The developer ruled on 2026-09-25: one
 *   migration gives the word to every agent of an operator that holds `*` on the day it runs. An agent
 *   the operator gave narrow permissions does not get it, which is what the audit asked for, and an
 *   agent made later gets it only when the operator ticks it.
 *
 *   ONCE, AND THE RECORD THAT SAYS SO. The node writes OPERATOR_ADMIN_MIGRATION_KEY under its own
 *   system identity when the migration has run, never to expire, and every later boot reads that and
 *   does nothing. Run on every boot instead, it would hand the word back to an agent whose owner took
 *   it away, and to every full-access agent made later, which is the reach the word exists to
 *   withhold. The record is claimed before the agents and written over the claim after them
 *   (services/once-only-step.ts), so of two node processes starting together one runs it; a boot
 *   whose run fails removes the claim, and the next run skips every agent that already holds the word.
 *
 *   WHAT THE OWNER SEES. One line on the operator's activity feed, `operator_admin_granted`, naming
 *   the agents that got the word; the feed says where to take it away. An owner whose agents did not
 *   change is told nothing.
 *
 *   WHAT IT READS. The agent record's own scope list, which is what every token is minted from, the
 *   OAuth connector's included (mcp/oauth.ts). An agent with no list of its own holds nothing on a
 *   request (auth/effective-scopes.ts) and is left alone. An MCP session reads the record when it
 *   opens (mcp/index.ts), so the agent is offered the admin tools in its next session; a door that
 *   reads the token has the word from the agent's next token.
 *
 *   AFTER THE SCOPE-VOCABULARY MIGRATION, NEVER BESIDE IT. Both rewrite an agent's whole scope list,
 *   so run side by side one could write over the other's addition; the boot chains this one after it
 *   (server-bootstrap/service-init.ts), and each agent's list is written only over the list that was
 *   read (services/scope-list-swap.ts), which also holds when another node process runs the
 *   vocabulary step at the same moment.
 * @structure OPERATOR_ADMIN_MIGRATION_KEY · OperatorAdminMigration · migrateOperatorAdminOnce(storage, config)
 * @usage
 *   const r = await migrateOperatorAdminOnce(storage, config);
 *   if (r.ran) logger.info(`${r.granted.length} operator account(s) changed`);
 * @version-history
 *   v1.1.0 — 2026-10-18 — The record is claimed before the work (services/once-only-step.ts) and each
 *     agent's list is written on the list that was read (services/scope-list-swap.ts) (check:atomic-writes).
 *   v1.0.1 — 2026-10-05 — The account's operator role is read with isOperatorAccount (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-09-25 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { OPERATOR_ADMIN_SCOPE } from '../utils/scope-coverage.js';
import { isOperatorAccount } from '../utils/operator-account.js';
import { recordAccountEvent } from './account-events.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { changeScopeList } from './scope-list-swap.js';

/** The record that says this node has run the migration, under `system@<nodeId>`. */
export const OPERATOR_ADMIN_MIGRATION_KEY = 'migrations.operator-admin';

/** What one call did. */
export interface OperatorAdminMigration {
  /** False when this node had already run it: nothing was read or written. */
  ran: boolean;
  /** Per operator account (the bare owner name), the names of the agents that got the word. */
  granted: Array<{ owner: string; agents: string[] }>;
}

/** Holds `*` on its own record and does not hold the word yet. */
function needsTheWord(agent: Pick<AgentRecord, 'defaultScopes'>): boolean {
  const held = agent.defaultScopes;
  return Array.isArray(held) && held.includes('*') && !held.includes(OPERATOR_ADMIN_SCOPE);
}

/**
 * Give operator:admin to every agent of an operator account that holds `*`, and tell each operator
 * which agents got it. Does nothing on a node that has run it before. Throws when a write fails, and
 * then leaves no record, so the next boot tries again.
 */
export async function migrateOperatorAdminOnce(
  storage: Storage,
  config: Pick<AimeatConfig, 'nodeId' | 'accountEventWindow'>,
): Promise<OperatorAdminMigration> {
  // Claimed before the work (services/once-only-step.ts), so of two node processes starting together
  // one runs it and each operator is told once.
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, OPERATOR_ADMIN_MIGRATION_KEY);
  if (!claim) return { ran: false, granted: [] };

  const granted: OperatorAdminMigration['granted'] = [];
  try {
    const byOwner = new Map<string, AgentRecord[]>();
    for (const agent of await storage.listAgents()) {
      if (needsTheWord(agent)) byOwner.set(agent.owner, [...(byOwner.get(agent.owner) ?? []), agent]);
    }

    for (const [owner, listed] of byOwner) {
      // The account first: the word means nothing on an account that does not run the node.
      if (!isOperatorAccount(await storage.getOwner(owner))) continue;
      const names: string[] = [];
      for (const agent of listed) {
        // Written on the list that was read (services/scope-list-swap.ts), because the write replaces
        // the whole list: a word another boot step or the owner adds meanwhile stays.
        const changed = await changeScopeList(storage, { kind: 'agent', id: agent.gaii }, agent.defaultScopes,
          held => (needsTheWord({ defaultScopes: [...held] }) ? [...held, OPERATOR_ADMIN_SCOPE] : null));
        if (changed) names.push(agent.name);
      }
      if (names.length === 0) continue;
      granted.push({ owner, agents: names });
      await recordAccountEvent(storage, {
        ownerGhii: `${owner}@${config.nodeId}`,
        kind: 'operator_admin_granted',
        subject: OPERATOR_ADMIN_SCOPE,
        link: '/v1/profile?tab=agents',
        data: { names: names.join(', '), count: String(names.length) },
      }, config);
    }
    await claim.finish({ at: new Date().toISOString(), operators: granted.length, agents: granted.reduce((n, g) => n + g.agents.length, 0) });
  } catch (err) {
    await claim.release();
    throw err;
  }

  const agents = granted.reduce((n, g) => n + g.agents.length, 0);
  logger.info('operator:admin migration: the operator\'s full-access agents keep the admin tools', {
    operators: granted.length, agents,
  });
  return { ran: true, granted };
}
