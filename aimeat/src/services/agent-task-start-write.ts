/**
 * @file src/services/agent-task-start-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent's own answer to "may it start work without asking me": set it, and show it.
 *   One implementation behind PATCH /v1/agents/:name/task-start and aimeat_agent_task_start_set, and
 *   one view of it for every surface that lists agents.
 *
 *   NEVER THE AGENT ITSELF. `agent:write` is the word that changes a sibling's mode, run mode and
 *   tags, and this follows it, with one addition: an agent may not set its own. A setting the party
 *   it constrains can loosen is not a setting.
 * @structure setAgentTaskStart() · taskStartView() · scopeUseLookup()
 * @usage
 *   const out = await setAgentTaskStart({ storage, config }, req.auth!.owner, resolve(req), name, req.body?.task_start);
 *   res.json(success(nodeId, { name: out.agent.name, ...taskStartView(out.agent) }));
 * @version-history
 *   v1.1.0 — 2026-10-02 — The view carries the `*` narrowing status (task_start_wildcard), and `'*'`
 *     joins task_start_held_by once it holds the agent.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { AgentRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { resolveAgentTarget, type AgentWriteDeps, type AgentWriteOutcome } from './agent-profile-write.js';
import { agentStartDefault, floorScopesOf } from './agent-task-rules.js';
import { readScopeUse, wildcardStatus, flushScopeUse, type AgentScopeUse, type ScopeUseRecord } from './scope-use.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';

/**
 * How an agent's tasks start, as every list and answer shows it.
 *
 *   task_start          what the owner set: 'automatic', 'confirm', or null (nobody has said)
 *   task_start_effective what applies: the setting, or the one the agent's mode gives
 *   task_start_held_by  the permissions that make every task wait whatever the setting; empty when
 *                       none do, `'*'` among them once the agent's `*` holds it. The switch on the
 *                       agent card reads this to say why it has no effect.
 *   task_start_wildcard for an agent holding `*`: how far its usage record is, what it used, and the
 *                       narrowing its owner can accept with one press (services/scope-use.ts); null
 *                       for every other agent.
 */
export function taskStartView(
    agent: Pick<AgentRecord, 'mode'> & Partial<Pick<AgentRecord, 'taskStart' | 'defaultScopes'>>,
    use?: AgentScopeUse,
): {
    task_start: 'automatic' | 'confirm' | null;
    task_start_effective: 'automatic' | 'confirm';
    task_start_held_by: string[];
    task_start_wildcard: { ready: boolean; days_left: number; since: string | null; used: string[]; proposal: string[] } | null;
} {
    const w = wildcardStatus(agent, use);
    return {
        task_start: agent.taskStart ?? null,
        task_start_effective: agentStartDefault(agent),
        task_start_held_by: floorScopesOf({ ...agent, wildcardReady: w.ready }),
        task_start_wildcard: w.holds ? { ready: w.ready, days_left: w.daysLeft, since: w.since, used: w.used, proposal: w.proposal } : null,
    };
}

/**
 * The usage records a list of agents needs, read once per owner and only when one of them holds `*`.
 * Returns a lookup by agent GAII for taskStartView's second argument.
 */
export async function scopeUseLookup(
    storage: Storage, agents: ReadonlyArray<Pick<AgentRecord, 'gaii' | 'name'> & Partial<Pick<AgentRecord, 'defaultScopes'>>>,
): Promise<(agent: Pick<AgentRecord, 'gaii' | 'name'>) => AgentScopeUse | undefined> {
    const owners = new Set(agents.filter(a => (a.defaultScopes ?? []).includes('*')).map(a => ownerGhiiOf(a.gaii)));
    // The list shows what a `*` agent did a moment ago too: the buffer is written before it is read.
    if (owners.size > 0) await flushScopeUse(storage);
    const records = new Map<string, ScopeUseRecord>();
    for (const owner of owners) records.set(owner, await readScopeUse(storage, owner));
    return (a) => records.get(ownerGhiiOf(a.gaii))?.agents[a.name];
}

/**
 * Set whether `identifier`'s tasks start on their own. `null` goes back to nobody-has-said (the
 * mode decides again); `undefined` is a caller that sent no field and is refused, not read as null.
 */
export async function setAgentTaskStart(
    deps: AgentWriteDeps,
    callerOwner: string,
    callerPrincipal: string,
    identifier: string,
    raw: unknown,
): Promise<AgentWriteOutcome> {
    const gaii = resolveAgentTarget(deps.config, callerOwner, identifier);
    const agent = await deps.storage.getAgent(gaii);
    if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    if (agent.owner !== callerOwner) {
        return { ok: false, code: 'ACCESS_DENIED', message: 'You can only set how the tasks of your own agents start' };
    }
    if (callerPrincipal === gaii) {
        return { ok: false, code: 'ACCESS_DENIED', message: 'An agent cannot change how its own tasks start. Ask the owner, or another of their agents with agent:write.' };
    }
    const clearing = raw === null;
    if (!clearing && raw !== 'automatic' && raw !== 'confirm') {
        return { ok: false, code: 'INVALID_INPUT', message: "task_start must be 'automatic', 'confirm', or null to leave it to the agent's mode" };
    }
    const updated = await deps.storage.updateAgent(gaii, { taskStart: clearing ? null : raw });
    if (!updated) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    emitChange('agents');
    return { ok: true, agent: updated };
}
