/**
 * @file src/services/mcp-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an MCP task (the Tasks extension, mcp/tasks-extension.ts) lives, and when it
 *   stops living. One memory record, `mcp.tasks.<taskId>`, in the namespace of the principal that
 *   made the call (resolveIdentity), with a one-hour ttlHours that the storage enforces on every
 *   read: a task is gone an hour after it was made, with nothing to sweep, which the spec allows (a
 *   server may discard a task after its ttlMs). Every function takes that principal and reads or
 *   writes only its namespace, so another principal's lookup of the same id finds nothing.
 *
 *   The record is created before the handle goes out (the spec's MUST: a tasks/get for the returned
 *   id resolves), and every later write is a compare-and-set (updateRecord), so a cancel and a
 *   finishing call cannot overwrite each other, and a terminal state never changes. The node may run
 *   several processes; the record is in the database, so each of them answers from the same state.
 * @structure McpTask · MCP_TASK_TTL_MS · createMcpTask · readMcpTask · settleMcpTask · cancelMcpTask ·
 *   countLiveMcpTasks · wireTask
 * @usage
 *   const task = await createMcpTask(storage, principal, 'aimeat_workflow_run');
 *   await settleMcpTask(storage, principal, task.taskId, { result });
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-mcp-tasks-laajennus-pitkille-ty-kalukutsuille).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { updateRecord, UNCHANGED } from './record-cas.js';

const KEY_PREFIX = 'mcp.tasks.';
/** One hour from creation: the Task's ttlMs and the record's ttlHours say the same thing. */
export const MCP_TASK_TTL_MS = 3_600_000;
const POLL_INTERVAL_MS = 2_000;
/** Headroom under the 1024 kB per-value ceiling for the rest of the record. */
const RESULT_MAX_BYTES = 900_000;
const INTERNAL_ERROR = -32603;

export type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'cancelled' | 'failed';

export interface McpTaskError { code: number; message: string; data?: unknown }

export interface McpTask {
    taskId: string;
    status: McpTaskStatus;
    statusMessage?: string;
    createdAt: string;
    lastUpdatedAt: string;
    ttlMs: number;
    pollIntervalMs: number;
    /** The tool the task runs, for the owner reading their agent's records. Not on the wire. */
    tool: string;
    result?: Record<string, unknown>;
    error?: McpTaskError;
}

const TERMINAL: ReadonlySet<McpTaskStatus> = new Set(['completed', 'cancelled', 'failed']);

const keyOf = (taskId: string): string => `${KEY_PREFIX}${taskId}`;

function parseTask(v: unknown): McpTask | null {
    const t = v as Partial<McpTask> | null | undefined;
    return t && typeof t.taskId === 'string' && typeof t.status === 'string' ? t as McpTask : null;
}

function write(storage: Storage, principal: string, taskId: string, mutate: (cur: McpTask | null) => McpTask | typeof UNCHANGED) {
    return updateRecord(storage, principal, keyOf(taskId), parseTask, mutate,
        { tag: 'mcp-task', tags: ['mcp', 'mcp-task'], ttlHours: MCP_TASK_TTL_MS / 3_600_000 });
}

/** The Task the wire carries: the record without the node's own `tool` field. */
export function wireTask(t: McpTask): Record<string, unknown> {
    const wire: Record<string, unknown> = { ...t };
    delete wire.tool;
    return wire;
}

/** A new `working` task, stored before the caller hands out its id. */
export async function createMcpTask(storage: Storage, principal: string, tool: string): Promise<McpTask> {
    const now = new Date().toISOString();
    const task: McpTask = {
        taskId: randomUUID(), status: 'working', statusMessage: `${tool} is running.`,
        createdAt: now, lastUpdatedAt: now, ttlMs: MCP_TASK_TTL_MS, pollIntervalMs: POLL_INTERVAL_MS, tool,
    };
    await write(storage, principal, task.taskId, () => task);
    return task;
}

/** The principal's own task, or null: an unknown id, an expired task and another principal's id read alike. */
export async function readMcpTask(storage: Storage, principal: string, taskId: string): Promise<McpTask | null> {
    return parseTask((await storage.getMemory(principal, keyOf(taskId)))?.value);
}

/** Live (non-terminal) tasks the principal holds. */
export async function countLiveMcpTasks(storage: Storage, principal: string): Promise<number> {
    const records = await storage.listMemory(principal, { prefix: KEY_PREFIX });
    return records.filter(r => { const t = parseTask(r.value); return !!t && !TERMINAL.has(t.status); }).length;
}

/**
 * Store how the call ended: `completed` with its result (a tool result with isError included, as the
 * spec requires), or `failed` with the JSON-RPC error. A task that ended first (a cancel) stays as it is.
 */
export async function settleMcpTask(
    storage: Storage, principal: string, taskId: string,
    outcome: { result: Record<string, unknown> } | { error: McpTaskError },
): Promise<void> {
    await write(storage, principal, taskId, (cur) => {
        if (!cur || TERMINAL.has(cur.status)) return UNCHANGED;
        const now = new Date().toISOString();
        if ('result' in outcome) {
            const result: Record<string, unknown> = { ...outcome.result };
            delete result.resultType;
            if (Buffer.byteLength(JSON.stringify(result), 'utf8') > RESULT_MAX_BYTES) {
                return { ...cur, status: 'failed', lastUpdatedAt: now, statusMessage: 'The result is too large to keep as a task result.',
                    error: { code: INTERNAL_ERROR, message: `The tool result is over ${RESULT_MAX_BYTES} bytes; call the tool again without the tasks extension to receive it directly.` } };
            }
            return { ...cur, status: 'completed', lastUpdatedAt: now, statusMessage: result.isError === true ? 'The tool reported an error.' : 'Done.', result };
        }
        return { ...cur, status: 'failed', lastUpdatedAt: now, statusMessage: outcome.error.message, error: outcome.error };
    });
}

/** Mark a live task cancelled. A terminal task stays as it is (the spec: cancellation is cooperative). */
export async function cancelMcpTask(storage: Storage, principal: string, taskId: string): Promise<void> {
    await write(storage, principal, taskId, (cur) => {
        if (!cur || TERMINAL.has(cur.status)) return UNCHANGED;
        return { ...cur, status: 'cancelled', lastUpdatedAt: new Date().toISOString(), statusMessage: 'Cancelled by the client. The run may still finish; its result is not kept.' };
    });
}
