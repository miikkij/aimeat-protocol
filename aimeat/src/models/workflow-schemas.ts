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
 *   v1.6.0 — 2026-07-06 — StepState 'agent-offline': a dispatched step whose agent is unreachable and
 *     produced nothing fails fast (offline grace) with a distinct state, not a slow timed-out.
 *   v1.7.0 — 2026-07-16 — Human-in-the-loop: step action kind 'human-input' (structured question to
 *     the owner, AskUserQuestion-shaped), StepState 'waiting-human', WorkflowRunStep.human (pinned
 *     question + answer), WorkflowHumanAnswerSchema (the answer POST body). The answer is written to
 *     `answer_to_key` so downstream steps gate on it with plain deterministic signals (json_field).
 *   v1.8.0 — 2026-08-15 — TARGET-063 A3: step action kind 'extension' — run one of the owner's own
 *     extension actions on the server, no agent session and no model call. A workflow could reach an
 *     agent, a human and another node's app, and could not reach the deterministic capability sitting
 *     on the same node, even though an HTTP caller could. Completion goes through onPushTerminal, so
 *     the success_signal decides green or red exactly as it does for an ecosystem step.
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
  // `path` counts the non-empty entries INSIDE one record (an object's values, or an array's
  // elements) instead of counting matching keys. Added 2026-08-09 so a pipeline can consolidate its
  // per-item keys into one record without breaking the very step that verifies it.
  | { kind: 'deterministic'; key?: string; key_glob?: string; op: 'count_nonempty'; min: number; path?: string }
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
  z.object({ kind: z.literal('deterministic'), ...leafTarget, op: z.literal('count_nonempty'), min: z.number().int().nonnegative(), path: z.string().min(1).max(200).optional() }),
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

/**
 * A structured question posed to the owner when a human-input step is reached. Shape is aligned
 * with InteractiveQuestionSchema (message-schemas.ts) / Claude's AskUserQuestion so inbox UIs can
 * render it with the answer UX they already have. `prompt` is {var}-templated at ask time.
 */
export interface WorkflowHumanQuestion {
  header?: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  multiSelect?: boolean;
  allowOther?: boolean;
}

export type WorkflowStepAction =
  | { kind: 'agent' }
  | { kind: 'export-out'; geai: string; capability?: string; from: string }
  | { kind: 'trigger-geai'; geai: string; capability: string; input?: Record<string, unknown> }
  // human-input: park the run (StepState 'waiting-human') until the owner answers via
  // POST /v1/workflows/:id/runs/:runId/steps/:stepId/answer. The answer JSON ({picks, pick, other,
  // answeredAt, by}) is written to `answer_to_key` (templated, keyPrefix-honoring) so downstream
  // steps branch on it with deterministic json_field gates. on_timeout: what the watchdog does when
  // timeout_min (default 1440 = 24h for human steps) elapses unanswered — 'fail' (default, timed-out),
  // 'skip', or 'default' (synthesize the answer `default_option`, by:'timeout-default').
  // reviews_key (TARGET-058): the memory key whose CONTENT this question puts in front of the
  // person. It is the ONE thing in the whole workflow engine that can upgrade a provenance record's
  // humanInvolvement to 'editorial-control', because it is the only place where a named person reads
  // the substance and can reject it. A step that merely asks "publish now?" must not set it —
  // clicking publish is not review, and a false editorial-control claim is worse than none.
  | { kind: 'human-input'; question: WorkflowHumanQuestion; answer_to_key?: string; reviews_key?: string; on_timeout?: 'fail' | 'skip' | 'default'; default_option?: string }
  // extension: run one of the OWNER'S OWN extension actions on the server, in the QuickJS sandbox,
  // with no agent session and no model call. It is the deterministic half of a pipeline — fetch,
  // normalise, hash, write a file — next to the agent steps that do the interpreting.
  //
  // Same input as the schedule kind, because it is the same run: services/extension-system-run.ts
  // executes both. `input` is {var}-templated at dispatch, so a step can be parameterised by the
  // run's vars the way a key template is. The step completes through onPushTerminal, which means
  // its success_signal decides green or red exactly as it does for an ecosystem step — a script
  // that returns without producing what the signal names is a RED step, not a quiet pass.
  //
  // OWN EXTENSION ONLY, checked at save AND at run. An unattended call has no paywall, no contract
  // and no meter, so pointing a workflow at somebody else's extension would be an unlimited standing
  // call on their capability, their API keys and their quota — the same reason POST /v1/schedules
  // has refused it since it was written.
  //
  // `result_to_key` IS HOW THE STEP IS GATED, and it is not optional decoration. An extension's own
  // memory lives in the `ext:{name}` namespace, and a workflow's signals read OWNER SCOPE (the owner
  // GHII plus their agents and ecosystem apps — see services/owner-memory.ts). Those two never
  // intersect, so a signal pointed at what the extension wrote for itself can only ever read
  // nothing. The engine therefore writes the action's RETURN VALUE to this key, in the owner's
  // namespace, templated and keyPrefix-honouring — exactly what `answer_to_key` does for a
  // human-input step — and the signal gates on that. A step must declare either this or its own
  // success_signal; with neither, the only thing left to green on is "the script returned", which is
  // the covering fallback this design exists to remove.
  | { kind: 'extension'; extension: string; action: string; instance_id?: string; input?: Record<string, unknown>; result_to_key?: string }
  // Publish one version of a data package from what an earlier step produced.
  //
  // WHY THIS IS A STEP KIND AND NOT AN EXTENSION. The binding a repeating package needs is "call the
  // producer, then publish what it returned", and the two halves cannot be joined any other way. An
  // extension step already writes its return value to `result_to_key` in the OWNER'S namespace, as a
  // PRIVATE record — which is right, since an intermediate result is not something to publish. But
  // that is also exactly what the sandbox cannot read: `ctx.memory.get` reads `ext:{name}`, and
  // `ctx.memory.getPublic` returns only public records. So a publisher EXTENSION could never see the
  // rows, and the alternatives are worse: widening the sandbox to read an owner's private keys, or
  // making intermediate results public. The engine already runs as the owner and already reads that
  // key, so the join belongs here.
  //
  // `rows_at` is a dotted path INTO the step's result, because a producer answers with an envelope
  // (`{ ok, total, results }`) far more often than with a bare array. Naming the path is how a
  // workflow says which part of the answer is the table.
  | {
      kind: 'datapackage';
      /** Package name — becomes part of the permanent address, so it is not a sentence. */
      name: string;
      /** Owner-namespace key an earlier step wrote (templated, keyPrefix honoured). */
      from_key: string;
      /** Dotted path to the rows inside that value. Omit when the value IS the array. */
      rows_at?: string;
      /**
       * Column name → dotted path INSIDE each row. Omit to publish the rows as they are.
       *
       * WHY A STEP NEEDS THIS AT ALL. A Table Schema describes scalars, and a real producer answers
       * with nested objects: `buyer: { name, businessId }`, `detail: { cpvLabel, lotCount }`, an
       * array of codes. Publishing those rows unchanged means either a schema that cannot describe
       * them or a quality gate that refuses every row — the first production run of this binding
       * refused 200 row problems for exactly that reason, which is the gate working and the step
       * being unable to do the one thing the data needed.
       *
       * It is a MAPPING rather than a script on purpose. Flattening is the transformation these
       * producers actually need, it is declarative, and it is recorded in the descriptor as one; a
       * scripting language in a workflow descriptor would be a sandbox with no boundary and no
       * provenance.
       *
       * A path that is missing yields null rather than dropping the column, so a row that lost a
       * field is visible as a gap instead of silently changing the table's shape. An ARRAY at the
       * end of a path is joined with a semicolon: a notice can carry several codes, and one column
       * that says so beats a column that keeps the first.
       */
      columns?: Record<string, string>;
      /**
       * The Table Schema this package's rows must satisfy. Omitting it INFERS from the rows, and for
       * a repeating producer that is the wrong default even though it is the convenient one:
       * inference widens to fit whatever arrived, so a run where the upstream sent a word instead of
       * a number produces a version whose column is quietly a string, and every consumer's join
       * against it stops matching without an error anywhere. Declare it, and the same run is refused
       * with the row and the field named, and the package stands on its previous version.
       *
       * Shape-checked by the publish service, which owns that contract. Typing it loosely here is
       * deliberate: two definitions of a Table Schema in two files is how they drift apart.
       */
      schema?: { fields: Array<{ name: string; type: string }> };
      /** REQUIRED by the publish contract: what moved against the previous version and why. */
      changes: string;
      title?: string;
      description?: string;
      resource?: string;
      provenance?: Record<string, unknown>;
      retention_policy?: { keep: number; unit: string };
    };

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
  | 'pending' | 'input-red' | 'dispatched' | 'green' | 'output-red' | 'timed-out' | 'skipped'
  // agent-offline: the step's agent was unreachable (no working webhook + stale lastSeen) and produced
  // nothing within the offline grace — a connectivity failure, distinct from a productive-but-slow
  // timed-out. Terminal + counts as a failure (partial run).
  | 'agent-offline'
  // waiting-human: a human-input step has asked its question and the run is parked until the owner
  // answers (or the timeout policy fires). Non-terminal — the run stays 'waiting-step'.
  | 'waiting-human';

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
  /**
   * Human-input bookkeeping. `question` is the {var}-TEMPLATED snapshot pinned at ask time (same
   * pinning philosophy as `resolved` — editing the def mid-run can't change what was asked). The
   * answer keeps both `picks` (array) and flat `pick` (first pick) so a downstream json_field gate
   * needs no array indexing: `{op:'json_field', path:'pick', equals:'approve'}`.
   */
  human?: {
    question: WorkflowHumanQuestion;
    askedAt: string;
    answeredAt?: string;
    answer?: { picks: string[]; pick: string; other?: string; by: string };
  };
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
  z.object({
    kind: z.literal('human-input'),
    question: z.object({
      header: z.string().min(1).max(80).optional(),
      prompt: z.string().min(1).max(2000),            // {var}-templated at ask time
      options: z.array(z.object({
        id: z.string().min(1).max(64),
        label: z.string().min(1).max(500),
      })).min(1).max(20),
      multiSelect: z.boolean().optional(),
      allowOther: z.boolean().optional(),
    }),
    answer_to_key: z.string().min(1).max(400).optional(),
    /** The key whose CONTENT the person is being asked to read. See the type above — this is the
     *  only field on the engine that may upgrade a provenance record to 'editorial-control'. */
    reviews_key: z.string().min(1).max(400).optional(),
    on_timeout: z.enum(['fail', 'skip', 'default']).optional(),
    default_option: z.string().min(1).max(64).optional(),
  }),
  z.object({
    kind: z.literal('extension'),
    extension: z.string().min(1).max(120),            // must be installed by THIS workflow's owner
    action: z.string().min(1).max(120),               // an action id on that extension
    instance_id: z.string().min(1).max(120).optional(),
    // Handed to the sandbox as the action's input, {var}-templated at dispatch. Values are opaque to
    // the engine; only string leaves are templated, so numbers and booleans survive as themselves.
    input: z.record(z.string().max(120), z.unknown()).optional(),
    /** Owner-namespace key the action's return value is written to, so a signal can gate on it.
     *  See the type above for why an extension step needs this and an agent step does not. */
    result_to_key: z.string().min(1).max(400).optional(),
  }),
  z.object({
    kind: z.literal('datapackage'),
    // Part of the permanent address, so it is a name rather than a sentence: the same shape the
    // publish route enforces.
    name: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
    /** The owner-namespace key an earlier step wrote (its `result_to_key`), {var}-templated. */
    from_key: z.string().min(1).max(400),
    /** Dotted path to the rows INSIDE that value — a producer answers with an envelope far more
     *  often than with a bare array. Omit when the value is the array itself. */
    rows_at: z.string().min(1).max(200).optional(),
    /** Column name -> dotted path inside each row. See the type above for why this is a mapping
     *  and not a script. */
    columns: z.record(z.string().min(1).max(64), z.string().min(1).max(200)).optional(),
    /** A declared Table Schema. Shape-checked by the publish service, which owns that contract;
     *  validating it twice, in two places, is how the two definitions drift apart. */
    schema: z.object({ fields: z.array(z.object({ name: z.string().min(1), type: z.string().min(1) }).loose()).min(1) }).loose().optional(),
    /** Required, and required here rather than only at publish: a workflow that discovers the
     *  contract at 06:00 has already lost the run it was written for. */
    changes: z.string().min(1).max(2000),
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2000).optional(),
    resource: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
    provenance: z.record(z.string().max(60), z.unknown()).optional(),
    retention_policy: z.object({ keep: z.number().int().min(0), unit: z.string().min(1).max(20) }).optional(),
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

/** POST body for answering a waiting-human step. Picks are validated against the PINNED question
 *  (ids must exist; single pick unless multiSelect; `other` only when allowOther). */
export const WorkflowHumanAnswerSchema = z.object({
  picks: z.array(z.string().min(1).max(64)).max(20),
  other: z.string().max(2000).optional(),
});
export type WorkflowHumanAnswer = z.infer<typeof WorkflowHumanAnswerSchema>;

/** Workflow id: lowercase slug, used directly in the memory key `workflows.def.<id>`. */
export const WORKFLOW_ID_RE = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/;
