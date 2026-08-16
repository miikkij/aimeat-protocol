/**
 * @file src/services/workflow/engine-steps.ts
 * @description Workflow-engine side-effect helpers — step/inspector dispatch (agent + ecosystem),
 *   human-input ask delivery, step-failure + finish notifications, agent-offline heads-up, and
 *   fresh-mode output clearing. Extracted from engine.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from engine.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — askHumanInput: deliver a human-input step's question to the owner (in-app
 *     inbox + push, best-effort) and return the templated question snapshot to pin into the run.
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
import { buildGAII } from '../../utils/gaii.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';
import { globToRegExp } from './signal-eval.js';
import { collectSignalKeys, runKey, type ResolvedStep } from './store.js';
import { listOwnerScopeMemory, getOwnerScopeMemory } from '../owner-memory.js';
import { getActiveConnectTunnelManager } from '../connect-tunnel.js';
import { runExtensionActionAsSystem, type SystemRunResult } from '../extension-system-run.js';
import { publishPackage, recordFailure } from '../datapackage/store.js';
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
  // An extension step runs HERE, on this node, in the QuickJS sandbox — no agent to reach, no
  // tunnel to cross, no model. Completion arrives through the same onPushTerminal path as an
  // ecosystem step, so its success_signal decides green or red the same way.
  if (step.action?.kind === 'extension') {
    dispatchExtensionStep(deps, ownerGhii, run, step, step.action, onPushTerminal);
    return [];
  }
  // A datapackage step publishes what an earlier step produced. Also here rather than over a wire:
  // it reads an owner-namespace key and calls the same publish the REST route calls.
  if (step.action?.kind === 'datapackage') {
    dispatchDataPackageStep(deps, ownerGhii, run, step, step.action, onPushTerminal);
    return [];
  }
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
 * Substitute `{var}` into the STRING leaves of a step's input, one level deep plus arrays of
 * strings. Numbers, booleans and nested objects pass through untouched: templating is for keys and
 * labels, and silently stringifying a number would make `{ window: 7 }` arrive as `"7"`.
 */
function templateInput(input: Record<string, unknown> | undefined, vars: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (typeof v === 'string') out[k] = template(v, vars);
    else if (Array.isArray(v)) out[k] = v.map(item => (typeof item === 'string' ? template(item, vars) : item));
    else out[k] = v;
  }
  return out;
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
  const ownerName = ownerGhii.split('@')[0];
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

  const fire = async (): Promise<boolean> => {
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
    // makes for a human-input step — before the signal is asked anything.
    if (action.result_to_key) {
      const key = (run.keyPrefix ?? '') + template(action.result_to_key, run.vars);
      const existing = await deps.storage.getMemory(ownerGhii, key);
      const now = new Date().toISOString();
      await deps.storage.setMemory({
        key, ownerGaii: ownerGhii, value: out.result ?? null,
        visibility: 'private', tags: ['workflow-extension-result'], ttlHours: null,
        version: existing ? existing.version + 1 : 1,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      });
    }
    // Reaching here means the sandbox returned rather than threw. Whether the step actually
    // DELIVERED is the success_signal's question, and onPushTerminal asks it — a script that returns
    // without producing what the signal names is a red step.
    return true;
  };
  fire()
    .then(() => onPushTerminal(ownerGhii, workflowId, runId, stepId, true))
    .catch(err => {
      // The reason has to survive: a red step with no message sends the owner to the run log for a
      // sentence that was thrown away here.
      logger.warn(`workflow ${workflowId} run ${runId}: extension step "${stepId}" failed`, { error: String(err) });
      return onPushTerminal(ownerGhii, workflowId, runId, stepId, false);
    });
}

/**
 * Call an action page by page and merge the pages into one result.
 *
 * WHY A STEP NEEDS THIS AT ALL. Real registries page. `laake-fi` caps at 500 rows on a set of 718,
 * so one call answers `truncated: true` and a package built from it holds five-sevenths of the data
 * with nothing anywhere saying so. Without paging the only honest choices were to publish a fraction
 * or to leave the producer unbound.
 *
 * The merged value KEEPS THE LAST PAGE'S ENVELOPE, with `items_at` replaced by every row collected,
 * plus two fields that did not exist before:
 *   - `pagesFetched`
 *   - `complete` — false when the loop stopped at `max_pages` rather than at the end of the data.
 *
 * `complete` is the point of the whole thing. "Did we get all of it" becomes something a
 * success_signal can assert, instead of something nobody checks until a consumer notices their
 * numbers are wrong.
 *
 * STOPPING is deliberately three conditions, because a producer may signal the end in any of them:
 * a short page, reaching the reported total, or the author's hard limit. The last one is required
 * rather than defaulted — a producer that never reports completion must not loop forever, and the
 * person who wrote the workflow is the one who knows how big their data can get.
 */
async function runPaged(
  paging: NonNullable<Extract<NonNullable<WorkflowStep['action']>, { kind: 'extension' }>['paging']>,
  baseInput: Record<string, unknown>,
  call: (input: Record<string, unknown>, page: number) => Promise<SystemRunResult>,
): Promise<SystemRunResult> {
  const items: unknown[] = [];
  let last: SystemRunResult = { result: null, reads: [], writes: [] };
  const reads = new Set<string>();
  const writes = new Set<string>();
  let complete = false;
  let page = 0;

  for (; page < paging.max_pages; page++) {
    // A page that fails THROWS, which fails the step. Merging what arrived before it and calling
    // that a result is the covering fallback this design refuses everywhere else: the package would
    // be short and nothing would say why.
    last = await call({ ...baseInput, [paging.offset_param]: page * paging.page_size }, page + 1);
    for (const r of last.reads) reads.add(r);
    for (const w of last.writes) writes.add(w);

    const pageItems = atPath(last.result, paging.items_at);
    if (!Array.isArray(pageItems)) {
      throw new Error(`paging: nothing at "${paging.items_at}" on page ${page + 1} — the path is wrong, `
        + 'or the producer changed shape');
    }
    items.push(...pageItems);

    const total = paging.total_at ? Number(atPath(last.result, paging.total_at)) : NaN;
    const reachedTotal = Number.isFinite(total) && items.length >= total;
    // A short page is the end of the data for a producer that reports no total, and a harmless
    // extra stop condition for one that does.
    if (reachedTotal || pageItems.length < paging.page_size) { complete = true; page++; break; }
  }

  const merged = (last.result && typeof last.result === 'object')
    ? { ...(last.result as Record<string, unknown>) }
    : {} as Record<string, unknown>;
  setAtPath(merged, paging.items_at, items);
  merged.pagesFetched = page;
  merged.complete = complete;
  return { result: merged, reads: [...reads], writes: [...writes] };
}

/**
 * One row through a column mapping. No mapping means the row as it is.
 *
 * A path that is missing yields NULL rather than dropping the column: a row that lost a field is a
 * visible gap, not a table that changed shape between runs. An array at the end of a path becomes
 * one delimited cell rather than its first element — a notice carries several CPV codes, and a
 * column that says so beats one that hides the rest.
 */
function mapColumns(row: Record<string, unknown>, columns: Record<string, string> | undefined): Record<string, unknown> {
  if (!columns) return row;
  const flat: Record<string, unknown> = {};
  for (const [column, path] of Object.entries(columns)) {
    const value = atPath(row, path);
    flat[column] = Array.isArray(value) ? value.join(';') : (value === undefined ? null : value);
  }
  return flat;
}

/**
 * Call an action once per value and merge the answers.
 *
 * THE OTHER SHAPE A REAL PRODUCER HAS. `kumppani` answers about ONE company per call, so a package
 * covering ten companies is ten calls. Paging varies an offset over one query; this varies a
 * parameter over a list. They share everything else, including the field that matters: `complete`,
 * so "did every call land" is assertable rather than assumed.
 *
 * A call that fails throws, which fails the step. Ten companies of which one could not be read is
 * not a package about ten companies, and quietly publishing nine is the loss this refuses.
 */
async function runForEach(
  forEach: NonNullable<Extract<NonNullable<WorkflowStep['action']>, { kind: 'extension' }>['for_each']>,
  baseInput: Record<string, unknown>,
  vars: Record<string, string>,
  call: (input: Record<string, unknown>, n: number) => Promise<SystemRunResult>,
): Promise<SystemRunResult> {
  const items: unknown[] = [];
  const reads = new Set<string>();
  const writes = new Set<string>();
  let last: SystemRunResult = { result: null, reads: [], writes: [] };
  let done = 0;

  for (const raw of forEach.values) {
    const value = template(raw, vars);
    last = await call({ ...baseInput, [forEach.param]: value }, done + 1);
    for (const r of last.reads) reads.add(r);
    for (const w of last.writes) writes.add(w);

    const answerItems = atPath(last.result, forEach.items_at);
    if (!Array.isArray(answerItems)) {
      throw new Error(`for_each: nothing at "${forEach.items_at}" for ${forEach.param}=${value} — the path is `
        + 'wrong, or the producer changed shape');
    }
    items.push(...answerItems);
    done++;
  }

  const merged = (last.result && typeof last.result === 'object')
    ? { ...(last.result as Record<string, unknown>) }
    : {} as Record<string, unknown>;
  setAtPath(merged, forEach.items_at, items);
  merged.callsMade = done;
  // Every value was called or the loop threw, so reaching here IS completeness. It is written down
  // anyway, because a signal should be able to assert the same thing for paging and for this.
  merged.complete = done === forEach.values.length;
  return { result: merged, reads: [...reads], writes: [...writes] };
}

/** Write into a dotted path, creating the objects on the way. Only used to put the merged rows back
 *  where the producer had its page, so the envelope a signal reads keeps its shape. */
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    if (typeof cursor[segment] !== 'object' || cursor[segment] === null) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

/** Walk a dotted path into a value. Returns undefined the moment a segment is missing, so a caller
 *  can tell "the path is wrong" from "the array was empty" — which are different bugs. */
function atPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let cursor: unknown = value;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
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
 */
export function dispatchDataPackageStep(
  deps: StepDeps, ownerGhii: string, run: WorkflowRun, step: WorkflowStep,
  action: Extract<NonNullable<WorkflowStep['action']>, { kind: 'datapackage' }>,
  onPushTerminal: OnPushTerminal,
): void {
  const { workflowId, runId } = run;
  const stepId = step.id;
  const name = template(action.name, run.vars);

  const fire = async (): Promise<void> => {
    const key = (run.keyPrefix ?? '') + template(action.from_key, run.vars);
    const record = await deps.storage.getMemory(ownerGhii, key);
    if (!record) {
      throw new Error(`no value at "${key}" — the step that produces it either did not run or wrote somewhere else`);
    }
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
      await publishRows(united);
      return;
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
    await publishRows((found as Array<Record<string, unknown>>).map(row => mapColumns(row, action.columns)));
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

  fire()
    .then(() => onPushTerminal(ownerGhii, workflowId, runId, stepId, true))
    .catch(async err => {
      logger.warn(`workflow ${workflowId} run ${runId}: datapackage step "${stepId}" failed`, { error: String(err) });
      return onPushTerminal(ownerGhii, workflowId, runId, stepId, false);
    });
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
