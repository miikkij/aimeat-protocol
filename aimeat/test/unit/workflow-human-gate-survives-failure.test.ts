/**
 * @file workflow-human-gate-survives-failure.test.ts
 * @description A human gate is asked when its producers have FINISHED, not when they have all
 *   succeeded. Reported from a real KANSI run on 2026-09-04: the image step went red on a script
 *   that legitimately asked for no images, the partial-fail policy skipped the whole subtree, and
 *   the owner's final approval gate went with it. Every piece had been written and nobody could
 *   approve any of it. The one thing that still skips a gate is having nothing to decide about:
 *   when every producer failed, an angle gate would be asking a person to choose from an empty list.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Found by omnituinen-agent as a CONSEQUENCE of another bug rather than a
 *     bug of its own, which is why it had not been noticed here.
 */
import { describe, it, expect } from 'vitest';
import { computeReadySteps } from '../../src/services/workflow/engine.js';
import type { WorkflowDef, WorkflowRunStep } from '../../src/models/workflow-schemas.js';

const NOW = '2026-09-04T12:00:00.000Z';

/** The shape of the KANSI desk: four writers in parallel, then the owner's approval gate. */
function desk(): WorkflowDef {
  return {
    id: 'desk',
    trigger: 'manual',
    steps: [
      { id: 'linkedin', after: [] },
      { id: 'x', after: [] },
      { id: 'video', after: [] },
      { id: 'kuva', after: ['video'] },
      { id: 'portti', after: ['linkedin', 'x', 'video', 'kuva'], action: { kind: 'human-input' } },
    ],
  } as unknown as WorkflowDef;
}

function states(map: Record<string, WorkflowRunStep['state']>): Record<string, WorkflowRunStep> {
  const out: Record<string, WorkflowRunStep> = {};
  for (const [id, state] of Object.entries(map)) out[id] = { state } as WorkflowRunStep;
  return out;
}

const ready = (def: WorkflowDef, map: Record<string, WorkflowRunStep['state']>): string[] =>
  computeReadySteps(def, states(map), NOW).map(s => s.id);

describe('a human gate whose producers did not all succeed', () => {
  it('is asked when one producer failed and the rest delivered', () => {
    expect(ready(desk(), {
      linkedin: 'green', x: 'green', video: 'green', kuva: 'output-red', portti: 'pending',
    })).toContain('portti');
  });

  it('is asked whatever kind of failure it was', () => {
    for (const bad of ['input-red', 'timed-out', 'skipped', 'agent-offline'] as const) {
      expect(ready(desk(), {
        linkedin: 'green', x: 'green', video: 'green', kuva: bad, portti: 'pending',
      })).toContain('portti');
    }
  });

  it('waits while a producer is still working', () => {
    expect(ready(desk(), {
      linkedin: 'green', x: 'green', video: 'green', kuva: 'dispatched', portti: 'pending',
    })).not.toContain('portti');
  });

  // Nothing was made, so there is nothing to approve. Asking here is worse than skipping: it puts a
  // question in front of a person that has no answer they could give.
  it('is not asked when every producer failed', () => {
    expect(ready(desk(), {
      linkedin: 'output-red', x: 'output-red', video: 'output-red', kuva: 'skipped', portti: 'pending',
    })).not.toContain('portti');
  });

  it('leaves an ordinary step under the old rule', () => {
    expect(ready(desk(), { video: 'output-red', kuva: 'pending' })).not.toContain('kuva');
    expect(ready(desk(), { video: 'green', kuva: 'pending' })).toContain('kuva');
  });

  // A gate that waits for nothing opens the run rather than judging it. The first cut of the rule
  // read "no green dep, therefore nothing to decide" and locked this one out for ever.
  it('asks a gate that has no producers at all', () => {
    const wf = { id: 'ask-first', trigger: 'manual', steps: [{ id: 'gate', action: { kind: 'human-input' } }] } as unknown as WorkflowDef;
    expect(ready(wf, { gate: 'pending' })).toContain('gate');
  });
});
