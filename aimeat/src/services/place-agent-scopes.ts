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
 *   THE OWNER KEEPS two kinds of word. First, every word no wildcard carries (SCOPES_OUTSIDE_WILDCARD,
 *   utils/scope-coverage.ts): account security, secrets, payment credentials, permission changes,
 *   sharing groups and shares, the as-owner reads, MCP management, publishing to the internet, operator
 *   and compliance words. Second, PLACE_OWNER_KEEPS below: words a wildcard carries that belong to the
 *   same five areas. `exchange:write` is among them although aimeat_app_tool_invoke asks for it: the one
 *   word also accepts a metered contract that spends money, so calling an app tool needs the owner's
 *   grant until the two are separate words.
 *
 *   IN THE RECORD, ONCE. The words go into the agent's own `defaultScopes` the first time it is approved
 *   or gets a token here (routes/agents/device-auth-approve.ts, routes/auth.ts), so the Agents tab shows
 *   what it may do. PLACE_DEFAULT_KEY remembers the agents that had it, so a word the owner takes away
 *   afterwards stays away: the owner's own narrowing is the decision that counts. The door's intersection
 *   of token and record (auth/effective-scopes.ts) is unchanged. Elsewhere nothing changes.
 * @structure PLACE_OWNER_KEEPS · placeAgentScopes(config) · applyPlaceDefault(storage, config, gaii, held) ·
 *   widenForPlace(storage, config, agent)
 * @usage const scopes = await widenForPlace(storage, config, agent); // then mint with scopes
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { TOOL_SCOPES } from '../tool-catalog/scopes.js';
import { exceedsCeiling, isOutsideWildcard, scopeIsCovered } from '../utils/scope-coverage.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { logger } from '../utils/logger.js';

/** Words a wildcard carries that the owner keeps on a store place: payments, sharing, permission changes. */
export const PLACE_OWNER_KEEPS: readonly string[] = [
    'agent:write',            // approve a new agent, or another agent's device
    'commerce:buy',           // spend the owner's money
    'commerce:sell',          // put something on sale in the owner's name
    'exchange:write',         // accept a metered contract, which spends money, and sell a data package
    'exchange:beneficiary',   // say where the owner's earnings are paid
    'organism:invite',        // bring a person into the owner's shared places
    'consent:manage',         // let someone else read the owner's data
];

/** The record under `system@<nodeId>` that names the agents that have had the place's default. */
const PLACE_DEFAULT_KEY = 'place.agent-default-applied';

/** The words an agent has by default on a store place, or null elsewhere. */
export function placeAgentScopes(config: AimeatConfig): string[] | null {
    if (!(config.siteLinks?.purchasePlan ?? '').trim()) return null;
    const words = new Set<string>();
    for (const list of Object.values(TOOL_SCOPES)) {
        for (const w of [list].flat()) {
            if (typeof w === 'string' && w && !isOutsideWildcard(w) && !PLACE_OWNER_KEEPS.includes(w)) words.add(w);
        }
    }
    // The operator's ceiling on what an agent may hold (scopes.max_agent_scopes) still holds.
    const over = new Set(config.maxAgentScopes?.length ? exceedsCeiling(config.maxAgentScopes, [...words]) : []);
    return [...words].filter(w => !over.has(w)).sort();
}

const parseApplied = (v: unknown): Record<string, string> =>
    (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, string> : {});

/**
 * `held` with the place's default added, the first time this agent asks; `held` as it is off a store
 * place and every later time. A record that cannot be read or written leaves `held`, so a failure never
 * widens anything and the next sign-in tries again.
 */
export async function applyPlaceDefault(storage: Storage, config: AimeatConfig, gaii: string, held: readonly string[]): Promise<string[]> {
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
    for (const w of place) if (!scopeIsCovered(out, w)) out.push(w);
    return out;
}

/**
 * The agent's scopes for a token about to be minted: the place's default on its first time, written to
 * its record so the token and the record agree. Never throws: a failed write leaves it on what it held.
 */
export async function widenForPlace(storage: Storage, config: AimeatConfig, agent: AgentRecord): Promise<string[]> {
    const held = agent.defaultScopes ?? [];
    const next = await applyPlaceDefault(storage, config, agent.gaii, held);
    if (next.length === held.length) return held;
    try {
        await storage.updateAgent(agent.gaii, { defaultScopes: next });
        logger.info(`[place-scopes] ${agent.gaii}: ${next.length - held.length} word(s) added, the store place's default`);
        return next;
    } catch (err) {
        logger.warn(`[place-scopes] ${agent.gaii}: the place's default could not be written: ${(err as Error).message}`);
        return held;
    }
}
