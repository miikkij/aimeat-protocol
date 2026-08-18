/**
 * @file signal-eval.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure, deterministic-first evaluator for the Agent Workflows signal grammar
 *   (workflow-schemas.ts §Signal). Given a signal tree and an injected I/O context (memory reads,
 *   {var} params, an optional node-OpenRouter `llm` judge, and an optional JSON-schema validator),
 *   it returns { ok, observed } — `observed` is the expected-vs-observed payload the inspector and
 *   the run UI surface. NO server, NO storage import: every side effect is injected, so this is
 *   unit-testable in isolation. Used by the workflow engine for both the input gate
 *   (required_to_function) and the output check (success_signal). See
 *   docs/plans/2026-06-13-agent-workflows-node-plan.md §3.
 * @structure
 *   - evaluateSignal(signal, ctx) — the recursive entry point
 *   - extractProgress(observed) — sum count_nonempty progress for slow-vs-stuck (watchdog)
 *   - SignalEvalCtx — the injected I/O surface
 *   - templateKey / globToRegExp / getByPath / isNonEmpty — internal helpers
 *   - SignalTemplateError — thrown when {var} templating would escape the owner namespace
 * @usage
 *   import { evaluateSignal } from '../workflow/signal-eval.js';
 *   const { ok, observed } = await evaluateSignal(step.success_signal, ctx);
 * @version-history
 *   v1.0.0 — 2026-06-13 — Initial: deterministic ops + llm leaf (degrades when disabled) + composites.
 *   v1.1.0 — 2026-07-05 — Add extractProgress(observed) — sums count_nonempty progress for the
 *     watchdog's slow-vs-stuck decision (resume-on-retry).
 */
import type { Signal, DeterministicSignal } from '../../models/workflow-schemas.js';

/** A value read from owner memory (just the parts the evaluator needs). */
export interface MemoryValue { key: string; value: unknown; }

/** The injected I/O surface — the caller binds these to the owner namespace. */
export interface SignalEvalCtx {
  /** Read one exact owner-memory key (already namespaced by the caller). */
  read: (key: string) => Promise<MemoryValue | null>;
  /** List owner-memory records whose key matches a glob (caller maps glob → listMemory). */
  listGlob: (glob: string) => Promise<MemoryValue[]>;
  /** Run params for {var} templating. */
  vars: Record<string, string>;
  /**
   * The node-OpenRouter judge for `llm` leaves, or null when disabled (OpenRouter not configured,
   * or the owner has not approved node-LLM use for this workflow). When null, an `llm` leaf
   * DEGRADES to ok (it does not fail the gate) — the cheap deterministic `when` gate that normally
   * guards it has already done the hard check.
   */
  llm: ((args: { key: string; content: unknown; ask: string }) => Promise<{ ok: boolean; reason: string }>) | null;
  /** Optional JSON-schema validator (ajv-backed in production). Absent ⇒ json_schema falls back to json_valid. */
  validateJsonSchema?: (value: unknown, schema: Record<string, unknown>) => { ok: boolean; errors?: string[] };
}

export interface SignalResult { ok: boolean; observed: unknown; }

/** Thrown when {var} templating would let a value escape the owner namespace. */
export class SignalTemplateError extends Error {
  constructor(message: string) { super(message); this.name = 'SignalTemplateError'; }
}

// ── {var} templating ───────────────────────────────────────────────────────────
// Replace {name} with vars[name]. A memory key lives in the owner namespace; '::' is the
// namespace separator, so neither the template nor any substituted value may contain it (that
// would target another owner's keys). An unknown {var} is also rejected.
function templateKey(template: string, vars: Record<string, string>): string {
  if (template.includes('::')) {
    throw new SignalTemplateError(`signal key "${template}" must not contain "::" (namespace escape)`);
  }
  const out = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name: string) => {
    if (!(name in vars)) throw new SignalTemplateError(`signal key references undeclared var "{${name}}"`);
    const v = String(vars[name]);
    if (v.includes('::')) throw new SignalTemplateError(`var "{${name}}" value must not contain "::" (namespace escape)`);
    return v;
  });
  return out;
}

// ── helpers ────────────────────────────────────────────────────────────────────
/**
 * Convert a `key_glob` ('*' is the only wildcard) into an anchored RegExp. Exported so the engine's
 * `listGlob` implementation (Phase 4, over listMemory) matches keys exactly the same way.
 */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function isNonEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true; // numbers, booleans
}

/** Parse a string value as JSON; pass-through objects/arrays (memory often stores parsed JSON). */
function asJson(value: unknown): { ok: boolean; parsed?: unknown } {
  if (value !== null && typeof value === 'object') return { ok: true, parsed: value };
  if (typeof value === 'string') {
    try { return { ok: true, parsed: JSON.parse(value) }; } catch { return { ok: false }; }
  }
  return { ok: false };
}

/** Dot-path traversal: "a.b.0.c" over an object/array tree. */
function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// ── deterministic leaf ───────────────────────────────────────────────────────────
async function evalDeterministic(sig: DeterministicSignal, ctx: SignalEvalCtx): Promise<SignalResult> {
  // count_nonempty counts either KEYS matching a glob, or ENTRIES inside one record at `path`.
  //
  // The path form exists because counting keys is what forced a pipeline to shard. A step that says
  // "at least 12 articles" used to be expressible only as "at least 12 keys matching article.*", so
  // consolidating those twelve keys into one record broke the step's own gate and the pipeline could
  // not be fixed without breaking its verification. Same op on purpose rather than a new one: the
  // watchdog's slow-vs-stuck rule sums `count_nonempty` leaves to tell "still filling" from "stuck",
  // and a consolidated pipeline must not lose that signal just for changing shape.
  if (sig.op === 'count_nonempty') {
    if (sig.path) {
      const keyTmpl = sig.key ?? sig.key_glob;
      if (!keyTmpl) return { ok: false, observed: { error: 'count_nonempty with path requires key' } };
      const key = templateKey(keyTmpl, ctx.vars);
      const rec = sig.key ? await ctx.read(key) : (await ctx.listGlob(key))[0] ?? null;
      if (!rec) return { ok: false, observed: { op: 'count_nonempty', key, path: sig.path, min: sig.min, count: 0, error: 'missing' } };
      const j = asJson(rec.value);
      if (!j.ok) return { ok: false, observed: { op: 'count_nonempty', key, path: sig.path, min: sig.min, count: 0, error: 'invalid json' } };
      const at = getByPath(j.parsed, sig.path);
      // An object counts its non-empty VALUES (articles keyed by category); an array counts its
      // non-empty elements. Anything else is not a collection and counts as nothing, rather than
      // silently passing a step that was meant to check for twelve of something.
      const count = Array.isArray(at)
        ? at.filter(isNonEmpty).length
        : (at && typeof at === 'object' ? Object.values(at as Record<string, unknown>).filter(isNonEmpty).length : 0);
      return { ok: count >= sig.min, observed: { op: 'count_nonempty', key, path: sig.path, min: sig.min, count } };
    }
    const glob = sig.key_glob ?? sig.key;
    if (!glob) return { ok: false, observed: { error: 'count_nonempty requires key_glob or path' } };
    const recs = await ctx.listGlob(templateKey(glob, ctx.vars));
    const count = recs.filter(r => isNonEmpty(r.value)).length;
    return { ok: count >= sig.min, observed: { op: 'count_nonempty', min: sig.min, count } };
  }

  const keyTmpl = sig.key ?? sig.key_glob;
  if (!keyTmpl) return { ok: false, observed: { error: `${sig.op} requires key or key_glob` } };
  const key = templateKey(keyTmpl, ctx.vars);

  // If a glob was given (non count op), evaluate against the first match.
  const rec = sig.key
    ? await ctx.read(key)
    : (await ctx.listGlob(key))[0] ?? null;
  const exists = rec !== null;

  switch (sig.op) {
    case 'exists':
      return { ok: exists, observed: { op: 'exists', key, exists } };
    case 'nonempty':
      return { ok: exists && isNonEmpty(rec!.value), observed: { op: 'nonempty', key, exists, nonempty: exists && isNonEmpty(rec!.value) } };
    case 'json_valid': {
      const j = exists ? asJson(rec!.value) : { ok: false };
      return { ok: j.ok, observed: { op: 'json_valid', key, valid: j.ok } };
    }
    case 'json_schema': {
      if (!exists) return { ok: false, observed: { op: 'json_schema', key, error: 'missing' } };
      const j = asJson(rec!.value);
      if (!j.ok) return { ok: false, observed: { op: 'json_schema', key, error: 'invalid json' } };
      if (!ctx.validateJsonSchema) {
        // No validator injected → degrade to json_valid (don't hard-fail on a missing tool).
        return { ok: true, observed: { op: 'json_schema', key, note: 'validator absent → json_valid only' } };
      }
      const v = ctx.validateJsonSchema(j.parsed, sig.schema);
      return { ok: v.ok, observed: { op: 'json_schema', key, valid: v.ok, errors: v.errors } };
    }
    case 'json_field': {
      if (!exists) return { ok: false, observed: { op: 'json_field', key, path: sig.path, error: 'missing' } };
      const j = asJson(rec!.value);
      if (!j.ok) return { ok: false, observed: { op: 'json_field', key, path: sig.path, error: 'invalid json' } };
      const fieldVal = getByPath(j.parsed, sig.path);
      let ok = fieldVal !== undefined;
      if (ok && sig.nonempty) ok = isNonEmpty(fieldVal);
      if (ok && sig.equals !== undefined) ok = JSON.stringify(fieldVal) === JSON.stringify(sig.equals);
      if (ok && sig.min !== undefined) {
        const n = typeof fieldVal === 'number' ? fieldVal : Array.isArray(fieldVal) ? fieldVal.length : NaN;
        ok = !Number.isNaN(n) && n >= sig.min;
      }
      return { ok, observed: { op: 'json_field', key, path: sig.path, value: fieldVal } };
    }
    default:
      return { ok: false, observed: { error: `unknown deterministic op` } };
  }
}

// ── progress extraction (slow-vs-stuck) ────────────────────────────────────────────
/**
 * Sum the `count_nonempty` progress across a signal's `observed` payload (the tree returned by
 * evaluateSignal). Returns { count, min } summed over every count_nonempty leaf found — the watchdog
 * uses a rising `count` as "the crew is still filling keys" (in-progress) and a flat one as "stuck".
 * Returns null when the signal has no countable leaf (exists / nonempty / json_*), so those signals
 * recover on the plain re-check but never extend their deadline. Pure — walks the observed object.
 */
export function extractProgress(observed: unknown): { count: number; min: number } | null {
  let count = 0, min = 0, found = false;
  const walk = (o: unknown): void => {
    if (o === null || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    if (rec.op === 'count_nonempty' && typeof rec.count === 'number' && typeof rec.min === 'number') {
      count += rec.count; min += rec.min; found = true;
      return;
    }
    if (Array.isArray(rec.all)) rec.all.forEach(walk);
    if (Array.isArray(rec.any)) rec.any.forEach(walk);
    if ('when' in rec) walk(rec.when);
    if ('then' in rec) walk(rec.then);
  };
  walk(observed);
  return found ? { count, min } : null;
}

// ── the recursive entry point ─────────────────────────────────────────────────────
export async function evaluateSignal(signal: Signal, ctx: SignalEvalCtx): Promise<SignalResult> {
  // Composite: all
  if ('all' in signal) {
    const results = await Promise.all(signal.all.map(s => evaluateSignal(s, ctx)));
    return { ok: results.every(r => r.ok), observed: { all: results.map(r => r.observed) } };
  }
  // Composite: any
  if ('any' in signal) {
    const results = await Promise.all(signal.any.map(s => evaluateSignal(s, ctx)));
    return { ok: results.some(r => r.ok), observed: { any: results.map(r => r.observed) } };
  }
  // Composite: when → then (the cheap gate guards the expensive/LLM check).
  if ('when' in signal) {
    const w = await evaluateSignal(signal.when, ctx);
    if (!w.ok) return { ok: true, observed: { notApplicable: true, when: w.observed } }; // gate closed ⇒ not applicable ⇒ passes
    const t = await evaluateSignal(signal.then, ctx);
    return { ok: t.ok, observed: { when: w.observed, then: t.observed } };
  }
  // Leaf: deterministic
  if ('kind' in signal && signal.kind === 'deterministic') {
    return evalDeterministic(signal, ctx);
  }
  // Leaf: llm
  if ('kind' in signal && signal.kind === 'llm') {
    const keyTmpl = signal.key ?? signal.key_glob;
    if (!keyTmpl) return { ok: false, observed: { error: 'llm leaf requires key or key_glob' } };
    const key = templateKey(keyTmpl, ctx.vars);
    if (!ctx.llm) {
      // Disabled (no OpenRouter / no owner consent) → degrade to pass; never break the workflow.
      return { ok: true, observed: { op: 'llm', key, disabled: true } };
    }
    const rec = signal.key ? await ctx.read(key) : (await ctx.listGlob(key))[0] ?? null;
    const content = rec?.value ?? null;
    const verdict = await ctx.llm({ key, content, ask: signal.ask });
    return { ok: verdict.ok, observed: { op: 'llm', key, reason: verdict.reason } };
  }
  return { ok: false, observed: { error: 'unrecognized signal node' } };
}
