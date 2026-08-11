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
 *   v1.1.0 — 2026-08-11 — CONDITIONAL_SCOPES: a word handed only to agents already holding the
 *     one it replaces. The four beneficiary tools moved from commerce:sell to the word REST
 *     always required, and that must not widen anyone's reach.
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
 * Words granted only to agents that ALREADY hold the word they are replacing.
 *
 * The four beneficiary tools asked for commerce:sell on the tool surface and exchange:beneficiary on
 * the HTTP one — not stricter or looser, simply not the same gate, so an owner who withheld
 * exchange:beneficiary still had an agent that could give away their revenue, and an agent granted
 * exchange:beneficiary could not see the tools at all. Aligning the tools to the REST word would
 * silently remove them from every selling agent, so the word is handed to exactly the agents that
 * could already reach those tools and to nobody else. That preserves the reach they had; it does not
 * hand a money-moving permission to an agent that never had it.
 */
export const CONDITIONAL_SCOPES: ReadonlyArray<{ grant: string; when: string; why: string }> = [
    {
        grant: 'exchange:beneficiary',
        when: 'commerce:sell',
        why: 'the four beneficiary tools moved from commerce:sell to the word REST already required',
    },
];

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

        const missing: string[] = GRANDFATHERED_SCOPES.filter(s => !held.includes(s));
        for (const c of CONDITIONAL_SCOPES) {
            if (held.includes(c.when) && !held.includes(c.grant)) missing.push(c.grant);
        }
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
