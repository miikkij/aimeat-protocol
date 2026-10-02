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
 * @structure setAgentTaskStart() · taskStartView()
 * @usage
 *   const out = await setAgentTaskStart({ storage, config }, req.auth!.owner, resolve(req), name, req.body?.task_start);
 *   res.json(success(nodeId, { name: out.agent.name, ...taskStartView(out.agent) }));
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { AgentRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { resolveAgentTarget, type AgentWriteDeps, type AgentWriteOutcome } from './agent-profile-write.js';
import { agentStartDefault, floorScopesOf } from './agent-task-rules.js';

/**
 * How an agent's tasks start, as every list and answer shows it.
 *
 *   task_start          what the owner set: 'automatic', 'confirm', or null (nobody has said)
 *   task_start_effective what applies: the setting, or the one the agent's mode gives
 *   task_start_held_by  the permissions that make every task wait whatever the setting; empty when
 *                       none do. The switch on the agent card reads this to say why it has no effect.
 */
export function taskStartView(agent: Pick<AgentRecord, 'mode'> & Partial<Pick<AgentRecord, 'taskStart' | 'defaultScopes'>>): {
    task_start: 'automatic' | 'confirm' | null;
    task_start_effective: 'automatic' | 'confirm';
    task_start_held_by: string[];
} {
    return {
        task_start: agent.taskStart ?? null,
        task_start_effective: agentStartDefault(agent),
        task_start_held_by: floorScopesOf(agent),
    };
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
