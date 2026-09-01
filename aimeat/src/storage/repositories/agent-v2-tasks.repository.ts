/**
 * @file src/storage/repositories/agent-v2-tasks.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage contract for Agent v2 tasks: the handle a caller holds while work runs.
 *
 *   `settleAgentV2Task` is a CONDITIONAL update, not a read-then-write. Two parties can reach for
 *   one task at the same moment — the worker completing it and the caller cancelling it — and a
 *   read followed by a write lets both through, leaving a task that is completed and cancelled and
 *   whichever one lost silently discarded. The update names the statuses it is willing to move
 *   FROM, and answers whether it was the one that moved it.
 *
 *   Every read takes the owner first, for the same reason the messaging repository does: the fence
 *   and the query are the same thing, and a signature that lets you ask without saying whose is a
 *   signature that lets you forget.
 *
 * @structure AgentV2TasksRepository — create / get / list / update / settle / deleteByOwner
 * @usage const task = await storage.getAgentV2Task(owner, taskId);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import type { AgentV2TaskRecord, AgentV2TaskStatus } from '../interface.js';

export interface AgentV2TaskQuery {
  /** Tasks in this exchange. */
  contextId?: string;
  /** Tasks assigned to this principal — the roster read a worker does. */
  assignedTo?: string;
  /** Tasks this principal asked for. */
  createdBy?: string;
  /** One or more statuses. Omitted means every status. */
  status?: AgentV2TaskStatus[];
  /** Default 50, capped by the caller. */
  limit?: number;
}

/** The fields a status change may carry. Everything not named is left as it was. */
export interface AgentV2TaskPatch {
  status?: AgentV2TaskStatus;
  statusMessage?: string | null;
  result?: unknown[] | null;
  error?: { code: string; message: string } | null;
  startedAt?: string | null;
  completedAt?: string | null;
  ttlMs?: number | null;
  pollIntervalMs?: number | null;
}

export interface AgentV2TasksRepository {
  createAgentV2Task(task: AgentV2TaskRecord): Promise<void>;
  getAgentV2Task(owner: string, taskId: string): Promise<AgentV2TaskRecord | null>;
  /** Newest first: a worker wants what just arrived, and a caller wants what it just asked for. */
  listAgentV2Tasks(owner: string, query: AgentV2TaskQuery): Promise<AgentV2TaskRecord[]>;
  /**
   * Move a task, but only from one of `fromStatuses`. Returns true if THIS call moved it — the
   * answer a racing completer and canceller need in order to know which of them won.
   */
  settleAgentV2Task(
    owner: string, taskId: string, fromStatuses: AgentV2TaskStatus[], patch: AgentV2TaskPatch, at: string,
  ): Promise<boolean>;
  deleteAgentV2TasksByOwner(owner: string): Promise<number>;
}
