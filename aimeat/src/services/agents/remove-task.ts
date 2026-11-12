/**
 * @file src/services/agents/remove-task.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Removing a task: one implementation behind DELETE /v1/agents/:name/tasks/:id and the
 *   aimeat_task_delete MCP tool.
 *
 *   WHO MAY REMOVE. The owner in person: any task of their account. The task's own agent: its own
 *   task, as before. Another of the owner's agents holding task:write and agent:write (the person's
 *   own chat AI, acting on their word): a task of a sibling (services/agent-task-rules.ts
 *   mayManageSiblingTasks). An app grant is not admitted, as before. Nobody removes an ACTIVE task:
 *   it is paused or its agent is stopped first.
 *
 *   WHY THE SIBLING. Until 2026-11-12 only the owner in a browser could end a task of an agent that
 *   was not the caller. On aimeat.io one waiting task of a scheduled agent kept announcing itself,
 *   the person asked their AI to end it, and the AI had no call that reached it: over MCP another
 *   agent's task could be started (aimeat_task_start) and nothing else.
 * @structure TaskRemoveDeps · TaskRemoveRefusal · removeTask()
 * @usage
 *   const out = await removeTask({ storage, config }, startCallerOf(req.auth!, resolve(req)), req.auth!.owner, id);
 *   if (!out.ok) return res.status(out.status).json(error(nodeId, out.code, out.message));
 * @version-history
 *   v1.0.0 — 2026-11-12 — Extracted from routes/agent-tasks/lifecycle.ts, with the sibling agent
 *     added (wish-the-owner-s-ai-can-remove-an-agent-end-its-task-and-delete-a).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord } from '../../storage/interface.js';
import { mayManageSiblingTasks, type StartCaller } from '../agent-task-rules.js';
import { emitChange } from '../event-bus.js';
import { emitResourceUpdated } from '../resource-events.js';
import { logger } from '../../utils/logger.js';

export interface TaskRemoveDeps {
    storage: Storage;
    config: AimeatConfig;
}

export interface TaskRemoveRefusal { ok: false; status: number; code: string; message: string }

/** Remove `taskId` for `caller`, who acts in the account `callerOwner` (a bare account name). */
export async function removeTask(
    deps: TaskRemoveDeps,
    caller: StartCaller,
    callerOwner: string,
    taskId: string,
): Promise<{ ok: true; task: AgentTaskRecord } | TaskRemoveRefusal> {
    const { storage, config } = deps;
    const task = await storage.getAgentTask(taskId);
    if (!task) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Task not found' };

    // The owner's own task, whoever asks. A visitor from another node carries its home identity as
    // `owner` (auth/jwt.ts), so it never matches a local account here.
    const notYours: TaskRemoveRefusal = { ok: false, status: 403, code: 'FORBIDDEN', message: 'This task belongs to another account or another agent.' };
    if (task.ownerGaii !== `${callerOwner}@${config.nodeId}`) return notYours;
    const ownTask = !caller.ownerInPerson && !caller.app && caller.principal === task.agentGaii;
    if (!caller.ownerInPerson && !ownTask && !mayManageSiblingTasks(caller, task.agentGaii, 'task:write')) return notYours;

    if (task.status === 'active') {
        return { ok: false, status: 409, code: 'INVALID_STATE',
            message: 'Active tasks cannot be deleted -- cancel or pause the task first, then delete it' };
    }

    const deleted = await storage.deleteAgentTask(taskId);
    if (!deleted) {
        return { ok: false, status: 409, code: 'INVALID_STATE', message: 'Task could not be deleted (it may have just become active)' };
    }

    // Clean the task's operational memory traces so a leftover does not confuse the runner or the
    // per-task memory view. Best-effort: a cleanup failure must not fail the removal (the task itself
    // is already gone). The agent's actual deliverable memory is intentionally preserved.
    //   - the live-status memory keys the agent wrote under its own namespace (`agents.<name>.tasks.<id>.*`)
    //   - the owner-written cancel marker (`agents.cancel.task.<id>`) the runner daemon scans on every poll
    const agentName = task.agentGaii.split('#')[0];
    try {
        const livePrefix = `agents.${agentName}.tasks.${taskId}.`;
        const liveEntries = await storage.listMemory(task.agentGaii, { prefix: livePrefix });
        for (const m of liveEntries) await storage.deleteMemory(task.agentGaii, m.key);
    } catch (err) { logger.warn('task remove: best-effort trace cleanup', { error: String(err) }); }
    try {
        await storage.deleteMemory(task.ownerGaii, `agents.cancel.task.${taskId}`);
    } catch (err) { logger.warn('task remove: best-effort trace cleanup', { error: String(err) }); }

    emitChange('agent-tasks', caller.principal);
    try { emitResourceUpdated(task.agentGaii, `aimeat://agents/${agentName}/tasks`); }
    catch (err) { logger.warn('task remove: MCP not connected', { error: String(err) }); }
    return { ok: true, task };
}
