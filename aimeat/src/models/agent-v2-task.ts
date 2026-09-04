/**
 * @file src/models/agent-v2-task.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agent v2 task SHAPE, the rules for a status change, and the one function that
 *   says what each status is called in A2A. No I/O, no storage.
 *
 *   ONE VOCABULARY IS STORED, THE OTHER IS DERIVED. MCP says `cancelled` and A2A says `canceled`;
 *   MCP says `input_required` and A2A says `input-required`. Two names for one state, one letter
 *   and one hyphen apart, is the exact shape of a bug that never throws — so nothing here accepts an
 *   A2A state as INPUT, and `a2aState` is the only place the second vocabulary is written at all.
 *
 *   A TERMINAL TASK NEVER MOVES AGAIN. `completed`, `failed` and `cancelled` are the end, and
 *   `allowedFrom` says so once, for every door. Without that rule a caller cannot stop polling on
 *   the first settled read it sees, which is the only thing a poll loop can be built on.
 *
 * @structure TASK_SPEC · TASK_LIMITS · a2aState() · isTerminal() · allowedFrom() ·
 *   validateTaskInput() · validateStatusInput() · publicTask()
 * @usage const { ok, defects, task } = validateTaskInput(req.body);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */
import type { AgentV2TaskRecord, AgentV2TaskStatus, MessagePart } from '../storage/interface.js';
import { V2_TASK_STATUSES } from '../storage/types/agent-v2-tasks.js';
import { a2aStateOf } from '../services/a2a-task-state.js';
import { validatePartsArray, type MessageDefect } from './agent-v2-message.js';

/** What a stored task says it is, for a reader that meets one on its own. */
export const TASK_SPEC = 'aimeat.task/v1';

export const TASK_LIMITS = {
  /** Characters in a status message. One line for a person. */
  maxStatusChars: 500,
  /** Milliseconds a caller may ask to be told to wait between polls. */
  maxPollIntervalMs: 300_000,
  /** Milliseconds a result may be claimed to stay readable. Seven days. */
  maxTtlMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/** The three statuses that are the end of the road. */
const TERMINAL: readonly AgentV2TaskStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminal(status: AgentV2TaskStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * Which statuses a move to `next` may start from. Everything may move out of an open status; nothing
 * may move out of a terminal one, whichever direction it is going.
 */
export function allowedFrom(): AgentV2TaskStatus[] {
  return ['working', 'input_required'];
}

/**
 * What A2A calls this task's state.
 *
 * Four A2A states have no MCP status of their own and are recovered from what is stored beside it:
 *   submitted     nobody has picked it up yet — `startedAt` is null and it is still working.
 *   rejected      it was refused before it started — failed, with error.code REJECTED.
 *   auth-required something must be authorised — input_required, with error.code AUTH_REQUIRED.
 * `unknown` is never produced: a task this node holds is in a state it knows.
 */
export function a2aState(task: Pick<AgentV2TaskRecord, 'status' | 'startedAt' | 'error'>): string {
  // ONE LINE, because the relation lives in services/a2a-task-state.ts. It was written out here and
  // again as a protobuf enum in a2a-projection.ts, on the reasoning that a string a person reads and
  // a wire enum are different things. A THIRD copy then went backwards in a2a-handler.ts, disagreed
  // with both, and filtered A2A's `rejected` as every failure. Two copies do not agree by being
  // separate; they agree until one of them is edited. → pitfalls §43
  return a2aStateOf(task);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function boundedNumber(
  v: unknown, field: string, max: number, defects: MessageDefect[],
): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    defects.push({ field, reason: 'Must be a non-negative number of milliseconds when given.' });
    return null;
  }
  if (v > max) {
    defects.push({ field, reason: `At most ${max} milliseconds.` });
    return null;
  }
  return Math.trunc(v);
}

export interface ValidatedTaskInput {
  assignedTo: string;
  input: MessagePart[];
  contextId: string | null;
  statusMessage: string | null;
  ttlMs: number | null;
  pollIntervalMs: number | null;
  metadata: Record<string, unknown> | null;
}

/** The body of a create. `assignedTo` is a shape here and a real principal by the time it is stored. */
export function validateTaskInput(value: unknown): { ok: boolean; defects: MessageDefect[]; task?: ValidatedTaskInput } {
  const defects: MessageDefect[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, defects: [{ field: '', reason: 'The body must be a JSON object.' }] };
  }
  const b = value as Record<string, unknown>;

  const assignedTo = str(b.assignedTo ?? b.assigned_to);
  if (!assignedTo) defects.push({ field: 'assignedTo', reason: 'Required: the principal that is to do this.' });

  // The same parts a turn carries, validated by the same function, so a task and the conversation
  // around it cannot disagree about what a payload looks like.
  const parts = validatePartsArray(b.input, 'input', defects);

  const statusMessage = b.statusMessage ?? b.status_message;
  if (statusMessage !== undefined && statusMessage !== null) {
    if (!str(statusMessage)) defects.push({ field: 'statusMessage', reason: 'Must be a non-empty string when given.' });
    else if ((statusMessage as string).length > TASK_LIMITS.maxStatusChars) {
      defects.push({ field: 'statusMessage', reason: `At most ${TASK_LIMITS.maxStatusChars} characters.` });
    }
  }

  const ttlMs = boundedNumber(b.ttlMs ?? b.ttl_ms, 'ttlMs', TASK_LIMITS.maxTtlMs, defects);
  const pollIntervalMs = boundedNumber(b.pollIntervalMs ?? b.poll_interval_ms, 'pollIntervalMs', TASK_LIMITS.maxPollIntervalMs, defects);

  if (b.metadata !== undefined && b.metadata !== null
    && (typeof b.metadata !== 'object' || Array.isArray(b.metadata))) {
    defects.push({ field: 'metadata', reason: 'Must be a JSON object when given.' });
  }

  if (defects.length > 0) return { ok: false, defects };
  return {
    ok: true,
    defects: [],
    task: {
      assignedTo: assignedTo as string,
      input: parts,
      contextId: str(b.contextId ?? b.context_id),
      statusMessage: str(statusMessage),
      ttlMs,
      pollIntervalMs,
      metadata: (b.metadata ?? null) as Record<string, unknown> | null,
    },
  };
}

export interface ValidatedStatusInput {
  status: AgentV2TaskStatus;
  statusMessage: string | null;
  result: MessagePart[] | null;
  error: { code: string; message: string } | null;
  ttlMs: number | null;
  pollIntervalMs: number | null;
}

/**
 * The body of a status change.
 *
 * `cancelled` is NOT accepted here. Cancelling is its own door, because the party allowed to do it
 * is a different one — the caller, not the worker — and folding it into a general status write
 * would mean one gate deciding two different questions.
 */
export function validateStatusInput(value: unknown): { ok: boolean; defects: MessageDefect[]; change?: ValidatedStatusInput } {
  const defects: MessageDefect[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, defects: [{ field: '', reason: 'The body must be a JSON object.' }] };
  }
  const b = value as Record<string, unknown>;

  const status = b.status;
  const settable = V2_TASK_STATUSES.filter(s => s !== 'cancelled');
  if (!(settable as readonly unknown[]).includes(status)) {
    defects.push({
      field: 'status',
      reason: `Must be one of ${settable.join(', ')}. To cancel, use the cancel door — a different party is allowed to.`,
    });
  }

  const statusMessage = b.statusMessage ?? b.status_message;
  if (statusMessage !== undefined && statusMessage !== null) {
    if (!str(statusMessage)) defects.push({ field: 'statusMessage', reason: 'Must be a non-empty string when given.' });
    else if ((statusMessage as string).length > TASK_LIMITS.maxStatusChars) {
      defects.push({ field: 'statusMessage', reason: `At most ${TASK_LIMITS.maxStatusChars} characters.` });
    }
  }

  let result: MessagePart[] | null = null;
  if (b.result !== undefined && b.result !== null) {
    result = validatePartsArray(b.result, 'result', defects);
  }
  if (status === 'completed' && (!result || result.length === 0)) {
    defects.push({ field: 'result', reason: 'Required when completing: what came back, as parts. Send an empty text part if there is genuinely nothing.' });
  }

  let error: { code: string; message: string } | null = null;
  if (b.error !== undefined && b.error !== null) {
    const e = (typeof b.error === 'object' && !Array.isArray(b.error)) ? b.error as Record<string, unknown> : null;
    if (!e || !str(e.code) || !str(e.message)) {
      defects.push({ field: 'error', reason: 'Must be an object with a non-empty `code` and `message`.' });
    } else {
      error = { code: e.code as string, message: e.message as string };
    }
  }
  if (status === 'failed' && !error) {
    defects.push({ field: 'error', reason: 'Required when failing: a code and a message, so the caller can tell why.' });
  }

  const ttlMs = boundedNumber(b.ttlMs ?? b.ttl_ms, 'ttlMs', TASK_LIMITS.maxTtlMs, defects);
  const pollIntervalMs = boundedNumber(b.pollIntervalMs ?? b.poll_interval_ms, 'pollIntervalMs', TASK_LIMITS.maxPollIntervalMs, defects);

  if (defects.length > 0) return { ok: false, defects };
  return {
    ok: true,
    defects: [],
    change: {
      status: status as AgentV2TaskStatus,
      statusMessage: str(statusMessage),
      result,
      error,
      ttlMs,
      pollIntervalMs,
    },
  };
}

/**
 * A task as any door returns it: the record plus the two derived readings. `a2a_state` is here
 * rather than in a V6-only projection because it is the answer to "what is this called on the
 * other protocol", and a caller reading the REST door deserves the same answer as one reading A2A.
 */
export function publicTask(task: AgentV2TaskRecord): Record<string, unknown> {
  return {
    spec: TASK_SPEC,
    taskId: task.taskId,
    status: task.status,
    a2a_state: a2aState(task),
    terminal: isTerminal(task.status),
    statusMessage: task.statusMessage,
    contextId: task.contextId,
    createdBy: task.createdBy,
    assignedTo: task.assignedTo,
    input: task.input,
    result: task.result,
    error: task.error,
    createdAt: task.createdAt,
    lastUpdatedAt: task.lastUpdatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    ttlMs: task.ttlMs,
    pollIntervalMs: task.pollIntervalMs,
    metadata: task.metadata,
  };
}
