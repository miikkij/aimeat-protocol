/**
 * @file src/services/place-agent-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On a node the store sold (site.purchase_plan set), an agent has the place's tools by
 *   default: every permission word a tool on this node asks for, except the words the owner keeps.
 *   Jouni, 2026-11-02 07.42 and 09.08 (via the Chief of Staff): "anna sille täyspääsy", so a run does not
 *   fail on a refused tool call; security, secrets, payments, sharing and permission changes stay with
 *   the owner (the help's sentence he accepted on 1.11 at 13.50). On crew64 a morning digest's run failed
 *   whole because one call (notify) was refused for a word its agent did not hold.
 *
 *   THE OWNER KEEPS three kinds of word. First, every word no wildcard carries (SCOPES_OUTSIDE_WILDCARD,
 *   utils/scope-coverage.ts): account security, secrets, payment credentials, permission changes,
 *   sharing groups and shares, the as-owner reads, MCP management, publishing to the internet, operator
 *   and compliance words. Second, every word on the task start floor (TASK_START_FLOOR,
 *   services/agent-task-rules.ts), read from that list so the two cannot drift: an agent holding one
 *   never starts a task by itself, so a default that held one left every scheduled run queued for the
 *   owner (crew76 on guestkoey3wfwk, 2.11; Jouni's option A, 10.25). The owner gives one per agent.
 *   Third, PLACE_OWNER_KEEPS below: words a wildcard carries that belong to the same five areas.
 *   aimeat_app_tool_invoke asks exchange:invoke, which is in the default; exchange:write, which opens a
 *   paid contract, is on the floor.
 *
 *   IN THE RECORD, ONCE, AT APPROVAL. Jouni, 2026-11-05 (codebase analysis 2026-11-03, decision 8b):
 *   the words go into the agent's own `defaultScopes` when it is approved, and a token mint copies the
 *   record and adds nothing. Two places give them:
 *   - applyPlaceDefault, at each door that approves a new agent: device authorization
 *     (routes/agents/device-auth-approve.ts, bounded by an approving agent's own scopes), POST
 *     /v1/agents and its import, the approval of an agent proposal, the basic agents button and the
 *     web identity proof's app agent. The list it answers is the list the door stores.
 *   - givePlaceDefaultToEveryAgent, the step for the agents that already exist: at every start of a
 *     store place (server-bootstrap/once-only-keep-steps.ts) and when `site.purchase_plan` is set while
 *     the node runs (services/config-apply.ts, the Consul import and watch). One write of
 *     PLACE_DEFAULT_KEY claims every agent that has not had the default, so of two processes starting
 *     together each agent is claimed by one; that one adds the words to the list it read
 *     (services/scope-list-swap.ts), which only adds, and tells the agent's live connector to fetch a
 *     fresh token (crew77 on guestkoey3wfwk, 2.11: without the frame a connector kept its old words for
 *     up to an hour). An agent that had the default is passed over at every later start, so the step
 *     runs once per agent.
 *   PLACE_DEFAULT_KEY remembers the agents that had it, so a word the owner takes away afterwards stays
 *   away: the owner's own narrowing is the decision that counts. The door's intersection of token and
 *   record (auth/effective-scopes.ts) is unchanged. Elsewhere (no purchase plan) nothing is read and
 *   nothing is written.
 * @structure PLACE_OWNER_KEEPS · PLACE_PLAN_PATH · placeAgentScopes(config) ·
 *   applyPlaceDefault(storage, config, gaii, held, within?) · givePlaceDefaultToEveryAgent(storage, config) ·
 *   placeDefaultAfterSettings(storage, config, paths)
 * @usage defaultScopes: await applyPlaceDefault(storage, config, gaii, requested)   // a door that approves
 *   await givePlaceDefaultToEveryAgent(storage, config)                             // the boot step
 * @version-history
 *   2026-11-05 — The default is given at approval and to every existing agent by givePlaceDefaultToEveryAgent
 *     (at start and when the plan is set); widenForPlace, the mint's widening, is removed (codebase
 *     analysis 2026-11-03, decision 8b of 2026-11-05).
 *   2026-11-02 — applyPlaceDefault takes `within`, the approving agent's scopes: an agent another agent
 *     approves gets the place's words its approver holds, at approval and once, and no more at its first
 *     mint (secaudit2026nov02d round 13, place-agent-scopes/agent-approved-sibling-widened-at-first-mint).
 *   v1.2.0 — 2026-11-02 — Enrolment applies the default, and the routes announce a widening to the live connector (crew77).
 *   v1.1.0 — 2026-11-02 — The default leaves out every task start floor word, and carries exchange:invoke (Jouni, 10.25).
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { TOOL_SCOPES } from '../tool-catalog/scopes.js';
import { exceedsCeiling, isOutsideWildcard, scopeIsCovered } from '../utils/scope-coverage.js';
import { TASK_START_FLOOR } from './agent-task-rules.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { changeScopeList } from './scope-list-swap.js';
import { isSharedAnonymous } from './rest-scope-gates-migration.js';
import { emitToolListChanged } from './resource-events.js';
import { nodeContext } from './node-context.js';
import { logger } from '../utils/logger.js';

/** The setting that makes a node a store place. */
export const PLACE_PLAN_PATH = 'site.purchase_plan';

/** Words a wildcard carries that the owner keeps on a store place: payments, sharing, permission changes. */
export const PLACE_OWNER_KEEPS: readonly string[] = [
    'agent:write',            // approve a new agent, or another agent's device
    'commerce:sell',          // put something on sale in the owner's name
    'exchange:beneficiary',   // say where the owner's earnings are paid
    'organism:invite',        // bring a person into the owner's shared places
    'consent:manage',         // let someone else read the owner's data
];

/** The record under `system@<nodeId>` that names the agents that have had the place's default. */
const PLACE_DEFAULT_KEY = 'place.agent-default-applied';

/** The words an agent has by default on a store place, or null elsewhere. */
export function placeAgentScopes(config: AimeatConfig): string[] | null {
    if (!(config.siteLinks?.purchasePlan ?? '').trim()) return null;
    const floor = new Set(TASK_START_FLOOR.map(f => f.scope));
    const words = new Set<string>();
    for (const list of Object.values(TOOL_SCOPES)) {
        for (const w of [list].flat()) {
            if (typeof w === 'string' && w && !isOutsideWildcard(w) && !floor.has(w) && !PLACE_OWNER_KEEPS.includes(w)) words.add(w);
        }
    }
    // The operator's ceiling on what an agent may hold (scopes.max_agent_scopes) still holds.
    const over = new Set(config.maxAgentScopes?.length ? exceedsCeiling(config.maxAgentScopes, [...words]) : []);
    return [...words].filter(w => !over.has(w)).sort();
}

const parseApplied = (v: unknown): Record<string, string> =>
    (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {});

/**
 * `held` with the place's default added, the first time this agent is approved; `held` as it is off a
 * store place and every later time. A record that cannot be read or written leaves `held`, so a failure
 * never widens anything; the step at the next start gives the default to an agent never marked.
 *
 * `within`: the scopes of the AGENT that approves this one (routes/agents/device-auth-approve.ts). Only
 * the place's words that list covers are added, and the agent is marked as having had its default, so
 * its later mints add nothing beyond the approver's bound. Without the mark at approval the full
 * default arrived at the agent's first mint (secaudit2026nov02d round 13,
 * place-agent-scopes/agent-approved-sibling-widened-at-first-mint).
 */
export async function applyPlaceDefault(
    storage: Storage, config: AimeatConfig, gaii: string, held: readonly string[], within?: readonly string[],
): Promise<string[]> {
    const place = placeAgentScopes(config);
    if (!place) return [...held];
    let first = false;
    try {
        await updateRecord(storage, `system@${config.nodeId}`, PLACE_DEFAULT_KEY, parseApplied, (cur) => {
            first = !cur[gaii];
            return first ? { ...cur, [gaii]: new Date().toISOString() } : UNCHANGED;
        }, { tag: PLACE_DEFAULT_KEY });
    } catch (err) {
        logger.warn(`[place-scopes] ${gaii}: the place's default was not applied: ${(err as Error).message}`);
        return [...held];
    }
    if (!first) return [...held];
    const out = [...held];
    for (const w of place) if (!scopeIsCovered(out, w) && (!within || scopeIsCovered(within, w))) out.push(w);
    return out;
}

/** The place's words `held` lacks, in the place's order. */
function missingPlaceWords(place: readonly string[], held: readonly string[]): string[] {
    const out = [...held];
    for (const w of place) if (!scopeIsCovered(out, w)) out.push(w);
    return out.slice(held.length);
}

/** The words a store place's step gave, per agent; `ran` is false off a store place. */
export interface PlaceDefaultStepResult { ran: boolean; agents: string[]; failed: string[] }

/**
 * The store place's default to every agent that has not had it: the agents that existed before this
 * version, and the ones made while no plan was set. Off a store place it reads and writes nothing.
 *
 * One write of PLACE_DEFAULT_KEY claims every agent not yet in it (record-cas.ts: on a conflict it is
 * read again), so of two processes starting together each agent is claimed by exactly one. The claimer
 * adds the missing words to the list it read and writes them only over that list
 * (scope-list-swap.ts), so a word the owner set meanwhile stays. An agent with no recorded list gets
 * the words as its list, as its first token mint gave them before 2026-11-05. Anonymous mode's shared
 * agent is left alone: anyone may hold it, and its words are fixed (auth/anonymous-scopes.ts). An
 * agent whose list could not be written loses its claim again, so the next start tries it again.
 * Never adds a word the agent held, never removes one.
 */
export async function givePlaceDefaultToEveryAgent(storage: Storage, config: AimeatConfig): Promise<PlaceDefaultStepResult> {
    const result: PlaceDefaultStepResult = { ran: false, agents: [], failed: [] };
    const place = placeAgentScopes(config);
    if (!place) return result;
    result.ran = true;
    const agents = (await storage.listAgents()).filter(a => !isSharedAnonymous(a.owner));
    if (agents.length === 0) return result;
    const system = `system@${config.nodeId}`;
    const at = new Date().toISOString();
    let claimed: string[] = [];
    await updateRecord(storage, system, PLACE_DEFAULT_KEY, parseApplied, (cur) => {
        claimed = agents.map(a => a.gaii).filter(g => !cur[g]);
        if (claimed.length === 0) return UNCHANGED;
        const next = { ...cur };
        for (const g of claimed) next[g] = at;
        return next;
    }, { tag: PLACE_DEFAULT_KEY });

    const byGaii = new Map<string, AgentRecord>(agents.map(a => [a.gaii, a]));
    for (const gaii of claimed) {
        const agent = byGaii.get(gaii);
        if (!agent) continue;
        try {
            let added = false;
            if (Array.isArray(agent.defaultScopes)) {
                added = !!await changeScopeList(storage, { kind: 'agent', id: gaii }, agent.defaultScopes, (held) => {
                    const missing = missingPlaceWords(place, held);
                    return missing.length ? [...held, ...missing] : null;
                });
            } else if (place.length > 0) {
                await storage.updateAgent(gaii, { defaultScopes: [...place] });
                added = true;
            }
            if (!added) continue;
            result.agents.push(gaii);
            // The agent's open MCP sessions list the tools of its old words, and a live connector calls
            // with the token it attached with: both are told, as routes/agents/announce-scopes.ts does.
            emitToolListChanged(gaii);
            nodeContext().tunnel?.notifyScopesChanged(gaii);
        } catch (err) {
            result.failed.push(gaii);
            logger.warn(`[place-scopes] ${gaii}: the place's default could not be written; the next start tries again: ${(err as Error).message}`);
        }
    }
    if (result.failed.length > 0) {
        const failed = new Set(result.failed);
        await updateRecord(storage, system, PLACE_DEFAULT_KEY, parseApplied, (cur) => {
            if (!result.failed.some(g => cur[g])) return UNCHANGED;
            return Object.fromEntries(Object.entries(cur).filter(([g]) => !failed.has(g)));
        }, { tag: PLACE_DEFAULT_KEY }).catch((err: unknown) => logger.warn(`[place-scopes] the claims of ${failed.size} agent(s) were not given back: ${String(err)}`));
    }
    if (result.agents.length > 0) {
        logger.info(`[place-scopes] the store place's default given to ${result.agents.length} agent(s)`, { agents: result.agents });
    }
    return result;
}

/**
 * Run givePlaceDefaultToEveryAgent when `paths`, the settings a running node has just applied, include
 * the purchase plan. Never throws: a failure is logged and the next start runs the step.
 */
export async function placeDefaultAfterSettings(storage: Storage, config: AimeatConfig, paths: readonly string[]): Promise<void> {
    if (!paths.includes(PLACE_PLAN_PATH)) return;
    await givePlaceDefaultToEveryAgent(storage, config).catch((err: unknown) =>
        logger.error('[place-scopes] the store place\'s default was not given to the existing agents; the next start tries again', { error: String(err) }));
}
