/**
 * @file src/services/workflow/engine-steps.ts
 * @description Workflow-engine side-effect helpers — step/inspector dispatch (agent + ecosystem),
 *   human-input ask delivery, step-failure + finish notifications, agent-offline heads-up, and
 *   fresh-mode output clearing. Extracted from engine.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — askHumanInput: deliver a human-input step's question to the owner (in-app
 *     inbox + push, best-effort) and return the templated question snapshot to pin into the run.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord, AgentTaskScope } from '../../storage/interface.js';
import type { createWebhookDispatcher } from '../webhook-dispatcher.js';
import type { PushService } from '../push.js';
import type { EmailService } from '../email.js';
import { buildGAII } from '../../utils/gaii.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';
import { globToRegExp } from './signal-eval.js';
import { collectSignalKeys, runKey, type ResolvedStep } from './store.js';
import { listOwnerScopeMemory, getOwnerScopeMemory } from '../owner-memory.js';
import { getActiveConnectTunnelManager } from '../connect-tunnel.js';
import { loc, template } from './engine-util.js';
import { isAgentStep, anyAgentReachable, AGENT_OFFLINE_GRACE_MS } from './engine-reachability.js';
import type { WorkflowRun, WorkflowRunStep, WorkflowStep } from '../../models/workflow-schemas.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

/** The services the step helpers close over — a bundle of the engine's private fields. */
export interface StepDeps {
  storage: Storage;
  config: AimeatConfig;
  webhookDispatcher?: WebhookDispatcher;
  pushService?: PushService;
  emailService?: EmailService;
}

/** Callback into the engine's non-task terminal path for ecosystem action steps. */
export type OnPushTerminal = (ownerGhii: string, workflowId: string, runId: string, stepId: string, ok: boolean) => void | Promise<void>;

const TERMINAL_RUN = new Set<WorkflowRun['status']>(['done', 'partial', 'red', 'cancelled']);
const FAILED_STEP = new Set<WorkflowRunStep['state']>(['input-red', 'output-red', 'timed-out', 'agent-offline']);

/** Dispatch a step's agent task(s); tag with the workflow-run scope for onTaskTerminal. */
export async function dispatchStep(deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep, resolved: ResolvedStep | undefined, onPushTerminal: OnPushTerminal): Promise<string[]> {
  // human-input steps are parked by tick() BEFORE dispatch (askHumanInput) — they never reach here.
  if (step.action?.kind === 'human-input') return [];
  // Ecosystem action steps push to / invoke a GEAI over the tunnel; completion arrives via the
  // async onPushTerminal path, never an agent task. They record no task ids.
  if (step.action && step.action.kind !== 'agent') {
    dispatchEcosystemStep(deps, ownerGhii, run, step, step.action, onPushTerminal);
    return [];
  }
  const ownerName = ownerGhii.split('@')[0];
  const agents = Array.isArray(step.agent) ? step.agent : (step.agent ? [step.agent] : []);
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const agentName of agents) {
    const agentGaii = buildGAII(agentName, ownerName, deps.config.nodeId);
    const scope: AgentTaskScope[] = [
      { name: 'workflow-run', value: `${run.workflowId}/${run.runId}`, type: 'text', description: step.id },
      { name: 'offer', value: step.offer ?? '', type: 'text', description: loc(step.description) },
    ];
    // Sandbox run: tell the agent the key prefix to write under (signals read under it too), so a
    // test run doesn't clobber production keys. A cooperating agent honors it; the node can't force it.
    if (run.keyPrefix) scope.push({ name: 'wf-key-prefix', value: run.keyPrefix, type: 'text', description: 'prefix all deliverable keys with this' });
    const record: AgentTaskRecord = {
      id: randomUUID(), agentGaii, ownerGaii: ownerGhii,
      title: loc(step.description) || `${run.workflowId} · ${step.id}`,
      description: loc(run.defSnapshot.description),
      scope, rules: [], verification: { userExpects: '', technicalChecks: [] },
      todos: [], status: 'active', createdAt: now, updatedAt: now, lastEventAt: now,
    };
    await deps.storage.createAgentTask(record);
    await deps.storage.appendTaskEvent({ id: randomUUID(), taskId: record.id, type: 'started', message: `Dispatched by workflow "${run.workflowId}" step "${step.id}"`, timestamp: now });
    deps.webhookDispatcher?.dispatchWebhookEvent(agentGaii, 'task.approved', {
      task_id: record.id, title: record.title, description: record.description ?? '',
      has_todos: false, todo_count: 0, scope_summary: scope.map(s => `${s.type}:${s.value}`),
      created_at: now, auto_activated: true, workflow_id: run.workflowId,
    });
    ids.push(record.id);
  }
  void resolved;
  return ids;
}

/**
 * Fire an ecosystem action step (export-out / trigger-geai) over the connect-tunnel and route its
 * reply into onPushTerminal. Fire-and-forget: the run was already marked 'dispatched' + persisted
 * under the lock by tick(), so onPushTerminal (which also locks) advances it safely on the reply.
 * The workflow owner is the caller GHII (the human pays / is the AIMEAT-side principal).
 */
export function dispatchEcosystemStep(deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep, action: Exclude<WorkflowStep['action'], undefined | { kind: 'agent' } | { kind: 'human-input' }>, onPushTerminal: OnPushTerminal): void {
  const { workflowId, runId } = run;
  const stepId = step.id;
  const fire = async (): Promise<boolean> => {
    const mgr = getActiveConnectTunnelManager();
    if (!mgr) return false;
    if (action.kind === 'trigger-geai') {
      const reply = await mgr.invokeOnPrincipal(action.geai, { capability: action.capability, input: action.input ?? {}, caller: ownerGhii });
      return reply.ok;
    }
    // export-out: read the owner-namespace `from` key and push it to the GEAI's ingest capability.
    const fromKey = template(action.from, run.vars);
    const rec = await deps.storage.getMemory(ownerGhii, fromKey);
    const reply = await mgr.invokeOnPrincipal(action.geai, {
      capability: action.capability ?? '__deposit__',
      input: { from: fromKey, data: rec?.value ?? null },
      caller: ownerGhii,
    });
    return reply.ok;
  };
  fire()
    .then(ok => onPushTerminal(ownerGhii, workflowId, runId, stepId, ok))
    .catch(() => onPushTerminal(ownerGhii, workflowId, runId, stepId, false));
}

/**
 * Deliver a human-input step's question to the owner and return the human bookkeeping record the
 * engine pins into the run. The question `prompt` is {var}-templated HERE so what the run stores is
 * exactly what was asked (same pinning philosophy as the resolved signals). Delivery = in-app inbox
 * notification (notify: inbox + web-push in one call) plus a direct push when enabled; both are
 * best-effort — a delivery problem parks the run all the same, and the pending-inputs endpoint /
 * dashboards still surface the question.
 */
export async function askHumanInput(
  deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep,
  action: Extract<NonNullable<WorkflowStep['action']>, { kind: 'human-input' }>,
): Promise<NonNullable<WorkflowRunStep['human']>> {
  const now = new Date().toISOString();
  const question = { ...action.question, prompt: template(action.question.prompt, run.vars) };
  const name = loc(run.defSnapshot.title) || run.workflowId;
  const title = 'Workflow needs your input';
  const optionsSummary = question.options.map(o => o.label).join(' / ');
  const body = `${name}: step "${step.id}" — ${question.prompt} [${optionsSummary}]`;
  logger.info(`workflow ${run.workflowId} run ${run.runId}: step "${step.id}" waiting for human input`);
  try { await notify(deps.storage, ownerGhii, { type: 'workflow_input_needed', title, body, link: '/v1/profile?tab=workflows' }); }
  catch (err) { logger.warn('askHumanInput: in-app notify best-effort', { error: String(err) }); }
  if (deps.pushService?.enabled) {
    deps.pushService.sendNotification(ownerGhii.split('@')[0], { title, body, url: '/v1/profile?tab=workflows', tag: `workflow:${run.workflowId}` })
      .catch(err => { logger.warn('askHumanInput: push best-effort', { error: String(err) }); });
  }
  return { question, askedAt: now };
}

/**
 * On a RED step: GUARANTEE the owner sees it (push — node-owned, never silent), then best-effort
 * dispatch the crew `workflow-inspector` agent for diagnosis/repair. The push is the contract; the
 * inspector is enrichment, so a missing/offline inspector never hides the failure.
 */
export async function onStepFail(deps: StepDeps, ownerGhii: string, run: WorkflowRun, stepId: string, reason: WorkflowRunStep['state']): Promise<void> {
  const ownerName = ownerGhii.split('@')[0];
  logger.warn(`workflow ${run.workflowId} run ${run.runId}: step "${stepId}" ${reason}`);
  // 1. Guaranteed owner alert (deterministic, node-owned).
  if (deps.pushService?.enabled) {
    deps.pushService.sendNotification(ownerName, {
      title: 'Workflow step failed',
      body: `${loc(run.defSnapshot.title) || run.workflowId}: step "${stepId}" → ${reason}`,
      url: '/v1/profile?tab=workflows',
      tag: `workflow:${run.workflowId}`,
    }).catch(err => { logger.warn('onStepFail: push best-effort', { error: String(err) }); });
  }
  // 2. Best-effort inspector dispatch (crew-owned; absent ⇒ skip silently, the push already fired).
  const taskId = await dispatchInspector(deps, ownerGhii, ownerName, run, stepId, reason);
  if (taskId) {
    run.inspections = [...(run.inspections ?? []), { stepId, taskId, reason, at: new Date().toISOString() }];
  }
}

/**
 * Queue a task to the owner's `workflow-inspector` agent (crew-owned) with full run context: the
 * run record (defSnapshot + every step's state + expected-vs-observed) is at a known memory key.
 * Tagged `workflow-inspect` (NOT `workflow-run`) so completing it never advances the run. Returns
 * the task id, or null when no inspector agent is installed.
 */
export async function dispatchInspector(deps: StepDeps, ownerGhii: string, ownerName: string, run: WorkflowRun, stepId: string, reason: WorkflowRunStep['state']): Promise<string | null> {
  const inspectorGaii = buildGAII('workflow-inspector', ownerName, deps.config.nodeId);
  const inspector = await deps.storage.getAgent(inspectorGaii);
  if (!inspector) return null;

  const rk = runKey(run.workflowId, run.runId);
  const failing = run.steps[stepId];
  const failingAgents = (run.defSnapshot.steps.find(s => s.id === stepId)?.agent) ?? '';
  const now = new Date().toISOString();
  const scope: AgentTaskScope[] = [
    { name: 'workflow-inspect', value: `${run.workflowId}/${run.runId}`, type: 'text', description: stepId },
  ];
  const record: AgentTaskRecord = {
    id: randomUUID(), agentGaii: inspectorGaii, ownerGaii: ownerGhii,
    title: `Inspect workflow "${run.workflowId}" — step "${stepId}" ${reason}`,
    description: [
      `A workflow step failed (${reason}).`,
      `Read the full run record at owner memory key "${rk}" — it carries defSnapshot, every step's`,
      `state (green / input-red / output-red / timed-out / skipped), and per-leaf expected-vs-observed.`,
      `Failing step: "${stepId}" (agent: ${Array.isArray(failingAgents) ? failingAgents.join(', ') : failingAgents}).`,
      `Observed: ${JSON.stringify(failing?.outputObserved ?? failing?.inputObserved ?? {}).slice(0, 1000)}.`,
      `Diagnose, auto-run any safe deterministic repairs, and report recommendations.`,
    ].join(' '),
    scope, rules: [], verification: { userExpects: '', technicalChecks: [] },
    resources: { memoryKeys: [rk] },
    todos: [], status: 'active', createdAt: now, updatedAt: now, lastEventAt: now,
  };
  await deps.storage.createAgentTask(record);
  await deps.storage.appendTaskEvent({ id: randomUUID(), taskId: record.id, type: 'started', message: `Workflow inspection requested for "${run.workflowId}" step "${stepId}" (${reason})`, timestamp: now });
  deps.webhookDispatcher?.dispatchWebhookEvent(inspectorGaii, 'task.approved', {
    task_id: record.id, title: record.title, description: record.description ?? '',
    has_todos: false, todo_count: 0, scope_summary: scope.map(s => `${s.name}:${s.value}`),
    created_at: now, auto_activated: true, workflow_id: run.workflowId,
  });
  return record.id;
}

/**
 * Heads-up alert (owner opt-in via pushService + always the in-app inbox) fired at dispatch when a
 * step's agent(s) look OFFLINE — so the owner can bring the crew online before the offline grace
 * elapses and the step fails. Best-effort: a notify/push problem never disturbs the run.
 */
export async function maybeAlertAgentOffline(deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep): Promise<void> {
  if (!isAgentStep(step)) return;
  const ownerName = ownerGhii.split('@')[0];
  if (await anyAgentReachable(deps.storage, deps.config, ownerName, step)) return;
  const agents = (Array.isArray(step.agent) ? step.agent : (step.agent ? [step.agent] : [])).join(', ');
  const name = loc(run.defSnapshot.title) || run.workflowId;
  const graceMin = Math.round(AGENT_OFFLINE_GRACE_MS / 60_000);
  const title = 'Workflow agent offline';
  const body = `${name}: step "${step.id}" was dispatched but its agent (${agents}) looks offline — it will fail in ~${graceMin} min unless the agent connects.`;
  logger.warn(`workflow ${run.workflowId} run ${run.runId}: step "${step.id}" dispatched to offline agent(s) ${agents}`);
  try { await notify(deps.storage, ownerGhii, { type: 'workflow_agent_offline', title, body, link: '/v1/profile?tab=workflows' }); }
  catch (err) { logger.warn('agents: in-app notify best-effort', { error: String(err) }); }
  if (deps.pushService?.enabled) {
    deps.pushService.sendNotification(ownerName, { title, body, url: '/v1/profile?tab=workflows', tag: `workflow:${run.workflowId}` })
      .catch(err => { logger.warn('agents: push best-effort', { error: String(err) }); });
  }
}

/**
 * Finish-notification (Rule: owner opt-in). When a full-live run reaches a terminal state AND the
 * owner ticked `notify_on_finish` on the workflow, drop a single notification — the in-app inbox
 * always, plus an email when the owner has a notification email and SMTP is configured — telling
 * them whether the run succeeded or failed and a per-step log of how it went. Fires for BOTH
 * outcomes (success and failure). Idempotent via run.notifiedFinish; fully best-effort so a
 * notification/email problem never disturbs the run. Returns whether the run was mutated (so the
 * caller persists the notifiedFinish flag).
 */
export async function onRunFinished(deps: StepDeps, ownerGhii: string, run: WorkflowRun): Promise<boolean> {
  if (run.mode !== 'full-live') return false;
  if (!run.defSnapshot.notify_on_finish) return false;
  if (run.notifiedFinish) return false;
  if (!TERMINAL_RUN.has(run.status)) return false;
  run.notifiedFinish = true;

  const name = loc(run.defSnapshot.title) || run.workflowId;
  const succeeded = run.status === 'done';
  const outcome = succeeded ? 'succeeded'
    : run.status === 'cancelled' ? 'was cancelled'
    : 'finished with failures';
  const title = `Workflow "${name}" ${succeeded ? 'succeeded' : run.status === 'cancelled' ? 'cancelled' : 'failed'}`;

  // Per-step log + a short header (duration, failed-step roster).
  const stepLog = run.defSnapshot.steps
    .map(s => `• ${s.id}: ${run.steps[s.id]?.state ?? 'unknown'}`)
    .join('\n');
  const failedSteps = run.defSnapshot.steps
    .filter(s => FAILED_STEP.has(run.steps[s.id]?.state))
    .map(s => s.id);
  const durMin = run.endedAt && run.startedAt
    ? Math.max(0, Math.round((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 60_000))
    : null;
  const header = [
    `Workflow "${name}" ${outcome}.`,
    durMin !== null ? `Duration: ~${durMin} min.` : null,
    failedSteps.length ? `Failed steps: ${failedSteps.join(', ')}.` : null,
  ].filter(Boolean).join(' ');
  const body = `${header}\n\nRun log:\n${stepLog}`;
  const link = '/v1/profile?tab=workflows';

  // 1. In-app inbox (the notification system) — always, best-effort (never throws).
  await notify(deps.storage, ownerGhii, {
    type: succeeded ? 'workflow_finished' : 'workflow_failed',
    title, body, link,
  });

  // 2. Email — only when configured AND the owner set a notification email.
  try {
    if (deps.emailService?.enabled) {
      const ghii = await deps.storage.getGHII(ownerGhii);
      if (ghii?.notificationEmail) {
        await deps.emailService.sendNotification(ghii.notificationEmail, title, body);
      }
    }
  } catch (err) {
    logger.warn('workflow finish email failed', { workflowId: run.workflowId, runId: run.runId, error: String(err) });
  }
  return true;
}

/**
 * `fresh` mode: at RUN START (before any step dispatches), delete every key the workflow PRODUCES —
 * the union over steps of (success_signal keys minus that step's own inputs) + deliverable key — so an
 * idempotent skip-existing crew regenerates them instead of finding a prior run's output present.
 * Cleared ONCE up front, NOT per-step: parallel steps that share an output namespace (e.g. write-a +
 * write-b + an independent step all under `article.*`) would otherwise wipe each other's fresh output
 * when a later step's clear runs after an earlier one already wrote. Pure external inputs (read but
 * produced by no step) are preserved — a key is only cleared if some step declares it as output. Reads
 * across OWNER-SCOPE (+ sandbox prefix); best-effort (a delete failure is logged, not fatal).
 */
export async function clearRunOutputs(deps: StepDeps, ownerGhii: string, run: WorkflowRun): Promise<void> {
  const produced = new Set<string>();
  for (const r of run.resolved ?? []) {
    const outs = new Set(collectSignalKeys(r.success_signal));
    for (const inKey of collectSignalKeys(r.required_to_function)) outs.delete(inKey);
    if (r.deliverableKey) outs.add(r.deliverableKey);
    for (const k of outs) produced.add(k);
  }
  if (produced.size === 0) return;
  const ownerName = ownerGhii.split('@')[0];
  const prefix = run.keyPrefix ?? '';
  let cleared = 0;
  for (const tmpl of produced) {
    let full: string;
    try {
      full = prefix + template(tmpl, run.vars);
    } catch (err) {
      // Skipping silently makes the step look like it ran with nothing to do.
      logger.warn('workflow step: key template failed to render, skipping it', { template: tmpl, error: String(err) });
      continue;
    }
    try {
      if (full.includes('*')) {
        const listPrefix = full.slice(0, full.indexOf('*'));
        const recs = await listOwnerScopeMemory(deps.storage, deps.config.nodeId, ownerName, { prefix: listPrefix });
        const re = globToRegExp(full);
        for (const rec of recs) if (re.test(rec.key)) { await deps.storage.deleteMemory(rec.ownerGaii, rec.key); cleared++; }
      } else {
        const rec = await getOwnerScopeMemory(deps.storage, deps.config.nodeId, ownerName, full);
        if (rec) { await deps.storage.deleteMemory(rec.ownerGaii, rec.key); cleared++; }
      }
    } catch (err) {
      logger.warn('fresh clearRunOutputs failed', { workflowId: run.workflowId, key: full, error: String(err) });
    }
  }
  if (cleared) logger.info(`workflow ${run.workflowId} run ${run.runId}: fresh cleared ${cleared} prior-run output key(s)`);
}
