/**
 * @file workflow-signals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The signal grammar of Agent Workflows: a tree evaluated against owner memory,
 *   deterministic-first, with a sparingly-used node-OpenRouter `llm` leaf. Both an agent's offer
 *   (success_signal / required_to_function) and a workflow step build to it. Moved unchanged out of
 *   workflow-schemas.ts (max-file-lines), which re-exports every name here, so an import from either
 *   file gets the same thing.
 * @structure DeterministicSignal · LlmSignal · Signal · SignalSchema
 * @usage import { SignalSchema, type Signal } from '../models/workflow-schemas.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved unchanged from workflow-schemas.ts (max-file-lines).
 */
import { z } from 'zod';

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
