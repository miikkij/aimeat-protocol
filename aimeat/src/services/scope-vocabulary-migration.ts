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
 *   WHAT MUST NEVER GO IN HERE. A word that names a capability agents did NOT already have. The
 *   lists below exist to preserve reach, never to hand out new reach, and the difference is easy to
 *   lose because both look like "add a string". `account:security` (utils/scope-coverage.ts) is the
 *   worked example: it gates the password, the recovery address, the second factor and account
 *   deletion, no agent could reach those before it existed, so it appears in NEITHER list and no
 *   wildcard carries it. An owner ticks it per agent or no agent has it.
 * @structure GRANDFATHERED_SCOPES · CONDITIONAL_SCOPES · migrateAgentScopeVocabulary(storage) →
 *   how many agents changed
 * @usage
 *   // fire-and-forget at boot, after storage is ready
 *   migrateAgentScopeVocabulary(storage).catch(err => logger.error(…));
 * @version-history
 *   v1.4.0 — 2026-08-14 — SECURITY: a conditional grant is decided from the OWNER-granted scopes, not
 *     from a set this migration had already widened. agent:permissions is conditional on agent:write,
 *     which is itself grandfathered, so the second boot handed every agent on the node the one word
 *     that lets an agent rewrite its own permissions — a word kept out of every wildcard for exactly
 *     that reason. Found by test/e2e-organism-scope-gate.ts asking whether a second run changes
 *     anything; it changed two agents out of three.
 *   v1.3.0 — 2026-08-14 — organism:write now gates three HTTP doors as well as the tools, so the
 *     entry for it says what removing it would cost. No conditional entry was added: this list
 *     already hands the word to every agent that has a scope list, and `*` covers it at the door, so
 *     one would have been dead code that read like a safeguard. An agent with NO recorded scope list
 *     is now counted and warned about instead of skipped in silence.
 *   v1.2.0 — 2026-08-11 — Says in writing that account:security is in neither list, and why a word
 *     that names NEW reach never belongs in either. Nothing executable changed.
 *   v1.1.0 — 2026-08-11 — CONDITIONAL_SCOPES: a word handed only to agents already holding the
 *     one it replaces. The four beneficiary tools moved from commerce:sell to the word REST
 *     always required, and that must not widen anyone's reach.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3a: the vocabulary, and not breaking anyone).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';

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
 *
 * organism:write NOW ALSO CARRIES THREE HTTP DOORS, as of 2026-08-14: POST /v1/organisms, POST
 * /v1/organisms/:id/workspaces and POST /v1/organisms/:id/comments. Until then all three used
 * requireRoleOrScope('agent', 'organism:write'), whose role path admitted every agent before it read
 * a scope, so the word bound the MCP tool surface and nothing else. Tightening them to requireScope
 * is safe only because the word is already in this list: taking it out would not merely rename a
 * permission, it would stop every agent on the node from creating an organism. There is deliberately
 * NO conditional entry for it below — a conditional grant would be dead code here, because this list
 * hands the word to every agent with a recorded scope list and `*` covers it at the door.
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
    // The five words added on 2026-08-11 that no wildcard carries. Each names a call the web door
    // reserves to a logged-in person; the agent keeps the door and pays an explicit tick for it.
    // Granted here to exactly the agents that could already reach the tool, and to nobody else.
    { grant: 'commerce:psp', when: 'commerce:sell', why: 'aimeat_commerce_psp_set / _delete' },
    { grant: 'commerce:beneficiary-verify', when: 'wallet:read', why: 'aimeat_commerce_beneficiary_approve' },
    { grant: 'agent:permissions', when: 'agent:write', why: 'aimeat_operator_agent_configure' },
    { grant: 'consent:groups', when: 'consent:manage', why: 'aimeat_group_create / _add_member / _remove_member' },
    { grant: 'social:members', when: 'social:write', why: 'aimeat_board_members' },
];

/**
 * Add the new words to every agent that does not already hold them. Idempotent: a second run finds
 * nothing to do. Returns the number of agents actually updated, for the boot log.
 */
export async function migrateAgentScopeVocabulary(storage: Storage): Promise<number> {
    const agents = await storage.listAgents();
    let changed = 0;
    let noScopeList = 0;

    for (const agent of agents) {
        const held = agent.defaultScopes;
        // No recorded scopes at all: nothing to grandfather. An agent with none is minted from
        // config.defaultAgentScopes, which is a separate decision — and writing a list here would
        // REPLACE that fallback rather than extend it, narrowing the agent to whatever this file
        // happens to name. Counted instead, because it is a real population with a real consequence
        // (see the warning below) and it was previously invisible.
        if (!Array.isArray(held)) { noScopeList++; continue; }

        // The grandfathered words ride inside a wildcard already, so a '*' agent needs none of them.
        const missing: string[] = held.includes('*')
            ? []
            : GRANDFATHERED_SCOPES.filter(s => !held.includes(s));

        // A conditional grant asks "did the OWNER already give this agent the word it depends on?",
        // and the answer has to come from what the owner granted — never from a word this migration
        // itself wrote on an earlier boot. Read literally, `held` mixes the two, and one pair
        // overlaps: agent:write is GRANDFATHERED and agent:permissions is conditional on it. That
        // handed agent:permissions — a word deliberately outside every wildcard, because it lets an
        // agent rewrite its own permissions — to EVERY agent on the node, on the second boot, in
        // silence. This runs on every boot, so "it only happens once" was never true of anything
        // here. Testing coverage against the owner-granted set makes the answer the same on run one
        // and run fifty. A '*' agent still gets these words written out, which is the whole point of
        // the list — they sit OUTSIDE every wildcard, so a '*' agent would silently lose a tool it
        // uses today. The filter does not touch that: '*' is not a grandfathered word, so it survives
        // and still confers every 'when'.
        const ownerGranted = held.filter(s => !(GRANDFATHERED_SCOPES as readonly string[]).includes(s));
        for (const c of CONDITIONAL_SCOPES) {
            if (scopeIsCovered(ownerGranted, c.when) && !held.includes(c.grant)) missing.push(c.grant);
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
    if (noScopeList) {
        // These agents keep whatever config.defaultAgentScopes says, which names none of the words
        // above. Every gate that now asks for one of them refuses this agent, and the owner's only
        // fix is to set its scopes explicitly in the agent editor. Say so out loud rather than
        // leaving the population to be discovered by a support ticket.
        logger.warn('Scope vocabulary migration: agents with no recorded scope list were left alone', {
            agents: noScopeList,
            effect: 'they fall back to config.defaultAgentScopes, which carries none of these words',
        });
    }
    return changed;
}
