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
 * @structure setAgentTaskStart() · setAgentTaskStartFloor() · taskStartView() · scopeUseLookup()
 * @usage
 *   const out = await setAgentTaskStart({ storage, config }, req.auth!.owner, resolve(req), name, req.body?.task_start);
 *   res.json(success(nodeId, { name: out.agent.name, ...taskStartView(out.agent) }));
 * @version-history
 *   v1.3.0 — 2026-10-23 — setAgentTaskStartFloor (owner in person only) and `task_start_floor_accepted`
 *     in the view: the floor permissions the owner let this agent start work with (Jouni 2026-10-23).
 *   v1.2.0 — 2026-10-18 — `'*'` leaves task_start_held_by: a ready `*` agent is narrowed at its next
 *     start decision instead of being held (services/scope-auto-narrow.ts).
 *   v1.1.0 — 2026-10-02 — The view carries the `*` narrowing status (task_start_wildcard), and `'*'`
 *     joins task_start_held_by once it holds the agent.
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { AgentRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { resolveAgentTarget, type AgentWriteDeps, type AgentWriteOutcome } from './agent-profile-write.js';
import { agentStartDefault, floorScopesOf, acceptedFloorOf, TASK_START_FLOOR } from './agent-task-rules.js';
import { readScopeUse, wildcardStatus, flushScopeUse, type AgentScopeUse, type ScopeUseRecord } from './scope-use.js';
import type { Storage } from '../storage/interface.js';
import { ownerGhiiOf } from '../utils/gaii.js';

/**
 * How an agent's tasks start, as every list and answer shows it.
 *
 *   task_start          what the owner set: 'automatic', 'confirm', or null (nobody has said)
 *   task_start_effective what applies: the setting, or the one the agent's mode gives
 *   task_start_held_by  the permissions that make every task wait whatever the setting; empty when
 *                       none do. Read from the words the agent holds by name: `*` is never among
 *                       them, because a ready `*` agent is narrowed at its next start decision
 *                       (services/scope-auto-narrow.ts). The switch on the agent card reads this to
 *                       say why it has no effect.
 *   task_start_wildcard for an agent holding `*`: how far its usage record is, what it used, and the
 *                       narrowing the node makes when the record is ready, which the owner can also
 *                       accept now with one press (services/scope-use.ts); null for every other agent.
 *   task_start_floor_accepted the floor permissions the owner in person accepted for this agent and it
 *                       holds: they no longer hold its tasks (agent-task-rules.ts acceptedFloorOf).
 */
export function taskStartView(
    agent: Pick<AgentRecord, 'mode'> & Partial<Pick<AgentRecord, 'taskStart' | 'defaultScopes' | 'taskStartFloor'>>,
    use?: AgentScopeUse,
): {
    task_start: 'automatic' | 'confirm' | null;
    task_start_effective: 'automatic' | 'confirm';
    task_start_held_by: string[];
    task_start_floor_accepted: string[];
    task_start_wildcard: { ready: boolean; days_left: number; since: string | null; used: string[]; proposal: string[] } | null;
} {
    const w = wildcardStatus(agent, use);
    return {
        task_start: agent.taskStart ?? null,
        task_start_effective: agentStartDefault(agent),
        task_start_held_by: floorScopesOf(agent),
        task_start_floor_accepted: acceptedFloorOf(agent),
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

/**
 * Set the floor permissions `identifier` may start work with (`taskStartFloor`): a list of words from
 * TASK_START_FLOOR, or `null` / `[]` for none. The list replaces the stored one.
 *
 * THE OWNER IN PERSON ONLY (`ownerInPerson`, utils/gaii.ts isOwnerInPerson): not an agent, not an
 * app, not a visitor. Lifting the floor is the same act as pressing Start on a task the floor held,
 * which only the owner in person may do (agent-task-rules.ts mayStartWaitingTask), so no MCP tool
 * and no agent may set it. A word that is not on the floor is refused rather than stored, so the
 * list never claims more than it does. A word the agent does not hold yet is stored and takes effect
 * if the agent is granted it: the owner named it.
 */
export async function setAgentTaskStartFloor(
    deps: AgentWriteDeps,
    callerOwner: string,
    ownerInPerson: boolean,
    identifier: string,
    raw: unknown,
): Promise<AgentWriteOutcome> {
    if (!ownerInPerson) {
        return { ok: false, code: 'ACCESS_DENIED', message: 'Only the owner, signed in themselves, can let an agent start work with these permissions.' };
    }
    const gaii = resolveAgentTarget(deps.config, callerOwner, identifier);
    const agent = await deps.storage.getAgent(gaii);
    if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    if (agent.owner !== callerOwner) {
        return { ok: false, code: 'ACCESS_DENIED', message: 'You can only set how the tasks of your own agents start' };
    }
    const floorWords = TASK_START_FLOOR.map(f => f.scope);
    if (raw !== null && !(Array.isArray(raw) && raw.every(w => typeof w === 'string'))) {
        return { ok: false, code: 'INVALID_INPUT', message: `task_start_floor must be a list of permissions from: ${floorWords.join(', ')}; or null for none` };
    }
    const words = [...new Set((raw ?? []) as string[])];
    const unknown = words.filter(w => !floorWords.includes(w));
    if (unknown.length > 0) {
        return { ok: false, code: 'INVALID_INPUT', message: `Not a permission that holds tasks: ${unknown.join(', ')}. Allowed: ${floorWords.join(', ')}` };
    }
    const updated = await deps.storage.updateAgent(gaii, { taskStartFloor: words.length ? words : null });
    if (!updated) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    emitChange('agents');
    return { ok: true, agent: updated };
}
