/**
 * @file src/services/agent/task-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may give an agent a task, and who may act on a task, with the reads those
 *   questions sit around. The REST task routes (routes/agent-tasks/) and the task tools
 *   (mcp/agent-tasks.ts) both call it, so the two surfaces ask one gate around one read
 *   (structure programme 2026-11, unit 2b).
 *
 *   ACTING ON A TASK (mayActOnTask, the rule routes/agent-tasks.ts called canAccessTask): the owner
 *   in person on a task filed under their own account, or the agent the task is for. An app grant
 *   is deliberately not admitted here; it reads through mayReadTask with task:read. An MCP session
 *   is the agent itself, so for a tool the rule is "the task is mine".
 *
 *   GIVING WORK (taskCreateTarget): the owner in person on their own agent (QA audit 2026-10-16,
 *   S2-03), an agent of the same owner, or a same-owner app grant holding task:write.
 * @structure mayActOnTask(auth, task, nodeId) · mayReadTask(auth, task, nodeId) ·
 *   taskToActOn(deps, auth, taskId) → { task } | refusal ·
 *   taskCreateTarget(deps, auth, agentGaii) → { agent } | refusal
 * @usage
 *   const found = await taskToActOn({ storage, config }, req.auth!, id);   // a tool: caller().auth
 *   if (!found.ok) refuse(found.code);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/agent-tasks.ts (canAccessTask, canReadTask) and the
 *     create route, and from the copies mcp/agent-tasks.ts held (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord, AgentTaskRecord } from '../../storage/interface.js';
import { isOwnerInPerson, mayActOnAgent } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'nodeId'> };

/** The token facts the task gates read. */
export interface TaskAuth {
    sub: string;
    owner?: string;
    roles: readonly string[];
    scopes?: readonly string[];
    federated?: boolean;
}

/** The owner in person on a task filed under their account, or the task's own agent. */
export function mayActOnTask(auth: TaskAuth, task: Pick<AgentTaskRecord, 'ownerGaii' | 'agentGaii'>, nodeId: string): boolean {
    if (isOwnerInPerson(auth)) return task.ownerGaii === `${auth.owner}@${nodeId}`;
    return task.agentGaii === auth.sub;
}

/** mayActOnTask, or a same-owner app grant holding task:read (the detail and events reads only). */
export function mayReadTask(auth: TaskAuth, task: Pick<AgentTaskRecord, 'ownerGaii' | 'agentGaii'>, nodeId: string): boolean {
    if (mayActOnTask(auth, task, nodeId)) return true;
    if (auth.roles.includes('app') && scopeIsCovered([...(auth.scopes ?? [])], 'task:read')) {
        return task.ownerGaii === `${auth.owner}@${nodeId}`;
    }
    return false;
}

/** The task a caller may act on, or why not: it does not exist, or it is not the caller's. */
export async function taskToActOn(
    deps: Deps, auth: TaskAuth, taskId: string,
): Promise<{ ok: true; task: AgentTaskRecord } | { ok: false; code: 'NOT_FOUND' | 'NOT_YOURS' }> {
    const task = await deps.storage.getAgentTask(taskId);
    if (!task) return { ok: false, code: 'NOT_FOUND' };
    if (!mayActOnTask(auth, task, deps.config.nodeId)) return { ok: false, code: 'NOT_YOURS' };
    return { ok: true, task };
}

/** Why a caller may not give an agent work. */
export type TaskCreateRefusal =
    | 'NOT_FOUND'          // no such agent
    | 'NOT_A_GIVER'        // neither the owner in person, an agent, nor an app grant
    | 'NOT_YOURS'          // the owner in person, on another account's agent
    | 'AGENT_OTHER_OWNER'  // an agent, on another owner's agent
    | 'APP_NEEDS_SCOPE'    // an app grant without task:write
    | 'APP_OTHER_OWNER';   // an app grant, on another owner's agent

/** The agent a caller may give a task to, or the refusal. The agent is read first, as the route always did. */
export async function taskCreateTarget(
    deps: Deps, auth: TaskAuth, agentGaii: string,
): Promise<{ ok: true; agent: AgentRecord } | { ok: false; code: TaskCreateRefusal }> {
    const agent = await deps.storage.getAgent(agentGaii);
    if (!agent) return { ok: false, code: 'NOT_FOUND' };
    // Moved unchanged from the create route (routes/agent-tasks/create-read.ts).
    const callerRoles = auth.roles;
    const isOwner = isOwnerInPerson(auth);
    const isAgent = callerRoles.includes('agent');
    const isApp = callerRoles.includes('app');
    if (!isOwner && !isAgent && !isApp) return { ok: false, code: 'NOT_A_GIVER' };
    if (isOwner && !mayActOnAgent(auth, agentGaii, deps.config.nodeId)) return { ok: false, code: 'NOT_YOURS' };
    if (isAgent && agent.owner !== auth.owner) return { ok: false, code: 'AGENT_OTHER_OWNER' };
    if (isApp) {
        if (!scopeIsCovered([...(auth.scopes ?? [])], 'task:write')) return { ok: false, code: 'APP_NEEDS_SCOPE' };
        if (agent.owner !== auth.owner) return { ok: false, code: 'APP_OTHER_OWNER' };
    }
    return { ok: true, agent };
}
