/**
 * @file src/mcp/tasks-extension.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP Tasks extension (`io.modelcontextprotocol/tasks`, the 2026-07-28 revision,
 *   github.com/modelcontextprotocol/ext-tasks specification/2026-07-28/tasks.md) on the stateless
 *   code path (mcp/modern-endpoint.ts). A `tools/call` that has not finished after
 *   config.mcpTaskAfterMs answers with a task handle instead of holding the request, the call goes on
 *   running, and the client reads the result with `tasks/get`. Clients and proxies cut a held
 *   request: claude.ai's connectors after about 240 seconds.
 *
 *   ONLY FOR A CLIENT THAT ASKS. The spec forbids a task for a request whose per-request
 *   capabilities do not name the extension, so every other call runs as it always did. A call that
 *   finishes before the threshold answers with its own result. The threshold 0 makes every call of a
 *   declaring client a task, which is also how the E2E suite gets a task without a slow tool.
 *
 *   THE RECORD IS services/mcp-tasks.ts: one memory record per task in the caller's own namespace,
 *   gone an hour after it was made. This file holds the protocol: which call becomes a task, the
 *   wire shapes, the capability check and the error codes. An unknown id, an expired task and
 *   another principal's id all answer "not found" (-32602).
 *
 *   WHAT IS NOT HERE. No tool asks for input in the middle of a run, so a task never enters
 *   `input_required`, and `tasks/update` acknowledges and ignores its responses (the spec says to
 *   ignore responses to keys that are not outstanding). `notifications/tasks` on a listen stream is
 *   optional and not sent: clients poll. Cancellation is cooperative: the record turns `cancelled`
 *   and the run's eventual result is not stored. Past 20 live tasks per principal a slow call holds
 *   the request, as it did before tasks.
 * @structure TASKS_EXTENSION · clientDeclaresTasks(mcp, extra) · installTasksExtension(mcp, deps)
 * @usage
 *   const server = await build(...);
 *   installTasksExtension(server, { storage, config, principal });  // modern servers only
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-mcp-tasks-laajennus-pitkille-ty-kalukutsuille).
 */
import { z } from 'zod';
import { ProtocolError, type McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import {
    cancelMcpTask, countLiveMcpTasks, createMcpTask, readMcpTask, settleMcpTask, wireTask, type McpTask, type McpTaskError,
} from '../services/mcp-tasks.js';
import { logger } from '../utils/logger.js';
import { wrapToolsCall } from './sdk-seams.js';

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';

/** Live tasks one principal may hold before a slow call holds the request again. */
const MAX_LIVE_TASKS = 20;

/** The JSON-RPC codes the spec names. */
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;

/** Whether this request's per-request capabilities name the extension (the SDK seeds them from the envelope). */
export function clientDeclaresTasks(mcp: McpServer, extra: unknown): boolean {
    const envelope = (extra as { mcpReq?: { envelope?: Record<string, unknown> } } | undefined)?.mcpReq?.envelope;
    const fromEnvelope = (envelope?.['io.modelcontextprotocol/clientCapabilities'] as { extensions?: Record<string, unknown> } | undefined)?.extensions;
    const declared = fromEnvelope ?? (mcp.server.getClientCapabilities() as { extensions?: Record<string, unknown> } | undefined)?.extensions;
    return !!declared && typeof declared === 'object' && TASKS_EXTENSION in declared;
}

function missingCapability(): ProtocolError {
    return new ProtocolError(MISSING_REQUIRED_CLIENT_CAPABILITY, 'Missing required client capability',
        { requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } });
}

/** A thrown error as the JSON-RPC error a task in `failed` carries. */
function rpcError(err: unknown): McpTaskError {
    if (err instanceof ProtocolError) return { code: err.code, message: err.message, ...(err.data !== undefined ? { data: err.data } : {}) };
    return { code: INTERNAL_ERROR, message: err instanceof Error ? err.message : String(err) };
}

export interface TasksDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The caller's identity (resolveIdentity of the verified token): the namespace its tasks live in. */
    principal: string;
}

/**
 * Advertise the extension on server/discover, answer a slow tools/call of a declaring client with a
 * task, and serve tasks/get, tasks/update and tasks/cancel. Call it on a 2026-07-28 server only: a
 * 2025-era session strips `resultType`, so a task handle would reach it as an empty tool result.
 */
export function installTasksExtension(mcp: McpServer, deps: TasksDeps): void {
    const { storage, config, principal } = deps;

    mcp.server.registerCapabilities({ extensions: { [TASKS_EXTENSION]: {} } } as Parameters<typeof mcp.server.registerCapabilities>[0]);

    wrapToolsCall(mcp, (original) => async (request, extra) => {
        if (!clientDeclaresTasks(mcp, extra)) return original(request, extra);
        // The outcome is taken at once, so a call that fails before anyone waits on it is still handled.
        const outcome = original(request, extra).then(
            (v): { result: unknown } => ({ result: v }),
            (e): { error: unknown } => ({ error: e }),
        );
        const unwrap = async () => { const o = await outcome; if ('error' in o) throw o.error; return o.result; };
        const after = config.mcpTaskAfterMs;
        if (after > 0) {
            let timer: NodeJS.Timeout | undefined;
            const late = Symbol('late');
            const first = await Promise.race([outcome, new Promise<typeof late>(resolve => { timer = setTimeout(() => resolve(late), after); })]);
            clearTimeout(timer);
            if (first !== late) return unwrap();
        }
        if (await countLiveMcpTasks(storage, principal) >= MAX_LIVE_TASKS) return unwrap();

        const tool = typeof request.params?.name === 'string' ? request.params.name : '';
        const task: McpTask = await createMcpTask(storage, principal, tool);
        void outcome.then((o) => settleMcpTask(storage, principal, task.taskId,
            'error' in o ? { error: rpcError(o.error) } : { result: (o.result ?? {}) as Record<string, unknown> }),
        ).catch(err => logger.warn('mcp-tasks: the outcome of a task was not stored', { taskId: task.taskId, error: String(err) }));
        return { resultType: 'task', ...wireTask(task) };
    });

    const TaskIdParams = z.object({ taskId: z.string().min(1).max(200) }).passthrough();
    const AnyResult = z.object({}).passthrough();

    async function ownTask(taskId: string): Promise<McpTask> {
        const task = await readMcpTask(storage, principal, taskId);
        if (!task) throw new ProtocolError(INVALID_PARAMS, 'Failed to retrieve task: Task not found');
        return task;
    }

    mcp.server.setRequestHandler('tasks/get', { params: TaskIdParams, result: AnyResult }, async (params, ctx) => {
        if (!clientDeclaresTasks(mcp, ctx)) throw missingCapability();
        return wireTask(await ownTask(params.taskId));
    });

    mcp.server.setRequestHandler('tasks/update', {
        params: TaskIdParams.extend({ inputResponses: z.record(z.string(), z.unknown()).optional() }),
        result: AnyResult,
    }, async (params, ctx) => {
        if (!clientDeclaresTasks(mcp, ctx)) throw missingCapability();
        await ownTask(params.taskId);
        // No task asks for input, so no key is outstanding and every response is ignored (spec, Task Update Requests).
        return {};
    });

    mcp.server.setRequestHandler('tasks/cancel', { params: TaskIdParams, result: AnyResult }, async (params, ctx) => {
        if (!clientDeclaresTasks(mcp, ctx)) throw missingCapability();
        await ownTask(params.taskId);
        await cancelMcpTask(storage, principal, params.taskId);
        return {};
    });
}
