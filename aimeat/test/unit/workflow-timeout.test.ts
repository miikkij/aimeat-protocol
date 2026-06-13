import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { WorkflowRun, WorkflowDef, ResolvedStepSignals } from '../../src/models/workflow-schemas.js';

// Minimal in-memory Storage covering only what the watchdog sweep path touches
// (getMemory/setMemory/listMemory + getAgent/getAgentTask → null). Cast to Storage.
function memStorage(): Storage {
  const map = new Map<string, MemoryRecord>();
  const k = (owner: string, key: string) => `${owner}|${key}`;
  return {
    getMemory: async (owner: string, key: string) => map.get(k(owner, key)) ?? null,
    setMemory: async (rec: MemoryRecord) => { map.set(k(rec.ownerGaii, rec.key), rec); return rec; },
    listMemory: async () => [],
    getAgent: async () => null,
    getAgentTask: async () => null,
  } as unknown as Storage;
}

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;

function seedRun(storage: Storage, deadlineMsFromNow: number): { workflowId: string; runId: string } {
  const workflowId = 'twf';
  const runId = 'run-timeout-1';
  // timeout_min is minute-granular; backdate startedAt so the deadline lands `deadlineMsFromNow` out.
  const startedAt = new Date(Date.now() - (60_000 - deadlineMsFromNow)).toISOString();
  const def: WorkflowDef = {
    id: workflowId, title: 'twf', description: 'd', trigger: { kind: 'manual' }, vars: [],
    steps: [{ id: 'a', agent: 'bot', offer: 'o', description: 'x', timeout_min: 1 }],
    on_step_fail: 'inspect', createdBy: 'x', createdAt: 't', updatedAt: 't',
  };
  const resolved: ResolvedStepSignals[] = [{ stepId: 'a', agents: ['bot'], offerId: 'o', success_signal: { kind: 'deterministic', key: 'k', op: 'exists' }, required_to_function: 'none' }];
  const run: WorkflowRun = {
    runId, workflowId, defSnapshot: def, resolved, vars: {}, mode: 'full-live', keyPrefix: '',
    status: 'waiting-step',
    steps: { a: { state: 'dispatched', attempt: 0, taskIds: ['t1'], reads: [], writes: [], startedAt } },
    startedAt,
  };
  const now = new Date().toISOString();
  // persist the run + register it in the active-run index the sweep reads
  void storage.setMemory({ key: `workflows.run.${workflowId}.${runId}`, ownerGaii: OWNER, value: run, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  void storage.setMemory({ key: 'workflows.active', ownerGaii: `system@${NODE}`, value: [{ ownerGhii: OWNER, workflowId, runId }], visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
  return { workflowId, runId };
}

describe('watchdog timeout firing', () => {
  it('marks a dispatched step timed-out (and the run partial) once its deadline passes', async () => {
    const storage = memStorage();
    const engine = new WorkflowEngine({ nodeId: NODE } as AimeatConfig, storage);
    // Effective 5s timeout for this test (not the 60-min default), so it stays short.
    const { workflowId, runId } = seedRun(storage, 5_000);

    // Before the deadline: sweep is a no-op (still dispatched).
    await engine.sweep();
    let rec = await storage.getMemory(OWNER, `workflows.run.${workflowId}.${runId}`);
    expect((rec!.value as WorkflowRun).steps.a.state).toBe('dispatched');

    // Wait past the 5s deadline, then sweep → timed-out.
    await new Promise(r => setTimeout(r, 5_300));
    await engine.sweep();

    rec = await storage.getMemory(OWNER, `workflows.run.${workflowId}.${runId}`);
    const run = rec!.value as WorkflowRun;
    expect(run.steps.a.state).toBe('timed-out');
    expect(run.status).toBe('partial');
  }, 15_000); // generous test timeout — the body waits ~5.3s
});
