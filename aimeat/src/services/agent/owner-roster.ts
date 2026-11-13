/**
 * @file src/services/agent/owner-roster.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The account's own agents, as GET /v1/agents and aimeat_agents_list list them: who may
 *   read the list, the read, and the run-mode filter. Both surfaces call it, so the gate and the filter
 *   are written once (structure programme 2026-11, unit 2b).
 *
 *   WHO. Anyone holding agent:read on the account (the word is asked where each surface checks its
 *   scope: requireRestScope on the route, the catalog entry on the tool). An APP principal also needs
 *   task:read, and only an app principal does, because ?include=stats returns the active tasks the
 *   tasks route refuses an app without that word. An MCP session is an agent, so the tool never meets
 *   that refusal.
 *
 *   THE FILTER. `runMode` keeps the agents whose runMode equals it; an unknown value lists nothing
 *   rather than everything, because a filter that silently does not filter is how a runtime ends up
 *   serving agents it was never meant to.
 * @structure ownerRoster(storage, auth, runMode?) → { agents } | refusal
 * @usage
 *   const roster = await ownerRoster(storage, req.auth!, req.query.run_mode);   // a tool: caller().auth
 *   if (!roster.ok) refuse(roster.code);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/agents/profile-metadata.ts and mcp/core.ts, which each held
 *     the read and the filter (structure programme 2026-11, unit 2b).
 */
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { loadOwnerAgents } from '../db/owner-identity.js';

/** The account's agents the caller may list, filtered by run mode, or the app refusal. */
export async function ownerRoster(
    storage: Storage,
    auth: { owner: string; roles: readonly string[]; scopes?: readonly string[] },
    runMode?: string,
): Promise<{ ok: true; agents: AgentRecord[] } | { ok: false; code: 'APP_NEEDS_TASK_READ' }> {
    if (auth.roles.includes('app') && !scopeIsCovered([...(auth.scopes ?? [])], 'task:read')) {
        return { ok: false, code: 'APP_NEEDS_TASK_READ' };
    }
    const all = await loadOwnerAgents(storage, auth.owner);
    return { ok: true, agents: runMode ? all.filter(a => (a.runMode ?? '') === runMode) : all };
}
