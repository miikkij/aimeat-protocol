/**
 * @file src/services/agents/sibling-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The task list of ANOTHER agent of the same owner, for an agent caller: what
 *   aimeat_task_list answers with target_agent_name.
 *
 *   The rule is services/agent/task-rules.ts mayManageSiblingTasks (task:read and agent:write),
 *   the one GET /v1/agents/:name/tasks applies to a sibling. The read is fenced by the owner's GHII,
 *   so a name that resolves to another account's agent finds nothing.
 * @structure SiblingTasksRefusal · listSiblingTasks()
 * @usage
 *   const out = await listSiblingTasks({ storage, config }, startCaller, 'worker', { status, page, perPage });
 *   if (!out.ok) return toolError(out.code, out.message);
 * @version-history
 *   v1.0.0 — 2026-11-12 — Initial (wish-the-owner-s-ai-can-remove-an-agent-end-its-task-and-delete-a).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord } from '../../storage/interface.js';
import { buildGAII, localAccountName, ownerGhiiOf } from '../../utils/gaii.js';
import { mayManageSiblingTasks, type StartCaller } from '../agent/task-rules.js';

export interface SiblingTasksRefusal { ok: false; status: number; code: string; message: string }

/** One page of the tasks of the agent `targetName` in the caller's own account. */
export async function listSiblingTasks(
    deps: { storage: Storage; config: AimeatConfig },
    caller: StartCaller,
    targetName: string,
    opts: { status?: string; page: number; perPage: number },
): Promise<{ ok: true; agentGaii: string; tasks: AgentTaskRecord[]; total: number } | SiblingTasksRefusal> {
    const { storage, config } = deps;
    const account = localAccountName(caller.principal);
    const agentGaii = buildGAII(targetName, account, config.nodeId);
    if (!mayManageSiblingTasks(caller, agentGaii, 'task:read')) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED',
            message: "Reading another agent's tasks needs the permissions task:read and agent:write. Without target_agent_name this lists your own tasks." };
    }
    if (!await storage.getAgent(agentGaii)) {
        return { ok: false, status: 404, code: 'NOT_FOUND',
            message: `Agent '${targetName}' not found under owner '${account}'. aimeat_agents_list names the owner's agents.` };
    }
    const r = await storage.listAgentTasksByOwner(ownerGhiiOf(caller.principal), { agentGaii, status: opts.status, page: opts.page, perPage: opts.perPage });
    return { ok: true, agentGaii, tasks: r.tasks, total: r.total };
}
