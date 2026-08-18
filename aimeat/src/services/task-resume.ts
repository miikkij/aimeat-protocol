/**
 * @file src/services/task-resume.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Bringing a stalled task back when its agent shows up again.
 *
 *   The stall detector marks a task 'stalled' after a quiet period. If the agent then posts an event
 *   or ticks a todo, it is evidently back, and the task resumes — which is why there is no separate
 *   "restart" call for the ordinary case of an agent that briefly crashed and recovered.
 *
 *   It lives here because both doors need it and only one had it. The HTTP door auto-resumed on both
 *   paths; the MCP tools refused outright ("Events can only be appended to active tasks"), so an
 *   agent that came back could neither report the progress it had made nor tick off the work it had
 *   finished, and the stall detector's verdict was permanent on the surface the agent actually uses.
 * @structure
 *   - resumeIfStalled() — flips a stalled task to active and appends the matching 'started' event
 * @usage
 *   await resumeIfStalled(storage, task, 'agent posted a new event');
 *   if (task.status !== 'active') return refuse(...);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted from routes/agent-tasks/completion.ts so the MCP tools get it too.
 */
import { randomUUID } from 'node:crypto';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';

/**
 * Resume `task` if it is stalled. Mutates `task.status` in place so the caller's own status check
 * below it sees the new state, exactly as the HTTP handlers did when this was written inline.
 *
 * `because` completes the sentence "Task auto-resumed from stalled (…)" in the event message, so the
 * history says which signal brought it back.
 */
export async function resumeIfStalled(
    storage: Storage,
    task: AgentTaskRecord,
    because: string,
): Promise<void> {
    if (task.status !== 'stalled') return;
    const now = new Date().toISOString();
    await storage.updateAgentTask(task.id, { status: 'active', lastEventAt: now, updatedAt: now });
    await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: task.id,
        type: 'started',
        message: `Task auto-resumed from stalled (${because})`,
        timestamp: now,
    });
    task.status = 'active';
}
