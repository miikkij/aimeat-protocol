/**
 * @file src/services/agent/narrow-own-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Narrowing one of an account's own agents by name: the agent is looked up among the
 *   account's agents only (so a name never reaches another account's agent), then
 *   services/scope/narrowing.ts narrowAgent replaces its `*` with what it used. POST
 *   /v1/agents/:name/scope-narrowing and aimeat_agent_scope_narrow both call it, so the two surfaces
 *   ask one lookup and one ownership rule (structure programme 2026-11, unit 2b).
 *
 *   A REQUIRED OPERATOR SERVICE'S AGENT is not narrowed here: the narrowing could drop a word the
 *   entry gave that the agent has not used yet, which is the operator's to decide
 *   (services/operator-services/required.ts). The person can still take back a `*` they added
 *   themselves through PATCH /v1/agents/:name/scopes, which keeps the entry's words.
 * @structure narrowOwnAgent(storage, config, owner, name) → NarrowOutcome
 * @usage const out = await narrowOwnAgent(storage, config, req.auth!.owner, req.params.name);
 * @version-history
 *   v1.1.0 — 2026-11-26 — Takes the config and refuses a required operator service's agent with
 *     OPERATOR_SERVICE_REQUIRED (operator services phase 2).
 *   v1.0.0 — 2026-11-13 — Moved from routes/agents/management.ts and mcp/agent-tasks.ts, which each
 *     held the lookup (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { narrowAgent, type NarrowOutcome } from '../scope/narrowing.js';
import { requiredAgentRefusal } from '../operator-services/required.js';

/** Narrow the agent named `name` among `owner`'s own agents; NOT_FOUND when the account has none by that name. */
export async function narrowOwnAgent(storage: Storage, config: AimeatConfig, owner: string, name: string):
    Promise<NarrowOutcome | { ok: false; code: 'OPERATOR_SERVICE_REQUIRED'; message: string }> {
    const agent = (await loadOwnerAgents(storage, owner)).find(a => a.name === name) ?? null;
    if (agent) {
        const refused = await requiredAgentRefusal(storage, config, agent.gaii, 'narrowing it to what it used');
        if (refused) return { ok: false, code: refused.code, message: refused.message };
    }
    return narrowAgent(storage, `${owner}@${config.nodeId}`, agent);
}
