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

export interface WorkflowStep {
  id: string;                         // stable; marks "what happened where" per run
  agent: string | string[];          // a list = parallel fan within one step
  offer: string;                      // inherit success_signal + required_to_function from this offer
  after?: string[];                   // DAG deps; same `after` + no mutual dep = parallel
  description: LocalizedString;
  required_to_function?: Signal | 'none'; // INPUT gate (consumer-owned); 'none' = no memory input
  success_signal?: Signal;            // OUTPUT check (producer-owned); inherited from offer if omitted
  retry?: { max: number; backoff_min: number };
  /** Max minutes to WAIT for this step's success signal before declaring it timed-out. A step may
   *  legitimately run for many minutes; this only bounds how long we wait for its output. Default 60. */
  timeout_min?: number;
}

export type WorkflowTrigger =
  | { kind: 'schedule'; cron: string; timezone?: string }
  | { kind: 'manual' }
  | { kind: 'event'; on: 'memory.write' | 'offer.ordered'; match: Record<string, string> };

export interface WorkflowDef {
  id: string;
  title: LocalizedString;
  description: LocalizedString;
  trigger: WorkflowTrigger;
  vars: WorkflowVar[];
  steps: WorkflowStep[];
  on_step_fail: 'inspect';
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

const WorkflowStepSchema = z.object({
  id: z.string().min(1).max(100),
  agent: z.union([z.string().min(1).max(100), z.array(z.string().min(1).max(100)).min(1).max(20)]),
  offer: z.string().min(1).max(100),
  after: z.array(z.string().min(1).max(100)).max(50).optional(),
  description: LocalizedStringSchema,
  required_to_function: z.union([SignalSchema, z.literal('none')]).optional(),
  success_signal: SignalSchema.optional(),
  retry: RetrySchema.optional(),
  timeout_min: z.number().int().min(1).max(10080).optional(), // minutes to wait for the signal; default 60 (engine), max 7 days
});

const WorkflowTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schedule'), cron: z.string().min(1).max(120), timezone: z.string().max(60).optional() }),
  z.object({ kind: z.literal('manual') }),
  z.object({ kind: z.literal('event'), on: z.enum(['memory.write', 'offer.ordered']), match: z.record(z.string().max(120), z.string().max(400)) }),
]);

/** The accepted PUT body — server fills id (from the URL), createdBy, createdAt, updatedAt. */
export const WorkflowDefInputSchema = z.object({
  title: LocalizedStringSchema,
  description: LocalizedStringSchema,
  trigger: WorkflowTriggerSchema,
  vars: z.array(WorkflowVarSchema).max(30),
  steps: z.array(WorkflowStepSchema).min(1).max(50),
  on_step_fail: z.literal('inspect'),
  llm: z.object({ approved: z.boolean() }).optional(),
  costCapMorsels: z.number().int().nonnegative().nullable().optional(),
});

export type WorkflowDefInput = z.infer<typeof WorkflowDefInputSchema>;

/** Workflow id: lowercase slug, used directly in the memory key `workflows.def.<id>`. */
export const WORKFLOW_ID_RE = /^[a-z0-9][a-z0-9-]{0,98}[a-z0-9]$/;
