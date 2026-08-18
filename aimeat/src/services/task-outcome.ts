/**
 * @file src/services/task-outcome.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a finished task actually produced, in one place, for every door that reports a
 *   task.
 *
 *   THE HOLE THIS CLOSES, and it was found by a crew rather than by us. A task-runner completed a
 *   real job in 104 seconds, the task went to `done`, and the answer could not be read back from
 *   anywhere: `aimeat_task_get` returns fifteen fields and not one of them is the output. The
 *   completion MESSAGE — the agent's own sentence about what it did — is written to the 'completed'
 *   event and nowhere else, and `deliverableKey` is on the record but was never returned. So the
 *   caller saw `status: "done"` and had to already know that a second, differently-shaped endpoint
 *   exists before it could find out what happened. A finished task whose result nobody can reach is
 *   indistinguishable from one that produced nothing.
 *
 *   WHY NOT A NEW COLUMN. The two facts already exist: the sentence is on the terminal event, the
 *   pointer is on the record. A `completionMessage` column would be a third copy of something
 *   stored twice, on both providers, with a migration — to fix a READ. The read is what was broken.
 *
 *   The deliverable is returned as an ADDRESS, not as content. It is a memory key under the agent's
 *   own namespace and may be any size; a task read that inlined it would make every listing as
 *   expensive as its largest output.
 * @structure taskOutcome() — the terminal event plus the deliverable pointer, or null while running
 * @usage
 *   import { taskOutcome } from '../services/task-outcome.js';
 *   const outcome = await taskOutcome(storage, task);   // null unless done/failed
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial. Reported by crewaimeat-dev against aimeat-crewai 0.20.0: a
 *     completed task-runner leaves its output where the caller cannot read it.
 */
import type { Storage, AgentTaskRecord } from '../storage/interface.js';

/** What a finished task produced. Null while it is still running — an unfinished task has no
 *  outcome, and reporting an empty one would read as "finished with nothing". */
export interface TaskOutcome {
    /** 'done' or 'failed' — the same word the terminal event carries. */
    state: 'done' | 'failed';
    /** The agent's own sentence about what it did, from the terminal event. */
    message: string;
    at: string;
    /** Memory key under the AGENT's namespace where the deliverable was published, when one was
     *  named. The pointer, never the content: an output may be megabytes. */
    deliverable_key?: string;
    /** A ready-to-follow address for that key, so a caller does not have to assemble one. */
    deliverable_url?: string;
}

const TERMINAL = new Set(['completed', 'failed']);

/**
 * The outcome of a task, or null if it has not finished.
 *
 * Reads the events newest-first and takes the first terminal one, so a task that was completed,
 * reopened and completed again reports the LATEST completion rather than the first — which is what
 * "what happened" means to whoever is asking.
 */
export async function taskOutcome(storage: Storage, task: AgentTaskRecord): Promise<TaskOutcome | null> {
    if (task.status !== 'done' && task.status !== 'failed') return null;

    const { events } = await storage.listTaskEvents(task.id, { page: 1, perPage: 50 });
    // listTaskEvents orders oldest-first; the terminal one is at the end.
    const terminal = [...events].reverse().find(e => TERMINAL.has(e.type));

    return {
        state: task.status,
        // A task can reach a terminal state without a terminal event — an owner-side cancel, an
        // older record from before the event existed. Saying so beats an empty string that reads
        // like an agent who had nothing to report.
        message: terminal?.message ?? '(no completion message was recorded)',
        at: terminal?.timestamp ?? task.completedAt ?? task.updatedAt,
        ...(task.deliverableKey ? {
            deliverable_key: task.deliverableKey,
            deliverable_url: `/v1/memory/${encodeURIComponent(task.agentGaii)}/${encodeURIComponent(task.deliverableKey)}`,
        } : {}),
    };
}
