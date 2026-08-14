/**
 * @file agent-tasks.ts
 * @description MCP tools for agent task management (list, get, propose todos, event, todo, complete, fail)
 * @structure
 *   - registerAgentTaskTools() -- registers all agent task tools on an McpServer instance
 * @usage
 *   import { registerAgentTaskTools } from './agent-tasks.js';
 *   registerAgentTaskTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   2026-08-14 — aimeat_task_create takes `scope`. The shared service and the HTTP route both took
 *     it; this tool could not express it, so a caller told to put a dispatch `kind` in the scope —
 *     which is what a fleet runner reads — built a task nothing would ever pick up, successfully.
 *   v1.8.0 — 2026-08-11 — The WRITES move to services/agent-task-write.ts: create, event, propose and
 *     todo now call the same functions the HTTP routes call, so these tools stop building their own
 *     records. Four differences closed with the move. Telemetry now ACCUMULATES instead of
 *     overwriting the task totals with the last event's numbers, so a forty-call task stops reading
 *     as a one-call task in the cost view. Title and description are capped as HTTP caps them (256 /
 *     10 000), so the node no longer accepts over MCP what it refuses over HTTP. Two identical
 *     commissions racing each other now answer with the winner instead of a raw unique-index error.
 *     And a created task emits the `task_assigned` tunnel wake, so a parked daemon starts within the
 *     second rather than on its next re-list. The agent webhook is the one thing still missing here:
 *     the dispatcher belongs to the HTTP router and the MCP server holds no instance of it.
 *   v1.x — 2026-08-11 — aimeat_task_complete and _fail call services/agent-task-fanout.ts.
 *     They wrote the record and did none of the eight things a completion sets off, so a
 *     workflow run that dispatched the task stayed on that step, the open item behind it never
 *     closed, the automation report was never sent, the agent's counters never moved and the
 *     runner's live-trace key was never reclaimed — one key per completed task, forever.
 *   v1.x — 2026-08-11 — Five differences from the REST task routes, none of which any suite
 *     exercised: task-runner auto-activation (a delegated task sat queued waiting for a click
 *     the owner was told they would not need), the live-plan guard on propose_todos (a mid-run
 *     re-proposal deleted every in-progress and completed todo), the stalled auto-resume on
 *     both the event and todo paths, and the readiness bar on complete.
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
import type { Storage, AgentTaskRecord } from '../storage/interface.js';
import { readinessRefusal } from '../middleware/readiness-gate.js';
import { createTask, recordTaskEvent, applyProposedPlan, setTodoStatus } from '../services/agent-task-write.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGAII, buildGAII } from '../utils/gaii.js';
import { taskWithFileHandles } from '../services/task-files.js';
import { afterTaskCompleted, failTask } from '../services/agent-task-fanout.js';
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
            scope: z.array(z.object({
                name: z.string().describe('Field name the receiving runner reads, e.g. "kind", "memory_key", "app_id".'),
                value: z.string(),
                type: z.enum(['text', 'url', 'memory_key', 'number', 'cron']).optional()
                    .describe('How to read the value. Defaults to "text".'),
                description: z.string().optional().describe('What this field is for, for whoever reads the task.'),
            })).max(20).optional()
                .describe('Named parameters the receiving runner DISPATCHES on, as opposed to the description, which is prose for a model to read. A fleet runner recognises work by a `kind` entry here and takes its pointers (a memory key, an app id) from the others — putting those in the title instead is the standard way to build a task nothing picks up.'),
        },
        annotationsFor('aimeat_task_create'),
        async ({ target_agent, title, description, status, files, scope }) => {
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
            // The write is services/agent-task-write.ts: the same validation, the same
            // one-live-commission guard, the same record, the same task-runner auto-activation and
            // the same tunnel wake POST /v1/agents/:name/tasks performs. This tool used to build its
            // own, which is how it ended up accepting an unbounded title, failing a racing pair with
            // a raw database error, and waking no daemon.
            const result = await createTask({ storage, config }, {
                agent: targetAgent,
                agentGaii: targetGaii,
                agentName: target_agent,
                creator: { gaii: agentGaii, sub: agentGaii, owner: callerParsed.owner },
                // 'queued' is THIS tool's documented default (an agent delegating work means the
                // target to see it now); the HTTP body defaults to 'draft', which is the owner
                // drafting a task in the dashboard.
                body: {
                    title,
                    description,
                    status: status ?? 'queued',
                    // `type` is optional here and required by the record, so it is defaulted at the
                    // seam rather than demanded of the caller: 'text' is what a dispatch key is, and
                    // a tool that refuses a task over a missing type field would be refusing the
                    // common case to satisfy a schema.
                    ...(scope?.length ? { scope: scope.map(s => ({ ...s, type: s.type ?? 'text' as const })) } : {}),
                    ...(files?.length ? { resources: { files: files.map(ref => ({ ref })) } } : {}),
                },
                actor: agentGaii,
            });
            if (!result.ok) {
                return { content: [{ type: 'text' as const, text: `${result.code}: ${result.message}` }], isError: true };
            }
            if (result.deduplicated) {
                return { content: [{ type: 'text' as const, text: JSON.stringify({
                    deduplicated: true, task_id: result.task.id, status: result.task.status,
                    note: 'An identical commission is already live for this agent; the existing one is returned instead of queueing a second.',
                }, null, 2) }] };
            }

            const created = result.task;
            emitResourceUpdated(targetGaii, `aimeat://agents/${target_agent}/tasks/${created.id}`);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        task_id: created.id,
                        target_agent,
                        status: created.status,
                        files: created.resources?.files?.length ?? 0,
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

            // Accepting a plan is services/agent-task-write.ts: the live-plan guard that stops a
            // mid-run re-proposal from dropping every in-progress and completed todo, the preserved
            // history, the renumbering, the task-runner auto-activation and its tail. This tool kept
            // a copy of all of it.
            const result = await applyProposedPlan({ storage, config }, task, todos.map(todo => ({
                title: todo.title,
                description: todo.description,
                verification: todo.verification,
                estimate_minutes: todo.estimate_minutes,
                // Work proposed through this tool is by definition the connected agent's own, and
                // this is the reason it states for that.
                environment: 'agent' as const,
                environment_reason: 'The connected agent can perform this work through AIMEAT MCP tools.',
            })), agentGaii);
            if (!result.ok) {
                return { content: [{ type: 'text' as const, text: `${result.code}: ${result.message}` }], isError: true };
            }

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        updated: true,
                        task_id,
                        status: result.task?.status ?? task.status,
                        todo_count: result.todos.length,
                        outdated_count: result.outdatedCount,
                        todos: result.todos.map(todo => ({
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

            // The auto-resume for an agent that briefly crashed and came back, the state gate, the
            // event and the telemetry roll-up are services/agent-task-write.ts. The copy here
            // OVERWROTE the task's telemetry totals with the last event's numbers, so an agent
            // reporting one AI call per event finished a forty-call task showing one.
            const result = await recordTaskEvent({ storage, config }, task, { type, message, details }, agentGaii);
            if (!result.ok) {
                return { content: [{ type: 'text' as const, text: `${result.code}: ${result.message}` }], isError: true };
            }

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        appended: true,
                        event_id: result.event.id,
                        task_id,
                        type: result.event.type,
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

            // Same as the event path, and the same service: ticking off a todo is the agent showing
            // up, so a stalled task resumes on it, the task's lastEventAt moves and the matching
            // todo_completed / todo_failed event is appended.
            const result = await setTodoStatus({ storage, config }, task, todo_id, { status }, agentGaii);
            if (!result.ok) {
                return { content: [{ type: 'text' as const, text: `${result.code}: ${result.message}` }], isError: true };
            }

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        updated: true,
                        task_id,
                        todo_id,
                        status,
                        todo_title: result.todo.title,
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
            // The same readiness bar the event path answers to. requireReadiness('standard') sits on
            // the REST completion route, and this tool had nothing: an agent that may not report
            // progress could still declare the whole task done.
            const notReady = await readinessRefusal(storage, agentGaii, 'standard');
            if (notReady) return { content: [{ type: 'text' as const, text: `READINESS_INSUFFICIENT: ${notReady}` }], isError: true };

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

            // Everything a completion sets off, which this tool used to do none of: the workflow run
            // that dispatched the task advances, the open item behind it closes, the agent's own
            // counters move, the runner's live-trace key is reclaimed, the automation report is sent
            // and its advisory outbox drained, and a public deliverable reaches the feed. The tool
            // answered "completed: true" and everything downstream simply never happened.
            await afterTaskCompleted({ storage, config }, task, updated ?? null, completionMessage,
                (updated ?? task).deliverableKey, agentGaii);

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

            // The whole failure — the allowed states, the record, the event and the fan-out — is
            // services/agent-task-fanout.ts. This copy had NARROWED it to an active task, so an
            // agent whose task had STALLED, which is the ordinary case for one that crashed, could
            // not report the failure at all: the task sat stalled, the workflow run that dispatched
            // it stayed on that step, and nothing said why.
            const failed = await failTask({ storage, config }, task, reason, agentGaii);
            if (!failed.ok) return { content: [{ type: 'text' as const, text: `${failed.code}: ${failed.message}` }], isError: true };
            const updated = failed.task;
            const now = updated.completedAt ?? new Date().toISOString();

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
