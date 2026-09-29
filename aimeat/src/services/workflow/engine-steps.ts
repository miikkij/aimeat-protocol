/**
 * @file src/services/workflow/engine-steps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workflow-engine side-effect helpers — step/inspector dispatch (agent + ecosystem),
 *   human-input ask delivery, step-failure + finish notifications, agent-offline heads-up, and
 *   fresh-mode output clearing. Extracted from engine.ts to satisfy max-file-lines.
 * @version-history
 *   v1.9.0 — 2026-09-29 — The export-out step and the datapackage step pass their source record
 *     through the classification leave() (external to the app; export) before it goes out; a refusal
 *     is a red step whose log names the key and the reason (TARGET-082 V4).
 *   v1.8.0 — 2026-09-26 — dispatchStep marks the call of an ai, extension or datapackage step open
 *     for its attempt (run-cost.ts markCallOpen), so the watchdog leaves the step to that call's
 *     answer (secaudit 2026-09, R4).
 *   v1.7.0 — 2026-09-26 — An extension step's write to result_to_key and a datapackage step's publish
 *     are passed to the engine with the answer (ResultWrite, engine-answer.ts), and the engine makes
 *     them only while the step still waits for an answer (secaudit 2026-09, R4).
 *   v1.6.0 — 2026-09-26 — The extension, datapackage and ecosystem steps report their outcome to the
 *     engine through reportOutcome (engine-answer.ts): only a failure of the step's own work fails the
 *     attempt, and an error inside the engine while it takes the answer in is logged as the engine's
 *     (secaudit 2026-09, R4).
 *   v1.5.5 — 2026-09-26 — templateInput, runPaged, runForEach, mapColumns, setAtPath and atPath moved
 *     to engine-step-rows.ts unchanged (max-file-lines).
 *   v1.5.4 — 2026-09-26 — dispatchStep hands the answer of every step kind to the engine with the
 *     attempt it was dispatched for, so the engine tells a late answer of an earlier attempt from the
 *     answer of the attempt that runs now (secaudit 2026-09, R3 problem 2).
 *   v1.5.3 — 2026-09-26 — OnPushTerminal carries the attempt an ai step's model call was started for,
 *     so the engine drops that call's hold on the cost cap when it answers (secaudit 2026-09, A6-11).
 *   v1.5.2 — 2026-09-26 — A run stopped because its next ai step's estimate did not fit under the
 *     cost cap is finished with its own words: the step, its estimate, the spend and the cap
 *     (workflow_stopped_estimate; secaudit 2026-09, A6-11).
 *   v1.5.1 — 2026-09-26 — The owner's account name comes from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.5.0 — 2026-09-25 — OnPushTerminal carries what the step's own model calls cost, for the run's
 *     cost cap. A run the node stopped at that cap is finished, so its owner's finish notification
 *     says so.
 *   v1.4.0 — 2026-09-08 — A dispatched task emits `task_assigned` on the connector tunnel, at both
 *     places this file creates one. It never did: the engine writes its own record straight to
 *     storage and copied agent-task-write.ts's webhook line without the emitDelivery on the line
 *     after it, so a workflow's task woke a webhook subscriber and no connected agent. Two nights
 *     of a nightly workflow, 0/6 steps, every surface reading healthy. → pitfalls §58
 *     dispatchInspector moved to engine-inspector.ts as a pure extraction (same signature, same
 *     single caller): the added comment took this file one line past the 800-line cap.
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — askHumanInput: deliver a human-input step's question to the owner (in-app
 *     inbox + push, best-effort) and return the templated question snapshot to pin into the run.
 *   v1.3.0 — 2026-08-24 — A dispatched agent task carries the run's variables (`var.<name>`) and the
 *     assembled `deliverable_key`. An offer names its output as a template and only the engine knows
 *     what the variables are, so an agent had no way to find the key it was being judged on: it
 *     invented one, wrote a good result where nothing reads, and the step went output-red. Keying a
 *     pipeline on `{date}` was the only shape that worked, because that is the one variable an agent
 *     can derive unaided.
 *   v1.2.0 — 2026-08-15 — TARGET-063 A3: dispatchExtensionStep — run one of the owner's own
 *     extension actions on this node, in the sandbox, with no agent and no model. It completes
 *     through the SAME onPushTerminal as an ecosystem step, so its success_signal decides green or
 *     red and a script that returns without delivering is red rather than quietly green. The run
 *     itself is services/extension-system-run.ts, shared with the scheduled road.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentTaskRecord, AgentTaskScope } from '../../storage/interface.js';
import type { createWebhookDispatcher } from '../webhook-dispatcher.js';
import type { PushService } from '../push.js';
import type { EmailService } from '../email.js';
import { buildGAII, localAccountName } from '../../utils/gaii.js';
import { notify } from '../notify.js';
import { readNotificationSettings, appendMailLog } from '../notification-settings.js';
import { logger } from '../../utils/logger.js';
import { globToRegExp } from './signal-eval.js';
import { collectSignalKeys, type ResolvedStep } from './store.js';
import { listOwnerScopeMemory, getOwnerScopeMemory } from '../owner-memory.js';
import { getActiveConnectTunnelManager } from '../connect-tunnel.js';
import { emitDelivery } from '../event-bus.js';
import { runExtensionActionAsSystem } from '../extension-system-run.js';
import { publishPackage, recordFailure } from '../datapackage/store.js';
import { loc, template } from './engine-util.js';
import { templateInput, runPaged, runForEach, mapColumns, atPath } from './engine-step-rows.js';
import { reportOutcome, type ResultWrite } from './engine-answer.js';
import { usd, markCallOpen } from './run-cost.js';
import { dispatchAiStep } from './engine-ai-step.js';
import { dispatchInspector } from './engine-inspector.js';
import { isAgentStep, anyAgentReachable, AGENT_OFFLINE_GRACE_MS } from './engine-reachability.js';
import type { WorkflowRun, WorkflowRunStep, WorkflowStep } from '../../models/workflow-schemas.js';
import { systemReader } from '../classification/reader.js';
import { memoryTarget } from '../classification/labels.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

/** The services the step helpers close over — a bundle of the engine's private fields. */
export interface StepDeps {
  storage: Storage;
  config: AimeatConfig;
  webhookDispatcher?: WebhookDispatcher;
  pushService?: PushService;
  emailService?: EmailService;
}

/** Callback into the engine's non-task terminal path for ecosystem action steps. `costUsd` is what the
 *  step's own model calls cost (an ai step), for the run's cost cap, and `call` is the attempt the
 *  answer was dispatched for: an ai step's model call holds its share of the cap until it answers,
 *  and an answer of an earlier attempt does not decide the attempt that runs now (engine.ts). `write`
 *  is the write the answer makes, which the engine makes only while the step waits for an answer. */
export type OnPushTerminal = (ownerGhii: string, workflowId: string, runId: string, stepId: string, ok: boolean, costUsd?: number, call?: number, write?: ResultWrite) => void | Promise<void>;

const TERMINAL_RUN = new Set<WorkflowRun['status']>(['done', 'partial', 'red', 'cancelled', 'stopped']);
const FAILED_STEP = new Set<WorkflowRunStep['state']>(['input-red', 'output-red', 'timed-out', 'agent-offline']);

/** Dispatch a step's agent task(s); tag with the workflow-run scope for onTaskTerminal. */
export async function dispatchStep(deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep, resolved: ResolvedStep | undefined, onPushTerminal: OnPushTerminal): Promise<string[]> {
  // human-input steps are parked by tick() BEFORE dispatch (askHumanInput) — they never reach here.
  if (step.action?.kind === 'human-input') return [];
  // Every answer names the attempt it was dispatched for, so the engine tells a late answer of an
  // earlier attempt from the answer of the attempt that runs now, after the watchdog gave a retry.
  const attempt = run.steps[step.id]?.attempt ?? 0;
  const onAnswer: OnPushTerminal = (o, w, rid, s, ok, cost, call, write) => onPushTerminal(o, w, rid, s, ok, cost, call ?? attempt, write);
  // The work of an ai, extension or datapackage step runs here, and its answer writes the step's
  // output. Its call is open until that answer comes: the watchdog leaves the step to it (engine.ts).
  const kind = step.action?.kind;
  if ((kind === 'ai' || kind === 'extension' || kind === 'datapackage') && run.steps[step.id]) markCallOpen(run.steps[step.id]);
  // An extension step runs HERE, on this node, in the QuickJS sandbox — no agent to reach, no
  // tunnel to cross, no model. Completion arrives through the same onPushTerminal path as an
  // ecosystem step, so its success_signal decides green or red the same way.
  if (step.action?.kind === 'extension') {
    dispatchExtensionStep(deps, ownerGhii, run, step, step.action, onAnswer);
    return [];
  }
  // An ai step runs the owner's own model here, on this node. No agent, no fleet, no browser — and
  // no round trip through another repository to change what it says.
  if (step.action?.kind === 'ai') {
    dispatchAiStep(deps, ownerGhii, run, step, step.action, onAnswer);
    return [];
  }
  // A datapackage step publishes what an earlier step produced. Also here rather than over a wire:
  // it reads an owner-namespace key and calls the same publish the REST route calls.
  if (step.action?.kind === 'datapackage') {
    dispatchDataPackageStep(deps, ownerGhii, run, step, step.action, onAnswer);
    return [];
  }
  // Ecosystem action steps push to / invoke a GEAI over the tunnel; completion arrives via the
  // async onPushTerminal path, never an agent task. They record no task ids.
  if (step.action && step.action.kind !== 'agent') {
    dispatchEcosystemStep(deps, ownerGhii, run, step, step.action, onAnswer);
    return [];
  }
  const ownerName = localAccountName(ownerGhii);
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
    // THE RUN'S VARIABLES, AND THE FINISHED KEY THEY BUILD. An offer names its output as a template
    // (`julkaisu.{ref}.aineisto`); only the engine knows what `{ref}` is on this run. Until these
    // went out, an agent had no way to find out: it either invented a value — writing a perfectly
    // good result to a key nobody reads, while the step went output-red — or the whole pipeline had
    // to be keyed on `{date}`, the one variable an agent can work out for itself. Measured on
    // 2026-08-24: the editor agent ran twice, wrote twice, and both results landed under ids it had
    // made up.
    //
    // Both forms go, because they answer different questions. The variables let a step build any key
    // it needs (a step may write more than its one deliverable, and it reads its inputs by the same
    // templates). `deliverable_key` is the exact string the success signal will look at, prefix and
    // all, assembled the way every other consumer assembles it — so "where do I write" needs no
    // reconstruction and cannot drift from what is checked.
    for (const [name, value] of Object.entries(run.vars ?? {})) {
      scope.push({ name: `var.${name}`, value: String(value), type: 'text', description: `workflow variable {${name}}` });
    }
    if (resolved?.deliverableKey) {
      scope.push({
        name: 'deliverable_key',
        value: (run.keyPrefix ?? '') + template(resolved.deliverableKey, run.vars ?? {}),
        type: 'memory_key',
        description: 'write your result to THIS key — it is the one the success signal reads',
      });
    }
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
    // AND THE TUNNEL, which is the half this had been missing. agent-task-write.ts emits this on
    // the line after its webhook; the engine builds its own record and writes it straight to
    // storage, so nothing shared enforced the pair and nothing errored when only the webhook went:
    // the task was created and active, the webhook fired, the socket heard nothing, and a spawn
    // daemon parked on /local/wake/next slept through it. Measured by crewaimeat on two consecutive
    // nights, 2026-09-07 and 2026-09-08: 0/6 steps, 50 agents reachable the whole time, every
    // surface reading healthy. A target holding no tunnel is unaffected — the task waits in the
    // store and is replayed on connect, which is what should happen.
    emitDelivery({ target: agentGaii, kind: 'task_assigned', id: record.id, payload: record });
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
export function dispatchEcosystemStep(deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep, action: Extract<NonNullable<WorkflowStep['action']>, { kind: 'export-out' } | { kind: 'trigger-geai' }>, onPushTerminal: OnPushTerminal): void {
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
    // The value goes to an outside app, so it passes leave() first (TARGET-082). A refused value
    // makes the step red, and the log says which key and why.
    if (rec) {
      const { left } = await systemReader(deps, ownerGhii).leave([rec], r => memoryTarget(r.ownerGaii, r.key),
        { kind: 'external', to: action.geai });
      if (left.length) {
        logger.warn(`workflow ${workflowId} run ${runId}: export-out step "${stepId}" sent nothing: "${fromKey}" is ${left[0]!.reason}`,
          { label: left[0]!.label, geai: action.geai });
        return false;
      }
    }
    const reply = await mgr.invokeOnPrincipal(action.geai, {
      capability: action.capability ?? '__deposit__',
      input: { from: fromKey, data: rec?.value ?? null },
      caller: ownerGhii,
    });
    return reply.ok;
  };
  reportOutcome(fire(),
    ok => onPushTerminal(ownerGhii, workflowId, runId, stepId, ok),
    () => onPushTerminal(ownerGhii, workflowId, runId, stepId, false),
    `workflow ${workflowId} run ${runId}: ecosystem step "${stepId}"`);
}

/**
 * Run an `extension` step: one of the OWNER'S OWN extension actions, here on this node, in the
 * QuickJS sandbox. No agent has to be online, no tunnel has to be up, and no model is called.
 *
 * WHY THIS EXISTS. An extension action was already callable over HTTP, over MCP and on a clock, and
 * was the one capability a workflow could not reach — so a pipeline whose deterministic half lives
 * in an extension had to route it through an agent that did nothing but relay, which needs the agent
 * to be online and puts a model in the path of work that has no judgement in it.
 *
 * IDENTITY. The caller is the RUN'S OWNER GHII (an ecosystem step already names them for the same
 * reason: the human is the AIMEAT-side principal), with the role 'operator' because nobody is
 * sitting at a screen. Files land in the owner's namespace, so a package produced by a workflow step
 * sits at the same permanent address as one produced on a clock, by an agent, or from the app.
 *
 * Fire-and-forget, exactly like the ecosystem path: tick() has already marked the step 'dispatched'
 * and persisted it under the run lock, and onPushTerminal takes the lock again to advance the run.
 * A throw becomes `ok: false`, which is `output-red` (or a retry) — never a quiet green.
 */
export function dispatchExtensionStep(
  deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep,
  action: Extract<NonNullable<WorkflowStep['action']>, { kind: 'extension' }>,
  onPushTerminal: OnPushTerminal,
): void {
  const { workflowId, runId } = run;
  const stepId = step.id;
  const ownerName = localAccountName(ownerGhii);
  const runOnce = (input: Record<string, unknown>, label: string) => runExtensionActionAsSystem(
    { storage: deps.storage, config: deps.config, emailService: deps.emailService },
    {
      extensionName: action.extension,
      actionId: action.action,
      instanceId: action.instance_id,
      input,
      callerGaii: ownerGhii,
      ownerName,
      storageOwnerGhii: ownerGhii,
      logLabel: label,
      producerKind: 'workflow',
      producerRef: `${workflowId}/${stepId}`,
      ...(run.defSnapshot.trigger?.kind === 'schedule' ? { producerSchedule: run.defSnapshot.trigger.cron } : {}),
    },
  );

  const fire = async (): Promise<ResultWrite | undefined> => {
    const base = templateInput(action.input, run.vars);
    const out = action.paging
      ? await runPaged(action.paging, base, (input, page) => runOnce(input, `wf:${workflowId}:${stepId}:p${page}`))
      : action.for_each
        ? await runForEach(action.for_each, base, run.vars, (input, n) => runOnce(input, `wf:${workflowId}:${stepId}:i${n}`))
        : await runOnce(base, `wf:${workflowId}:${stepId}`);
    // THE BRIDGE BETWEEN TWO NAMESPACES. An extension's own memory lives under `ext:{name}`, and a
    // workflow's signals read OWNER SCOPE (services/owner-memory.ts: the owner GHII plus their
    // agents and ecosystem apps). Those never intersect, so without this the step's result would be
    // invisible to its own gate and every extension step would be permanently red. The engine
    // therefore lands the return value in the owner's namespace — the same move `answer_to_key`
    // makes for a human-input step — before the signal is asked anything, and only while the step
    // still waits for this answer: once the step has ended, a later answer writes nothing.
    let write: ResultWrite | undefined;
    if (action.result_to_key) {
      const key = (run.keyPrefix ?? '') + template(action.result_to_key, run.vars);
      write = async () => {
        const existing = await deps.storage.getMemory(ownerGhii, key);
        const now = new Date().toISOString();
        await deps.storage.setMemory({
          key, ownerGaii: ownerGhii, value: out.result ?? null,
          visibility: 'private', tags: ['workflow-extension-result'], ttlHours: null,
          version: existing ? existing.version + 1 : 1,
          createdAt: existing?.createdAt ?? now, updatedAt: now,
        });
      };
    }
    // Reaching here means the sandbox returned rather than threw. Whether the step actually
    // DELIVERED is the success_signal's question, and onPushTerminal asks it — a script that returns
    // without producing what the signal names is a red step.
    return write;
  };
  reportOutcome(fire(),
    write => onPushTerminal(ownerGhii, workflowId, runId, stepId, true, undefined, undefined, write),
    err => {
      // The reason has to survive: a red step with no message sends the owner to the run log for a
      // sentence that was thrown away here.
      logger.warn(`workflow ${workflowId} run ${runId}: extension step "${stepId}" failed`, { error: String(err) });
      return onPushTerminal(ownerGhii, workflowId, runId, stepId, false);
    },
    `workflow ${workflowId} run ${runId}: extension step "${stepId}"`);
}

/**
 * Run a `datapackage` step: publish one version from what an earlier step wrote.
 *
 * THIS IS THE BINDING A REPEATING PACKAGE NEEDS, and it is the join no other component could make.
 * An extension step lands its return value in the OWNER'S namespace as a private record — right,
 * because an intermediate result is not something to publish — and that is precisely what the
 * sandbox cannot read back: `ctx.memory.get` sees `ext:{name}`, `ctx.memory.getPublic` returns only
 * public records. So the two halves, "call the producer" and "publish what it returned", can only
 * meet in the engine, which already runs as the owner and already wrote that key.
 *
 * It calls the same publishPackage() the REST route and the sandbox capability call, so a package a
 * workflow refreshes weekly is the same object, at the same kind of address, as one a person
 * published from the app. The producer block records that a workflow made it, and the schedule that
 * drives the workflow rides along — a buyer choosing between two packages can see which is which.
 *
 * REFUSALS ARE RED, and loudly. A quality-gate refusal throws with the coordinates in the message:
 * nothing was written, the package still stands on its previous version, and the step is red rather
 * than green-with-nothing-produced. `recordFailure` puts the same sentence on the package's own
 * pointer, so an owner looking at the package — not at a run log — learns that the latest attempt
 * broke and which version they are still on.
 *
 * ONE VERSION FOR ONE STEP. The step reads and shapes the rows and passes the publish to the engine
 * with its answer. The engine publishes under the run's lock, and only while the step still waits
 * for an answer: an attempt that answers after the step ended publishes nothing (engine.ts
 * onPushTerminal).
 */
export function dispatchDataPackageStep(
  deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep,
  action: Extract<NonNullable<WorkflowStep['action']>, { kind: 'datapackage' }>,
  onPushTerminal: OnPushTerminal,
): void {
  const { workflowId, runId } = run;
  const stepId = step.id;
  const name = template(action.name, run.vars);

  const fire = async (): Promise<ResultWrite> => {
    const key = (run.keyPrefix ?? '') + template(action.from_key, run.vars);
    const record = await deps.storage.getMemory(ownerGhii, key);
    if (!record) {
      throw new Error(`no value at "${key}" — the step that produces it either did not run or wrote somewhere else`);
    }
    // A public data package is an export, so the source record passes leave() first (TARGET-082).
    // A refusal is a red step with the reason, and the package stays on its previous version.
    const { left } = await systemReader(deps, ownerGhii).leave([record], r => memoryTarget(r.ownerGaii, r.key),
      { kind: 'export', organismId: null });
    if (left.length) throw new Error(`CLASSIFIED: "${key}" is ${left[0]!.reason}, so nothing was published`);
    // A UNION publishes several lists as one table. `aiuutiset` answers with topics, actors and
    // sources — the same numbers under a differently-named label each time — and three near-identical
    // packages would be worse than one table with a `kind` column.
    if (action.union) {
      const united: Array<Record<string, unknown>> = [];
      for (const source of action.union) {
        const list = atPath(record.value, source.rows_at);
        if (!Array.isArray(list)) {
          throw new Error(`"${key}" has no array at "${source.rows_at}" — a union names one path per list, `
            + 'and this one is not there');
        }
        for (const row of list as Array<Record<string, unknown>>) {
          united.push({ ...(source.set ?? {}), ...mapColumns(row, source.columns) });
        }
      }
      return () => publishRows(united);
    }

    const found = atPath(record.value, action.rows_at);
    if (found === undefined) {
      throw new Error(`"${key}" has nothing at path "${action.rows_at}". A producer usually answers with an `
        + 'envelope, so name the path to the table inside it.');
    }
    if (!Array.isArray(found)) {
      throw new Error(`"${key}"${action.rows_at ? ` at "${action.rows_at}"` : ''} is ${typeof found}, not an array of rows`);
    }
    // Flatten, when the step says how. A Table Schema describes scalars and a real producer answers
    // with nested objects, so this is the transformation these bindings actually need — declarative,
    // recorded in the descriptor, and with no scripting language in a workflow descriptor.
    const rows = (found as Array<Record<string, unknown>>).map(row => mapColumns(row, action.columns));
    return () => publishRows(rows);
  };

  /** Publish one version from rows that are already flat, and turn a refusal into a red step. */
  const publishRows = async (rows: Array<Record<string, unknown>>): Promise<void> => {
    const out = await publishPackage(
      { storage: deps.storage, config: deps.config },
      ownerGhii,
      {
        name,
        changes: template(action.changes, run.vars),
        resources: [{
          name: action.resource ?? 'rows',
          rows,
          // Declared when the step says so. Inference is the convenient default and the wrong
          // one for a repeating producer: it widens to fit whatever arrived, so a bad run
          // changes a column's type instead of being refused.
          schema: (action.schema as never) ?? 'infer',
        }],
        ...(action.title ? { title: action.title } : {}),
        ...(action.description ? { description: action.description } : {}),
        ...(action.provenance ? { provenance: action.provenance as never } : {}),
        ...(action.retention_policy ? { retentionPolicy: action.retention_policy as never } : {}),
      },
      {
        gaii: ownerGhii,
        kind: 'workflow',
        ref: `${workflowId}/${stepId}`,
        run: runId,
        ...(run.defSnapshot.trigger?.kind === 'schedule' ? { schedule: run.defSnapshot.trigger.cron } : {}),
      },
    );
    if (!out.ok) {
      const detail = out.issues?.length
        ? ` First: row ${out.issues[0].row ?? '?'}, field "${out.issues[0].field ?? '?'}" — ${out.issues[0].message}`
        : '';
      // On the package's own pointer, not only in the run log: an owner watching the package has to
      // be able to see that the newest attempt failed and which version they are still reading.
      await recordFailure({ storage: deps.storage, config: deps.config }, ownerGhii, name, out.message + detail);
      throw new Error(`${out.code}: ${out.message}${detail}`);
    }
    logger.info(`workflow ${workflowId} run ${runId}: published ${out.descriptor.aimeat.packageId}`,
      { contentHash: out.contentHash, unchanged: out.unchanged, rows: out.resources[0]?.rowCount });
  };

  reportOutcome(fire(),
    write => onPushTerminal(ownerGhii, workflowId, runId, stepId, true, undefined, undefined, write),
    err => {
      logger.warn(`workflow ${workflowId} run ${runId}: datapackage step "${stepId}" failed`, { error: String(err) });
      return onPushTerminal(ownerGhii, workflowId, runId, stepId, false);
    },
    `workflow ${workflowId} run ${runId}: datapackage step "${stepId}"`);
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
  try { await notify(deps.storage, ownerGhii, { type: 'workflow_input_needed', title, body, link: '/v1/profile?tab=workflows', i18n: { key: 'workflow_input_needed', vars: { name, step: step.id, question: question.prompt, options: optionsSummary } } }); }
  catch (err) { logger.warn('askHumanInput: in-app notify best-effort', { error: String(err) }); }
  if (deps.pushService?.enabled) {
    deps.pushService.sendNotification(localAccountName(ownerGhii), { title, body, url: '/v1/profile?tab=workflows', tag: `workflow:${run.workflowId}` })
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
  const ownerName = localAccountName(ownerGhii);
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
 * Heads-up alert (owner opt-in via pushService + always the in-app inbox) fired at dispatch when a
 * step's agent(s) look OFFLINE — so the owner can bring the crew online before the offline grace
 * elapses and the step fails. Best-effort: a notify/push problem never disturbs the run.
 */
export async function maybeAlertAgentOffline(deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep): Promise<void> {
  if (!isAgentStep(step)) return;
  const ownerName = localAccountName(ownerGhii);
  if (await anyAgentReachable(deps.storage, deps.config, ownerName, step)) return;
  const agents = (Array.isArray(step.agent) ? step.agent : (step.agent ? [step.agent] : [])).join(', ');
  const name = loc(run.defSnapshot.title) || run.workflowId;
  const graceMin = Math.round(AGENT_OFFLINE_GRACE_MS / 60_000);
  const title = 'Workflow agent offline';
  const body = `${name}: step "${step.id}" was dispatched but its agent (${agents}) looks offline — it will fail in ~${graceMin} min unless the agent connects.`;
  logger.warn(`workflow ${run.workflowId} run ${run.runId}: step "${step.id}" dispatched to offline agent(s) ${agents}`);
  try { await notify(deps.storage, ownerGhii, { type: 'workflow_agent_offline', title, body, link: '/v1/profile?tab=workflows', i18n: { key: 'workflow_agent_offline', vars: { name, step: step.id, agents, minutes: graceMin } } }); }
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
  const stopped = run.status === 'stopped';
  // Stopped because the next ai step's estimate did not fit in what was left: the run stayed within the cap.
  const estimated = stopped && !!run.costCap?.neededUsd;
  const stopWords = estimated ? 'stopped to stay within its spending limit' : 'stopped at its spending limit';
  const outcome = succeeded ? 'succeeded'
    : run.status === 'cancelled' ? 'was cancelled'
    : stopped ? stopWords
    : 'finished with failures';
  const title = `Workflow "${name}" ${succeeded ? 'succeeded' : run.status === 'cancelled' ? 'cancelled' : stopped ? stopWords : 'failed'}`;

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
    stopped && run.reason ? run.reason : null,
    durMin !== null ? `Duration: ~${durMin} min.` : null,
    failedSteps.length ? `Failed steps: ${failedSteps.join(', ')}.` : null,
  ].filter(Boolean).join(' ');
  const body = `${header}\n\nRun log:\n${stepLog}`;
  const link = '/v1/profile?tab=workflows';

  // 1. In-app inbox (the notification system) — always, best-effort (never throws).
  await notify(deps.storage, ownerGhii, {
    type: succeeded ? 'workflow_finished' : 'workflow_failed',
    title, body, link,
    i18n: {
      key: succeeded ? 'workflow_finished' : run.status === 'cancelled' ? 'workflow_cancelled'
        : estimated ? 'workflow_stopped_estimate' : stopped ? 'workflow_stopped' : 'workflow_failed',
      vars: {
        name, minutes: durMin ?? 0, failed: failedSteps.join(', '), steps: run.defSnapshot.steps.map(s => `${s.id}: ${run.steps[s.id]?.state ?? 'unknown'}`).join(' · '),
        ...(run.costCap ? { cap: usd(run.costCap.capUsd), spent: usd(run.costCap.spentUsd), step: run.costCap.stoppedBefore } : {}),
        ...(run.costCap?.neededUsd ? { needed: usd(run.costCap.neededUsd) } : {}),
      },
    },
  });

  // 2. Email — only when configured, the owner set a notification email, and they have not
  //    switched the workflow email off on the Email page (notification-settings.ts, email.workflowEnd).
  try {
    if (deps.emailService?.enabled) {
      const ghii = await deps.storage.getGHII(ownerGhii);
      const prefs = await readNotificationSettings(deps.storage, ownerGhii);
      if (ghii?.notificationEmail && prefs.email.workflowEnd) {
        const sent = await deps.emailService.sendNotification(ghii.notificationEmail, title, body);
        if (sent) await appendMailLog(deps.storage, ownerGhii, { kind: 'workflow_end', subject: title });
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
  const ownerName = localAccountName(ownerGhii);
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
