/**
 * @file src/services/agent-v2-tasks-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The authorised operations behind Agent v2 tasks. Every door — REST, node MCP,
 *   connector MCP, CLI dispatch — calls these, so the fences are written once.
 *
 *   WHO MAY DO WHAT, AND WHY THE THREE ANSWERS DIFFER:
 *     create   any principal of the account, for any other principal of the account.
 *     status   the ASSIGNEE, and the account holder. Not the caller: a caller that could mark its
 *              own request completed could report work that was never done, and the whole point of
 *              a handle is that its status is the worker's testimony.
 *     cancel   the CALLER, and the account holder. Not the assignee: a worker that could cancel
 *              what it was asked to do would be refusing by a door meant for changing one's mind.
 *              A worker that will not do the work says so with `failed`, which records a reason.
 *
 *   A TERMINAL TASK NEVER MOVES. Every write goes through `settleAgentV2Task`, which is conditional
 *   on the current status: a worker completing while the caller cancels is a real race, and a read
 *   followed by a write lets both through and discards whichever lost in silence. The conditional
 *   update answers which call actually moved it, and the loser is told so rather than being told
 *   nothing.
 *
 * @structure createTask() · listTasks() · getTask() · setTaskStatus() · cancelTask()
 * @usage const out = await createTask(storage, config, req.auth!, req.body);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentV2TaskRecord, AgentV2TaskStatus } from '../storage/interface.js';
import { V2_TASK_STATUSES } from '../storage/types/agent-v2-tasks.js';
import { resolveIdentity } from '../utils/gaii.js';
import { validateTaskInput, validateStatusInput, allowedFrom, isTerminal } from '../models/agent-v2-task.js';
import { resolveRecipient, type Principal, type OpResult } from './agent-v2-messaging-ops.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { emitDelivery, emitTaskMoved } from './event-bus.js';
import { logger } from '../utils/logger.js';

/** The tunnel `deliver` kinds for task news. Additive: the wire's `kind` is an open string. */
export const TASK_ASSIGNED_KIND = 'v2.task.assigned';
export const TASK_UPDATED_KIND = 'v2.task.updated';

const MAX_LIST_LIMIT = 200;

function isOwnerSession(auth: Principal): boolean {
  const roles = auth.roles ?? [];
  return roles.includes('owner') && !roles.includes('agent') && !roles.includes('ecosystem');
}

/** Tell a principal something happened to a task it cares about. Never fails the operation. */
function notify(target: string, kind: string, task: AgentV2TaskRecord): void {
  // UNCONDITIONAL, and before the tunnel gate. An A2A client streaming this task is not anybody's
  // connector and holds no tunnel, so gating this the way the delivery below is gated would mean a
  // subscriber heard about a task only when some OTHER principal happened to be online. It carries
  // the id and nothing else; the listener re-reads through the same op every other reader uses.
  try {
    emitTaskMoved(task.taskId);
  } catch (err) {
    logger.warn('v2 task: the move event failed; the task is stored and readable', {
      taskId: task.taskId, error: String(err),
    });
  }
  try {
    if (getActiveConnectTunnelManager()?.isConnected(target)) {
      emitDelivery({ target, kind, id: task.taskId, payload: { taskId: task.taskId, status: task.status, contextId: task.contextId } });
    }
  } catch (err) {
    logger.warn('v2 task: the tunnel notification failed; the task is stored and readable', {
      taskId: task.taskId, target, error: String(err),
    });
  }
}

export async function createTask(
  storage: Storage, config: AimeatConfig, auth: Principal, body: unknown,
): Promise<OpResult<AgentV2TaskRecord>> {
  const parsed = validateTaskInput(body);
  if (!parsed.ok || !parsed.task) {
    return {
      ok: false, status: 400, code: 'INVALID_TASK',
      message: 'This task cannot be created as written. Every defect is listed in details.defects.',
      details: { defects: parsed.defects },
    };
  }
  const input = parsed.task;
  const assignee = await resolveRecipient(storage, config.nodeId, auth.owner, input.assignedTo);
  if (!assignee.ok) return assignee;

  const now = new Date().toISOString();
  const taskId = randomUUID();
  const task: AgentV2TaskRecord = {
    taskId,
    // Created, not started: `startedAt` stays null until somebody picks it up, and that is the
    // distinction A2A calls `submitted` and MCP has no status for.
    status: 'working',
    statusMessage: input.statusMessage,
    contextId: input.contextId?.trim() || taskId,
    owner: auth.owner,
    createdBy: resolveIdentity(auth, config.nodeId),
    assignedTo: input.assignedTo,
    input: input.input,
    result: null,
    error: null,
    createdAt: now,
    lastUpdatedAt: now,
    startedAt: null,
    completedAt: null,
    ttlMs: input.ttlMs,
    pollIntervalMs: input.pollIntervalMs,
    metadata: input.metadata,
  };
  await storage.createAgentV2Task(task);
  notify(task.assignedTo, TASK_ASSIGNED_KIND, task);
  return { ok: true, value: task };
}

export interface TaskFilter {
  context_id?: string;
  assigned_to?: string;
  created_by?: string;
  /** CSV or array of MCP statuses. An unrecognised one is refused rather than ignored. */
  status?: string | string[];
  limit?: number;
}

export async function listTasks(
  storage: Storage, auth: Principal, filter: TaskFilter,
): Promise<OpResult<AgentV2TaskRecord[]>> {
  let statuses: AgentV2TaskStatus[] | undefined;
  if (filter.status !== undefined) {
    const asked = Array.isArray(filter.status) ? filter.status : String(filter.status).split(',');
    const cleaned = asked.map(s => s.trim()).filter(s => s !== '');
    const bad = cleaned.filter(s => !(V2_TASK_STATUSES as readonly string[]).includes(s));
    if (bad.length > 0) {
      // Refused rather than dropped: a filter that does not filter returns everything and reads as
      // a working query, which is how a roster loop silently starts picking up finished work.
      return {
        ok: false, status: 400, code: 'INVALID_STATUS',
        message: `Not a task status: ${bad.join(', ')}. Use one or more of ${V2_TASK_STATUSES.join(', ')}.`,
      };
    }
    if (cleaned.length > 0) statuses = cleaned as AgentV2TaskStatus[];
  }
  const raw = Number(filter.limit ?? 50);
  const limit = Number.isFinite(raw) ? Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(raw))) : 50;

  const tasks = await storage.listAgentV2Tasks(auth.owner, {
    contextId: filter.context_id,
    assignedTo: filter.assigned_to,
    createdBy: filter.created_by,
    status: statuses,
    limit,
  });
  return { ok: true, value: tasks };
}

export async function getTask(storage: Storage, auth: Principal, taskId: string): Promise<OpResult<AgentV2TaskRecord>> {
  const task = await storage.getAgentV2Task(auth.owner, taskId);
  if (!task) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such task on this account.' };
  return { ok: true, value: task };
}

/**
 * Move a task. Only the assignee or the account holder may: the status is the worker's testimony
 * about the work, and a caller able to write it could report work that never happened.
 */
export async function setTaskStatus(
  storage: Storage, config: AimeatConfig, auth: Principal, taskId: string, body: unknown,
): Promise<OpResult<AgentV2TaskRecord>> {
  const parsed = validateStatusInput(body);
  if (!parsed.ok || !parsed.change) {
    return {
      ok: false, status: 400, code: 'INVALID_STATUS_CHANGE',
      message: 'This status change cannot be made as written. Every defect is listed in details.defects.',
      details: { defects: parsed.defects },
    };
  }
  const change = parsed.change;
  const task = await storage.getAgentV2Task(auth.owner, taskId);
  if (!task) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such task on this account.' };

  const self = resolveIdentity(auth, config.nodeId);
  if (task.assignedTo !== self && !isOwnerSession(auth)) {
    return {
      ok: false, status: 403, code: 'ACCESS_DENIED',
      message: 'A task\'s status is the assignee\'s to report. To stop work you asked for, cancel it instead.',
    };
  }
  if (isTerminal(task.status)) {
    return {
      ok: false, status: 409, code: 'TASK_SETTLED',
      message: `This task is already ${task.status} and does not move again.`,
    };
  }

  const now = new Date().toISOString();
  const terminal = isTerminal(change.status);
  const moved = await storage.settleAgentV2Task(auth.owner, taskId, allowedFrom(), {
    status: change.status,
    statusMessage: change.statusMessage ?? task.statusMessage,
    result: change.result ?? undefined,
    error: change.error ?? undefined,
    // The first move by the assignee is what "started" means. A2A reads a task with no startedAt as
    // `submitted`, so this is the write that turns it into `working`.
    startedAt: task.startedAt ?? now,
    completedAt: terminal ? now : undefined,
    ttlMs: change.ttlMs ?? undefined,
    pollIntervalMs: change.pollIntervalMs ?? undefined,
  }, now);

  if (!moved) {
    // Somebody else settled it between the read and the write. Saying so is the point: the loser of
    // this race must not believe it wrote.
    return {
      ok: false, status: 409, code: 'TASK_SETTLED',
      message: 'This task settled while the change was in flight. Read it again to see what it became.',
    };
  }

  const after = await storage.getAgentV2Task(auth.owner, taskId);
  if (after) notify(after.createdBy, TASK_UPDATED_KIND, after);
  return { ok: true, value: after ?? task };
}

/**
 * Cancel. Only the caller or the account holder may: a worker refusing what it was asked to do says
 * so with `failed`, which records a reason, rather than through a door meant for changing one's
 * mind.
 */
export async function cancelTask(
  storage: Storage, config: AimeatConfig, auth: Principal, taskId: string, reason?: string,
): Promise<OpResult<AgentV2TaskRecord>> {
  const task = await storage.getAgentV2Task(auth.owner, taskId);
  if (!task) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No such task on this account.' };

  const self = resolveIdentity(auth, config.nodeId);
  if (task.createdBy !== self && !isOwnerSession(auth)) {
    return {
      ok: false, status: 403, code: 'ACCESS_DENIED',
      message: 'Cancelling belongs to whoever asked for the work. If you will not do it, report it failed with a reason.',
    };
  }
  if (isTerminal(task.status)) {
    return {
      ok: false, status: 409, code: 'TASK_SETTLED',
      message: `This task is already ${task.status} and does not move again.`,
    };
  }

  const now = new Date().toISOString();
  const moved = await storage.settleAgentV2Task(auth.owner, taskId, allowedFrom(), {
    status: 'cancelled',
    statusMessage: reason && reason.trim() !== '' ? reason.trim() : 'Cancelled by whoever asked for it.',
    completedAt: now,
  }, now);
  if (!moved) {
    return {
      ok: false, status: 409, code: 'TASK_SETTLED',
      message: 'This task settled while the cancel was in flight. Read it again to see what it became.',
    };
  }

  const after = await storage.getAgentV2Task(auth.owner, taskId);
  if (after) notify(after.assignedTo, TASK_UPDATED_KIND, after);
  return { ok: true, value: after ?? task };
}
