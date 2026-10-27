/**
 * @file test/unit/workflow-deactivated-account.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A workflow run already in flight when its account is deactivated dispatches no further
 *   step: the step stays pending, nothing is deleted, and after reactivation the next tick dispatches
 *   it (secaudit2026oct26, dispatch-authority.ts:dispatchGate:in-flight-run-ignores-deactivation).
 *   The usage case: an active account's run dispatches exactly as before.
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { WorkflowRun, WorkflowDef, WorkflowStep, ResolvedStepSignals } from '../../src/models/workflow-schemas.js';

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const WF = 'dwf';

/** In-memory storage with the owner record the deactivation check reads. */
function memStorage(owner: { disabledAt?: string | null }): Storage & { tasks: unknown[] } {
  const map = new Map<string, MemoryRecord>();
  const tasks: unknown[] = [];
  const k = (o: string, key: string) => `${o}|${key}`;
  return {
    tasks,
    getOwner: async (name: string) => (name === 'alice' ? { name: 'alice', disabledAt: owner.disabledAt ?? null } : null),
    getMemory: async (o: string, key: string) => map.get(k(o, key)) ?? null,
    setMemory: async (rec: MemoryRecord) => { map.set(k(rec.ownerGaii, rec.key), rec); return rec; },
    deleteMemory: async (o: string, key: string) => map.delete(k(o, key)),
    listMemory: async (o: string, opts?: { prefix?: string }) =>
      [...map.values()].filter(r => r.ownerGaii === o && r.key.startsWith(opts?.prefix ?? '')),
    getAgent: async () => null,
    getAgentTask: async () => null,
    createAgentTask: async (rec: unknown) => { tasks.push(rec); return rec; },
    appendTaskEvent: async () => undefined,
    getAgentsByOwner: async () => [],
    getEcosystemAppsByOwner: async () => [],
  } as unknown as Storage & { tasks: unknown[] };
}

const STEP: WorkflowStep = { id: 'work', agent: 'bot', offer: 'o', description: 'do it', timeout_min: 30, required_to_function: 'none' };

/** A run the owner started in person, its one agent step still pending, registered for the sweep. */
async function seed(storage: Storage): Promise<void> {
  const now = new Date().toISOString();
  const def: WorkflowDef = {
    id: WF, title: WF, description: 'd', trigger: { kind: 'manual' }, vars: [],
    steps: [STEP], on_step_fail: 'inspect', createdBy: OWNER, createdAt: 't', updatedAt: 't',
  };
  const resolved: ResolvedStepSignals[] = [{
    stepId: 'work', agents: ['bot'], offerId: 'o', required_to_function: 'none',
    success_signal: { kind: 'deterministic', key: 'work.out', op: 'nonempty' },
  }];
  const run: WorkflowRun = {
    runId: 'run-1', workflowId: WF, defSnapshot: def, resolved, vars: { run: 'run-1' },
    mode: 'full-live', keyPrefix: '', status: 'running', startedAt: now,
    steps: { work: { state: 'pending', attempt: 0, reads: [], writes: [] } },
    principal: { kind: 'owner', id: OWNER },
  };
  const put = (o: string, key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: o, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  } as MemoryRecord);
  await put(OWNER, `workflows.run.${WF}.run-1`, run);
  await put(`system@${NODE}`, 'workflows.active', [{ ownerGhii: OWNER, workflowId: WF, runId: 'run-1' }]);
}

const engineFor = (storage: Storage) => new WorkflowEngine({ nodeId: NODE } as AimeatConfig, storage);
const readRun = async (storage: Storage) => (await storage.getMemory(OWNER, `workflows.run.${WF}.run-1`))!.value as WorkflowRun;

describe('a run in flight and its account', () => {
  it('usage: an active account\'s run dispatches its pending step', async () => {
    const storage = memStorage({});
    await seed(storage);
    await engineFor(storage).sweep();
    expect((await readRun(storage)).steps.work.state).toBe('dispatched');
    expect(storage.tasks).toHaveLength(1);
  });

  it('a deactivated account\'s run dispatches nothing, keeps the step pending, and resumes on reactivation', async () => {
    const owner: { disabledAt?: string | null } = { disabledAt: '2026-10-27T08:00:00.000Z' };
    const storage = memStorage(owner);
    await seed(storage);
    const engine = engineFor(storage);
    await engine.sweep();
    let run = await readRun(storage);
    expect(run.steps.work.state).toBe('pending');
    expect(run.status).toBe('running');
    expect(storage.tasks).toHaveLength(0);

    owner.disabledAt = null;
    await engine.sweep();
    run = await readRun(storage);
    expect(run.steps.work.state).toBe('dispatched');
    expect(storage.tasks).toHaveLength(1);
  });
});
