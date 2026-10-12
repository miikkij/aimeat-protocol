/**
 * @file src/services/workflow/workflow-event.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The event a workflow's trigger starts a run for, as data: what it is, the run
 *   variables it becomes, how two of them fold into one, and what a trigger must say at save for
 *   its event to be able to arrive. Pure: no storage, no engine.
 *
 *   WHY THE RUN GETS THE EVENT. Until 2026-10-13 a trigger started a run with nothing but the mode,
 *   so a workflow that started "when news.* is written" could not learn which key was written, and
 *   its agent step had to search for what was new. The event now reaches the run as variables named
 *   `event_*`. They template a key like any variable and go to an agent step with the other
 *   variables (engine-steps.ts sends every variable as a `var.<name>` scope entry), so the agent is
 *   told what arrived.
 *
 *   ONLY WHAT THE NODE ITSELF KNOWS, OR THE AUTHOR NAMED. For the node's own events every field is
 *   the node's: a key, an offer id, the address of a row space, a count, row ids. An ecosystem
 *   event's payload is written by an outside app, and a value an outside app wrote is not placed in
 *   front of an agent unasked: only the fields the trigger's `match` names become variables, because
 *   those are the ones the author read and tested against.
 * @structure
 *   - WorkflowEvent · workflowEvent(on, fields)
 *   - eventVars(event) · eventVarNames(trigger)
 *   - foldEvents(waiting, next) · coalesces(trigger)
 *   - triggerErrors(trigger, parallel)
 * @usage import { workflowEvent, eventVars, foldEvents } from './workflow-event.js';
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import type { WorkflowTrigger } from '../../models/workflow-schemas.js';

/** One event, or several of one kind folded together, that a trigger starts a run for. */
export interface WorkflowEvent {
  /** `memory.write`, `offer.ordered`, `workspace.rows`, or an ecosystem app's own event name. */
  on: string;
  /** When it happened, ISO 8601. For a folded event: when the FIRST of them happened. */
  at: string;
  /** How many events this stands for. 1 unless events were folded while a run was in flight. */
  folded: number;
  /** What happened, by field name. Every value is a string, because a run variable is one. */
  fields: Record<string, string>;
}

/** A variable name is `[a-zA-Z0-9_]+` (engine-util.ts template); a field outside that is not exposed. */
const FIELD_NAME = /^[a-zA-Z0-9_]{1,40}$/;
/** The longest value one event field carries into a run. A row id may be 200 characters. */
const MAX_FIELD_CHARS = 1500;
/** How many row ids one event names. `count` says how many rows there were. */
const MAX_ROW_IDS = 50;

const cut = (value: string): string => (value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value);

/** An event that happened now. Fields with a name a variable cannot carry are left out. */
export function workflowEvent(on: string, fields: Record<string, string | number | undefined>): WorkflowEvent {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || !FIELD_NAME.test(name)) continue;
    kept[name] = cut(String(value));
  }
  return { on, at: new Date().toISOString(), folded: 1, fields: kept };
}

/**
 * A row id that may go into a run. A row id is whatever its writer chose, up to 200 characters, and
 * the writer may be another member than the workflow's owner. The ids reach an agent's task and can
 * be templated into a model's prompt, so an id that reads like a sentence is left out: only an id
 * made of the characters identifiers are made of is named. `count` still counts every row.
 */
const PLAIN_ROW_ID = /^[A-Za-z0-9._:@+=-]{1,120}$/;

/** Row ids as one field: the plain ones, at most MAX_ROW_IDS of them, joined by commas, cut at a whole id. */
export function rowIdsField(ids: string[]): string {
  const out: string[] = [];
  let chars = 0;
  for (const id of ids.filter(i => PLAIN_ROW_ID.test(i)).slice(0, MAX_ROW_IDS)) {
    if (chars + id.length + 1 > MAX_FIELD_CHARS) break;
    out.push(id);
    chars += id.length + 1;
  }
  return out.join(',');
}

/** The run variables an event becomes. No event, no variables. */
export function eventVars(event: WorkflowEvent | undefined): Record<string, string> {
  if (!event) return {};
  const out: Record<string, string> = { event_on: event.on, event_at: event.at, event_folded: String(event.folded) };
  for (const [name, value] of Object.entries(event.fields)) out[`event_${name}`] = value;
  return out;
}

/** The fields each of the node's own events carries. */
const OWN_EVENT_FIELDS: Record<string, readonly string[]> = {
  'memory.write': ['key'],
  'offer.ordered': ['offer'],
  'workspace.rows': ['organism', 'workspace', 'space', 'count', 'row_ids'],
};

/**
 * The variable names a workflow with this trigger may use in a key template without declaring
 * them. The save-time check reads this, so `{event_key}` in a key is accepted exactly where a run
 * will have it.
 */
export function eventVarNames(trigger: WorkflowTrigger): string[] {
  if (trigger.kind === 'event') {
    return ['event_on', 'event_at', 'event_folded', ...(OWN_EVENT_FIELDS[trigger.on] ?? []).map(f => `event_${f}`)];
  }
  if (trigger.kind === 'ecosystem.event') {
    const named = Object.keys(trigger.match ?? {}).filter(f => FIELD_NAME.test(f));
    return ['event_on', 'event_at', 'event_folded', 'event_app', ...named.map(f => `event_${f}`)];
  }
  return [];
}

/** Does this trigger ask for the events that arrive during a run to start one more run after it? */
export function coalesces(trigger: WorkflowTrigger): boolean {
  return (trigger.kind === 'event' || trigger.kind === 'ecosystem.event') && trigger.coalesce === true;
}

/**
 * Two events as one: the one that already waits, and the one that just arrived.
 *
 * The follow-up run stands for both. It keeps the time of the first, so a step that reads "what
 * changed since event_at" misses nothing; it counts the events; and it carries the LATEST event's
 * fields, except the two that add up: a row count is summed and row ids are joined.
 */
export function foldEvents(waiting: WorkflowEvent, next: WorkflowEvent): WorkflowEvent {
  const fields = { ...next.fields };
  const a = Number(waiting.fields.count);
  const b = Number(next.fields.count);
  if (Number.isFinite(a) && Number.isFinite(b) && waiting.fields.count !== undefined && next.fields.count !== undefined) {
    fields.count = String(a + b);
  }
  if (waiting.fields.row_ids !== undefined && next.fields.row_ids !== undefined) {
    fields.row_ids = rowIdsField([...waiting.fields.row_ids.split(','), ...next.fields.row_ids.split(',')].filter(Boolean));
  }
  return { on: next.on, at: waiting.at, folded: waiting.folded + next.folded, fields };
}

/**
 * What is wrong with a trigger that the schema's shape cannot say. Refused at save, where the
 * author is looking: a trigger that can never fire saves cleanly and then starts nothing, and
 * nothing reports a run that did not happen.
 *
 * Only what is new on 2026-10-13 is refused. A memory.write trigger without match.key and an
 * offer.ordered trigger without match.offer never fire either, but definitions saved that way exist
 * and start by hand, and this check also runs when a run starts.
 */
export function triggerErrors(trigger: WorkflowTrigger, parallel: boolean | undefined): string[] {
  const errors: string[] = [];
  if (trigger.kind === 'event') {
    const has = (field: string): boolean => typeof trigger.match[field] === 'string' && trigger.match[field].trim() !== '';
    if (trigger.on === 'workspace.rows' && !(has('organism') && has('workspace'))) {
      errors.push('trigger: a workspace.rows event needs match.organism and match.workspace, the ids of the organism and the workspace whose row spaces start a run; match.space narrows it to one row space');
    }
  }
  if (coalesces(trigger) && parallel) {
    errors.push('coalesce and parallel cannot both be set: a parallel workflow starts a run for every event, so nothing waits for a run to end');
  }
  return errors;
}
