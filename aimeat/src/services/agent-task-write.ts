/**
 * @file src/services/agent-task-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The task WRITES themselves, in one place, for every door: creating a task, appending
 *   an event, accepting a proposed plan, and ticking a todo.
 *
 *   WHY. The August 2026 audit's third step moved the task GATES here (agent-task-rules.ts,
 *   task-resume.ts) and the completion fan-out with them (agent-task-fanout.ts). What stayed written
 *   out twice was the write in the middle: the validation, the record build, the event append and
 *   the pushes. `POST /v1/agents/:name/tasks` and `aimeat_task_create` each built their own
 *   AgentTaskRecord; `POST /tasks/:id/event` and `aimeat_task_event` each merged their own telemetry.
 *   Four differences had already grown in that gap, and none of them was a decision anyone made:
 *
 *     - TELEMETRY. The HTTP door ACCUMULATES what an agent reports (`prev + reported`, which is what
 *       a per-event delta means); the tool REPLACED the totals with the last event's numbers. An
 *       agent working over MCP and reporting 1 AI call per event finished a forty-call task showing
 *       one call, and the cost view read from that.
 *     - VALIDATION. The HTTP door caps a title at 256 characters and a description at 10 000; the
 *       tool declared both as a bare string, so the same node accepted over MCP what it refused over
 *       HTTP, and the oversized row then had to be rendered by a UI built for the capped one.
 *     - THE RACE BACKSTOP. Both doors pre-check the one-live-commission fingerprint, but only the
 *       HTTP one caught the unique-index violation two simultaneous identical commissions produce
 *       and answered with the winner. Over MCP that pair surfaced as a 500 on a click the owner was
 *       entitled to.
 *     - THE WAKE. Creating a queued or auto-activated task emits `task_assigned` on the connector
 *       tunnel, which is how a parked daemon starts within the second instead of on its next
 *       ~5-minute re-list. The tool emitted nothing, so delegating over MCP was the slow path.
 *
 *   The webhook dispatcher is a constructor argument of the HTTP router and the MCP server has no
 *   instance of it, so `deps.webhook` is optional and a task delegated over MCP still fires no
 *   agent webhook. That is the one difference this file does not close; it is now visible in one
 *   signature instead of hidden in two handler bodies.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - createTask() — validate, dedupe, build, insert, auto-activate, push
 *   - recordTaskEvent() — the stalled-resume, the state gate, the event and the telemetry roll-up
 *   - applyProposedPlan() — accept a TODO plan: preserve history, renumber, auto-activate
 *   - setTodoStatus() — tick one todo, with the matching event
 * @usage
 *   const r = await createTask({ storage, config, webhook }, { agent, agentGaii, agentName, creator, body, actor });
 *   if (!r.ok) return res.status(r.status).json(error(config.nodeId, r.code, r.message));
 * @version-history
 *   2026-08-15 — The record carries `createdBy`. Both doors already knew the actor and neither
 *     stored it.
 *   v1.0.0 — 2026-08-11 — Extracted from routes/agent-tasks/{create-read,completion,lifecycle}.ts and
 *     mcp/agent-tasks.ts (August 2026 audit, step 8: the write). Two ordering changes came with the
 *     move and neither is observable from outside: `emitChange` and the offer-ordered workflow
 *     trigger now run just before the door renders its answer rather than just after, and the record
 *     is committed either way.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type {
    Storage, AgentRecord, AgentTaskRecord, AgentTaskTodo, AgentTaskEventRecord, AgentTaskScope,
} from '../storage/interface.js';
import type { createWebhookDispatcher } from './webhook-dispatcher.js';
import { AgentTaskCreateSchema, AgentTaskEventSchema, AgentTaskTodoUpdateSchema } from '../models/agent-task-schemas.js';
import {
    resolveAutoActivation, AUTO_ACTIVATED_EVENT_MESSAGE, canProposeTodos, todoProposeRefusal, statusAfterProposal,
} from './agent-task-rules.js';
import { commissionFingerprint, isUniqueViolation } from '../routes/agent-tasks/dedupe.js';
import { resumeIfStalled } from './task-resume.js';
import { resolveTaskFileInputs } from './task-files.js';
import type { FileRefAccessor } from './file-refs.js';
import { recordTaskStarted } from './activity-recorder.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { getActiveWorkflowEngine } from './workflow/engine.js';
import { logger } from '../utils/logger.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

export interface TaskWriteDeps {
    storage: Storage;
    config: AimeatConfig;
    /**
     * The agent webhook fan-out, when the door holds one. The HTTP router is constructed with a
     * dispatcher; the MCP server is not, so webhooks stay unsent for a task written over MCP.
     */
    webhook?: WebhookDispatcher;
}

/** A refusal every door can render in its own shape: HTTP status + code, or a line of text. */
export interface TaskWriteRefusal {
    ok: false;
    status: number;
    code: string;
    message: string;
}

/** Zod issues as the single line both doors have always shown. */
function invalidInput(issues: { path: (string | number | symbol)[]; message: string }[]): TaskWriteRefusal {
    return {
        ok: false, status: 400, code: 'INVALID_INPUT',
        message: issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
}

// ── Create ──────────────────────────────────────────────────────────────────────────────────────

export interface CreateTaskArgs {
    /** The target agent, already fetched and authorized by the door. */
    agent: Pick<AgentRecord, 'owner' | 'mode'>;
    agentGaii: string;
    /** The name segment, for the webhook payload and the door's own resource notification. */
    agentName: string;
    /** Who is creating the task, for the attachment read check. */
    creator: FileRefAccessor;
    /** The raw create body. Validated here with AgentTaskCreateSchema, so both doors cap the same fields. */
    body: unknown;
    /** The principal whose live view this write belongs to, for SSE owner scoping. */
    actor?: string;
}

export type CreateTaskResult =
    | TaskWriteRefusal
    | { ok: true; deduplicated: true; task: AgentTaskRecord }
    | { ok: true; deduplicated: false; task: AgentTaskRecord; autoActivated: boolean };

/**
 * Create a task for `agent`.
 *
 * The caller has already decided that it MAY create this task; everything from the body validation
 * onwards happens here. `ownerGaii` is always the target agent's owner GHII, never the calling
 * agent's GAII, so the task shows up in the owner's dashboard the same way whoever queued it.
 */
export async function createTask(deps: TaskWriteDeps, args: CreateTaskArgs): Promise<CreateTaskResult> {
    const { storage, config } = deps;

    const parsed = AgentTaskCreateSchema.safeParse(args.body);
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const body = parsed.data;

    // Attachments are validated against the CREATOR's own read access — a task must not be a way to
    // slip a reference to data the creator cannot see into somebody's work queue.
    const fileResult = await resolveTaskFileInputs(storage, config, body.resources?.files, args.creator);
    if ('error' in fileResult) return { ok: false, ...fileResult.error };

    // ── One live commission per (agent, fingerprint) ──
    // The browser SDK collapses repeat clicks inside a page, but a reload or a second tab starts with
    // an empty in-flight map, and every duplicate here is a real agent run the owner pays for. A
    // matching OPEN task wins; a finished, failed or stalled one does not, so the same work is
    // orderable again tomorrow.
    const dedupeKey = body.allow_duplicate
        ? undefined
        : commissionFingerprint(args.agentGaii, body.idempotency_key, body.title, body.description);
    if (dedupeKey) {
        const live = await storage.findLiveTaskByDedupeKey(args.agentGaii, dedupeKey);
        if (live) return { ok: true, deduplicated: true, task: live };
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    const todos: AgentTaskTodo[] = body.todos.map(t => ({
        id: t.id,
        order: t.order,
        title: t.title,
        description: t.description,
        environment: t.environment,
        environmentReason: t.environment_reason,
        verification: t.verification,
        estimateMinutes: t.estimate_minutes,
        status: t.status,
    }));

    // 'task-runner' is the owner saying "start without asking me each time", so a queued task for
    // such an agent starts on its own and carries the same 'started' event an owner-approved one
    // would. Which door delegated the task is not part of that instruction.
    const { autoActivated, effectiveStatus } = resolveAutoActivation(args.agent, body.status);

    const record: AgentTaskRecord = {
        id,
        agentGaii: args.agentGaii,
        ownerGaii: `${args.agent.owner}@${config.nodeId}`,
        // Who ordered it. Known here on every door and stored nowhere until now, which is what made
        // a commission invisible to the party that placed it. `actor` is the principal whose live
        // view this write belongs to — the owner on the HTTP door, the calling agent over MCP.
        createdBy: args.actor,
        title: body.title.trim(),
        description: body.description.trim(),
        scope: body.scope,
        rules: body.rules,
        verification: {
            userExpects: body.verification.user_expects,
            technicalChecks: body.verification.technical_checks,
        },
        resources: body.resources ? {
            knowledgePackages: body.resources.knowledge_packages,
            memoryKeys: body.resources.memory_keys,
            memoryPrefixes: body.resources.memory_prefixes,
            ...(fileResult.files.length ? { files: fileResult.files } : {}),
        } : undefined,
        todos,
        status: effectiveStatus,
        ...(dedupeKey ? { dedupeKey } : {}),
        parentTaskId: body.parent_task_id,
        createdAt: now,
        updatedAt: now,
        lastEventAt: autoActivated ? now : undefined,
    };

    // The pre-check above closes the ordinary window; the unique index closes the racing one. When
    // two identical commissions arrive together, one inserts and the other lands here — read back the
    // winner and answer with it rather than failing a click the owner is entitled to.
    let created: AgentTaskRecord;
    try {
        created = await storage.createAgentTask(record);
    } catch (err) {
        if (dedupeKey && isUniqueViolation(err)) {
            const live = await storage.findLiveTaskByDedupeKey(args.agentGaii, dedupeKey);
            if (live) return { ok: true, deduplicated: true, task: live };
        }
        throw err;
    }

    // The matching 'started' event, so an auto-activated task reads like an owner-approved one in
    // every event report.
    if (autoActivated) {
        await storage.appendTaskEvent({
            id: randomUUID(),
            taskId: record.id,
            type: 'started',
            message: AUTO_ACTIVATED_EVENT_MESSAGE,
            timestamp: now,
        });
    }

    // Push. Both 'queued' and auto-activated 'active' creations notify the agent so the daemon does
    // not wait for its next interval. Auto-activated tasks share the webhook name owner-approved ones
    // use, because subscribers react to "this task is now runnable" whichever gate flipped it.
    if (record.status === 'queued' || autoActivated) {
        deps.webhook?.dispatchWebhookEvent(args.agentGaii, autoActivated ? 'task.approved' : 'task.queued', {
            task_id: record.id,
            title: record.title,
            description: record.description ?? '',
            has_todos: (record.todos?.length ?? 0) > 0,
            todo_count: record.todos?.length ?? 0,
            scope_summary: (record.scope ?? []).slice(0, 5).map((s: AgentTaskScope) => `${s.type || s.name}:${s.value}`),
            created_at: record.createdAt,
            auto_activated: autoActivated,
        });
        // Connector forward tunnel: if the agent holds an open tunnel the full task goes down the
        // socket now; if it is offline the task stays in the store and is replayed on connect.
        emitDelivery({ target: args.agentGaii, kind: 'task_assigned', id: record.id, payload: created });
    }

    emitChange('agent-tasks', args.actor);

    // Event-triggered workflows: a USER ordering an offer (the Ask flow tags the task with an
    // `offer_id` scope) may start a workflow. The engine's OWN dispatched tasks go through
    // storage.createAgentTask directly and use a different scope, so they do not fire this.
    const orderedOfferId = record.scope?.find((s: AgentTaskScope) => s.name === 'offer_id')?.value;
    if (orderedOfferId) {
        getActiveWorkflowEngine()?.onOfferOrdered(record.ownerGaii, orderedOfferId)
            .catch(e => logger.error('workflow event trigger (offer.ordered) failed', { offerId: orderedOfferId, error: String(e) }));
    }

    return { ok: true, deduplicated: false, task: created, autoActivated };
}

// ── Event ───────────────────────────────────────────────────────────────────────────────────────

export type RecordTaskEventResult =
    | TaskWriteRefusal
    | { ok: true; event: AgentTaskEventRecord; task: AgentTaskRecord | null };

/**
 * Append an event to a task and roll its telemetry forward.
 *
 * A stalled task resumes first: a new event is the agent showing up, which is why there is no
 * separate restart call for an agent that briefly crashed. Then the state gate, then the write.
 *
 * TELEMETRY IS ACCUMULATED. An event reports what THIS step cost, so the task total is the running
 * sum. The tool surface used to overwrite the totals with the last event's numbers, which turned a
 * forty-call task into a one-call task in the cost view.
 */
export async function recordTaskEvent(
    deps: TaskWriteDeps,
    task: AgentTaskRecord,
    body: unknown,
    actor?: string,
): Promise<RecordTaskEventResult> {
    const { storage } = deps;

    await resumeIfStalled(storage, task, 'agent posted a new event');
    if (task.status !== 'active') {
        return {
            ok: false, status: 409, code: 'INVALID_STATE',
            message: `Events can only be appended to active tasks (current: ${task.status})`,
        };
    }

    const parsed = AgentTaskEventSchema.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const input = parsed.data;

    const now = new Date().toISOString();
    const event = await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: task.id,
        type: input.type,
        message: input.message,
        details: input.details,
        timestamp: now,
    });

    const updates: Partial<AgentTaskRecord> = { lastEventAt: now, updatedAt: now };
    if (input.details?.telemetry) {
        const tel = input.details.telemetry as Record<string, unknown>;
        const prev = task.telemetry;
        updates.telemetry = {
            aiCalls: (prev?.aiCalls ?? 0) + (typeof tel.ai_calls === 'number' ? tel.ai_calls : 0),
            tokensIn: (prev?.tokensIn ?? 0) + (typeof tel.tokens_in === 'number' ? tel.tokens_in : 0),
            tokensOut: (prev?.tokensOut ?? 0) + (typeof tel.tokens_out === 'number' ? tel.tokens_out : 0),
            durationSeconds: (prev?.durationSeconds ?? 0) + (typeof tel.duration_seconds === 'number' ? tel.duration_seconds : 0),
        };
    }
    const updated = await storage.updateAgentTask(task.id, updates);

    emitChange('agent-tasks', actor);
    return { ok: true, event, task: updated ?? null };
}

// ── Proposed plan ───────────────────────────────────────────────────────────────────────────────

/** One proposed todo as a door hands it in, before it becomes an AgentTaskTodo. */
export interface ProposedTodoInput {
    id?: string;
    order?: number;
    title: string;
    description?: string;
    environment?: 'aimeat' | 'agent';
    environment_reason?: string;
    verification?: string;
    estimate_minutes?: number;
}

export type ProposePlanResult =
    | TaskWriteRefusal
    | {
        ok: true;
        task: AgentTaskRecord | null;
        /** The todos this proposal added, numbered after the preserved history. */
        todos: AgentTaskTodo[];
        outdatedCount: number;
        autoActivated: boolean;
    };

/**
 * Accept a proposed TODO plan.
 *
 * Todos already marked 'outdated' are kept as history, and on a revision cycle the still-pending
 * ones join them, so the owner's next view shows the previous plan as history rather than as the
 * live plan. New todos are numbered after the preserved ones, which keeps `order` stable across the
 * whole history.
 */
export async function applyProposedPlan(
    deps: TaskWriteDeps,
    task: AgentTaskRecord,
    incoming: ProposedTodoInput[] | undefined,
    actor?: string,
): Promise<ProposePlanResult> {
    const { storage } = deps;

    // An ACTIVE task that already has a live plan is not re-plannable: the preserve step below keeps
    // only todos already marked 'outdated', so a mid-run re-proposal would drop every in-progress and
    // completed todo, their completedAt stamps included.
    if (!canProposeTodos(task)) {
        return { ok: false, status: 409, code: 'INVALID_STATE', message: todoProposeRefusal(task.status) };
    }
    const todosIn = Array.isArray(incoming) ? incoming : [];
    if (todosIn.length === 0) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'todos must be a non-empty array' };
    }

    const now = new Date().toISOString();

    const preserved: AgentTaskTodo[] = (task.todos ?? []).flatMap(t => {
        if (t.status === 'outdated') return [t];
        if (task.status === 'revision_requested') return [{ ...t, status: 'outdated' as const }];
        return [];
    });

    const baseOrder = preserved.length;
    const newTodos: AgentTaskTodo[] = todosIn.map((t, index) => ({
        id: t.id ?? `todo-${baseOrder + index + 1}`,
        order: t.order ?? baseOrder + index + 1,
        title: t.title,
        description: t.description ?? '',
        environment: t.environment ?? 'agent',
        environmentReason: t.environment_reason,
        verification: t.verification ?? '',
        estimateMinutes: t.estimate_minutes,
        status: 'pending',
    }));

    // A revision_requested task returns to queued: the agent answered, so it waits for the owner
    // again. A queued task belonging to a task-runner agent starts on its own, for the same reason as
    // on creation. Active (plan-less) stays active.
    const { nextStatus, autoActivated } = await statusAfterProposal(g => storage.getAgent(g), task);

    const updated = await storage.updateAgentTask(task.id, {
        todos: [...preserved, ...newTodos],
        status: nextStatus,
        lastEventAt: now,
        updatedAt: now,
    });

    await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: task.id,
        type: 'progress',
        message: task.status === 'revision_requested' ? 'Revised TODO plan proposed' : 'TODO plan proposed',
        details: { todo_count: newTodos.length, outdated_count: preserved.length },
        timestamp: now,
    });

    if (autoActivated) {
        // Mirror the owner-approved start: matching 'started' event so the history reads the same,
        // the activity metric, the 'task.approved' webhook, and the tunnel push that wakes a parked
        // daemon immediately.
        await storage.appendTaskEvent({
            id: randomUUID(),
            taskId: task.id,
            type: 'started',
            message: 'Task auto-activated on TODO proposal (agent mode: task-runner)',
            timestamp: now,
        });
        await recordTaskStarted(storage, task.agentGaii);
        deps.webhook?.dispatchWebhookEvent(task.agentGaii, 'task.approved', {
            task_id: task.id,
            title: task.title,
            status: 'active',
            todo_count: (updated?.todos ?? []).length,
            pending_todo_count: (updated?.todos ?? []).filter((t: AgentTaskTodo) => t.status === 'pending').length,
            approved_at: now,
            auto_activated: true,
        });
        emitDelivery({ target: task.agentGaii, kind: 'task_assigned', id: task.id, payload: updated });
    }

    deps.webhook?.dispatchWebhookEvent(task.agentGaii, 'task.updated', {
        task_id: task.id,
        title: task.title,
        status: updated?.status ?? task.status,
        changed_fields: ['todos', 'status'],
        todo_count: (updated?.todos ?? []).length,
        pending_todo_count: (updated?.todos ?? []).filter((t: AgentTaskTodo) => t.status === 'pending').length,
        updated_at: now,
    });

    emitChange('agent-tasks', actor);
    return { ok: true, task: updated ?? null, todos: newTodos, outdatedCount: preserved.length, autoActivated };
}

// ── One todo ────────────────────────────────────────────────────────────────────────────────────

export type SetTodoStatusResult =
    | TaskWriteRefusal
    | { ok: true; task: AgentTaskRecord | null; todo: AgentTaskTodo };

/**
 * Move one todo to a new status.
 *
 * Ticking a todo is the agent showing up, so a stalled task resumes on it exactly as it does on an
 * event, and the task's `lastEventAt` moves with it — without that the stall detector counts an
 * agent that is visibly working as gone quiet.
 *
 * The matching event is appended here too. The HTTP door wrote none, so a task worked through
 * PATCH /todos/:todoId showed a plan filling in with nothing in its history to say when or by what.
 * `completedAt` is stamped on every terminal status, not on 'done' alone, because a failed or
 * skipped todo with no timestamp is a hole in that same history.
 */
export async function setTodoStatus(
    deps: TaskWriteDeps,
    task: AgentTaskRecord,
    todoId: string,
    body: unknown,
    actor?: string,
): Promise<SetTodoStatusResult> {
    const { storage } = deps;

    await resumeIfStalled(storage, task, 'agent updated a todo');
    if (task.status !== 'active') {
        return {
            ok: false, status: 409, code: 'INVALID_STATE',
            message: `Todo updates are only allowed on active tasks (current: ${task.status})`,
        };
    }

    const parsed = AgentTaskTodoUpdateSchema.safeParse(body);
    if (!parsed.success) return invalidInput(parsed.error.issues);
    const input = parsed.data;

    const todos = task.todos ?? [];
    const index = todos.findIndex(t => t.id === todoId);
    if (index === -1) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Todo '${todoId}' not found in task` };
    }

    const now = new Date().toISOString();
    const terminal = ['done', 'failed', 'skipped'].includes(input.status);
    const updatedTodos: AgentTaskTodo[] = todos.map((t, i) => {
        if (i !== index) return t;
        return {
            ...t,
            status: input.status,
            completedAt: input.completed_at ?? (terminal ? now : t.completedAt),
        };
    });

    const updated = await storage.updateAgentTask(task.id, {
        todos: updatedTodos,
        lastEventAt: now,
        updatedAt: now,
    });

    const eventType = input.status === 'done' ? 'todo_completed' as const
        : input.status === 'failed' ? 'todo_failed' as const
            : 'progress' as const;
    await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: task.id,
        type: eventType,
        message: `TODO "${todos[index].title}" ${input.status}`,
        details: { todo_id: todoId, status: input.status },
        timestamp: now,
    });

    emitChange('agent-tasks', actor);
    return { ok: true, task: updated ?? null, todo: updatedTodos[index] };
}
