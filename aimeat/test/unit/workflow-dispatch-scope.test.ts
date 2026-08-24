/**
 * @file test/unit/workflow-dispatch-scope.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a dispatched workflow step actually TELLS its agent.
 *
 *   An offer names its output as a template — `julkaisu.{ref}.aineisto` — and only the engine knows
 *   what `{ref}` is on this run. Before the scope carried them, an agent had no way to find out.
 *   Measured on production 2026-08-24: the editor agent ran twice, produced a good result both
 *   times, and wrote both under ids it had invented; the step went output-red while the work sat in
 *   memory under an address nobody reads. The only pipeline shape that worked was one keyed on
 *   `{date}`, which is the single variable an agent can derive unaided.
 *
 *   These assert the two fields that close that hole, and the third that was already there.
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial: run vars + assembled deliverable_key on the dispatched task.
 */
import { describe, it, expect } from 'vitest';
import { dispatchStep } from '../../src/services/workflow/engine-steps.js';
import type { AgentTaskRecord } from '../../src/storage/interface.js';
import type { WorkflowRun, WorkflowStep } from '../../src/models/workflow-schemas.js';

/** The two storage calls dispatchStep makes for an agent step, and nothing else. */
function recordingDeps() {
  const created: AgentTaskRecord[] = [];
  const deps = {
    storage: {
      createAgentTask: async (r: AgentTaskRecord) => { created.push(r); },
      appendTaskEvent: async () => {},
    },
    config: { nodeId: 'test-node' },
  } as unknown as Parameters<typeof dispatchStep>[0];
  return { deps, created };
}

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: 'r1', workflowId: 'wf', vars: { ref: 'p1a2b3c', date: '2026-08-24' },
    mode: 'full-live', keyPrefix: '', status: 'running', steps: {},
    defSnapshot: { description: 'the whole pipeline' },
    resolved: [],
    ...overrides,
  } as unknown as WorkflowRun;
}

const step: WorkflowStep = { id: 'toimittaja', agent: 'julkaisu-toimittaja', offer: 'valitse-aihe', description: 'pick the story', timeout_min: 20 };
const resolved = { stepId: 'toimittaja', agents: ['julkaisu-toimittaja'], offerId: 'valitse-aihe', deliverableKey: 'julkaisu.{ref}.aineisto' };

const scopeMap = (r: AgentTaskRecord) =>
  Object.fromEntries(r.scope.map(s => [s.name, s.value]));

describe('dispatchStep — what the agent is told', () => {
  it('carries every run variable, so a templated key can be built at all', async () => {
    const { deps, created } = recordingDeps();
    await dispatchStep(deps, 'alice@test-node', run(), step, resolved, () => {});
    expect(created).toHaveLength(1);
    const s = scopeMap(created[0]);
    expect(s['var.ref']).toBe('p1a2b3c');
    expect(s['var.date']).toBe('2026-08-24');
  });

  it('carries the ASSEMBLED deliverable key, not the template', async () => {
    const { deps, created } = recordingDeps();
    await dispatchStep(deps, 'alice@test-node', run(), step, resolved, () => {});
    const s = scopeMap(created[0]);
    // The exact string the success signal will read. An agent that writes here cannot miss.
    expect(s['deliverable_key']).toBe('julkaisu.p1a2b3c.aineisto');
    // And it is typed as a key, so a fleet dispatching on scope types can find it.
    expect(created[0].scope.find(x => x.name === 'deliverable_key')?.type).toBe('memory_key');
  });

  it('prefixes the deliverable key in a sandbox run, exactly as the signal reader does', async () => {
    const { deps, created } = recordingDeps();
    await dispatchStep(deps, 'alice@test-node', run({ keyPrefix: 'wf-test.r1.', mode: 'full-sandbox' }), step, resolved, () => {});
    const s = scopeMap(created[0]);
    expect(s['deliverable_key']).toBe('wf-test.r1.julkaisu.p1a2b3c.aineisto');
    expect(s['wf-key-prefix']).toBe('wf-test.r1.');
  });

  it('still carries the run pointer the terminal path keys on', async () => {
    const { deps, created } = recordingDeps();
    await dispatchStep(deps, 'alice@test-node', run(), step, resolved, () => {});
    expect(scopeMap(created[0])['workflow-run']).toBe('wf/r1');
    expect(scopeMap(created[0])['offer']).toBe('valitse-aihe');
  });

  it('omits deliverable_key when the offer publishes none, rather than sending an empty one', async () => {
    const { deps, created } = recordingDeps();
    const noKey = { ...resolved, deliverableKey: undefined };
    await dispatchStep(deps, 'alice@test-node', run(), step, noKey, () => {});
    expect(created[0].scope.some(x => x.name === 'deliverable_key')).toBe(false);
  });
});
