/**
 * @file a2a-task-state.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ONE table for the relation between a task's state here and its state in A2A.
 *
 *   TWO VOCABULARIES, EIGHT STATES, AND UNTIL NOW THREE FUNCTIONS. This node stores five statuses;
 *   A2A names eight states. The extra three are carried by the task's ERROR CODE and by whether the
 *   assignee has started: `failed` + `REJECTED` is A2A's "the agent refused", `input_required` +
 *   `AUTH_REQUIRED` is "authorise something first", and `working` with no `startedAt` is
 *   "submitted, nobody has picked it up".
 *
 *   That relation was written out three separate times — as the protobuf enum in a2a-projection.ts,
 *   as the wire string in models/agent-v2-task.ts, and BACKWARDS in a2a-handler.ts for filtering a
 *   list. Three copies of one rule is the shape that has cost this project a defect a day; here it
 *   already had, and nobody had noticed: the backwards one mapped A2A's REJECTED to `['failed']`,
 *   so a client asking "show me what was refused" was handed everything that broke as well.
 *
 *   SO THE INVERSE IS DERIVED, NOT WRITTEN. `matchesA2AState` is defined as "the forward answer
 *   equals this state" and cannot disagree with it. `statusesForA2AState` remains, because a
 *   database query has to narrow by a column before a predicate can look at the rows, but it is
 *   documented as a PREFILTER and the predicate is what decides.
 * @structure
 *   - A2A_TASK_ERROR_CODE — the two error codes that carry a state, named once
 *   - a2aStateOf(task) — the forward answer, as A2A's wire string
 *   - a2aTaskStateOf(task) — the same answer as the protobuf enum
 *   - statusesForA2AState(state) — the coarse status prefilter for a query
 *   - matchesA2AState(task, state) — the exact predicate, derived from the forward answer
 * @usage
 *   import { a2aStateOf, matchesA2AState, A2A_TASK_ERROR_CODE } from './a2a-task-state.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Extracted from three call sites; REJECTED stops filtering as FAILED.
 */
import { TaskState } from '@a2a-js/sdk';
import type { AgentV2TaskRecord, AgentV2TaskStatus } from '../storage/types/agent-v2-tasks.js';

/**
 * The two error codes that mean a STATE rather than a fault.
 *
 * An assignee reporting a status may set either, and it is the only way to reach A2A's `rejected`
 * and `auth-required` from a task this node stores. Named here because they were a convention three
 * files read and no file wrote down — a runtime had no way to learn that `REJECTED` was the
 * difference between "I will not do this" and "I tried and it broke".
 */
export const A2A_TASK_ERROR_CODE = {
  /** The assignee looked at the work and declined it. A2A: `rejected`. */
  refused: 'REJECTED',
  /** The work cannot proceed until the caller authorises something. A2A: `auth-required`. */
  authRequired: 'AUTH_REQUIRED',
} as const;

/** A2A's eight task states, as they are spelled on the wire. */
export type A2AStateName =
  | 'submitted' | 'working' | 'input-required' | 'auth-required'
  | 'completed' | 'failed' | 'rejected' | 'canceled';

/** What the forward answer reads. Anything with these three fields can be asked. */
export type TaskStateInput = Pick<AgentV2TaskRecord, 'status' | 'startedAt' | 'error'>;

/**
 * THE TABLE. Every other function here is this one, read a different way.
 *
 * `canceled` has one L: A2A spells it that way and this node spells it the other, which is the
 * whole reason a translation exists rather than the two vocabularies being treated as one.
 */
export function a2aStateOf(task: TaskStateInput): A2AStateName {
  switch (task.status) {
    case 'working':
      // No `startedAt` means nobody has picked it up. That is A2A's `submitted`, and the write that
      // sets `startedAt` is the assignee's first move.
      return task.startedAt ? 'working' : 'submitted';
    case 'input_required':
      return task.error?.code === A2A_TASK_ERROR_CODE.authRequired ? 'auth-required' : 'input-required';
    case 'completed':
      return 'completed';
    case 'failed':
      return task.error?.code === A2A_TASK_ERROR_CODE.refused ? 'rejected' : 'failed';
    case 'cancelled':
      return 'canceled';
  }
}

/** The same answer as the protobuf enum the A2A SDK serialises. */
const ENUM_BY_NAME: Record<A2AStateName, TaskState> = {
  submitted: TaskState.TASK_STATE_SUBMITTED,
  working: TaskState.TASK_STATE_WORKING,
  'input-required': TaskState.TASK_STATE_INPUT_REQUIRED,
  'auth-required': TaskState.TASK_STATE_AUTH_REQUIRED,
  completed: TaskState.TASK_STATE_COMPLETED,
  failed: TaskState.TASK_STATE_FAILED,
  rejected: TaskState.TASK_STATE_REJECTED,
  canceled: TaskState.TASK_STATE_CANCELED,
};

export function a2aTaskStateOf(task: TaskStateInput): TaskState {
  return ENUM_BY_NAME[a2aStateOf(task)];
}

/** The enum an A2A state name carries, for a caller that holds the name. */
export function a2aStateEnum(name: A2AStateName): TaskState {
  return ENUM_BY_NAME[name];
}

/**
 * The statuses a query must narrow to before the predicate can decide. A PREFILTER, never the
 * answer: REJECTED and FAILED share the status `failed`, and SUBMITTED and WORKING share `working`,
 * so a listing that stops here returns more than was asked for. Follow it with `matchesA2AState`.
 */
export function statusesForA2AState(state: TaskState): AgentV2TaskStatus[] | undefined {
  switch (state) {
    case TaskState.TASK_STATE_SUBMITTED:
    case TaskState.TASK_STATE_WORKING:
      return ['working'];
    case TaskState.TASK_STATE_INPUT_REQUIRED:
    case TaskState.TASK_STATE_AUTH_REQUIRED:
      return ['input_required'];
    case TaskState.TASK_STATE_COMPLETED:
      return ['completed'];
    case TaskState.TASK_STATE_FAILED:
    case TaskState.TASK_STATE_REJECTED:
      return ['failed'];
    case TaskState.TASK_STATE_CANCELED:
      return ['cancelled'];
    default:
      return undefined;
  }
}

/**
 * Does this task's state equal the one a client asked to filter by?
 *
 * DERIVED FROM THE FORWARD ANSWER on purpose. Written out as its own switch it would be a fourth
 * copy of the table, free to disagree with the other three — which is exactly how a filter for
 * `rejected` came to return every failure.
 */
export function matchesA2AState(task: TaskStateInput, state: TaskState): boolean {
  return a2aTaskStateOf(task) === state;
}
