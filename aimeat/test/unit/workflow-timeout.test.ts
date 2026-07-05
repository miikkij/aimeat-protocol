import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { WorkflowRun, WorkflowDef, WorkflowRunStep, ResolvedStepSignals, Signal } from '../../src/models/workflow-schemas.js';

// In-memory Storage covering the watchdog sweep path: getMemory/setMemory/listMemory(prefix) +
// getAgent/getAgentTask → null + the owner-scope aggregation helpers (getAgentsByOwner /
// getEcosystemAppsByOwner → []). Cast to Storage. The sweep now re-evaluates the success signal via
// buildEvalCtx → owner-memory helpers, so the mock supports prefix listing + the two aggregation calls.
function memStorage(): Storage {
  const map = new Map<string, MemoryRecord>();
  const k = (owner: string, key: string) => `${owner}|${key}`;
  return {
    getMemory: async (owner: string, key: string) => map.get(k(owner, key)) ?? null,
    setMemory: async (rec: MemoryRecord) => { map.set(k(rec.ownerGaii, rec.key), rec); return rec; },
    listMemory: async (owner: string, opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? '';
      return [...map.values()].filter(r => r.ownerGaii === owner && r.key.startsWith(prefix));
    },
    getAgent: async () => null,
    getAgentTask: async () => null,
    getAgentsByOwner: async () => [],
    getEcosystemAppsByOwner: async () => [],
  } as unknown as Storage;
}

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const WF = 'twf';

interface SeedOpts {
  successSignal: Signal;
  startedAtMsAgo: number;                  // how long ago the step was dispatched
  timeoutMin?: number;                     // default 1
  retry?: { max: number; backoff_min: number };
  keys?: Record<string, unknown>;          // memory keys to seed under OWNER (the crew's output)
  priorProgress?: { count: number; min: number; lastProgressAtMsAgo: number }; // simulate an earlier sample
  runId?: string;
}

/** Seed a single-step ('a') dispatched run + register it in the active-run index the sweep reads. */
function seed(storage: Storage, o: SeedOpts): { runId: string } {
  const runId = o.runId ?? 'run-1';
  const now = Date.now();
  const startedAt = new Date(now - o.startedAtMsAgo).toISOString();
  const def: WorkflowDef = {
    id: WF, title: WF, description: 'd', trigger: { kind: 'manual' }, vars: [],
    steps: [{ id: 'a', agent: 'bot', offer: 'o', description: 'x', timeout_min: o.timeoutMin ?? 1, retry: o.retry }],
    on_step_fail: 'inspect', createdBy: 'x', createdAt: 't', updatedAt: 't',
  };
  const resolved: ResolvedStepSignals[] = [{ stepId: 'a', agents: ['bot'], offerId: 'o', success_signal: o.successSignal, required_to_function: 'none' }];
  const stepA: WorkflowRunStep = { state: 'dispatched', attempt: 0, taskIds: ['t1'], reads: [], writes: [], startedAt };
  if (o.priorProgress) {
    stepA.progress = {
      count: o.priorProgress.count, min: o.priorProgress.min, increasing: false,
      lastProgressAt: new Date(now - o.priorProgress.lastProgressAtMsAgo).toISOString(),
    };
  }
  const run: WorkflowRun = {
    runId, workflowId: WF, defSnapshot: def, resolved, vars: {}, mode: 'full-live', keyPrefix: '',
    status: 'waiting-step', steps: { a: stepA }, startedAt,
  };
  const nowIso = new Date().toISOString();
  const put = (owner: string, key: string, value: unknown) =>
    void storage.setMemory({ key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: nowIso, updatedAt: nowIso });
  put(OWNER, `workflows.run.${WF}.${runId}`, run);
  put(`system@${NODE}`, 'workflows.active', [{ ownerGhii: OWNER, workflowId: WF, runId }]);
  for (const [key, value] of Object.entries(o.keys ?? {})) put(OWNER, key, value);
  return { runId };
}

const engineFor = (storage: Storage) => new WorkflowEngine({ nodeId: NODE } as AimeatConfig, storage);
const readRun = async (storage: Storage, runId: string) =>
  (await storage.getMemory(OWNER, `workflows.run.${WF}.${runId}`))!.value as WorkflowRun;

const COUNT3: Signal = { kind: 'deterministic', key_glob: 'art.*', op: 'count_nonempty', min: 3 };

describe('watchdog: re-check before failing (recover a slow step)', () => {
  it('a step whose leaves are present at the deadline recovers to green (not timed-out)', async () => {
    const storage = memStorage();
    // Dispatched 10 min ago with a 1-min timeout (base deadline long past), but the key IS present now.
    seed(storage, { successSignal: { kind: 'deterministic', key: 'k', op: 'exists' }, startedAtMsAgo: 600_000, keys: { k: 'the deliverable' } });
    const engine = engineFor(storage);
    await engine.sweep();

    const run = await readRun(storage, 'run-1');
    expect(run.steps.a.state).toBe('green'); // reality wins over the elapsed clock
    expect(run.status).toBe('done');
  });

  it('a step with NO progress past timeout_min still times out (0/3 stuck → inspect)', async () => {
    const storage = memStorage();
    seed(storage, { successSignal: COUNT3, startedAtMsAgo: 65_000 }); // no keys seeded → 0/3, never progressed
    const engine = engineFor(storage);
    await engine.sweep();

    const run = await readRun(storage, 'run-1');
    expect(run.steps.a.state).toBe('timed-out');
    expect(run.status).toBe('partial');
    expect(run.steps.a.progress).toMatchObject({ count: 0, min: 3, increasing: false });
  });
});

describe('watchdog: slow vs stuck (sliding no-progress window)', () => {
  it('a step still filling keys past its base deadline keeps waiting (in-progress), not timed-out', async () => {
    const storage = memStorage();
    // Base deadline (startedAt + 1 min) is past, but the crew filled 2/3 → progress since dispatch (0).
    seed(storage, { successSignal: COUNT3, startedAtMsAgo: 65_000, keys: { 'art.a': 'x', 'art.b': 'y' } });
    const engine = engineFor(storage);
    await engine.sweep();

    const run = await readRun(storage, 'run-1');
    expect(run.steps.a.state).toBe('dispatched');            // the deadline slid — still waiting
    expect(run.steps.a.progress).toMatchObject({ count: 2, min: 3, increasing: true });
    expect(run.status).toBe('waiting-step');
  });

  it('a step that stalled (flat count) past timeout_min since its last progress times out', async () => {
    const storage = memStorage();
    // 2/3 filled, but the last progress was 90s ago (> 1-min window) and no new keys this sweep → stuck.
    seed(storage, {
      successSignal: COUNT3, startedAtMsAgo: 300_000, keys: { 'art.a': 'x', 'art.b': 'y' },
      priorProgress: { count: 2, min: 3, lastProgressAtMsAgo: 90_000 },
    });
    const engine = engineFor(storage);
    await engine.sweep();

    const run = await readRun(storage, 'run-1');
    expect(run.steps.a.state).toBe('timed-out');
    expect(run.steps.a.progress).toMatchObject({ count: 2, increasing: false });
  });

  it('a stalled step with retry budget re-dispatches (gap-fill) instead of timing out', async () => {
    const storage = memStorage();
    seed(storage, {
      successSignal: COUNT3, startedAtMsAgo: 300_000, keys: { 'art.a': 'x', 'art.b': 'y' },
      priorProgress: { count: 2, min: 3, lastProgressAtMsAgo: 90_000 },
      retry: { max: 2, backoff_min: 5 },
    });
    const engine = engineFor(storage);
    await engine.sweep();

    const run = await readRun(storage, 'run-1');
    expect(run.steps.a.state).toBe('pending');   // back to pending for a gap-fill re-dispatch
    expect(run.steps.a.attempt).toBe(1);
    expect(run.steps.a.notBefore).toBeDefined();
  });
});
