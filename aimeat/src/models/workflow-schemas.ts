/**
 * @file workflow-schemas.ts
 * @description The shared contract for Agent Workflows — the signal grammar and the workflow
 *   descriptor types. A "signal" is a tree evaluated against owner memory (deterministic-first,
 *   with a sparingly-used node-OpenRouter `llm` leaf); both an agent's offer (success_signal /
 *   required_to_function) and a workflow step build to this same grammar. The deterministic engine
 *   is node-owned; the non-deterministic inspector is crew-owned. See
 *   docs/plans/2026-06-13-agent-workflows-node-plan.md and the crew spec (dev-organism
 *   Development workspace, note doc-mqbukpqskhzq).
 * @structure
 *   - LocalizedStringSchema — string | { [locale]: text }
 *   - SignalSchema / Signal — the recursive signal grammar (deterministic | llm | all | any | when)
 *   - WorkflowVar / WorkflowStep / WorkflowDef / WorkflowRun — descriptor + run-record TS types
 *     (Zod validation for the descriptor is added in Phase 3 with the CRUD routes)
 * @usage import { SignalSchema, type Signal } from '../models/workflow-schemas.js';
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial: signal grammar (shared with offers) + descriptor/run types.
 *   v1.1.0 — 2026-06-13 — Phase 3: Zod for the descriptor (WorkflowDefInputSchema) — CRUD validation.
 *   v1.2.0 — 2026-06-15 — Add WorkflowDef.notify_on_finish (owner opt-in finish notification) +
 *     WorkflowRun.notifiedFinish (fire-once guard).
 *   v1.3.0 — 2026-07-05 — Resume-on-retry: WorkflowRunStep.progress (live fill count for slow-vs-stuck
 *     + dashboard) and WorkflowDef.resume (owner opt-in to gate downstream steps on their own
 *     required_to_function instead of parent success).
 *   v1.4.0 — 2026-07-05 — Re-run freshness: WorkflowDef.fresh (clear a step's outputs before it runs)
 *     + built-in {run}/{date} key-template vars (run-scoped keys, the non-destructive default).
 *   v1.5.0 — 2026-07-06 — WorkflowDef.skip_done: a re-run skips already-satisfied steps (green without
 *     dispatching the crew) and continues from the not-yet-done ones.
 */
import { z } from 'zod';

// ── Localized string ─────────────────────────────────────────────────────────
// A plain string, or a { locale: text } map (e.g. { en_US: "…", fi_FI: "…" }).
export const LocalizedStringSchema = z.union([
  z.string().max(2000),
  z.record(z.string().max(20), z.string().max(2000)),
]);
export type LocalizedString = z.infer<typeof LocalizedStringSchema>;

// ── Signal grammar (crew spec §3) ──────────────────────────────────────────────
// A signal is a tree evaluated against owner memory, with {var} templated from run params.
//   - deterministic leaf — no LLM (the whole happy path) over a `key` or `key_glob`
//   - llm leaf — judgment, evaluated by the node's OpenRouter, opt-in + consent-gated
//   - composite — all / any / when-then (the cheap gate guards the expensive check)

export type DeterministicSignal =
  | { kind: 'deterministic'; key?: string; key_glob?: string; op: 'exists' }
  | { kind: 'deterministic'; key?: string; key_glob?: string; op: 'nonempty' }
  | { kind: 'deterministic'; key?: string; key_glob?: string; op: 'json_valid' }
  | { kind: 'deterministic'; key?: string; key_glob?: string; op: 'count_nonempty'; min: number }
  | { kind: 'deterministic'; key?: string; key_glob?: string; op: 'json_schema'; schema: Record<string, unknown> }
  | { kind: 'deterministic'; key?: string; key_glob?: string; op: 'json_field'; path: string; min?: number; equals?: unknown; nonempty?: boolean };

export type LlmSignal = { kind: 'llm'; key?: string; key_glob?: string; ask: string };

export type Signal =
  | DeterministicSignal
  | LlmSignal
  | { all: Signal[] }
  | { any: Signal[] }
  | { when: Signal; then: Signal };

// Common leaf fields — a leaf targets exactly one of key | key_glob (enforced by the evaluator).
const leafTarget = {
  key: z.string().max(400).optional(),
  key_glob: z.string().max(400).optional(),
};

const DeterministicLeafSchema = z.discriminatedUnion('op', [
  z.object({ kind: z.literal('deterministic'), ...leafTarget, op: z.literal('exists') }),
  z.object({ kind: z.literal('deterministic'), ...leafTarget, op: z.literal('nonempty') }),
  z.object({ kind: z.literal('deterministic'), ...leafTarget, op: z.literal('json_valid') }),
  z.object({ kind: z.literal('deterministic'), ...leafTarget, op: z.literal('count_nonempty'), min: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('deterministic'), ...leafTarget, op: z.literal('json_schema'), schema: z.record(z.string(), z.unknown()) }),
  z.object({
    kind: z.literal('deterministic'), ...leafTarget, op: z.literal('json_field'),
    path: z.string().min(1).max(200),
    min: z.number().optional(),
    equals: z.unknown().optional(),
    nonempty: z.boolean().optional(),
  }),
]);

const LlmLeafSchema = z.object({
  kind: z.literal('llm'),
  ...leafTarget,
  ask: z.string().min(1).max(2000),
});

// Recursive: composites nest signals. z.lazy breaks the cycle.
export const SignalSchema: z.ZodType<Signal> = z.lazy(() =>
  z.union([
    DeterministicLeafSchema,
    LlmLeafSchema,
    z.object({ all: z.array(SignalSchema).min(1).max(50) }),
    z.object({ any: z.array(SignalSchema).min(1).max(50) }),
    z.object({ when: SignalSchema, then: SignalSchema }),
  ]),
) as z.ZodType<Signal>;

// ── Descriptor + run-record types (Zod for WorkflowDef added in Phase 3) ───────
// Stored in owner memory: workflows.def.<id> (descriptor), workflows.run.<id>.<runId> (run).

export interface WorkflowVar {
  name: string;
  type: string;                       // 'date' | 'enum[a,b]' | 'string' | … (validated in Phase 3)
  description: LocalizedString;
  default?: string;                   // engine fills '<run-date>' with the firing date
  example?: string;
}

export type WorkflowStepAction =
  | { kind: 'agent' }
  | { kind: 'export-out'; geai: string; capability?: string; from: string }
  | { kind: 'trigger-geai'; geai: string; capability: string; input?: Record<string, unknown> };

export interface WorkflowStep {
  id: string;                         // stable; marks "what happened where" per run
  agent?: string | string[];         // a list = parallel fan within one step (agent steps only)
  offer?: string;                     // inherit success_signal + required_to_function from this offer (agent steps only)
  after?: string[];                   // DAG deps; same `after` + no mutual dep = parallel
  description: LocalizedString;
  required_to_function?: Signal | 'none'; // INPUT gate (consumer-owned); 'none' = no memory input
  success_signal?: Signal;            // OUTPUT check (producer-owned); inherited from offer if omitted
  retry?: { max: number; backoff_min: number };
  /** Max minutes to WAIT for this step's success signal before declaring it timed-out. A step may
   *  legitimately run for many minutes; this only bounds how long we wait for its output. Default 60. */
  timeout_min?: number;
  /** Absent ⇒ default agent-dispatch. export-out/trigger-geai push to / invoke a GEAI over the tunnel. */
  action?: WorkflowStepAction;
}

export type WorkflowTrigger =
  | { kind: 'schedule'; cron: string; timezone?: string }
  | { kind: 'manual' }
  | { kind: 'event'; on: 'memory.write' | 'offer.ordered'; match: Record<string, string> }
  // Fires when a bound ecosystem app (GEAI) emits an inbound event. `app` is the bound app name
  // (e.g. 'zendesk'), `on` the inbound event name (e.g. 'ticket.resolved'). `version` pins the
  // event's MAJOR version — the trigger is fail-safe (does NOT fire) on a major mismatch.
  | { kind: 'ecosystem.event'; app: string; on: string; version: number; match?: Record<string, string> };

export interface WorkflowDef {
  id: string;
  title: LocalizedString;
  description: LocalizedString;
  trigger: WorkflowTrigger;
  vars: WorkflowVar[];
  steps: WorkflowStep[];
  on_step_fail: 'inspect';
  /** Owner opt-in: when a (full-live) run reaches a terminal state — done / partial / cancelled —
   *  drop a finish notification (in-app inbox + email when configured) summarizing outcome + a
   *  per-step log. Default false (no finish notification). */
  notify_on_finish?: boolean;
  /**
   * Owner opt-in (default false): re-evaluate the DAG against reality instead of restart-and-skip.
   * When true, a downstream step gates on its OWN `required_to_function` (evaluated against current
   * memory) rather than requiring every `after` dependency to have succeeded — so `after` becomes
   * ordering and the input gate becomes the real gate. A dependent whose input is genuinely present
   * runs even if a parent step timed out / went red; a dependent whose input is missing goes
   * input-red (never blanket-skipped). Safe only when crew stages are idempotent (a re-run fills
   * absent keys, never rewrites). The watchdog's re-check-before-failing + sliding no-progress
   * timeout are ALWAYS on and need no flag — `resume` gates only the downstream decoupling.
   */
  resume?: boolean;
  /**
   * Owner opt-in (default false): at RUN START (before any step dispatches), DELETE every key the
   * workflow produces — the union of each step's success_signal output keys (minus keys it also reads
   * as input) + deliverable keys — so an idempotent skip-existing crew regenerates them from empty
   * instead of finding a prior run's output already present (which would false-green the step and
   * waste a no-op crew pass). Cleared ONCE up front (not per-step) so parallel steps sharing an output
   * namespace can't wipe each other's fresh output; pure external inputs (produced by no step) are
   * kept. Use when a workflow deliberately writes to the SAME (non-run-scoped) keys every run and wants
   * each run to overwrite. DESTRUCTIVE by design — discards the previous run's deliverables. The
   * non-destructive alternative is per-run keys via the built-in `{run}`/`{date}` vars (see engine
   * resolveVars), which keeps history. Orthogonal to `resume`.
   */
  fresh?: boolean;
  /**
   * Owner opt-in (default false): before dispatching a ready step, check its success_signal against
   * current memory; if the deliverable is ALREADY present, mark the step green WITHOUT dispatching the
   * crew. So a re-run continues from the not-yet-done steps instead of re-invoking crews for work that
   * is already complete — and re-running a single step = delete its output key(s) + run (every other
   * step skips, only the cleared one + its dependents re-run). Safe only when a present deliverable
   * genuinely means "done" (idempotent producers); a workflow whose crew is meant to OVERWRITE stable
   * keys each run should NOT set this (it would skip the refresh) — use `fresh` instead. Mutually
   * moot with `fresh` (fresh clears outputs at run start, so nothing is ever already-done). Orthogonal
   * to `resume`.
   */
  skip_done?: boolean;
  llm?: { approved: boolean };        // owner consent to use the node OpenRouter for `llm` leaves
  costCapMorsels?: number | null;     // optional per-workflow cap (OpenRouter also caps per key)
  createdBy: string;                  // GAII/GHII of the author (audit)
  createdAt: string;
  updatedAt: string;
}

export type StepState =
  | 'pending' | 'input-red' | 'dispatched' | 'green' | 'output-red' | 'timed-out' | 'skipped';

export interface WorkflowRunStep {
  state: StepState;
  attempt: number;
  taskIds?: string[];
  inputObserved?: unknown;
  outputObserved?: unknown;
  reads: string[];
  writes: string[];
  startedAt?: string;
  endedAt?: string;
  /** Retry backoff: the engine won't (re-)dispatch this pending step before this ISO time. */
  notBefore?: string;
  /**
   * Live fill progress for a dispatched step, sampled by the watchdog each sweep from the success
   * signal's observed count (count_nonempty leaves summed). Drives slow-vs-stuck: while `count` keeps
   * increasing the step is in-progress (its no-progress deadline slides to `lastProgressAt +
   * timeout_min`); it only times out after `timeout_min` with `increasing:false`. Absent for signals
   * with no countable leaf (exists/json_*) — those recover on the plain re-check but never extend.
   * Also surfaced to the dashboard as "leaves N/M, still increasing".
   */
  progress?: { count: number; min: number; increasing: boolean; lastProgressAt: string };
}

/**
 * The effective signals for a step, resolved from its offer AT START TIME and pinned into the run.
 * The engine evaluates against THIS, never re-resolving against current offers mid-run — so editing
 * or deleting an offer while a run is in flight can't silently turn a step's check into a false pass.
 */
export interface ResolvedStepSignals {
  stepId: string;
  agents: string[];
  offerId: string;
  success_signal?: Signal;
  required_to_function?: Signal | 'none';
  deliverableKey?: string;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  defSnapshot: WorkflowDef;           // pin the def at run time (interpretable after the def changes)
  resolved: ResolvedStepSignals[];    // pin the offer-resolved signals at run time (no mid-run re-resolution)
  vars: Record<string, string>;
  mode: 'full-live' | 'full-sandbox' | 'signals-only';
  keyPrefix?: string;                 // 'wf-test.<runId>.' in sandbox mode; '' otherwise
  status: 'running' | 'waiting-step' | 'red' | 'partial' | 'done' | 'cancelled';
  steps: Record<string, WorkflowRunStep>;
  /** Inspector tasks dispatched on RED steps (best-effort enrichment; the owner push is guaranteed). */
  inspections?: Array<{ stepId: string; taskId: string; reason: string; at: string }>;
  /** Set once the finish notification (notify_on_finish) has been sent, so it fires exactly once even
   *  if the run is re-persisted (retries, restart re-sync). */
  notifiedFinish?: boolean;
  startedAt: string;
  endedAt?: string;
}

// ── Zod for the descriptor (Phase 3 — CRUD validation) ─────────────────────────
// The PUT body shape: server-managed fields (id from the URL, createdBy + timestamps) are added by
// the store, not accepted from the client.

const RetrySchema = z.object({
  max: z.number().int().min(0).max(10),
  backoff_min: z.number().min(0).max(1440),
});

const WorkflowVarSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_]+$/, 'var name must be [a-zA-Z0-9_]'),
  type: z.string().min(1).max(40),
  description: LocalizedStringSchema,
  default: z.string().max(500).optional(),
  example: z.string().max(500).optional(),
});

// A step's action: absent ⇒ the default agent-dispatch (back-compat). The two ecosystem kinds push
// to / invoke a GEAI over the tunnel and complete on the reply (onPushTerminal), never an agent task.
const WorkflowStepActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent') }),
  z.object({
    kind: z.literal('export-out'),
    geai: z.string().min(1).max(200),                 // the target GEAI (eco:{app}#{owner}@{node})
    capability: z.string().min(1).max(120).optional(),// the GEAI ingest capability (default '__deposit__')
    from: z.string().min(1).max(200),                 // owner memory key/glob whose value is pushed
  }),
  z.object({
    kind: z.literal('trigger-geai'),
    geai: z.string().min(1).max(200),
    capability: z.string().min(1).max(120),           // the GEAI capability to invoke
    input: z.record(z.string().max(120), z.unknown()).optional(),
  }),
]);

const WorkflowStepSchema = z.object({
  id: z.string().min(1).max(100),
  // agent/offer are required for the default agent step but absent for export-out/trigger-geai.
  agent: z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(20)]).optional(),
  offer: z.string().min(1).max(100).optional(),
  after: z.array(z.string().min(1).max(100)).max(50).optional(),
  description: LocalizedStringSchema,
  required_to_function: z.union([SignalSchema, z.literal('none')]).optional(),
  success_signal: SignalSchema.optional(),
  retry: RetrySchema.optional(),
  timeout_min: z.number().int().min(1).max(10080).optional(), // minutes to wait for the signal; default 60 (engine), max 7 days
  action: WorkflowStepActionSchema.optional(),
});

const WorkflowTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schedule'), cron: z.string().min(1).max(120), timezone: z.string().max(60).optional() }),
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('event'), on: z.enum(['memory.write', 'offer.ordered']), match: z.record(z.string().max(120), z.string().max(400)) }),
  z.object({
    kind: z.literal('ecosystem.event'),
    app: z.string().min(1).max(100),                          // the bound app name, e.g. 'zendesk'
    on: z.string().min(1).max(120),                           // inbound event name, e.g. 'ticket.resolved'
    version: z.number().int().min(1),                         // pinned MAJOR of the event type; fail-safe (no fire) on major mismatch
    match: z.record(z.string().max(120), z.string().max(400)).optional(),
  }),
]);

/** The accepted PUT body — server fills id (from the URL), createdBy, createdAt, updatedAt. */
export const WorkflowDefInputSchema = z.object({
  title: LocalizedStringSchema,
  description: LocalizedStringSchema,
  trigger: WorkflowTriggerSchema,
  vars: z.array(WorkflowVarSchema).max(30),
  steps: z.array(WorkflowStepSchema).min(1).max(50),
  on_step_fail: z.literal('inspect'),
  notify_on_finish: z.boolean().optional(),
  resume: z.boolean().optional(),
  fresh: z.boolean().optional(),
  skip_done: z.boolean().optional(),
  llm: z.object({ approved: z.boolean() }).optional(),
  costCapMorsels: z.number().int().nonnegative().nullable().optional(),
});

export type WorkflowDefInput = z.infer<typeof WorkflowDefInputSchema>;

/** Workflow id: lowercase slug, used directly in the memory key `workflows.def.<id>`. */
export const WORKFLOW_ID_RE = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/;
