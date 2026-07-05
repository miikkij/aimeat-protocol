import { describe, it, expect } from 'vitest';
import { collectSignalKeys, collectVarRefs, missingAfterRefs, detectCycle, BUILTIN_VARS } from '../../src/services/workflow/store.js';
import type { Signal, WorkflowStep } from '../../src/models/workflow-schemas.js';

describe('collectSignalKeys', () => {
  it('collects key + key_glob across a nested signal tree', () => {
    const sig: Signal = {
      all: [
        { kind: 'deterministic', key: 'news.{date}.a', op: 'nonempty' },
        { when: { kind: 'deterministic', key_glob: 'news.{date}.*', op: 'count_nonempty', min: 1 },
          then: { kind: 'llm', key: 'news.{date}.editorial', ask: 'real?' } },
      ],
    };
    expect(collectSignalKeys(sig).sort()).toEqual(
      ['news.{date}.*', 'news.{date}.a', 'news.{date}.editorial'].sort(),
    );
  });

  it('returns [] for "none" or undefined', () => {
    expect(collectSignalKeys('none')).toEqual([]);
    expect(collectSignalKeys(undefined)).toEqual([]);
  });
});

describe('collectVarRefs', () => {
  it('extracts {var} tokens from key templates', () => {
    expect([...collectVarRefs(['news.{date}.{edition}', 'static.key', 'a.{date}'])].sort())
      .toEqual(['date', 'edition']);
  });
});

describe('BUILTIN_VARS (run-scoped keys)', () => {
  it('run + date are always available to key templates without declaration', () => {
    expect([...BUILTIN_VARS].sort()).toEqual(['date', 'run']);
  });
  it('collectVarRefs surfaces {run}/{date} so save-time validation can allow them as built-ins', () => {
    // A key template scoped per run + per day references only built-ins → no declared var needed.
    const refs = collectVarRefs(['news.{date}.{run}.article', 'scoped.{run}.done']);
    expect([...refs].every(v => (BUILTIN_VARS as readonly string[]).includes(v))).toBe(true);
    expect([...refs].sort()).toEqual(['date', 'run']);
  });
});

describe('missingAfterRefs', () => {
  it('flags after ids that name no step', () => {
    const steps: Pick<WorkflowStep, 'id' | 'after'>[] = [
      { id: 'a' }, { id: 'b', after: ['a', 'ghost'] },
    ];
    expect(missingAfterRefs(steps)).toEqual(['ghost']);
  });
});

describe('detectCycle', () => {
  it('returns null for a DAG', () => {
    const steps: Pick<WorkflowStep, 'id' | 'after'>[] = [
      { id: 'fetch' }, { id: 'a', after: ['fetch'] }, { id: 'b', after: ['fetch'] },
      { id: 'features', after: ['a', 'b'] }, { id: 'editorial', after: ['features'] },
    ];
    expect(detectCycle(steps)).toBeNull();
  });

  it('detects a direct cycle', () => {
    const steps: Pick<WorkflowStep, 'id' | 'after'>[] = [
      { id: 'a', after: ['b'] }, { id: 'b', after: ['a'] },
    ];
    expect(detectCycle(steps)).not.toBeNull();
  });

  it('detects a longer cycle', () => {
    const steps: Pick<WorkflowStep, 'id' | 'after'>[] = [
      { id: 'a', after: ['c'] }, { id: 'b', after: ['a'] }, { id: 'c', after: ['b'] },
    ];
    const cycle = detectCycle(steps);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
  });
});
