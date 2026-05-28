/**
 * @file agent-tasks.ts
 * @description MCP tools for agent task management (list, get, propose todos, event, todo, complete, fail)
 * @structure
 *   - registerAgentTaskTools() -- registers all agent task tools on an McpServer instance
 * @usage
 *   import { registerAgentTaskTools } from './agent-tasks.js';
 *   registerAgentTaskTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-05-28 -- Remove legacy agent-side task start tool; owners start queued tasks
 *   v1.2.0 -- 2026-05-28 -- Add TODO proposal tool for public MCP parity with connector MCP
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentTaskRecord, AgentTaskTodo } from '../storage/interface.js';

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

    // ── Tool 1: aimeat_task_list ──
    mcp.tool(
        'aimeat_task_list',
        'List tasks assigned to you',
        {
            status: z.enum(['draft', 'queued', 'active', 'stalled', 'done', 'failed']).optional()
                .describe('Filter by task status'),
            page: z.number().optional().describe('Page number (default 1)'),
            per_page: z.number().optional().describe('Results per page (default 20, max 100)'),
        },
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
        'Get full details of a specific task including TODOs, scope, rules, and verification',
        {
            task_id: z.string().describe('The task ID'),
        },
        async ({ task_id }) => {
            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

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
                        resources: task.resources,
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
        'Propose TODOs for a queued task before owner approval or onboarding auto-start',
        {
            task_id: z.string().describe('The task ID'),
            todos: z.array(z.object({
                title: z.string().describe('TODO title'),
                description: z.string().optional().describe('TODO details'),
                verification: z.string().optional().describe('How completion can be verified'),
                estimate_minutes: z.number().optional().describe('Estimated work time in minutes'),
            })).describe('Proposed TODO plan'),
        },
        async ({ task_id, todos }) => {
            const task = await storage.getAgentTask(task_id);
            if (!task) return { content: [{ type: 'text' as const, text: 'Task not found' }], isError: true };

            if (!isOwnTask(task)) {
                return { content: [{ type: 'text' as const, text: 'Access denied -- task belongs to another agent' }], isError: true };
            }

            if (!['queued', 'active'].includes(task.status)) {
                return { content: [{ type: 'text' as const, text: `TODOs can only be proposed on queued or active tasks (current: ${task.status})` }], isError: true };
            }

            const now = new Date().toISOString();
            const proposedTodos: AgentTaskTodo[] = todos.map((todo, index) => ({
                id: `todo-${index + 1}`,
                order: index + 1,
                title: todo.title,
                description: todo.description ?? '',
                environment: 'agent',
                environmentReason: 'The connected agent can perform this onboarding verification step through AIMEAT MCP tools.',
                verification: todo.verification ?? '',
                estimateMinutes: todo.estimate_minutes,
                status: 'pending',
            }));

            const updated = await storage.updateAgentTask(task_id, {
                todos: proposedTodos,
                lastEventAt: now,
                updatedAt: now,
            });

            await storage.appendTaskEvent({
                id: randomUUID(),
                taskId: task_id,
                type: 'progress',
                message: 'TODO plan proposed',
                details: { todo_count: proposedTodos.length },
                timestamp: now,
            });

            emitResourceUpdated(agentGaii, `aimeat://tasks/${task_id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        updated: true,
                        task_id,
                        status: updated?.status ?? task.status,
                        todo_count: proposedTodos.length,
                        todos: proposedTodos.map(todo => ({
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
        'Append a progress event to an active task',
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
        async ({ task_id, type, message, details }) => {
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
        'Update the status of a TODO item in a task',
        {
            task_id: z.string().describe('The task ID'),
            todo_id: z.string().describe('The TODO item ID'),
            status: z.enum(['pending', 'active', 'done', 'failed', 'skipped']).describe('New TODO status'),
        },
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
        'Complete an active task (transitions active -> done)',
        {
            task_id: z.string().describe('The task ID to complete'),
            message: z.string().optional().describe('Completion message'),
        },
        async ({ task_id, message }) => {
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

            await storage.appendTaskEvent({
                id: randomUUID(),
                taskId: task_id,
                type: 'completed',
                message: completionMessage,
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
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 8: aimeat_task_fail ──
    mcp.tool(
        'aimeat_task_fail',
        'Fail an active task (transitions active -> failed)',
        {
            task_id: z.string().describe('The task ID to fail'),
            reason: z.string().describe('Reason for failure'),
        },
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
