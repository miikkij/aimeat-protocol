/**
 * @file test/unit/a2a-task-state.test.ts
 * @description The relation between a task's state here and its state in A2A, held in both directions.
 *
 *   ONE RULE, THREE FUNCTIONS, AND ONE OF THEM DISAGREED. Five statuses here become eight states in
 *   A2A; the extra three are carried by the task's error code and by whether the assignee has
 *   started. That relation was written out three separate times — the protobuf enum in
 *   a2a-projection.ts, the wire string in models/agent-v2-task.ts, and BACKWARDS in a2a-handler.ts
 *   for filtering a list. The backwards one mapped A2A's `rejected` to the status `failed` and
 *   stopped, so `ListTasks(status: REJECTED)` answered with everything that had broken as well as
 *   what had been refused.
 *
 *   THE LAST TEST IS THE ONE THAT MATTERS IN A YEAR. It does not check a value; it checks that the
 *   two directions are the same relation. A fourth copy, or an edit to one of the three, cannot
 *   pass it.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, with the filter defect it exists to hold.
 */
import { describe, it, expect } from 'vitest';
import { TaskState } from '@a2a-js/sdk';
import {
  a2aStateOf, a2aTaskStateOf, statusesForA2AState, matchesA2AState,
  A2A_TASK_ERROR_CODE, type A2AStateName, type TaskStateInput,
} from '../../src/services/a2a-task-state.js';

/** A task shape carrying only what the relation reads. */
const task = (over: Partial<TaskStateInput>): TaskStateInput =>
  ({ status: 'working', startedAt: null, error: null, ...over } as TaskStateInput);

/** One task per A2A state, which is also the proof that all eight are reachable from this model. */
const EVERY_STATE: Array<[A2AStateName, TaskStateInput]> = [
  ['submitted', task({ status: 'working', startedAt: null })],
  ['working', task({ status: 'working', startedAt: '2026-09-04T00:00:00.000Z' })],
  ['input-required', task({ status: 'input_required' })],
  ['auth-required', task({ status: 'input_required', error: { code: A2A_TASK_ERROR_CODE.authRequired, message: 'pay first' } })],
  ['completed', task({ status: 'completed' })],
  ['failed', task({ status: 'failed', error: { code: 'BOOM', message: 'it broke' } })],
  ['rejected', task({ status: 'failed', error: { code: A2A_TASK_ERROR_CODE.refused, message: 'not doing that' } })],
  ['canceled', task({ status: 'cancelled' })],
];

describe('the forward answer', () => {
  it('produces all eight A2A states from the five this node stores', () => {
    for (const [expected, t] of EVERY_STATE) {
      expect(a2aStateOf(t)).toBe(expected);
    }
    expect(new Set(EVERY_STATE.map(([name]) => name)).size).toBe(8);
  });

  it('spells canceled with one L, because A2A does and this node does not', () => {
    expect(a2aStateOf(task({ status: 'cancelled' }))).toBe('canceled');
  });

  it('reads a task nobody has picked up as submitted, not working', () => {
    // `startedAt` is written by the assignee's first move; before that the work is queued, and a
    // client watching for someone to start would never see the transition if this said `working`.
    expect(a2aStateOf(task({ status: 'working', startedAt: null }))).toBe('submitted');
    expect(a2aStateOf(task({ status: 'working', startedAt: '2026-09-04T00:00:00.000Z' }))).toBe('working');
  });

  it('separates a refusal from a fault, which is the whole point of the REJECTED code', () => {
    expect(a2aStateOf(task({ status: 'failed', error: { code: A2A_TASK_ERROR_CODE.refused, message: 'no' } }))).toBe('rejected');
    expect(a2aStateOf(task({ status: 'failed', error: { code: 'TIMEOUT', message: 'slow' } }))).toBe('failed');
    expect(a2aStateOf(task({ status: 'failed', error: null }))).toBe('failed');
  });
});

describe('the query prefilter', () => {
  it('narrows to the statuses that could produce the asked-for state', () => {
    expect(statusesForA2AState(TaskState.TASK_STATE_REJECTED)).toEqual(['failed']);
    expect(statusesForA2AState(TaskState.TASK_STATE_SUBMITTED)).toEqual(['working']);
    expect(statusesForA2AState(TaskState.TASK_STATE_AUTH_REQUIRED)).toEqual(['input_required']);
  });

  it('is not the answer on its own, which is the defect that started this', () => {
    // Both of these narrow to `failed`. A listing that stops at the prefilter hands a client asking
    // for what was REFUSED everything that BROKE, which is what ListTasks did.
    expect(statusesForA2AState(TaskState.TASK_STATE_REJECTED))
      .toEqual(statusesForA2AState(TaskState.TASK_STATE_FAILED));
  });
});

describe('the two directions are one relation', () => {
  it('matches a task to its own state and to no other', () => {
    for (const [name, t] of EVERY_STATE) {
      for (const [other] of EVERY_STATE) {
        const asked = a2aTaskStateOf(EVERY_STATE.find(([n]) => n === other)![1]);
        expect(matchesA2AState(t, asked)).toBe(name === other);
      }
    }
  });

  it('never matches a task the prefilter would have excluded', () => {
    // The predicate must be NARROWER than the query, never wider: a row the database would not have
    // returned must not be one the filter would have kept. This is the direction a fourth copy of
    // the table would break first.
    for (const [, t] of EVERY_STATE) {
      for (const [, otherTask] of EVERY_STATE) {
        const state = a2aTaskStateOf(otherTask);
        if (!matchesA2AState(t, state)) continue;
        const allowed = statusesForA2AState(state);
        expect(allowed).toBeDefined();
        expect(allowed).toContain(t.status);
      }
    }
  });
});
