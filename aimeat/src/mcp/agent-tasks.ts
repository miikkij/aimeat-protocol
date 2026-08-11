/**
 * @file agent-tasks.ts
 * @description MCP tools for agent task management (list, get, propose todos, event, todo, complete, fail)
 * @structure
 *   - registerAgentTaskTools() -- registers all agent task tools on an McpServer instance
 * @usage
 *   import { registerAgentTaskTools } from './agent-tasks.js';
 *   registerAgentTaskTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.7.0 — 2026-08-01 — TARGET-058 Phase 4: aimeat_task_complete accepts an `ai_provenance`
 *     declaration and stamps the completion message — the text the OWNER reads when they look at
 *     what their agent did. The link rides in the event's `details` rather than a column of its
 *     own, because `details` is already the per-event metadata home and one of thirteen event
 *     types carrying a dedicated column would be the odd row out in every query on the table.
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-05-28 -- Remove legacy agent-side task start tool; owners start queued tasks
 *   v1.2.0 -- 2026-05-28 -- Add TODO proposal tool for public MCP parity with connector MCP
 *   v1.3.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.4.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.5.0 -- 2026-07-14 -- propose_todos auto-activates a queued task when the agent's mode is
 *     task-runner (started event + task_assigned push) -- parity with the REST propose-todos route.
 *   v1.6.0 -- 2026-07-26 -- aimeat_task_create takes `files` (attachments by reference) and
 *     aimeat_task_get returns each attachment as a presigned handle authorized for the reading agent.
 *     Previously an attachments field was silently dropped: the call answered 201 while the file
 *     vanished, so delegating file-shaped work looked like it worked and did not.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo } from '../storage/interface.js';
import { readinessRefusal } from '../middleware/readiness-gate.js';
import { commissionFingerprint } from '../routes/agent-tasks/dedupe.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGAII, buildGAII } from '../utils/gaii.js';
import { resolveTaskFileInputs, taskWithFileHandles } from '../services/task-files.js';
import { emitDelivery } from '../services/event-bus.js';
import { recordTaskStarted } from '../services/activity-recorder.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { provenanceForWrite } from '../services/ai-provenance.js';

export function registerAgentTaskTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    /** Check if a task belongs to the current agent. */
    function isOwnTask(task: AgentTaskRecord): boolean {
        return task.agentGaii === agentGaii;
    }

    // ── Tool 0: aimeat_task_create ──
    // Lets the calling agent create a task for ANY same-owner agent. Used by
    // Claude Desktop and other orchestrator agents to delegate work to crew-style
    // agents (e.g. demo-crew). The target agent must belong to the same owner.
    mcp.tool(
        'aimeat_task_create',
        descriptionFor('aimeat_task_create'),
        {
            target_agent: z.string().describe('Name of the agent the task is FOR. Must be owned by the same owner as the calling agent.'),
            title: z.string().describe('Short human-readable title for the task.'),
            description: z.string().describe('The actual prompt / instruction for the target agent.'),
            status: z.enum(['draft', 'queued']).optional().describe('Default "queued" (visible to target immediately).'),
            files: z.array(z.string()).max(20).optional()
                .describe('Files the target agent needs, by REFERENCE: "<owner@node>/<storage key>" (or a bare key for one of your own files). Upload first via aimeat_storage_upload, or pass the `ref` from a DM attachment. You must be able to read each file yourself; the target agent gets a presigned download_url from aimeat_task_get.'),
        },
        annotationsFor('aimeat_task_create'),
        async ({ target_agent, title, description, status, files }) => {
            const callerParsed = parseGAII(agentGaii);
            if (!callerParsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            const targetGaii = buildGAII(target_agent, callerParsed.owner, config.nodeId);
            const targetAgent = await storage.getAgent(targetGaii);
            if (!targetAgent) {
                return {
                    content: [{ type: 'text' as const, text: `Target agent '${target_agent}' not found under owner '${callerParsed.owner}'. Use aimeat_agents_list to see available agents.` }],
                    isError: true,
                };
            }
            const fileResult = await resolveTaskFileInputs(
                storage, config, files?.map(ref => ({ ref })),
                { gaii: agentGaii, sub: agentGaii, owner: callerParsed.owner },
            );
            if ('error' in fileResult) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({ error: fileResult.error.message, code: fileResult.error.code }, null, 2) }], isError: true };
            }

            // One live commission per (agent, fingerprint), as POST /v1/agent-tasks does. Without
            // it, a repeated delegation over MCP queues duplicate runs the owner pays for, and the
            // row carries no dedupeKey so nothing downstream can collapse them either. An agent
            // retrying after a timeout is the ordinary case, not the exotic one.
            const dedupeKey = commissionFingerprint(targetGaii, undefined, title, description);
            const live = await storage.findLiveTaskByDedupeKey(targetGaii, dedupeKey);
            if (live) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({
                    deduplicated: true, task_id: live.id, status: live.status,
                    note: 'An identical commission is already live for this agent; the existing one is returned instead of queueing a second.',
                }, null, 2) }] };
            }

            const now = new Date().toISOString();
            const id = randomUUID();
            const record: AgentTaskRecord = {
                id,
                agentGaii: targetGaii,
                ownerGaii: `${callerParsed.owner}@${config.nodeId}`,
                title: title.trim(),
                description: description.trim(),
                scope: [],
                rules: [],
                verification: { userExpects: '', technicalChecks: [] },
                ...(fileResult.files.length ? { resources: { files: fileResult.files } } : {}),
                todos: [],
                status: (status ?? 'queued') as AgentTaskRecord['status'],
                dedupeKey,
                createdAt: now,
                updatedAt: now,
            };
            const created = await storage.createAgentTask(record);
            emitResourceUpdated(targetGaii, `aimeat://agents/${target_agent}/tasks/${id}`);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        task_id: created.id,
                        target_agent,
                        status: created.status,
                        files: fileResult.files.length,
                        created_at: created.createdAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 1: aimeat_task_list ──
    mcp.tool(
        'aimeat_task_list',
        descriptionFor('aimeat_task_list'),
        {
            status: z.enum(['draft', 'queued', 'active', 'stalled', 'done', 'failed']).optional()
                .describe('Filter by task status'),
            page: z.number().optional().describe('Page number (default 1)'),
            per_page: z.number().optional().describe('Results per page (default 20, max 100)'),
        },
        annotationsFor('aimeat_task_list'),
        async ({ status, page, per_page }) => {
            const pageNum = Math.max(1, page ?? 1);
            const perPage = Math.min(100, Math.max(1, per_page ?? 20));

            const result = await storage.listAgentTasks(agentGaii, {
                status,
                page: pageNum,
                perPage,
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        tasks: result.tasks.map(t => ({
                            id: t.id,
                            title: t.title,
                            status: t.status,
                            todos_total: t.todos.length,
                            todos_done: t.todos.filter(td => td.status === 'done').length,
                            created_at: t.createdAt,
                            updated_at: t.updatedAt,
                            last_event_at: t.lastEventAt,
                        })),
                        total: result.total,
                        page: pageNum,
                        per_page: perPage,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_task_get ──
    mcp.tool(
        'aimeat_task_get',
        descriptionFor('aimeat_task_get'),
        {
            task_id: z.string().describe('The task ID'),
        },
        annotationsFor('aimeat_task_get'),
        async ({ task_id }) => {
            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

            // Attachments become presigned handles here, authorized for THIS agent on THIS read — the
            // task assignment carries the reference, the read carries the permission.
            const withFiles = await taskWithFileHandles(storage, config, task, {
                gaii: agentGaii, sub: agentGaii, owner: parseGAII(agentGaii)?.owner,
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: task.id,
                        title: task.title,
                        description: task.description,
                        status: task.status,
                        scope: task.scope,
                        rules: task.rules,
                        verification: task.verification,
                        resources: withFiles.resources,
                        todos: task.todos.map(t => ({
                            id: t.id,
                            order: t.order,
                            title: t.title,
                            description: t.description,
                            environment: t.environment,
                            environment_reason: t.environmentReason,
                            verification: t.verification,
                            estimate_minutes: t.estimateMinutes,
                            status: t.status,
                            completed_at: t.completedAt,
                        })),
                        parent_task_id: task.parentTaskId,
                        telemetry: task.telemetry,
                        last_event_at: task.lastEventAt,
                        created_at: task.createdAt,
                        updated_at: task.updatedAt,
                        completed_at: task.completedAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_task_propose_todos ──
    mcp.tool(
        'aimeat_task_propose_todos',
        descriptionFor('aimeat_task_propose_todos'),
        {
            task_id: z.string().describe('The task ID'),
            todos: z.array(z.object({
                title: z.string().describe('TODO title'),
                description: z.string().optional().describe('TODO details'),
                verification: z.string().optional().describe('How completion can be verified'),
                estimate_minutes: z.number().optional().describe('Estimated work time in minutes'),
            })).describe('Proposed TODO plan'),
        },
        annotationsFor('aimeat_task_propose_todos'),
        async ({ task_id, todos }) => {
            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

            if (!['queued', 'revision_requested', 'active'].includes(task.status)) {
                return { content: [{ type: 'text' as const, text: `TODOs can only be proposed on queued, revision_requested, or active tasks (current: ${task.status})` }], isError: true };
            }

            const now = new Date().toISOString();
            // Preserve outdated history (from prior revision cycles) and retire still-
            // pending todos to outdated when the task is in revision_requested state.
            // This mirrors POST /v1/agents/:name/tasks/:id/propose-todos exactly.
            const preserved: AgentTaskTodo[] = (task.todos ?? []).flatMap(t => {
                if (t.status === 'outdated') return [t];
                if (task.status === 'revision_requested') return [{ ...t, status: 'outdated' as const }];
                return [];
            });
            const baseOrder = preserved.length;
            const newTodos: AgentTaskTodo[] = todos.map((todo, index) => ({
                id: `todo-${baseOrder + index + 1}`,
                order: baseOrder + index + 1,
                title: todo.title,
                description: todo.description ?? '',
                environment: 'agent',
                environmentReason: 'The connected agent can perform this work through AIMEAT MCP tools.',
                verification: todo.verification ?? '',
                estimateMinutes: todo.estimate_minutes,
                status: 'pending',
            }));

            // Task-runner auto-approval (mirrors POST /propose-todos in routes/agent-tasks/lifecycle.ts):
            // the owner pre-authorized a task-runner agent to start work without per-task gating, so a
            // proposal on a plain 'queued' task activates it immediately (zero-click onboarding). A
            // revision cycle still returns to 'queued' -- the owner explicitly asked to review the plan.
            let nextStatus: AgentTaskRecord['status'] = task.status === 'revision_requested' ? 'queued' : task.status;
            let autoActivated = false;
            if (task.status === 'queued') {
                const agent = await storage.getAgent(task.agentGaii);
                if (agent?.mode === 'task-runner') {
                    nextStatus = 'active';
                    autoActivated = true;
                }
            }

            const updated = await storage.updateAgentTask(task_id, {
                todos: [...preserved, ...newTodos],
                status: nextStatus,
                lastEventAt: now,
                updatedAt: now,
            });

            await storage.appendTaskEvent({
                id: randomUUID(),
                taskId: task_id,
                type: 'progress',
                message: task.status === 'revision_requested' ? 'Revised TODO plan proposed' : 'TODO plan proposed',
                details: { todo_count: newTodos.length, outdated_count: preserved.length },
                timestamp: now,
            });

            if (autoActivated) {
                await storage.appendTaskEvent({
                    id: randomUUID(),
                    taskId: task_id,
                    type: 'started',
                    message: 'Task auto-activated on TODO proposal (agent mode: task-runner)',
                    timestamp: now,
                });
                await recordTaskStarted(storage, task.agentGaii);
                emitDelivery({ target: task.agentGaii, kind: 'task_assigned', id: task_id, payload: updated });
            }

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        updated: true,
                        task_id,
                        status: updated?.status ?? task.status,
                        todo_count: newTodos.length,
                        outdated_count: preserved.length,
                        todos: newTodos.map(todo => ({
                            id: todo.id,
                            order: todo.order,
                            title: todo.title,
                            status: todo.status,
                        })),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 4: aimeat_task_event ──
    mcp.tool(
        'aimeat_task_event',
        descriptionFor('aimeat_task_event'),
        {
            task_id: z.string().describe('The task ID'),
            type: z.enum([
                'started', 'progress', 'todo_completed', 'todo_failed',
                'memory_write', 'extension_install', 'app_publish',
                'verification', 'completed', 'failed', 'message',
            ]).describe('Event type'),
            message: z.string().describe('Event message'),
            details: z.record(z.string(), z.unknown()).optional().describe('Optional event details (may include telemetry)'),
        },
        annotationsFor('aimeat_task_event'),
        async ({ task_id, type, message, details }) => {
            // The readiness bar POST /v1/agent-tasks/:id/events applies. It was middleware, so this
            // door had none: an agent below the standard level was refused over HTTP and wrote the
            // same events freely here.
            const notReady = await readinessRefusal(storage, agentGaii, 'standard');
            if (notReady) return { content: [{ type: 'text' as const, text: `READINESS_INSUFFICIENT: ${notReady}` }], isError: true };

            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

            if (task.status !== 'active') {
                return { content: [{ type: 'text' as const, text: `Events can only be appended to active tasks (current: ${task.status})` }], isError: true };
            }

            const now = new Date().toISOString();

            const event = await storage.appendTaskEvent({
                id: randomUUID(),
                taskId: task_id,
                type,
                message,
                details,
                timestamp: now,
            });

            // Update lastEventAt and optionally telemetry
            const taskUpdates: Partial<AgentTaskRecord> = {
                lastEventAt: now,
                updatedAt: now,
            };
            if (details?.telemetry) {
                const tel = details.telemetry as Record<string, unknown>;
                taskUpdates.telemetry = {
                    aiCalls: typeof tel.ai_calls === 'number' ? tel.ai_calls : task.telemetry?.aiCalls,
                    tokensIn: typeof tel.tokens_in === 'number' ? tel.tokens_in : task.telemetry?.tokensIn,
                    tokensOut: typeof tel.tokens_out === 'number' ? tel.tokens_out : task.telemetry?.tokensOut,
                    durationSeconds: typeof tel.duration_seconds === 'number' ? tel.duration_seconds : task.telemetry?.durationSeconds,
                };
            }
            await storage.updateAgentTask(task_id, taskUpdates);

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        appended: true,
                        event_id: event.id,
                        task_id,
                        type: event.type,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 5: aimeat_task_todo ──
    mcp.tool(
        'aimeat_task_todo',
        descriptionFor('aimeat_task_todo'),
        {
            task_id: z.string().describe('The task ID'),
            todo_id: z.string().describe('The TODO item ID'),
            status: z.enum(['pending', 'active', 'done', 'failed', 'skipped']).describe('New TODO status'),
        },
        annotationsFor('aimeat_task_todo'),
        async ({ task_id, todo_id, status }) => {
            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

            if (task.status !== 'active') {
                return { content: [{ type: 'text' as const, text: `TODOs can only be updated on active tasks (current: ${task.status})` }], isError: true };
            }

            const todoIdx = task.todos.findIndex(t => t.id === todo_id);
            if (todoIdx === -1) {
                return { content: [{ type: 'text' as const, text: `TODO '${todo_id}' not found in task` }], isError: true };
            }

            const now = new Date().toISOString();

            // Update the TODO
            const updatedTodos: AgentTaskTodo[] = task.todos.map((t, i) => {
                if (i !== todoIdx) return t;
                return {
                    ...t,
                    status,
                    completedAt: ['done', 'failed', 'skipped'].includes(status) ? now : t.completedAt,
                };
            });

            await storage.updateAgentTask(task_id, {
                todos: updatedTodos,
                lastEventAt: now,
                updatedAt: now,
            });

            // Append appropriate event
            const eventType = status === 'done' ? 'todo_completed' as const
                : status === 'failed' ? 'todo_failed' as const
                    : 'progress' as const;
            const todoTitle = task.todos[todoIdx].title;

            await storage.appendTaskEvent({
                id: randomUUID(),
                taskId: task_id,
                type: eventType,
                message: `TODO "${todoTitle}" ${status}`,
                details: { todo_id, status },
                timestamp: now,
            });

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        updated: true,
                        task_id,
                        todo_id,
                        status,
                        todo_title: todoTitle,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 7: aimeat_task_complete ──
    mcp.tool(
        'aimeat_task_complete',
        descriptionFor('aimeat_task_complete'),
        {
            task_id: z.string().describe('The task ID to complete'),
            message: z.string().optional().describe('Completion message'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_task_complete'),
        async ({ task_id, message, ai_provenance, ai_provenance_id }) => {
            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

            if (task.status !== 'active') {
                return { content: [{ type: 'text' as const, text: `Only active tasks can be completed (current: ${task.status})` }], isError: true };
            }

            const now = new Date().toISOString();
            const completionMessage = message ?? 'Task completed';

            const updated = await storage.updateAgentTask(task_id, {
                status: 'done',
                completedAt: now,
                lastEventAt: now,
                updatedAt: now,
            });

            // TARGET-058. The completion message is what the OWNER reads when they look at what their
            // agent did, so it is stamped like any other text an agent writes for a person.
            //
            // The link lives in the event's `details` rather than in a column of its own, unlike
            // memory / apps / direct messages. That is deliberate: `details` is already the designed
            // home for per-event metadata, and a column carried by exactly one of thirteen event
            // types would be the odd row out in every query that touches the table. The RECORD is the
            // same record everywhere; only where the pointer sits differs.
            const aiProvenanceId = await provenanceForWrite(storage, {
                principal: agentGaii,
                content: completionMessage,
                declaredId: ai_provenance_id,
                declared: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.task_complete',
                surface: { visibility: 'private', humanAudience: true },
                labelPolicy: config.aiLabelPublic,
                nodeId: config.nodeId,
                baseUrl: config.baseUrl,
                enabled: config.aiProvenance,
            });

            await storage.appendTaskEvent({
                id: randomUUID(),
                taskId: task_id,
                type: 'completed',
                message: completionMessage,
                ...(aiProvenanceId ? { details: { aiProvenanceId } } : {}),
                timestamp: now,
            });

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        completed: true,
                        task_id,
                        status: updated?.status ?? 'done',
                        completed_at: now,
                        ...(await writeProvenanceEcho(storage, config, aiProvenanceId)),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 8: aimeat_task_fail ──
    mcp.tool(
        'aimeat_task_fail',
        descriptionFor('aimeat_task_fail'),
        {
            task_id: z.string().describe('The task ID to fail'),
            reason: z.string().describe('Reason for failure'),
        },
        annotationsFor('aimeat_task_fail'),
        async ({ task_id, reason }) => {
            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

            if (task.status !== 'active') {
                return { content: [{ type: 'text' as const, text: `Only active tasks can be failed (current: ${task.status})` }], isError: true };
            }

            const now = new Date().toISOString();

            const updated = await storage.updateAgentTask(task_id, {
                status: 'failed',
                completedAt: now,
                lastEventAt: now,
                updatedAt: now,
            });

            await storage.appendTaskEvent({
                id: randomUUID(),
                taskId: task_id,
                type: 'failed',
                message: reason,
                timestamp: now,
            });

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        failed: true,
                        task_id,
                        status: updated?.status ?? 'failed',
                        reason,
                        completed_at: now,
                    }, null, 2),
                }],
            };
        },
    );
}
