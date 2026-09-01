/**
 * @file src/services/agui-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A v2 task, watched and told as AG-UI events, so a front end built on the
 *   Agent-User Interaction protocol can render what one of this owner's agents is doing.
 *
 *   THE THIRD PROJECTION OF ONE THING. A2A is how another agent talks to ours, ACP is how an editor
 *   does, and this is how a WEB UI watches. All three create the same V5 task through the same ops
 *   and read the same row; none of them stores anything of its own. That is the whole design of
 *   V4 and V5, and it is why each of these files is short.
 *
 *   AG-UI IS A ONE-WAY STREAM, WHICH FITS. The protocol is a run that emits events until it
 *   finishes: RUN_STARTED, some text, RUN_FINISHED or RUN_ERROR. A task on this node is exactly
 *   that shape — it is created, it says things while it works, and it settles — so the mapping is a
 *   rename rather than a translation.
 *
 *   EVERY LINE THE TASK PRODUCES IS ITS OWN MESSAGE, not one long stream of deltas. A status line
 *   and a result are different utterances at different times, and folding them into one message
 *   would make a UI render "Reading the widget.Renamed it." as a single paragraph.
 *
 *   IT POLLS, for the same reason the ACP agent does: the node pushes task news to the CONNECTED
 *   principal over its tunnel, and an HTTP request is not one. The task's own `pollIntervalMs` is
 *   the interval when it has one.
 *
 * @structure AGUI_PROTOCOL · streamTaskAsAgui(deps) — an async generator of AG-UI events
 * @usage for await (const event of streamTaskAsAgui({ storage, auth, taskId, threadId, runId })) …
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6d).
 */
import { randomUUID } from 'node:crypto';
import { EventType, type BaseEvent } from '@ag-ui/core';
import type { Storage, AgentV2TaskRecord } from '../storage/interface.js';
import type { Principal } from './agent-v2-messaging-ops.js';

/** What this door speaks, said once so the route and the stream cannot disagree. */
export const AGUI_PROTOCOL = { name: 'ag-ui', version: '0.0.59' } as const;

/** How often to look at a task that did not say. */
const DEFAULT_POLL_MS = 1000;
/** The longest one run is held open. A task outlives a run; a browser connection should not. */
const MAX_RUN_MS = 10 * 60 * 1000;

export interface AguiRunDeps {
  storage: Storage;
  auth: Principal;
  taskId: string;
  threadId: string;
  runId: string;
  /** Ends the run early when the browser goes away. */
  signal?: AbortSignal;
}

/** One utterance, as the three events AG-UI wants for a complete message. */
function* utterance(text: string): Generator<BaseEvent> {
  const messageId = randomUUID();
  yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as unknown as BaseEvent;
  yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text } as unknown as BaseEvent;
  yield { type: EventType.TEXT_MESSAGE_END, messageId } as unknown as BaseEvent;
}

/** What a task's current state should say to somebody watching. */
function lineFor(task: AgentV2TaskRecord): string {
  if (task.statusMessage) return task.statusMessage;
  switch (task.status) {
    case 'working': return 'Working on it.';
    case 'input_required': return 'It needs something from you before it can go on.';
    case 'completed': return 'Done.';
    case 'failed': return task.error?.message ?? 'It could not finish.';
    case 'cancelled': return 'Stopped.';
    default: return task.status;
  }
}

/**
 * Watch one task and tell it as AG-UI.
 *
 * A run ENDS when the task settles, when the watcher leaves, or after ten minutes — and the last
 * case says the task is still going, because a UI that saw a run finish will otherwise report work
 * as over when it is not.
 */
export async function* streamTaskAsAgui(deps: AguiRunDeps): AsyncGenerator<BaseEvent> {
  const { storage, auth, taskId, threadId, runId } = deps;

  yield { type: EventType.RUN_STARTED, threadId, runId } as unknown as BaseEvent;

  const started = Date.now();
  let lastLine = '';
  let interval = DEFAULT_POLL_MS;

  for (;;) {
    if (deps.signal?.aborted) return;

    const task = await storage.getAgentV2Task(auth.owner, taskId);
    if (!task) {
      yield { type: EventType.RUN_ERROR, message: 'That task is not on this account.', code: 'NOT_FOUND' } as unknown as BaseEvent;
      return;
    }
    if (task.pollIntervalMs && task.pollIntervalMs > 0) interval = Math.max(250, task.pollIntervalMs);

    const line = lineFor(task);
    if (line !== lastLine) {
      yield* utterance(line);
      lastLine = line;
    }

    const terminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
    if (terminal) {
      for (const part of (task.result ?? []) as Array<{ kind?: string; text?: string }>) {
        if (part?.kind === 'text' && part.text) yield* utterance(part.text);
      }
      if (task.status === 'failed') {
        yield {
          type: EventType.RUN_ERROR,
          message: task.error?.message ?? 'The task failed.',
          code: task.error?.code ?? 'FAILED',
        } as unknown as BaseEvent;
        return;
      }
      // A cancelled run FINISHES rather than errors: somebody meant to stop it, and a UI that
      // renders an error for a deliberate stop teaches people to distrust its errors.
      yield {
        type: EventType.RUN_FINISHED, threadId, runId,
        result: { taskId, status: task.status, result: task.result ?? null },
      } as unknown as BaseEvent;
      return;
    }

    if (Date.now() - started > MAX_RUN_MS) {
      yield* utterance(`Still running after ten minutes, so this stream is closing. The work continues as task ${taskId}.`);
      yield { type: EventType.RUN_FINISHED, threadId, runId, result: { taskId, status: task.status, stillRunning: true } } as unknown as BaseEvent;
      return;
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
