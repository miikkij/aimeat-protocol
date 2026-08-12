/**
 * @file src/services/agent-task-fanout.ts
 * @description Everything that happens BECAUSE a task finished, in one place, for every door.
 *
 *   WHY. Completing a task writes one record and sets off eight other things, and all eight lived
 *   inside the HTTP handler. `aimeat_task_complete` wrote the record and did none of them, which is
 *   the worst shape a side effect can have: the tool answered "completed: true", the task showed as
 *   done, and everything downstream of it simply never happened.
 *
 *   What that cost, in the order a person would notice it:
 *
 *     - A WORKFLOW RUN THAT DISPATCHED THE TASK NEVER ADVANCED. The engine learns a step is over
 *       from onTaskTerminal. An agent completing its own work over MCP left the run sitting on that
 *       step, and a reload does not fix a hung run.
 *     - THE OPEN ITEM THE PERSON SWITCHED ON NEVER CLOSED. The pool's one indirect write is this,
 *       made on the evidence of a completed task, so the item stayed on until somebody closed it by
 *       hand.
 *     - THE AUTOMATION REPORT WAS NEVER SENT and the advisory outbox was never drained, so a recipe
 *       with email:true produced work and no report.
 *     - THE AGENT'S OWN COUNTERS DID NOT MOVE. recordTaskCompleted is where tasksCompleted and the
 *       token totals come from, so an agent working through MCP looked idle in its own quality view.
 *     - THE RUNNER'S LIVE-TRACE KEY WAS NEVER RECLAIMED. One key per completed task, forever,
 *       against a 1000-key ceiling: 991 of them were measured on aimeat.io on 2026-08-09.
 *     - AND THE PUBLIC FEED missed a public deliverable.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - afterTaskCompleted() — the eight things a completion sets off
 *   - afterTaskFailed() — the two a failure sets off
 *   - failTask() — the whole failure: the state move, the event and the fan-out
 * @usage
 *   await storage.updateAgentTask(id, { status: 'done', … });
 *   await afterTaskCompleted({ storage, config }, task, updated, message, deliverableKey);
 * @version-history
 *   v1.1.0 — 2026-08-12 — recordTaskCompleted logs and continues instead of rejecting. Both doors
 *     await this function, and the REST door now answers after it, so a storage hiccup in the
 *     counters must not turn a task that IS done into a 500.
 *   v1.0.0 — 2026-08-11 — Extracted from routes/agent-tasks/completion.ts (August 2026 audit, the
 *     side-effect sweep) so the tool surface stops being a completion that completes nothing.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import { recordTaskCompleted, recordTaskFailed } from './activity-recorder.js';
import { getActiveWorkflowEngine } from './workflow/engine.js';
import { notifyAutomationTaskComplete } from './ecosystem-automation-notify.js';
import { processAutomationAdvisories } from './ecosystem-automation-advisories.js';
import { closeItemsForTask } from './open-items.js';
import { reclaimTaskLiveTrace } from '../routes/agent-tasks/helpers.js';
import { recordPublicActivity } from './public-activity.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

interface Deps { storage: Storage; config: AimeatConfig }

/**
 * A task reached 'done'. Everything here is best-effort and isolated: none of it may fail a
 * completion that already happened, and each failure is logged with the task it belongs to.
 *
 * `updated` is the record as stored after the completion, because it carries the deliverableKey the
 * agent just set; `task` is the pre-update copy the workflow engine and the activity recorder read.
 */
export async function afterTaskCompleted(
    deps: Deps,
    task: AgentTaskRecord,
    updated: AgentTaskRecord | null,
    message: string,
    deliverableKey: string | undefined,
    /** The principal whose live view should skip its own echo, when the door knows it. */
    actor?: string,
): Promise<void> {
    const { storage, config } = deps;
    const id = task.id;

    // The agent's counters are the ONE step a caller waits for, because a completion is read
    // straight back: the Activity tab refreshes on the change event and an agent reads its own
    // /capabilities. Everything below is fire-and-forget by design.
    //
    // It still may not fail a completion that already happened, so it logs and continues rather than
    // rejecting into the door. Both doors await this function, so the guarantee lives here, once.
    await recordTaskCompleted(storage, task.agentGaii, task.telemetry)
        .catch(e => logger.error('moving the agent counters after a completed task failed', { taskId: id, error: String(e) }));

    // If this task came from the owner's intent pool, the intent closes here. The SERVER does it:
    // the agent never writes into the owner's namespace, so the pool's one indirect write is this,
    // and it happens on the evidence of a completed task rather than on the agent's say-so.
    void closeItemsForTask(storage, config, task)
        .catch(e => logger.error('switching off the open item behind a task failed', { taskId: id, error: String(e) }));

    emitChange('agent-tasks', actor);

    // Public landing feed — only when the agent published a PUBLIC deliverable (a real material).
    if (deliverableKey) {
        void (async () => {
            const rec = await storage.getMemory(task.agentGaii, deliverableKey);
            if (rec?.visibility !== 'public') return;
            await recordPublicActivity(storage, config, {
                category: 'agents',
                actor: task.agentGaii,
                summary: `Agent ${task.agentGaii.split('#')[0]} completed "${task.title}"`,
                detail: message,
                link: `/v1/memory/${encodeURIComponent(task.agentGaii)}/${encodeURIComponent(deliverableKey)}`,
            });
        })().catch(e => logger.error('public activity (task deliverable) failed', { taskId: id, error: String(e) }));
    }

    // If this task was dispatched by a workflow, advance that run (output check → next step).
    getActiveWorkflowEngine()?.onTaskTerminal(task, 'done')
        .catch(e => logger.error('workflow advance on task done failed', { taskId: id, error: String(e) }));

    // The runner's live-progress record is spent now that the task is done: reclaim its key rather
    // than hold one per completed task forever. Safe to run concurrently with the workflow advance
    // above — a step's success signal globs the agent's DELIVERABLE keys, never this
    // `agents.{name}.tasks.{id}.` prefix, so the two never touch the same record.
    void reclaimTaskLiveTrace(storage, task);

    // B6 — if this task was materialised by an ecosystem-app automation recipe with email:true,
    // email the owner a short report + store an in-app report record.
    void notifyAutomationTaskComplete(storage, config, updated ?? task, message)
        .catch(e => logger.error('automation completion notify failed', { taskId: id, error: String(e) }));

    // B7/B8 — drain the owner's advisory outbox for this app: deliver immediately (no approval) over
    // the connector tunnel, or gate behind owner approval.
    void processAutomationAdvisories(storage, config, updated ?? task)
        .catch(e => logger.error('automation advisory drain failed', { taskId: id, error: String(e) }));
}

/** A task reached 'failed'. The counters move and the workflow run learns the step is over. */
export async function afterTaskFailed(
    deps: Deps,
    task: AgentTaskRecord,
    actor?: string,
): Promise<void> {
    await recordTaskFailed(deps.storage, task.agentGaii);
    emitChange('agent-tasks', actor);
    getActiveWorkflowEngine()?.onTaskTerminal(task, 'failed')
        .catch(e => logger.error('workflow advance on task fail failed', { taskId: task.id, error: String(e) }));
}

/** The states a task may be failed from. STALLED counts: an agent that crashed still gets to say so. */
export const FAILABLE_STATES: readonly string[] = ['active', 'stalled'];

export type FailResult =
    | { ok: true; task: AgentTaskRecord }
    | { ok: false; status: number; code: string; message: string };

/**
 * Move a task to 'failed', append the event, and run the fan-out.
 *
 * Written out on both doors, and the copy had narrowed it: the tool surface accepted only an ACTIVE
 * task, so an agent whose task had STALLED — which is the ordinary case for an agent that crashed —
 * could not report the failure at all. The task sat stalled, the workflow run that dispatched it
 * stayed on that step, and nothing said why.
 */
export async function failTask(
    deps: Deps,
    task: AgentTaskRecord,
    reason: string,
    actor?: string,
): Promise<FailResult> {
    if (!FAILABLE_STATES.includes(task.status)) {
        return {
            ok: false, status: 409, code: 'INVALID_STATE',
            message: `Only active or stalled tasks can be failed (current: ${task.status})`,
        };
    }
    const now = new Date().toISOString();
    const updated = await deps.storage.updateAgentTask(task.id, {
        status: 'failed',
        completedAt: now,
        lastEventAt: now,
        updatedAt: now,
    });
    await deps.storage.appendTaskEvent({
        id: randomUUID(),
        taskId: task.id,
        type: 'failed',
        message: reason,
        timestamp: now,
    });
    await afterTaskFailed(deps, task, actor);
    return { ok: true, task: updated ?? task };
}
