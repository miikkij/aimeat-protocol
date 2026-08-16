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
 *   - completeTask() — the whole completion: the state move, the stamp, the event and the fan-out
 *   - failTask() — the whole failure: the state move, the event and the fan-out
 * @usage
 *   const done = await completeTask({ storage, config }, task,
 *     { message, deliverableKey, pipeline: 'rest.task_complete' }, resolve(req));
 *   if (!done.ok) { … done.status / done.code / done.message … }
 * @version-history
 *   v1.2.0 — 2026-08-14 — completeTask(). The last writing tool surface: aimeat_task_complete wrote
 *     the same two records POST /v1/agents/:name/tasks/:id/complete writes, and the two copies had
 *     drifted three ways. The reasons are on the function.
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
import { provenanceForWrite, type DeclaredProvenance } from './ai-provenance.js';
import { logger } from '../utils/logger.js';
import { recordAccountEvent } from './account-events.js';
import { ownerGhiiOf } from '../utils/gaii.js';

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

    // The owner's own "what has happened". Their agent finishing work is the single most ordinary
    // thing they would want told without asking for it.
    void recordAccountEvent(storage, {
        ownerGhii: ownerGhiiOf(task.agentGaii),
        kind: 'agent_task_done',
        actorGaii: task.agentGaii,
        subject: id,
        link: `/v1/profile?tab=agents&task=${encodeURIComponent(id)}`,
        data: { agent: task.agentGaii.split('#')[0], title: task.title ?? '' },
    }, config);

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
    void recordAccountEvent(deps.storage, {
        ownerGhii: ownerGhiiOf(task.agentGaii),
        kind: 'agent_task_failed',
        actorGaii: task.agentGaii,
        subject: task.id,
        link: `/v1/profile?tab=agents&task=${encodeURIComponent(task.id)}`,
        data: { agent: task.agentGaii.split('#')[0], title: task.title ?? '' },
    }, deps.config);
    getActiveWorkflowEngine()?.onTaskTerminal(task, 'failed')
        .catch(e => logger.error('workflow advance on task fail failed', { taskId: task.id, error: String(e) }));
}

/**
 * The states a task may be completed from. STALLED counts, for the same reason it counts on
 * FAILABLE_STATES: the stall detector flips the state on a clock, not on evidence that the work
 * stopped, so an agent that went quiet and came back holding a deliverable is handing in real work.
 * A late deliverable is more useful than a refusal.
 *
 * draft / queued / paused / revision_requested / done / failed are not completable. Those need an
 * explicit owner-driven transition first (POST …/start), and a completion arriving before it would
 * be reporting work on a task nobody has released.
 */
export const COMPLETABLE_STATES: readonly string[] = ['active', 'stalled'];

/** What a door supplies about the completion itself. Everything else is read off the task. */
export interface CompleteTaskInput {
    /** What the owner reads under the task. Blank or absent becomes 'Task completed'. */
    message?: string;
    /**
     * Memory key, under the AGENT's namespace, where the deliverable was published. It is what the
     * owner's task card links to, and a PUBLIC record named here is what reaches the node's activity
     * feed. Trimmed and capped at 256 characters here so both doors cap it the same way.
     */
    deliverableKey?: string;
    /** A provenance record the caller already holds and is attaching. Checked against its own account. */
    declaredProvenanceId?: string;
    /** What the caller said about how the completion message was made. */
    declaredProvenance?: DeclaredProvenance;
    /** Which road this came down, for the provenance record: 'mcp.task_complete' | 'rest.task_complete'. */
    pipeline: string;
}

export type CompleteResult =
    | { ok: true; task: AgentTaskRecord; aiProvenanceId?: string }
    | { ok: false; status: number; code: string; message: string };

/**
 * Move a task to 'done', stamp the completion message, append the event, and run the fan-out.
 *
 * Written out on both doors until now, and the two copies had drifted three ways. Each one was
 * measured, and not one of them was caught by a suite:
 *
 *   - THE TOOL ACCEPTED ONLY AN ACTIVE TASK. So an agent that crashed, was flipped to stalled by the
 *     detector's clock and came back could not report the work it had finished. Exactly the
 *     narrowing failTask() was written to close on the failure path.
 *   - THE TOOL HAD NO WAY TO NAME A DELIVERABLE. `deliverable_key` is the pointer the owner's UI
 *     follows and the one thing that puts a public deliverable on the node's activity feed, so an
 *     agent working over MCP published its result into silence.
 *   - ONLY THE TOOL STAMPED PROVENANCE. See the note on the stamp below.
 */
export async function completeTask(
    deps: Deps,
    task: AgentTaskRecord,
    input: CompleteTaskInput,
    /**
     * The RESOLVED identity of whoever is completing: resolveIdentity(req.auth!) over REST, the
     * agent's own GAII over MCP. It does double duty deliberately. It is the principal the
     * provenance record names AND the live view that skips its own echo, and those are the same
     * party by definition.
     */
    actor: string,
): Promise<CompleteResult> {
    if (!COMPLETABLE_STATES.includes(task.status)) {
        return {
            ok: false, status: 409, code: 'INVALID_STATE',
            message: `Only active or stalled tasks can be completed (current: ${task.status})`,
        };
    }

    // An empty completion message tells the owner nothing and hashes to nothing useful in the
    // provenance record, so blank and absent get the same default.
    const message = input.message?.trim() ? input.message : 'Task completed';
    const deliverableKey = input.deliverableKey?.trim()
        ? input.deliverableKey.trim().slice(0, 256)
        : undefined;

    // WHERE THE PROVENANCE STAMP BELONGS: here, so BOTH doors carry it.
    //
    // "The tool stamps and REST does not" looks like it could be correct, because a message an agent
    // composes is model-written and a person's is not. It is half right, and the half it gets wrong
    // is WHICH DOOR DECIDES. provenanceForWrite() already answers that question from the PRINCIPAL: a
    // GHII writing through their own token is left alone, because stamping a person's own words would
    // be a false statement about authorship, while a GAII or GEAI that declared nothing is recorded
    // as model-written. So the owner clicking Complete in the dashboard gets no stamp and an agent
    // completing over REST gets the same stamp it gets over MCP. Minting on one door only made the
    // label depend on which client wrote it, which is a split a reader can neither see nor account
    // for, and it is the same thing routes/boards.ts closed in TARGET-058 Phase 9.
    //
    // The DECLARATION stays an MCP-only parameter, which is that same precedent: `ai_provenance` is
    // scope-gated on `provenance:write`, and an agent that wants to state how content was made has a
    // tool that takes it. What arrives from REST is the node's own observation and nothing else.
    //
    // MINTED BEFORE THE STATE MOVE. A declaration without the scope raises ProvenanceScopeError, and
    // minting after the update would leave a task marked done with no 'completed' event and a refusal
    // handed back to the agent. Nothing is lost the other way round: an unreferenced provenance row
    // is inert.
    const aiProvenanceId = await provenanceForWrite(deps.storage, {
        principal: actor,
        content: message,
        declaredId: input.declaredProvenanceId,
        declared: input.declaredProvenance,
        pipeline: input.pipeline,
        // Never public, but a PERSON reads it, and that is what decides whether a label is owed.
        surface: { visibility: 'private', humanAudience: true },
        labelPolicy: deps.config.aiLabelPublic,
        nodeId: deps.config.nodeId,
        baseUrl: deps.config.baseUrl,
        enabled: deps.config.aiProvenance,
    });

    const now = new Date().toISOString();
    const updated = await deps.storage.updateAgentTask(task.id, {
        status: 'done',
        completedAt: now,
        lastEventAt: now,
        updatedAt: now,
        ...(deliverableKey ? { deliverableKey } : {}),
    });

    // The provenance link rides in the event's `details` rather than in a column of its own, unlike
    // memory / apps / direct messages. `details` is already the designed home for per-event metadata,
    // and a column carried by exactly one of thirteen event types would be the odd row out in every
    // query that touches the table. The RECORD is the same record everywhere; only the pointer's
    // address differs.
    await deps.storage.appendTaskEvent({
        id: randomUUID(),
        taskId: task.id,
        type: 'completed',
        message,
        ...(aiProvenanceId ? { details: { aiProvenanceId } } : {}),
        timestamp: now,
    });

    // The key this completion names, or one an earlier step already put on the task. REST passed only
    // the first and the tool only the second, so between them a completion could carry a deliverable
    // and still miss the feed. Reading it is safe either way: the fan-out publishes nothing unless the
    // record at that key is actually public.
    await afterTaskCompleted({ storage: deps.storage, config: deps.config }, task, updated ?? null,
        message, deliverableKey ?? updated?.deliverableKey ?? task.deliverableKey, actor);

    return { ok: true, task: updated ?? task, ...(aiProvenanceId ? { aiProvenanceId } : {}) };
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
