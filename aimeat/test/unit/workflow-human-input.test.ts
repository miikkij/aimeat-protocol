/**
 * @file workflow-human-input.test.ts
 * @description Unit coverage for human-input workflow steps: tick parks the step (waiting-human,
 *   question pinned + inbox notification), onHumanAnswer validates against the pinned question and
 *   advances (answer key written under the run keyPrefix), the watchdog applies the on_timeout
 *   policy (fail | skip | default), skip_done doesn't re-ask an answered gate, cancelRun skips a
 *   parked step, and validateWorkflow rejects bad human-step configs. The timeout paths live here
 *   (the 60s sweep interval is not black-box-able in E2E); the happy/decline paths are also covered
 *   end-to-end in test/e2e-workflows-human.ts.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial human-input engine + validation coverage.
 */
import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../../src/services/workflow/engine.js';
import { validateWorkflow } from '../../src/services/workflow/store.js';
import { validateHumanAnswer } from '../../src/services/workflow/engine-human.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type {
  WorkflowRun, WorkflowDef, WorkflowRunStep, WorkflowStep, WorkflowDefInput, ResolvedStepSignals,
} from '../../src/models/workflow-schemas.js';

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const WF = 'hwf';

// In-memory Storage: memory CRUD + the agent-task stubs tick's dispatch path needs when a
// downstream agent step follows the human gate. getAgent returns null (no inspector, offline bot —
// fine: dispatch itself doesn't require reachability).
function memStorage(): Storage & { tasks: unknown[] } {
  const map = new Map<string, MemoryRecord>();
  const tasks: unknown[] = [];
  const k = (owner: string, key: string) => `${owner}|${key}`;
  return {
    tasks,
    getMemory: async (owner: string, key: string) => map.get(k(owner, key)) ?? null,
    setMemory: async (rec: MemoryRecord) => { map.set(k(rec.ownerGaii, rec.key), rec); return rec; },
    deleteMemory: async (owner: string, key: string) => map.delete(k(owner, key)),
    listMemory: async (owner: string, opts?: { prefix?: string }) => {
      const prefix = opts?.prefix ?? '';
      return [...map.values()].filter(r => r.ownerGaii === owner && r.key.startsWith(prefix));
    },
    getAgent: async () => null,
    getAgentTask: async () => null,
    createAgentTask: async (rec: unknown) => { tasks.push(rec); return rec; },
    appendTaskEvent: async () => undefined,
    getAgentsByOwner: async () => [],
    getEcosystemAppsByOwner: async () => [],
  } as unknown as Storage & { tasks: unknown[] };
}

const QUESTION = {
  prompt: 'Approve step "{step}" for run {run}?',
  options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }],
};

function humanStep(over?: Partial<Extract<NonNullable<WorkflowStep['action']>, { kind: 'human-input' }>>): WorkflowStep {
  return {
    id: 'gate', description: 'human gate',
    required_to_function: 'none',
    action: { kind: 'human-input', question: QUESTION, answer_to_key: 'gate.decision', ...over },
  };
}

interface SeedOpts {
  steps: WorkflowStep[];
  runSteps: Record<string, WorkflowRunStep>;
  resolved?: ResolvedStepSignals[];
  status?: WorkflowRun['status'];
  keyPrefix?: string;
  skipDone?: boolean;
  runId?: string;
}

/** Seed a run + register it in the active-run index (the sweep entry point). */
function seed(storage: Storage, o: SeedOpts): { runId: string } {
  const runId = o.runId ?? 'run-1';
  const nowIso = new Date().toISOString();
  const def: WorkflowDef = {
    id: WF, title: WF, description: 'd', trigger: { kind: 'manual' }, vars: [],
    steps: o.steps, on_step_fail: 'inspect', skip_done: o.skipDone ?? false,
    createdBy: 'x', createdAt: 't', updatedAt: 't',
  };
  const resolved: ResolvedStepSignals[] = o.resolved ?? o.steps.map(s => ({
    stepId: s.id, agents: [], offerId: '',
    success_signal: s.action?.kind === 'human-input' && s.action.answer_to_key
      ? { kind: 'deterministic', key: s.action.answer_to_key, op: 'nonempty' }
      : undefined,
    required_to_function: 'none',
    deliverableKey: s.action?.kind === 'human-input' ? s.action.answer_to_key : undefined,
  }));
  const run: WorkflowRun = {
    runId, workflowId: WF, defSnapshot: def, resolved, vars: { run: runId },
    mode: 'full-live', keyPrefix: o.keyPrefix ?? '',
    status: o.status ?? 'running', steps: o.runSteps, startedAt: nowIso,
  };
  const put = (owner: string, key: string, value: unknown) =>
    void storage.setMemory({ key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: nowIso, updatedAt: nowIso });
  put(OWNER, `workflows.run.${WF}.${runId}`, run);
  put(`system@${NODE}`, 'workflows.active', [{ ownerGhii: OWNER, workflowId: WF, runId }]);
  return { runId };
}

const engineFor = (storage: Storage) => new WorkflowEngine({ nodeId: NODE } as AimeatConfig, storage);
const readRun = async (storage: Storage, runId = 'run-1') =>
  (await storage.getMemory(OWNER, `workflows.run.${WF}.${runId}`))!.value as WorkflowRun;

const pendingStep = (): WorkflowRunStep => ({ state: 'pending', attempt: 0, reads: [], writes: [] });
const waitingStep = (askedAtMsAgo: number): WorkflowRunStep => ({
  state: 'waiting-human', attempt: 0, reads: [], writes: [],
  startedAt: new Date(Date.now() - askedAtMsAgo).toISOString(),
  human: {
    question: { ...QUESTION, prompt: 'Approve?' },
    askedAt: new Date(Date.now() - askedAtMsAgo).toISOString(),
  },
});

describe('tick parks a reached human-input step', () => {
  it('pending → waiting-human with the templated question pinned + an inbox notification; run waiting-step', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep()], runSteps: { gate: pendingStep() } });
    await engineFor(storage).sweep(); // sweep → tick dispatches the ready pending step → parks it

    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('waiting-human');
    expect(run.status).toBe('waiting-step');
    expect(run.steps.gate.human?.question.prompt).toContain('run run-1'); // {run} templated at ask time
    expect(run.steps.gate.human?.askedAt).toBeDefined();
    const notifs = await storage.listMemory(OWNER, { prefix: 'notif.' });
    expect(notifs.some(n => (n.value as { type?: string }).type === 'workflow_input_needed')).toBe(true);
  });

  it('skip_done: an already-answered gate greens WITHOUT re-asking', async () => {
    const storage = memStorage();
    const nowIso = new Date().toISOString();
    await storage.setMemory({
      key: 'gate.decision', ownerGaii: OWNER, value: { picks: ['approve'], pick: 'approve' },
      visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: nowIso, updatedAt: nowIso,
    });
    seed(storage, { steps: [humanStep()], runSteps: { gate: pendingStep() }, skipDone: true });
    await engineFor(storage).sweep();

    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('green');
    expect(run.steps.gate.human).toBeUndefined(); // never asked
    expect(run.status).toBe('done');
  });
});

describe('onHumanAnswer', () => {
  it('greens the step, writes the answer JSON to answer_to_key, and the run completes', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep()], runSteps: { gate: waitingStep(1000) }, status: 'waiting-step' });
    const engine = engineFor(storage);

    const res = await engine.onHumanAnswer(OWNER, WF, 'run-1', 'gate', { picks: ['approve'], by: OWNER });
    expect(res.ok).toBe(true);

    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('green');
    expect(run.steps.gate.human?.answer).toMatchObject({ picks: ['approve'], pick: 'approve', by: OWNER });
    expect(run.status).toBe('done');
    const rec = await storage.getMemory(OWNER, 'gate.decision');
    expect((rec?.value as { pick?: string })?.pick).toBe('approve');
  });

  it('honors the run keyPrefix (a sandbox answer never clobbers the prod key)', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep()], runSteps: { gate: waitingStep(1000) }, status: 'waiting-step', keyPrefix: 'wf-test.run-1.' });
    await engineFor(storage).onHumanAnswer(OWNER, WF, 'run-1', 'gate', { picks: ['approve'], by: OWNER });

    expect(await storage.getMemory(OWNER, 'gate.decision')).toBeNull();
    const sandboxed = await storage.getMemory(OWNER, 'wf-test.run-1.gate.decision');
    expect((sandboxed?.value as { pick?: string })?.pick).toBe('approve');
  });

  it('a decline gates the dependent step input-red via a json_field gate (downstream branching)', async () => {
    const storage = memStorage();
    const dependent: WorkflowStep = {
      id: 'ship', agent: 'bot', offer: 'o', after: ['gate'], description: 'ship it',
      required_to_function: { kind: 'deterministic', key: 'gate.decision', op: 'json_field', path: 'pick', equals: 'approve' },
    };
    seed(storage, {
      steps: [humanStep(), dependent],
      runSteps: { gate: waitingStep(1000), ship: pendingStep() },
      status: 'waiting-step',
      resolved: [
        { stepId: 'gate', agents: [], offerId: '', success_signal: { kind: 'deterministic', key: 'gate.decision', op: 'nonempty' }, required_to_function: 'none', deliverableKey: 'gate.decision' },
        { stepId: 'ship', agents: ['bot'], offerId: 'o', success_signal: { kind: 'deterministic', key: 'ship.out', op: 'nonempty' }, required_to_function: dependent.required_to_function },
      ],
    });
    await engineFor(storage).onHumanAnswer(OWNER, WF, 'run-1', 'gate', { picks: ['reject'], by: OWNER });

    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('green');       // the human step itself is green — any answer counts
    expect(run.steps.ship.state).toBe('input-red');   // the gate said no
    expect(run.status).toBe('partial');
  });

  it('rejects an unknown option id / multi-pick on single-select / answering a non-waiting step', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep()], runSteps: { gate: waitingStep(1000) }, status: 'waiting-step' });
    const engine = engineFor(storage);

    const bad1 = await engine.onHumanAnswer(OWNER, WF, 'run-1', 'gate', { picks: ['nope'], by: OWNER });
    expect(bad1).toMatchObject({ ok: false, code: 'BAD_ANSWER' });
    const bad2 = await engine.onHumanAnswer(OWNER, WF, 'run-1', 'gate', { picks: ['approve', 'reject'], by: OWNER });
    expect(bad2).toMatchObject({ ok: false, code: 'BAD_ANSWER' });

    const ok = await engine.onHumanAnswer(OWNER, WF, 'run-1', 'gate', { picks: ['approve'], by: OWNER });
    expect(ok.ok).toBe(true);
    const again = await engine.onHumanAnswer(OWNER, WF, 'run-1', 'gate', { picks: ['approve'], by: OWNER });
    expect(again).toMatchObject({ ok: false, code: 'NOT_WAITING' });
    const missing = await engine.onHumanAnswer(OWNER, WF, 'no-such-run', 'gate', { picks: ['approve'], by: OWNER });
    expect(missing).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('validateHumanAnswer (pure)', () => {
  it('empty picks with no other is rejected; other alone passes when allowed', () => {
    expect(validateHumanAnswer(QUESTION, { picks: [] })).toBeTruthy();
    expect(validateHumanAnswer({ ...QUESTION, allowOther: true }, { picks: [], other: 'custom' })).toBeNull();
    expect(validateHumanAnswer({ ...QUESTION, allowOther: false }, { picks: ['approve'], other: 'x' })).toBeTruthy();
    expect(validateHumanAnswer({ ...QUESTION, multiSelect: true }, { picks: ['approve', 'reject'] })).toBeNull();
  });
});

describe('watchdog on_timeout policies (default timeout 1440 min)', () => {
  const DAY = 24 * 60 * 60_000;

  it('fail (default): an unanswered step past the deadline goes timed-out, run partial', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep()], runSteps: { gate: waitingStep(DAY + 60_000) }, status: 'waiting-step' });
    await engineFor(storage).sweep();
    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('timed-out');
    expect(run.status).toBe('partial');
  });

  it('a step still inside the window is left waiting', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep()], runSteps: { gate: waitingStep(60_000) }, status: 'waiting-step' });
    await engineFor(storage).sweep();
    expect((await readRun(storage)).steps.gate.state).toBe('waiting-human');
  });

  it('skip: the step is skipped, run partial', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep({ on_timeout: 'skip' })], runSteps: { gate: waitingStep(DAY + 60_000) }, status: 'waiting-step' });
    await engineFor(storage).sweep();
    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('skipped');
    expect(run.status).toBe('partial');
  });

  it('default: the default option is synthesized (by timeout-default), key written, step green', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep({ on_timeout: 'default', default_option: 'approve' })], runSteps: { gate: waitingStep(DAY + 60_000) }, status: 'waiting-step' });
    await engineFor(storage).sweep();
    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('green');
    expect(run.steps.gate.human?.answer).toMatchObject({ pick: 'approve', by: 'timeout-default' });
    expect(((await storage.getMemory(OWNER, 'gate.decision'))?.value as { pick?: string })?.pick).toBe('approve');
    expect(run.status).toBe('done');
  });

  it('a custom timeout_min shortens the wait', async () => {
    const storage = memStorage();
    seed(storage, { steps: [{ ...humanStep(), timeout_min: 1 }], runSteps: { gate: waitingStep(2 * 60_000) }, status: 'waiting-step' });
    await engineFor(storage).sweep();
    expect((await readRun(storage)).steps.gate.state).toBe('timed-out');
  });
});

describe('cancelRun', () => {
  it('skips a parked waiting-human step and cancels the run', async () => {
    const storage = memStorage();
    seed(storage, { steps: [humanStep()], runSteps: { gate: waitingStep(1000) }, status: 'waiting-step' });
    const engine = engineFor(storage);
    expect(await engine.cancelRun(OWNER, WF, 'run-1')).toBe(true);
    const run = await readRun(storage);
    expect(run.steps.gate.state).toBe('skipped');
    expect(run.status).toBe('cancelled');
  });
});

describe('validateWorkflow (human-step config)', () => {
  const base: Omit<WorkflowDefInput, 'steps'> = {
    title: 'x', description: 'x', trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
  };
  const validate = (steps: WorkflowStep[]) =>
    validateWorkflow(memStorage(), { nodeId: NODE } as AimeatConfig, 'alice', { ...base, steps } as WorkflowDefInput);

  it('accepts a plain human-input step and synthesizes its resolved entry', async () => {
    const v = await validate([humanStep()]);
    expect(v.ok).toBe(true);
    const r = v.resolved?.find(x => x.stepId === 'gate');
    expect(r?.deliverableKey).toBe('gate.decision');
    expect(r?.success_signal).toMatchObject({ op: 'nonempty', key: 'gate.decision' });
  });

  it('rejects retry on a human-input step', async () => {
    const v = await validate([{ ...humanStep(), retry: { max: 1, backoff_min: 1 } }]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('cannot declare retry');
  });

  it('rejects on_timeout=default without a valid default_option', async () => {
    const missing = await validate([humanStep({ on_timeout: 'default' })]);
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(' ')).toContain('requires default_option');
    const unknown = await validate([humanStep({ on_timeout: 'default', default_option: 'nope' })]);
    expect(unknown.ok).toBe(false);
    expect(unknown.errors.join(' ')).toContain('not one of question.options');
  });

  it('rejects an undeclared var in answer_to_key', async () => {
    const v = await validate([humanStep({ answer_to_key: 'gate.{mystery}' })]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('undeclared var');
  });
});
