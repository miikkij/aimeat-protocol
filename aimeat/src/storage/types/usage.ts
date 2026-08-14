/**
 * @file src/storage/types/usage.ts
 * @description Record types for usage telemetry: the hot call stream, the archive rows, and the
 *   discriminated serving rollup with its fold watermark. Design and rationale:
 *   docs/internal/telemetria/02-design.md
 *
 *   THE ONE RULE THAT MAKES THE ROLLUP WORK. A dimension outside a cut holds `''`, never null or
 *   undefined. The unique key is therefore total, and the upsert is a plain
 *   `ON CONFLICT DO UPDATE SET x = x + excluded.x`. A nullable dimension makes the conflict target
 *   unreachable — the same trap AgentUsageDailyRecord documents for its context dims.
 * @structure
 *   - UsageCallRecord / UsageCallInput   -- layer 1, one row per observable call
 *   - UsageCallFilter                    -- the operator's raw drill
 *   - UsageRollupRow / UsageRollupDelta  -- layer 3, the serving table
 *   - UsageRollupFilter                  -- how a read names a cut and a window
 *   - UsageRollupCursor                  -- the fold's per-stream watermark
 *   - UsageArchiveResult                 -- what one archive sweep moved
 * @usage
 *   import type { UsageCallInput } from '../storage/interface.js';
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: three-layer usage telemetry substrate.
 */

/** Which door a call came through. Widening this list is additive; the rollup stores it verbatim. */
export type UsageSurface =
  | 'mcp'
  | 'apptool'
  | 'exchange'
  | 'capability'
  | 'app'
  | 'extension'
  | 'http'
  | 'operator';

/** What kind of principal acted. `anon` covers an unauthenticated public app open. */
export type UsageActorKind = 'owner' | 'agent' | 'app' | 'eco' | 'operator' | 'anon';

/**
 * How a call ended. `refused` and `error` are different on purpose: a refusal is the system working
 * (no entitlement, budget reached, scope missing) and is a demand signal; an error is the system
 * failing. Collapsing them would hide the more useful of the two.
 */
export type UsageOutcome = 'ok' | 'refused' | 'error';

/**
 * One observable call, whichever door it came through. Written through the buffered recorder
 * (services/usage/usage-buffer.ts), never directly from a route — a call must not wait on a
 * metrics write.
 */
export interface UsageCallRecord {
  id: string;
  /** ISO 8601 UTC. Together with `id` this is the fold's total order over the stream. */
  ts: string;
  /**
   * The human whose account this belongs to: the payer for a priced call, the app owner's user for
   * an app open. Always a GHII, never a bare owner name, so it joins the LLM ledger.
   */
  ownerGhii: string;
  /** The exact principal. `ownerGhii` answers whose, this answers which of theirs. */
  actorGaii: string;
  actorKind: UsageActorKind;
  surface: UsageSurface;
  /** The MCP tool name, `ext/action`, or the app filename. */
  coordinate: string;
  /** `owner/filename` when app-related, else ''. */
  appId: string;
  /** The provider bought from on an exchange call; the inspected owner on an operator drill. */
  counterpartyGhii: string;
  outcome: UsageOutcome;
  /** Refusal kind or error code. '' on a clean call. */
  reason: string;
  durationMs: number;
  /** 0 for a free call. Denominated by `unit` — morsels and money minor units never mix. */
  chargedUnits: number;
  unit: 'morsels' | 'money' | '';
  currency: string;
  entitlementId: string;
  runId: string;
  /** Detail the fold never reads. Anything the rollup aggregates gets a column instead. */
  meta: Record<string, unknown>;
}

/**
 * What a door supplies. Everything optional defaults at the recorder, so a door names only what it
 * knows — that is what keeps six call sites from each re-deriving the same empty strings.
 */
export interface UsageCallInput {
  ownerGhii: string;
  surface: UsageSurface;
  coordinate: string;
  actorGaii?: string;
  actorKind?: UsageActorKind;
  appId?: string;
  counterpartyGhii?: string;
  outcome?: UsageOutcome;
  reason?: string;
  durationMs?: number;
  chargedUnits?: number;
  unit?: 'morsels' | 'money' | '';
  currency?: string;
  entitlementId?: string;
  runId?: string;
  meta?: Record<string, unknown>;
  /** Override the timestamp (tests and backfills only; the recorder stamps now otherwise). */
  ts?: string;
}

/**
 * The operator's raw drill. NOT owner-scoped by construction — the calling route MUST gate on the
 * operator role, and it must record its own inspection as a UsageCall (see the design's audit rule).
 */
export interface UsageCallFilter {
  ownerGhii?: string;
  actorGaii?: string;
  surface?: UsageSurface;
  appId?: string;
  outcome?: UsageOutcome;
  /** Inclusive ISO bounds. */
  from?: string;
  to?: string;
  limit?: number;
}

/** The fold's cursor over one raw stream. */
export interface UsageRollupCursor {
  stream: 'llm' | 'call';
  lastTs: string;
  lastId: string;
  updatedAt: string;
}

/** The dimension columns. Every one is present and every one defaults to ''. */
export interface UsageRollupDims {
  ownerGhii: string;
  actorGaii: string;
  appId: string;
  model: string;
  provider: string;
  surface: string;
  outcome: string;
  coordinate: string;
  counterpartyGhii: string;
}

/** The metric columns. All add on conflict except `durationMsMax`, which takes the greater. */
export interface UsageRollupMetrics {
  calls: number;
  errors: number;
  refusals: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  unpricedCalls: number;
  chargedUnits: number;
  durationMsSum: number;
  durationMsMax: number;
  /**
   * Distinct actors within ONE fold batch, summed across batches: an approximation from below,
   * because an actor seen in two batches counts twice as one each. Served with that caveat, and
   * never used for billing.
   */
  actorsSeen: number;
}

/** One delta the fold writes. `extra` merges additively by key, for a metric without a column yet. */
export interface UsageRollupDelta extends UsageRollupDims, UsageRollupMetrics {
  cut: string;
  grain: 'hour' | 'day';
  bucket: string;
  extra?: Record<string, number>;
}

/** One stored row. Identical to a delta plus its identity and freshness. */
export interface UsageRollupRow extends UsageRollupDims, UsageRollupMetrics {
  id: string;
  cut: string;
  grain: 'hour' | 'day';
  bucket: string;
  extra: Record<string, number>;
  updatedAt: string;
}

/**
 * How a read names what it wants. `cut` is required: a query that does not name its cut would scan
 * every cut in the table, which is the whole thing this layer exists to prevent.
 */
export interface UsageRollupFilter {
  cut: string;
  grain?: 'hour' | 'day';
  /** Inclusive bucket bounds, in the grain's own format. */
  from?: string;
  to?: string;
  /** Owner scoping. Absent means cross-owner and MUST be operator-gated by the caller. */
  ownerGhii?: string;
  appId?: string;
  actorGaii?: string;
  counterpartyGhii?: string;
  limit?: number;
}

/** What one archive sweep moved, per table. */
export interface UsageArchiveResult {
  usageCalls: number;
  usageEvents: number;
  hourRollupsPruned: number;
}
