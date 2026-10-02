/**
 * @file src/services/task-start-op.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Starting a task: one implementation behind POST /v1/agents/:name/tasks/:id/start and
 *   the aimeat_task_start MCP tool.
 *
 *   WHO MAY START. The owner in person and a same-owner app holding task:write: any queued, paused or
 *   stalled task of the owner's. Another of the owner's agents holding task:write (the person's own
 *   chat AI, acting on their word): only a QUEUED task, never its own (the propose-before-start rule),
 *   and never one held by the permission floor or by a plan that declared it will spend, send or
 *   delete as the owner (services/agent-task-rules.ts mayStartWaitingTask). Until 2026-10-02 only the
 *   browser could start a task, so a person working through their AI had no way to say "go ahead".
 *
 *   THE WAKE. The push carries a delivery id of its own (taskWakeId). With the task id, the tunnel
 *   skipped it as already acknowledged (the create push used that id first), and a hosted agent woke
 *   on its runtime's own re-list about 90 s later instead of at once.
 * @structure TaskStartDeps · TaskStartRefusal · startWaitingTask()
 * @usage
 *   const out = await startWaitingTask({ storage, config, webhook }, caller, req.auth!.owner, id);
 *   if (!out.ok) return res.status(out.status).json(error(nodeId, out.code, out.message));
 * @version-history
 *   v1.0.0 — 2026-10-02 — Extracted from routes/agent-tasks/lifecycle.ts, with the agent caller and
 *     the per-transition wake id added.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo } from '../storage/interface.js';
import type { createWebhookDispatcher } from './webhook-dispatcher.js';
import { decideTaskStart, mayStartWaitingTask, taskWakeId, type StartCaller } from './agent-task-rules.js';
import { waitReason } from './task-start-notice.js';
import { recordTaskStarted } from './activity-recorder.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { emitResourceUpdated } from '../mcp/resource-events.js';
import { logger } from '../utils/logger.js';

export interface TaskStartDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The agent webhook fan-out, when the caller holds one (the HTTP router does, MCP does not). */
    webhook?: ReturnType<typeof createWebhookDispatcher>;
}

export interface TaskStartRefusal { ok: false; status: number; code: string; message: string }

/** Start `taskId` for `caller`, who acts in the account `callerOwner` (a bare account name). */
export async function startWaitingTask(
    deps: TaskStartDeps,
    caller: StartCaller,
    callerOwner: string,
    taskId: string,
): Promise<{ ok: true; task: AgentTaskRecord } | TaskStartRefusal> {
    const { storage, config } = deps;
    const task = await storage.getAgentTask(taskId);
    if (!task) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Task not found' };

    // The owner's own task, whoever asks. A visitor from another node carries its home identity as
    // `owner` (auth/jwt.ts), so it never matches a local account here.
    if (task.ownerGaii !== `${callerOwner}@${config.nodeId}`) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'This task belongs to another account.' };
    }

    // Allow recovery from 'stalled': the stall detector marks tasks as stalled when they go quiet for
    // too long, but a stalled task is not a failed task — the agent may have crashed, been killed, or
    // lost its tokens. The owner can re-start a stalled task to give the agent another chance.
    if (task.status !== 'queued' && task.status !== 'paused' && task.status !== 'stalled') {
        return { ok: false, status: 409, code: 'INVALID_STATE', message: `Only queued, paused, or stalled tasks can be started (current: ${task.status})` };
    }

    const delegate = !caller.ownerInPerson && !caller.app;
    if (delegate) {
        if (caller.principal === task.agentGaii) {
            return { ok: false, status: 403, code: 'OWNER_MUST_START',
                message: 'An agent cannot start its own task. It waits for the owner, or for another of their agents to start it on their word.' };
        }
        if (task.status !== 'queued') {
            return { ok: false, status: 403, code: 'OWNER_MUST_START', message: `Only the owner can restart a ${task.status} task.` };
        }
        const decision = decideTaskStart(await storage.getAgent(task.agentGaii), { policy: task.startPolicy, todos: task.todos });
        if (!mayStartWaitingTask(caller, task.agentGaii, decision)) {
            return { ok: false, status: 403, code: 'OWNER_MUST_START',
                message: `${waitReason(task.agentGaii.split('#')[0], decision)} Only the owner can start it, from the notification they got or from Tasks.` };
        }
    }

    const now = new Date().toISOString();
    const updated = await storage.updateAgentTask(task.id, { status: 'active', lastEventAt: now, updatedAt: now });
    if (!updated) return { ok: false, status: 500, code: 'UPDATE_FAILED', message: 'Failed to start the task' };

    await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: task.id,
        type: 'started',
        message: delegate ? `Task started by ${caller.principal.split('#')[0]} on the owner's word` : 'Task started',
        timestamp: now,
    });
    await recordTaskStarted(storage, task.agentGaii);

    deps.webhook?.dispatchWebhookEvent(task.agentGaii, 'task.approved', {
        task_id: task.id,
        title: task.title,
        status: 'active',
        todo_count: task.todos?.length ?? 0,
        pending_todo_count: (task.todos ?? []).filter((t: AgentTaskTodo) => t.status === 'pending').length,
        approved_at: now,
    });
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${task.agentGaii.split('#')[0]}/tasks`); }
    catch (err) { logger.warn('task start: MCP not connected', { error: String(err) }); }
    // Connector forward tunnel: the now-active task goes down a live socket at once. If the agent is
    // offline the task stays 'active' in the store and is replayed by backlog-on-connect.
    emitDelivery({ target: task.agentGaii, kind: 'task_assigned', id: taskWakeId(task.id, 'active', now), payload: updated });
    emitChange('agent-tasks', caller.principal);
    return { ok: true, task: updated };
}
