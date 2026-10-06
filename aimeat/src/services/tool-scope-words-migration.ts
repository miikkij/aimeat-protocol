/**
 * @file src/services/tool-scope-words-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One-time migration for the scope words MCP tools started asking on 2026-10-06
 *   (secaudit 2026-10 follow-up, A4, commit 65d3c5b36). The node MCP registers a tool only when the
 *   session holds every word on it (tool-catalog/scopes.ts scopeAllowsTool), so a new word on a tool
 *   REMOVES the tool from every agent approved without it. A4 put organism:read on the workspace and
 *   organism read tools, which had asked nothing, and none of the scope presets or the node's default
 *   agent scopes carry it: an agent approved with them lost workspace read, overview, comments,
 *   organism search and export at the deploy. Same shape as changelog 1.33.1 and
 *   services/scope-vocabulary-migration.ts.
 *
 *   WHAT IT GIVES. Only words that keep reach an agent already had, to agents approved before the
 *   words shipped on aimeat.io (TOOL_SCOPE_WORDS_SHIPPED_AT), once per node:
 *     - organism:read, to an agent holding memory:read. The tools it gates only read, and an agent
 *       without memory:read was narrowed on purpose by its owner.
 *     - messages:send, to an agent holding messages:send-as-owner. aimeat_dm_send_as_owner now asks
 *       both; sending as itself is less than sending in the owner's name.
 *
 *   WHAT IT NEVER GIVES. organism:write: since 2026-08-10 the consent screen lists it, and it gates
 *   creating organisms and workspaces as well as publish and revert, so an owner who left it unticked
 *   chose that (the agents approved before 2026-08-10 got it from the vocabulary migration already).
 *   ai:use, outbound:send, packages:write, memory:write, wallet:read and workflow:read, the other
 *   words A4 added: each opens more than the one tool, so handing it out would give reach nobody
 *   granted; the owner ticks it on the agent's card. A wildcard agent and an agent with no recorded
 *   scope list are left alone, as in scope-vocabulary-migration.ts.
 * @structure CARRIED_FORWARD · carriedForwardWords(held) · migrateToolScopeWordsOnce(storage, nodeId)
 * @usage migrateToolScopeWordsOnce(storage, config.nodeId).catch(err => logger.error(…));
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up audit, finding 1).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { agentPredatesVocabulary } from './scope-vocabulary-migration.js';

/** When aimeat.io first ran the words (its build muwbbfy7). An agent approved later chose from a screen that showed today's presets. */
export const TOOL_SCOPE_WORDS_SHIPPED_AT = '2026-10-06T06:43:27.000Z';

/** The record under `system@<nodeId>` that says this node has run the migration. */
export const TOOL_SCOPE_WORDS_KEY = 'migrations.tool-scope-words-2026-10';

/** A word given to an agent that holds `when`, and why that keeps reach rather than adding it. */
export const CARRIED_FORWARD: ReadonlyArray<{ grant: string; when: string; why: string }> = [
    { grant: 'organism:read', when: 'memory:read', why: 'workspace read, overview and comments, organism overview, search and export' },
    { grant: 'messages:send', when: 'messages:send-as-owner', why: 'aimeat_dm_send_as_owner asks both words' },
];

/** The words this migration gives an agent holding `held`; none for a wildcard or a word already covered. */
export function carriedForwardWords(held: readonly string[]): string[] {
    return CARRIED_FORWARD
        .filter(c => scopeIsCovered(held, c.when) && !scopeIsCovered(held, c.grant))
        .map(c => c.grant);
}

/**
 * Give the carried-forward words to every agent approved before they shipped, unless this node's
 * record says it has run. The record is written after the agents, so a boot that stops half way runs
 * it again; after that an owner who takes a word away keeps it away.
 */
export async function migrateToolScopeWordsOnce(storage: Storage, nodeId: string): Promise<{ ran: boolean; agents: number }> {
    const system = `system@${nodeId}`;
    if (await storage.getMemory(system, TOOL_SCOPE_WORDS_KEY)) return { ran: false, agents: 0 };

    let agents = 0;
    for (const agent of await storage.listAgents()) {
        if (!agentPredatesVocabulary(agent, TOOL_SCOPE_WORDS_SHIPPED_AT)) continue;
        const held = agent.defaultScopes;
        if (!Array.isArray(held)) continue;
        const missing = carriedForwardWords(held);
        if (!missing.length) continue;
        await storage.updateAgent(agent.gaii, { defaultScopes: [...held, ...missing] });
        agents++;
    }

    const now = new Date().toISOString();
    await storage.setMemory({
        key: TOOL_SCOPE_WORDS_KEY,
        ownerGaii: system,
        value: { at: now, agents, words: CARRIED_FORWARD.map(c => c.grant) },
        visibility: 'private',
        tags: ['migration'],
        // Never swept: a record that expired would run the migration again at the next boot.
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
    });
    if (agents > 0) logger.info(`Tool scope words: ${agents} agent(s) approved before ${TOOL_SCOPE_WORDS_SHIPPED_AT} keep their workspace read and send tools`);
    return { ran: true, agents };
}
