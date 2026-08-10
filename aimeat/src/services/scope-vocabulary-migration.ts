/**
 * @file src/services/scope-vocabulary-migration.ts
 * @description Grandfather every existing agent onto the scope names added on 2026-08-10.
 *
 *   WHY THIS EXISTS. The MCP surface filters tools at REGISTRATION: `mcp/index.ts` wraps
 *   `mcp.tool`, and a tool whose scope the session does not carry is never registered. Until now, 73
 *   mutating tools had no entry in `TOOL_SCOPES`, and `scopeAllowsTool()` reads a missing entry as
 *   PERMISSION — so every agent could call every one of them. Giving those tools an entry therefore
 *   does not start refusing a call; it DELETES the tool from every agent whose owner-approved scopes
 *   predate the new words.
 *
 *   That has broken production once already in exactly this shape: changelog 1.33.1 (2026-06-24),
 *   where every agent calling `aimeat_agent_tags_set` on itself got ACCESS_DENIED and tag-based
 *   discovery stopped working fleet-wide.
 *
 *   So the new words are handed to the agents that already had the access, once, at boot. The gate
 *   then means what it says for every agent approved afterwards, and the owner can take any of them
 *   away from the agent editor — which is the point of naming them at all.
 *
 *   WHAT IT DOES NOT DO. An agent holding `*` is left alone: the wildcard already covers everything
 *   at runtime, and adding words to it would only make the owner's list harder to read. Nothing is
 *   ever removed, and running it twice changes nothing the first run did not.
 * @structure GRANDFATHERED_SCOPES · migrateAgentScopeVocabulary(storage) → how many agents changed
 * @usage
 *   // fire-and-forget at boot, after storage is ready
 *   migrateAgentScopeVocabulary(storage).catch(err => logger.error(…));
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3a: the vocabulary, and not breaking anyone).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/**
 * The words added on 2026-08-10, and what each one covers. Every existing agent gets all of them,
 * because today every existing agent can already do all of it.
 *
 *   agent:write      — reconfigure another of the owner's agents (mode, tags)
 *   app:write        — publish or update an app, save or publish a draft
 *   app:manage       — delete an app, fork one, remove a template
 *   capability:write — create, update, delete or vouch for a published capability
 *   ext:invoke       — run an installed extension's action
 *   organism:write   — create a workspace, write and publish in one, comment, revert
 *   organism:invite  — invite a member, grant or revoke a workspace role
 */
export const GRANDFATHERED_SCOPES = [
    'agent:write',
    'app:write',
    'app:manage',
    'capability:write',
    'ext:invoke',
    'organism:write',
    'organism:invite',
] as const;

/**
 * Add the new words to every agent that does not already hold them. Idempotent: a second run finds
 * nothing to do. Returns the number of agents actually updated, for the boot log.
 */
export async function migrateAgentScopeVocabulary(storage: Storage): Promise<number> {
    const agents = await storage.listAgents();
    let changed = 0;

    for (const agent of agents) {
        const held = agent.defaultScopes;
        // No recorded scopes at all, or the wildcard: nothing to grandfather. An agent with no
        // defaultScopes is minted from config.defaultAgentScopes, which is a separate decision.
        if (!Array.isArray(held) || held.includes('*')) continue;

        const missing = GRANDFATHERED_SCOPES.filter(s => !held.includes(s));
        if (!missing.length) continue;

        await storage.updateAgent(agent.gaii, { defaultScopes: [...held, ...missing] });
        changed++;
    }

    if (changed) {
        logger.info('Scope vocabulary migration: existing agents grandfathered onto the new words', {
            agentsUpdated: changed,
            scopes: GRANDFATHERED_SCOPES.join(', '),
        });
    }
    return changed;
}
