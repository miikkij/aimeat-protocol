/**
 * @file src/services/agent/narrow-own-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Narrowing one of an account's own agents by name: the agent is looked up among the
 *   account's agents only (so a name never reaches another account's agent), then
 *   services/scope-narrowing.ts narrowAgent replaces its `*` with what it used. POST
 *   /v1/agents/:name/scope-narrowing and aimeat_agent_scope_narrow both call it, so the two surfaces
 *   ask one lookup and one ownership rule (structure programme 2026-11, unit 2b).
 * @structure narrowOwnAgent(storage, nodeId, owner, name) → NarrowOutcome
 * @usage const out = await narrowOwnAgent(storage, config.nodeId, req.auth!.owner, req.params.name);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/agents/management.ts and mcp/agent-tasks.ts, which each
 *     held the lookup (structure programme 2026-11, unit 2b).
 */
import type { Storage } from '../../storage/interface.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { narrowAgent, type NarrowOutcome } from '../scope-narrowing.js';

/** Narrow the agent named `name` among `owner`'s own agents; NOT_FOUND when the account has none by that name. */
export async function narrowOwnAgent(storage: Storage, nodeId: string, owner: string, name: string): Promise<NarrowOutcome> {
    const agent = (await loadOwnerAgents(storage, owner)).find(a => a.name === name) ?? null;
    return narrowAgent(storage, `${owner}@${nodeId}`, agent);
}
