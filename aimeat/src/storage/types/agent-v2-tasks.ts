/**
 * @file src/storage/types/agent-v2-tasks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Agent v2 tasks: a unit of work one principal hands another, in the shape MCP's task
 *   augmentation defines, with the A2A state each status maps to written down beside it.
 *
 *   THE NODE ALREADY HAS TASKS AND THEY STAY. `AgentTaskRecord` is the owner's dashboard work item:
 *   a title, a description, todos, an approval flow, an SLA, a rating, and a whole tab built on it.
 *   It is not going anywhere and nothing here touches it. What it cannot be is the OTHER thing — the
 *   handle a caller holds while a long tool call runs, polls until it settles, and cancels if it
 *   changes its mind. That handle has a shape now (MCP tasks), a second protocol reads it (A2A
 *   Task), and both are about to arrive at this node's door in V6.
 *
 *   ONE SHAPE, TWO NAMES FOR THE SAME FIVE STATES. MCP says `working`, `input_required`,
 *   `completed`, `failed`, `cancelled`. A2A says `working`, `input-required`, `completed`, `failed`,
 *   `canceled` — one hyphen and one L apart, which is exactly the kind of difference that produces a
 *   silent mismatch at a border. So the stored status is the MCP word, the A2A word is DERIVED by
 *   one function (`a2aState`), and no caller ever writes an A2A state.
 *
 *   A2A HAS FOUR STATES MCP DOES NOT, and this is where they go:
 *     submitted     → stored as `working`. MCP has no queued state, and inventing one here would
 *                     mean a status a MCP client cannot read. The distinction that matters — has
 *                     anybody picked this up — is `startedAt`, which is null until someone has.
 *     rejected      → stored as `failed`, with `error.code = 'REJECTED'`. It is a refusal to start,
 *                     not a different kind of end.
 *     auth-required → stored as `input_required`, with `error.code = 'AUTH_REQUIRED'`. What the
 *                     caller must do is the same: supply something and let it continue.
 *     unknown       → never stored. A task this node holds is in a state it knows.
 *
 * @structure V2_TASK_STATUSES · AgentV2TaskStatus · AgentV2TaskRecord
 * @usage import type { AgentV2TaskRecord } from '../interface.js';
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V5).
 */

/**
 * The five MCP task statuses, and the only values `status` ever holds.
 *
 * `working` and `input_required` are open; the other three are terminal, and a terminal task never
 * changes status again — that rule is enforced in the ops layer and is what lets a caller stop
 * polling on the first settled read it sees.
 */
export const V2_TASK_STATUSES = ['working', 'input_required', 'completed', 'failed', 'cancelled'] as const;
export type AgentV2TaskStatus = (typeof V2_TASK_STATUSES)[number];

/** One unit of work, held as a handle rather than as a dashboard item. */
export interface AgentV2TaskRecord {
  /** Server-assigned. The handle a caller polls. */
  taskId: string;
  status: AgentV2TaskStatus;
  /** One line for a person: what it is doing, or why it stopped. */
  statusMessage: string | null;
  /**
   * The exchange this work belongs to. A v2 message carrying the same `contextId` is part of the
   * same conversation, which is how the turns and the work stay one thing rather than two.
   */
  contextId: string;
  /** Bare owner name. Both principals sit under it, and every read is fenced on it. */
  owner: string;
  /** Who asked. */
  createdBy: string;
  /** Who is to do it. */
  assignedTo: string;
  /** What was asked, as message parts: the same shape a turn carries. */
  input: unknown[];
  /** What came back. Null until the task completes. */
  result: unknown[] | null;
  /** Why it did not. Null unless it failed or was rejected. */
  error: { code: string; message: string } | null;
  createdAt: string;
  lastUpdatedAt: string;
  /**
   * When somebody picked it up. Null while nobody has, which is the distinction A2A calls
   * `submitted` and MCP has no status for.
   */
  startedAt: string | null;
  /** When it settled. Null while it is open. */
  completedAt: string | null;
  /**
   * How long the caller may still read this after it settles, in milliseconds from `lastUpdatedAt`.
   * MCP's own field, and it is advice: this node does not delete on it, it reports it so a client
   * knows when to stop expecting an answer.
   */
  ttlMs: number | null;
  /** How often the caller should poll, in milliseconds. MCP's own field. */
  pollIntervalMs: number | null;
  /** Anything the caller wants carried along. Never read by the node. */
  metadata: Record<string, unknown> | null;
}
