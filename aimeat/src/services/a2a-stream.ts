/**
 * @file a2a-stream.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A2A streaming: one task, watched until it settles.
 *
 *   WHAT A CLIENT GETS. The task as it stands, then the task again every time it moves, then
 *   nothing — the generator ends when the task reaches a state it does not leave. A2A allows finer
 *   events (a status delta, an artifact delta) and this yields whole Tasks instead, because that is
 *   what this node stores: a delta stream assembled from whole records would be a second
 *   representation to keep in step with the first, and the first is what GetTask already answers.
 *
 *   THE FENCE IS READ, NOT REMEMBERED. The move event carries an id and no data, so every yield
 *   goes back through `getTask` with the caller's own principal — the same op, the same check, the
 *   same refusal. A stream that captured the task once and then pushed updates from the event would
 *   keep serving a caller whose access was revoked halfway through, and nothing in the loop would
 *   know. This costs a read per move and buys a fence that cannot be forgotten.
 *
 *   IT ENDS, ALWAYS, and that is the part a long-lived connection gets wrong. Three ways out: the
 *   task settles, the ceiling is reached, or the consumer stops iterating — and the last one is why
 *   the listener is removed in a `finally`. An abandoned SSE connection that left a bus listener
 *   behind would leak one per stream, and the node holds one bus for the process.
 *
 *   FAIRNESS. `MAX_STREAM_MS` is the ceiling on how long one caller may hold a connection waiting
 *   for somebody else's work to finish. It is deliberately generous — real work is slow — and it is
 *   deliberately finite, because a stream is a connection somebody else is not using. A client that
 *   hits it re-subscribes; the task is unaffected and `SubscribeToTask` is the method for exactly
 *   that.
 * @structure streamTask(storage, caller, taskId, history) — the generator both A2A methods use
 * @usage for await (const t of streamTask(storage, caller, id, h)) { … }
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial: message/stream and SubscribeToTask stop refusing.
 */
import type { Storage, AgentV2TaskRecord, AgentV2MessageRecord } from '../storage/interface.js';
import type { Task } from '@a2a-js/sdk';
import { onTaskMoved, offTaskMoved, type TaskMovedEvent } from './event-bus.js';
import { getTask } from './agent-v2-tasks-ops.js';
import type { Principal } from './agent-v2-messaging-ops.js';
import { toA2ATask } from './a2a-projection.js';
import { isTerminal } from '../models/agent-v2-task.js';
import { logger } from '../utils/logger.js';

/**
 * How long one stream may hold a connection. Half an hour: long enough that a real piece of work
 * finishes inside it, short enough that an abandoned client is not holding a socket all day.
 */
export const MAX_STREAM_MS = 30 * 60 * 1000;

/** How often the loop wakes even with no event, so a move missed in a race is still seen. */
const SWEEP_MS = 15_000;

/**
 * A queue of "this task moved" nudges, fed by the bus and drained by the generator.
 *
 * A generator cannot `await` an EventEmitter directly, and reading events straight in the loop body
 * would drop every move that arrived while the previous read was in flight. The queue is one
 * boolean, not a list: two moves during one read are still one thing to do, which is re-read the
 * task.
 */
class MoveSignal {
  private pending = false;
  private wake: (() => void) | null = null;
  private readonly handler = (evt: TaskMovedEvent) => {
    if (evt.taskId !== this.taskId) return;
    this.pending = true;
    const w = this.wake;
    this.wake = null;
    if (w) w();
  };

  constructor(private readonly taskId: string) {
    onTaskMoved(this.handler);
  }

  /** Resolves when the task moves, or after `SWEEP_MS`, whichever comes first. */
  async next(): Promise<void> {
    if (this.pending) { this.pending = false; return; }
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.wake = null; resolve(); }, SWEEP_MS);
      this.wake = () => { clearTimeout(timer); resolve(); };
    });
    this.pending = false;
  }

  close(): void {
    offTaskMoved(this.handler);
    this.wake = null;
  }
}

/** The turns of a task, for the Task's `history`. Supplied by the caller so this file does no policy. */
export type HistoryReader = (task: AgentV2TaskRecord) => Promise<AgentV2MessageRecord[]>;

/**
 * Yield a task now, and again on every move, until it settles.
 *
 * Ends silently when the caller may no longer read the task: a revoked credential mid-stream is a
 * finished stream, not an error frame, because the client already has every state up to that point
 * and an error would read as the task having failed.
 */
export async function* streamTask(
  storage: Storage,
  caller: Principal,
  taskId: string,
  history: HistoryReader,
): AsyncGenerator<Task, void, undefined> {
  const signal = new MoveSignal(taskId);
  const deadline = Date.now() + MAX_STREAM_MS;
  let lastSeen = '';
  try {
    while (Date.now() < deadline) {
      const out = await getTask(storage, caller, taskId);
      if (!out.ok) {
        logger.info('a2a stream: the task is no longer readable by this caller; ending the stream', {
          taskId, code: out.code,
        });
        return;
      }
      const task = out.value;
      // Only on a real change. The sweep exists to catch a move the bus missed, and without this a
      // quiet task would send an identical frame every fifteen seconds for half an hour.
      const stamp = `${task.status}|${task.lastUpdatedAt}|${task.startedAt ?? ''}`;
      if (stamp !== lastSeen) {
        lastSeen = stamp;
        yield toA2ATask(task, await history(task));
      }
      if (isTerminal(task.status)) return;
      await signal.next();
    }
    logger.info('a2a stream: the ceiling was reached; the client may subscribe again', { taskId });
  } finally {
    // In a `finally` because a consumer that stops iterating — a closed connection, a `break` —
    // resumes the generator at the yield and runs this. Without it every abandoned stream would
    // leave a listener on the one bus this process holds.
    signal.close();
  }
}
