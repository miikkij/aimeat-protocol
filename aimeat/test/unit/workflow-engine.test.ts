import { describe, it, expect } from 'vitest';
import { computeReadySteps, runOutcome } from '../../src/services/workflow/engine.js';
import type { WorkflowDef, WorkflowRunStep } from '../../src/models/workflow-schemas.js';

function def(steps: Array<{ id: string; after?: string[] }>): WorkflowDef {
  return {
    id: 'wf', title: 'wf', description: 'd', trigger: { kind: 'manual' }, vars: [],
    steps: steps.map(s => ({ id: s.id, agent: 'a', offer: 'o', after: s.after, description: 'x', timeout_min: 10 })),
    on_step_fail: 'inspect', createdBy: 'o@n', createdAt: 't', updatedAt: 't',
  };
}
const step = (state: WorkflowRunStep['state'], extra: Partial<WorkflowRunStep> = {}): WorkflowRunStep =>
  ({ state, attempt: 0, reads: [], writes: [], ...extra });

const NOW = '2026-06-13T12:00:00.000Z';

describe('computeReadySteps', () => {
  it('a root step (no deps) is ready', () => {
    const d = def([{ id: 'a' }, { id: 'b', after: ['a'] }]);
    const ready = computeReadySteps(d, { a: step('pending'), b: step('pending') }, NOW);
    expect(ready.map(s => s.id)).toEqual(['a']);
  });

  it('a step becomes ready only when ALL deps are green', () => {
    const d = def([{ id: 'a' }, { id: 'b' }, { id: 'c', after: ['a', 'b'] }]);
    const partial = computeReadySteps(d, { a: step('green'), b: step('dispatched'), c: step('pending') }, NOW);
    expect(partial.map(s => s.id)).toEqual([]); // b not green yet
    const ready = computeReadySteps(d, { a: step('green'), b: step('green'), c: step('pending') }, NOW);
    expect(ready.map(s => s.id)).toEqual(['c']);
  });

  it('respects the notBefore retry-backoff gate', () => {
    const d = def([{ id: 'a' }]);
    const future = '2026-06-13T13:00:00.000Z';
    expect(computeReadySteps(d, { a: step('pending', { notBefore: future }) }, NOW)).toEqual([]);
    const past = '2026-06-13T11:00:00.000Z';
    expect(computeReadySteps(d, { a: step('pending', { notBefore: past }) }, NOW).map(s => s.id)).toEqual(['a']);
  });

  it('parallel roots are all ready at once', () => {
    const d = def([{ id: 'a' }, { id: 'b' }]);
    expect(computeReadySteps(d, { a: step('pending'), b: step('pending') }, NOW).map(s => s.id).sort()).toEqual(['a', 'b']);
  });

  it('resume: a dependent becomes ready when its dep is TERMINAL (green OR failed), not only green', () => {
    const d: WorkflowDef = { ...def([{ id: 'a' }, { id: 'b', after: ['a'] }]), resume: true };
    // Default policy would keep b blocked while a is timed-out; resume treats a terminal dep as
    // satisfied so b runs and re-gates on its OWN required_to_function inside tick.
    expect(computeReadySteps(d, { a: step('timed-out'), b: step('pending') }, NOW).map(s => s.id)).toEqual(['b']);
    expect(computeReadySteps(d, { a: step('output-red'), b: step('pending') }, NOW).map(s => s.id)).toEqual(['b']);
    // Still blocked while the dep is non-terminal (dispatched).
    expect(computeReadySteps(d, { a: step('dispatched'), b: step('pending') }, NOW).map(s => s.id)).toEqual([]);
  });

  it('default (no resume): a dependent stays blocked while its dep is timed-out', () => {
    const d = def([{ id: 'a' }, { id: 'b', after: ['a'] }]);
    expect(computeReadySteps(d, { a: step('timed-out'), b: step('pending') }, NOW).map(s => s.id)).toEqual([]);
  });
});

describe('runOutcome', () => {
  it('running while any step is non-terminal', () => {
    expect(runOutcome({ a: step('green'), b: step('dispatched') })).toBe('running');
    expect(runOutcome({ a: step('pending') })).toBe('running');
  });
  it('done when every step is green', () => {
    expect(runOutcome({ a: step('green'), b: step('green') })).toBe('done');
  });
  it('partial when terminal but not all green', () => {
    expect(runOutcome({ a: step('green'), b: step('output-red') })).toBe('partial');
    expect(runOutcome({ a: step('green'), b: step('skipped') })).toBe('partial');
    expect(runOutcome({ a: step('input-red') })).toBe('partial');
  });
});
