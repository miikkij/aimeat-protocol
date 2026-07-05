/**
 * @file store.ts
 * @description Workflow persistence + save-time validation + offer resolution + blueprint, all over
 *   the owner's existing memory (NO new SQLite/Mongo tables — Agent Workflows reuses the flexible
 *   memory system). Definitions live in the owner GHII namespace so the owner AND all their agents
 *   see them: `workflows.def.<id>`; runs (written by the engine, Phase 4) live at
 *   `workflows.run.<id>.<runId>`. A workflow is only saveable when its graph is a DAG and every
 *   step's agent/offer publishes its signals (an agent is "workflow-compatible" exactly then). The
 *   blueprint is DERIVED from those offers along step order, not hand-authored. See
 *   docs/plans/2026-06-13-agent-workflows-node-plan.md §3,§5,§8.
 * @structure
 *   - key helpers: defKey / runKeyPrefix / runKey
 *   - CRUD: getWorkflow / listWorkflows / saveWorkflow / deleteWorkflow / listRuns / getRun
 *   - validation (pure, exported for tests): collectSignalKeys / collectVarRefs / detectCycle /
 *     missingAfterRefs
 *   - offer resolution: resolveStep (storage) → effective signals + deliverable location
 *   - buildBlueprint — derived structural graph (nodes + edges + keys touched)
 * @usage import { saveWorkflow, getWorkflow, buildBlueprint } from '../workflow/store.js';
 * @version-history
 *   v1.0.0 — 2026-06-13 — Phase 3: memory-backed CRUD + DAG/offer validation + blueprint.
 *   v1.1.0 — 2026-06-15 — Persist the notify_on_finish opt-in on save.
 *   v1.2.0 — 2026-07-05 — Persist the resume opt-in on save (resume-on-retry downstream decoupling).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { buildGAII } from '../../utils/gaii.js';
import {
  WorkflowDefInputSchema, WORKFLOW_ID_RE,
  type WorkflowDef, type WorkflowDefInput, type WorkflowStep, type WorkflowRun, type Signal,
} from '../../models/workflow-schemas.js';

// ── memory keys ────────────────────────────────────────────────────────────────
export const defKey = (id: string): string => `workflows.def.${id}`;
export const runKeyPrefix = (id: string): string => `workflows.run.${id}.`;
export const runKey = (id: string, runId: string): string => `workflows.run.${id}.${runId}`;
export const DEF_LIST_PREFIX = 'workflows.def.';

// ── pure validation helpers (exported for unit tests) ──────────────────────────

/** Collect the raw key / key_glob templates referenced anywhere in a signal tree. */
export function collectSignalKeys(signal: Signal | 'none' | undefined): string[] {
  if (!signal || signal === 'none') return [];
  const out: string[] = [];
  const walk = (s: Signal): void => {
    if ('all' in s) { s.all.forEach(walk); return; }
    if ('any' in s) { s.any.forEach(walk); return; }
    if ('when' in s) { walk(s.when); walk(s.then); return; }
    if ('kind' in s) {
      if (s.key) out.push(s.key);
      if (s.key_glob) out.push(s.key_glob);
    }
  };
  walk(signal);
  return out;
}

/** Extract the {var} names referenced across a list of key templates. */
export function collectVarRefs(keyTemplates: string[]): Set<string> {
  const refs = new Set<string>();
  for (const tmpl of keyTemplates) {
    for (const m of tmpl.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) refs.add(m[1]);
  }
  return refs;
}

/** `after` ids that don't name an existing step. */
export function missingAfterRefs(steps: Pick<WorkflowStep, 'id' | 'after'>[]): string[] {
  const ids = new Set(steps.map(s => s.id));
  const missing = new Set<string>();
  for (const s of steps) for (const dep of s.after ?? []) if (!ids.has(dep)) missing.add(dep);
  return [...missing];
}

/** Detect a cycle in the `after` dependency graph. Returns the offending path, or null if a DAG. */
export function detectCycle(steps: Pick<WorkflowStep, 'id' | 'after'>[]): string[] | null {
  const deps = new Map(steps.map(s => [s.id, s.after ?? []]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  let cycle: string[] | null = null;

  const dfs = (id: string): void => {
    if (cycle) return;
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue; // missing refs reported separately
      const st = state.get(dep);
      if (st === 'visiting') { cycle = [...stack.slice(stack.indexOf(dep)), dep]; return; }
      if (st !== 'done') dfs(dep);
      if (cycle) return;
    }
    stack.pop();
    state.set(id, 'done');
  };

  for (const s of steps) if (state.get(s.id) !== 'done') { dfs(s.id); if (cycle) break; }
  return cycle;
}

// ── offer resolution ───────────────────────────────────────────────────────────

interface OfferLite {
  id: string;
  success_signal?: Signal;
  required_to_function?: Signal;
  deliverable?: { location?: { key?: string; space?: string; url?: string } };
}

/** Read one agent's published offers (stored under the agent's GAII as `agents.<name>.offers`). */
async function readAgentOffers(storage: Storage, config: AimeatConfig, ownerName: string, agentName: string): Promise<OfferLite[]> {
  const gaii = buildGAII(agentName, ownerName, config.nodeId);
  const rec = await storage.getMemory(gaii, `agents.${agentName}.offers`);
  const offers = (rec?.value as { offers?: OfferLite[] } | undefined)?.offers;
  return Array.isArray(offers) ? offers : [];
}

export interface ResolvedStep {
  stepId: string;
  agents: string[];
  offerId: string;
  /** Effective signals: the step's own, else inherited from the offer. */
  success_signal?: Signal;
  required_to_function?: Signal | 'none';
  deliverableKey?: string;
}

/**
 * Resolve a step's effective signals from its agent(s)' offer. Returns the resolved view, or an
 * error string when an agent/offer is missing or not workflow-compatible (no published signals).
 */
async function resolveStep(
  storage: Storage, config: AimeatConfig, ownerName: string, step: WorkflowStep,
): Promise<{ resolved: ResolvedStep } | { error: string }> {
  const agents = (Array.isArray(step.agent) ? step.agent : [step.agent]).filter((a): a is string => !!a);
  const offerId = step.offer ?? '';
  let chosen: OfferLite | undefined;
  for (const agentName of agents) {
    const offers = await readAgentOffers(storage, config, ownerName, agentName);
    const offer = offers.find(o => o.id === offerId);
    if (!offer) return { error: `step "${step.id}": agent "${agentName}" does not publish offer "${step.offer}"` };
    const hasSignals = !!offer.success_signal && !!offer.required_to_function;
    const hasLocation = !!offer.deliverable?.location?.key || !!offer.deliverable?.location?.url;
    if (!hasSignals || !hasLocation) {
      return { error: `step "${step.id}": offer "${step.offer}" (agent "${agentName}") is not workflow-compatible — it must publish success_signal + required_to_function + deliverable.location` };
    }
    if (!chosen) chosen = offer; // signals are the offer's contract; use the first agent's copy
  }
  const offer = chosen!;
  return {
    resolved: {
      stepId: step.id,
      agents,
      offerId,
      success_signal: step.success_signal ?? offer.success_signal,
      required_to_function: step.required_to_function ?? offer.required_to_function,
      deliverableKey: offer.deliverable?.location?.key,
    },
  };
}

// ── save-time validation (offer-aware) ─────────────────────────────────────────

export interface ValidationResult { ok: boolean; errors: string[]; resolved?: ResolvedStep[]; }

export async function validateWorkflow(
  storage: Storage, config: AimeatConfig, ownerName: string, input: WorkflowDefInput,
): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. unique step ids
  const seen = new Set<string>();
  for (const s of input.steps) {
    if (seen.has(s.id)) errors.push(`duplicate step id "${s.id}"`);
    seen.add(s.id);
  }

  // 2. dangling `after` refs + 3. cycle
  for (const dep of missingAfterRefs(input.steps)) errors.push(`"after" references unknown step "${dep}"`);
  const cycle = detectCycle(input.steps);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' → ')}`);

  // 4. offer resolution (workflow-compatibility) + 5. declared-var coverage
  const declaredVars = new Set(input.vars.map(v => v.name));
  const resolved: ResolvedStep[] = [];
  for (const step of input.steps) {
    // export-out / trigger-geai steps don't dispatch an agent offer — they push to / invoke a GEAI.
    // They carry no offer to resolve; their success is the push-ack / capability-response (+ optional
    // success_signal). Synthesize a resolved entry from the step's own signals.
    if (step.action && step.action.kind !== 'agent') {
      resolved.push({
        stepId: step.id, agents: [], offerId: '',
        success_signal: step.success_signal,
        required_to_function: step.required_to_function ?? 'none',
      });
      const keys = [...collectSignalKeys(step.success_signal), ...collectSignalKeys(step.required_to_function === 'none' ? undefined : step.required_to_function)];
      for (const v of collectVarRefs(keys)) {
        if (!declaredVars.has(v)) errors.push(`step "${step.id}": signal references undeclared var "{${v}}"`);
      }
      continue;
    }
    if (!step.agent || !step.offer) {
      errors.push(`step "${step.id}": an agent step requires both "agent" and "offer"`);
      continue;
    }
    const r = await resolveStep(storage, config, ownerName, step);
    if ('error' in r) { errors.push(r.error); continue; }
    resolved.push(r.resolved);
    const keys = [...collectSignalKeys(r.resolved.success_signal), ...collectSignalKeys(r.resolved.required_to_function)];
    for (const v of collectVarRefs(keys)) {
      if (!declaredVars.has(v)) errors.push(`step "${step.id}": signal references undeclared var "{${v}}"`);
    }
  }

  return { ok: errors.length === 0, errors, resolved: errors.length === 0 ? resolved : undefined };
}

// ── CRUD ────────────────────────────────────────────────────────────────────────

export async function getWorkflow(storage: Storage, ownerGhii: string, id: string): Promise<WorkflowDef | null> {
  const rec = await storage.getMemory(ownerGhii, defKey(id));
  return rec ? (rec.value as WorkflowDef) : null;
}

export async function listWorkflows(storage: Storage, ownerGhii: string): Promise<WorkflowDef[]> {
  const recs = await storage.listMemory(ownerGhii, { prefix: DEF_LIST_PREFIX });
  return recs.map(r => r.value as WorkflowDef);
}

export interface SaveResult { ok: boolean; def?: WorkflowDef; errors?: string[]; }

/**
 * Validate + persist a workflow definition under the owner GHII namespace. `createdBy` records the
 * author (owner GHII or agent GAII) for audit; createdAt is preserved across updates.
 */
export async function saveWorkflow(
  storage: Storage, config: AimeatConfig, ownerGhii: string, ownerName: string,
  id: string, body: unknown, createdBy: string,
): Promise<SaveResult> {
  if (!WORKFLOW_ID_RE.test(id)) return { ok: false, errors: [`invalid workflow id "${id}" — use a lowercase slug`] };

  const parsed = WorkflowDefInputSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) };
  }
  const input = parsed.data;

  // llm leaves require explicit owner approval (consent gate).
  const usesLlm = input.steps.some(s =>
    collectSignalKeysHasLlm(s.success_signal) || collectSignalKeysHasLlm(s.required_to_function));
  if (usesLlm && !input.llm?.approved) {
    return { ok: false, errors: ['a step uses an `llm` signal leaf — set llm.approved=true to consent to node-LLM use'] };
  }

  const v = await validateWorkflow(storage, config, ownerName, input);
  if (!v.ok) return { ok: false, errors: v.errors };

  const now = new Date().toISOString();
  const existing = await storage.getMemory(ownerGhii, defKey(id));
  const prior = existing?.value as WorkflowDef | undefined;
  const def: WorkflowDef = {
    id,
    title: input.title,
    description: input.description,
    trigger: input.trigger,
    vars: input.vars,
    steps: input.steps,
    on_step_fail: input.on_step_fail,
    notify_on_finish: input.notify_on_finish ?? false,
    resume: input.resume ?? false,
    llm: input.llm,
    costCapMorsels: input.costCapMorsels ?? null,
    createdBy: prior?.createdBy ?? createdBy,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };

  await storage.setMemory({
    key: defKey(id),
    ownerGaii: ownerGhii,
    value: def,
    visibility: 'private',
    tags: ['workflow'],
    ttlHours: null,
    version: existing ? existing.version + 1 : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  return { ok: true, def };
}

/** True if any leaf in the signal tree is an `llm` leaf. */
function collectSignalKeysHasLlm(signal: Signal | 'none' | undefined): boolean {
  if (!signal || signal === 'none') return false;
  const walk = (s: Signal): boolean => {
    if ('all' in s) return s.all.some(walk);
    if ('any' in s) return s.any.some(walk);
    if ('when' in s) return walk(s.when) || walk(s.then);
    return 'kind' in s && s.kind === 'llm';
  };
  return walk(signal);
}

export async function deleteWorkflow(storage: Storage, ownerGhii: string, id: string, opts?: { withRuns?: boolean }): Promise<boolean> {
  const existing = await storage.getMemory(ownerGhii, defKey(id));
  if (!existing) return false;
  await storage.deleteMemory(ownerGhii, defKey(id));
  if (opts?.withRuns) {
    const runs = await storage.listMemory(ownerGhii, { prefix: runKeyPrefix(id) });
    for (const r of runs) await storage.deleteMemory(ownerGhii, r.key);
  }
  return true;
}

export async function listRuns(storage: Storage, ownerGhii: string, id: string): Promise<WorkflowRun[]> {
  const recs = await storage.listMemory(ownerGhii, { prefix: runKeyPrefix(id) });
  return recs.map(r => r.value as WorkflowRun)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}

export async function getRun(storage: Storage, ownerGhii: string, id: string, runId: string): Promise<WorkflowRun | null> {
  const rec = await storage.getMemory(ownerGhii, runKey(id, runId));
  return rec ? (rec.value as WorkflowRun) : null;
}

// ── blueprint (derived) ──────────────────────────────────────────────────────────

export interface BlueprintNode {
  stepId: string;
  agents: string[];
  offerId: string;
  reads: string[];   // key templates the input gate (required_to_function) checks
  writes: string[];  // key templates the output check (success_signal) + deliverable.location touch
}
export interface Blueprint {
  workflowId: string;
  nodes: BlueprintNode[];
  edges: Array<{ from: string; to: string }>;  // dependency edges (after: from → to)
}

/**
 * Compose the steps into one structural blueprint, derived from the resolved offers along the step
 * order. Shows the input→output flow and the exact memory keys each step touches (as templates).
 */
export function buildBlueprint(def: WorkflowDef, resolved: ResolvedStep[]): Blueprint {
  const byId = new Map(resolved.map(r => [r.stepId, r]));
  const nodes: BlueprintNode[] = def.steps.map(step => {
    const r = byId.get(step.id);
    const writes = new Set<string>(collectSignalKeys(r?.success_signal));
    if (r?.deliverableKey) writes.add(r.deliverableKey);
    const stepAgents = Array.isArray(step.agent) ? step.agent : (step.agent ? [step.agent] : []);
    return {
      stepId: step.id,
      agents: r?.agents ?? stepAgents,
      offerId: step.offer ?? (step.action && step.action.kind !== 'agent' ? step.action.kind : ''),
      reads: collectSignalKeys(r?.required_to_function),
      writes: [...writes],
    };
  });
  const edges: Array<{ from: string; to: string }> = [];
  for (const step of def.steps) for (const dep of step.after ?? []) edges.push({ from: dep, to: step.id });
  return { workflowId: def.id, nodes, edges };
}
