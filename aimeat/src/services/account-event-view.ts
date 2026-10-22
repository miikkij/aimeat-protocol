/**
 * @file src/services/account-event-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One row of the account's event record as one reader may see it. GET /v1/account/events,
 *   GET /v1/account/events/archive and GET /v1/home/feed all project through here.
 *
 *   WHY. The record is the owner's, and anything the owner granted memory:read reads it, so an agent
 *   can answer "what has happened lately" in chat. Three kinds carry the content of an agent's task:
 *   agent_task_done, agent_task_failed and agent_task_declined hold the task's title in `data.title`,
 *   and a decline holds up to 280 characters of the reason in `data.reason`. The task route
 *   (GET /v1/agents/:name/tasks, routes/agent-tasks/create-read.ts) shows that content only to the
 *   owner in person, an app grant holding task:read and the task's own agent, and answers 403 to a
 *   sibling agent and an ecosystem app. Until 2026-10-22 those two read the same title and reason here
 *   on memory:read (secaudit 2026-10, v89).
 *
 *   THE RULE (the developer, 2026-10-22). The title and the reason are shown to exactly the readers the
 *   task route admits, with no new permission word. Every other reader still gets the row: its kind,
 *   time, link, subject and the agent's name, and `withheld` names the fields that were taken out, so
 *   "what has happened lately" still works in chat. Every other kind passes unchanged.
 * @structure TASK_CONTENT_KINDS · readsTaskContent(reader, actorGaii) · projectAccountEvent(row, reader) ·
 *   projectAccountEvents(rows, reader) · TASK_CONTENT_NOTE
 * @usage
 *   const reader = callerOf(req, config.nodeId, storage);
 *   const { rows, withheld } = projectAccountEvents(await readAccountEvents(storage, ownerGhii), reader);
 * @version-history
 *   v1.1.0 — 2026-10-22 — An app grant that existed before this rule, held memory:read and not
 *     task:read, keeps reading a task's title and reason while its token covers what it held then
 *     (`taskContentKept`, services/account-event-task-keep.ts; the developer's ruling, 2026-10-22).
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v89).
 */
import type { CallerContext } from './caller-context.js';

/** The kinds whose `data` carries the content of an agent's task. */
export const TASK_CONTENT_KINDS: ReadonlySet<string> = new Set(['agent_task_done', 'agent_task_failed', 'agent_task_declined']);

/** The fields of such a row that carry the task's content. */
const TASK_CONTENT_FIELDS = ['title', 'reason'] as const;

/**
 * The reader facts the projection needs (services/caller-context.ts). `taskContentKept` is true for an
 * app grant that existed before this rule and still holds what it held then
 * (services/account-event-task-keep.ts, accountEventReader).
 */
export type AccountEventReader = Pick<CallerContext, 'principal' | 'kind' | 'inPerson' | 'has'> & { taskContentKept?: boolean };

/** The note an answer carries when a row's task content was taken out, so the reader knows why. */
export const TASK_CONTENT_NOTE = 'Some task rows carry no title or reason. A task\'s title and decline reason are shown to the account owner, '
  + 'to an app holding the "task:read" permission and to the agent that did the task, as on GET /v1/agents/{name}/tasks. '
  + 'The row still says which agent, what happened and when.';

/**
 * True when this reader may read the content of a task row whose actor is `actorGaii`: the task
 * route's rule (create-read.ts): the owner in person, an app grant holding task:read, or the agent
 * whose task it was. An app grant the once-only step kept reads it as before (the developer's ruling,
 * 2026-10-22: a published app's permissions change only when its author republishes it).
 */
export function readsTaskContent(reader: AccountEventReader, actorGaii: string | undefined): boolean {
  if (reader.inPerson) return true;
  if (reader.kind === 'app' && (reader.has('task:read') || reader.taskContentKept === true)) return true;
  return reader.kind === 'agent' && !!actorGaii && actorGaii === reader.principal;
}

/** One row as this reader may see it. A row this rule does not touch is returned as it is. */
export function projectAccountEvent<T extends { kind: string; actorGaii?: string; data?: Record<string, string> }>(
  row: T, reader: AccountEventReader,
): T & { withheld?: string[] } {
  if (!TASK_CONTENT_KINDS.has(row.kind) || readsTaskContent(reader, row.actorGaii)) return row;
  const data: Record<string, string> = { ...(row.data ?? {}) };
  const withheld: string[] = [];
  for (const field of TASK_CONTENT_FIELDS) {
    if (field in data) { delete data[field]; withheld.push(field); }
  }
  return withheld.length ? { ...row, data, withheld } : row;
}

/** Every row as this reader may see it, order kept, and whether any row had content taken out. */
export function projectAccountEvents<T extends { kind: string; actorGaii?: string; data?: Record<string, string> }>(
  rows: readonly T[], reader: AccountEventReader,
): { rows: Array<T & { withheld?: string[] }>; withheld: boolean } {
  const out = rows.map(r => projectAccountEvent(r, reader));
  return { rows: out, withheld: out.some(r => !!r.withheld) };
}
