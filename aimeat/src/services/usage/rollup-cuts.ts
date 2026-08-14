/**
 * @file src/services/usage/rollup-cuts.ts
 * @description THE EXTENSION POINT. A "cut" is one named dimension set the fold materialises, and
 *   adding a report to this system means adding an entry here plus a backfill. No migration, no
 *   repository method, no provider pair, no new route.
 *   Design: docs/internal/telemetria/02-design.md
 *
 *   WHY DECLARED CUTS RATHER THAN EVERY COMBINATION. Nine dimensions crossed with each other is a
 *   row count nobody can reason about and an index nobody can use. Declaring the twenty slices the
 *   product actually asks for keeps the table bounded by real cardinality: the largest,
 *   call.owner.tool, is (active owners x tools they actually called) per day.
 *
 *   WHY GRAINS ARE PER-CUT. Hour grain is for a live dashboard and multiplies a cut's rows by 24.
 *   Only the two cuts that back a live view carry it; the rest are day-only, and the archive job
 *   prunes hour rows at 30 days while day rows are kept indefinitely.
 *
 *   ADDING A CUT: append it, then run POST /v1/admin/usage/rollup/rebuild so history exists for it.
 *   Without the rebuild the new cut is correct from today forward and empty before that, which
 *   looks exactly like "this feature was never used" on a chart.
 * @structure
 *   - UsageDim / UsageCut / CUTS
 *   - cutsForStream(stream) · findCut(name)
 * @usage
 *   import { CUTS, cutsForStream } from './rollup-cuts.js';
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: twenty cuts over the llm and call streams.
 */

/** The dimension columns a cut may key on. Every one exists on UsageRollup and defaults to ''. */
export type UsageDim =
  | 'ownerGhii'
  | 'actorGaii'
  | 'appId'
  | 'model'
  | 'provider'
  | 'surface'
  | 'outcome'
  | 'coordinate'
  | 'counterpartyGhii';

export interface UsageCut {
  /** Stable name, stored in the row. Renaming one orphans its history — add a new one instead. */
  name: string;
  /** Which raw stream feeds it. */
  stream: 'llm' | 'call';
  /** The dimensions this cut is keyed by. Everything else is rolled over and stored as ''. */
  dims: UsageDim[];
  grains: Array<'hour' | 'day'>;
  /** What question this answers, so the list stays readable as it grows. */
  answers: string;
}

const DAY: Array<'hour' | 'day'> = ['day'];
const LIVE: Array<'hour' | 'day'> = ['hour', 'day'];

export const CUTS: UsageCut[] = [
  // ── LLM spend ──────────────────────────────────────────────────────────────────────────────
  { name: 'llm.node', stream: 'llm', dims: [], grains: LIVE,
    answers: 'node-wide LLM spend over time' },
  { name: 'llm.owner', stream: 'llm', dims: ['ownerGhii'], grains: LIVE,
    answers: 'per-user spend; the operator top-spenders list' },
  { name: 'llm.model', stream: 'llm', dims: ['model', 'provider'], grains: DAY,
    answers: 'which models are used most, node-wide, and where they ran' },
  { name: 'llm.owner.model', stream: 'llm', dims: ['ownerGhii', 'model', 'provider'], grains: DAY,
    answers: 'which models THIS person uses most' },
  { name: 'llm.actor', stream: 'llm', dims: ['ownerGhii', 'actorGaii'], grains: DAY,
    answers: 'per-agent spend' },
  { name: 'llm.app', stream: 'llm', dims: ['appId'], grains: DAY,
    answers: 'which app burns the most tokens, node-wide' },
  { name: 'llm.owner.app', stream: 'llm', dims: ['ownerGhii', 'appId'], grains: DAY,
    answers: 'this person spend per app' },
  { name: 'llm.app.model', stream: 'llm', dims: ['appId', 'model', 'provider'], grains: DAY,
    answers: 'which model an app actually calls — impossible before appId reached the ledger' },

  // ── Calls ──────────────────────────────────────────────────────────────────────────────────
  { name: 'call.node', stream: 'call', dims: [], grains: LIVE,
    answers: 'total call volume and error rate' },
  { name: 'call.owner', stream: 'call', dims: ['ownerGhii'], grains: LIVE,
    answers: 'per-user activity' },
  { name: 'call.surface', stream: 'call', dims: ['surface', 'outcome'], grains: DAY,
    answers: 'is MCP or the web carrying the work' },
  { name: 'call.owner.surface', stream: 'call', dims: ['ownerGhii', 'surface', 'outcome'], grains: DAY,
    answers: 'how this person actually works' },
  { name: 'call.tool', stream: 'call', dims: ['surface', 'coordinate', 'outcome'], grains: DAY,
    answers: 'which tool is used, which fails, which nobody has ever called' },
  { name: 'call.owner.tool', stream: 'call', dims: ['ownerGhii', 'surface', 'coordinate'], grains: DAY,
    answers: 'the operator drill into one person tool use' },
  { name: 'call.app', stream: 'call', dims: ['appId', 'outcome'], grains: DAY,
    answers: 'which app is alive' },
  { name: 'call.owner.app', stream: 'call', dims: ['ownerGhii', 'appId'], grains: DAY,
    answers: 'who uses which app' },
  { name: 'call.actor', stream: 'call', dims: ['ownerGhii', 'actorGaii'], grains: DAY,
    answers: 'per-agent and per-app-grant activity' },
  { name: 'call.provider.coordinate', stream: 'call',
    dims: ['counterpartyGhii', 'coordinate', 'outcome'], grains: DAY,
    answers: 'what a seller sold and what they refused; also an app author own traffic' },
];

const BY_STREAM = new Map<'llm' | 'call', UsageCut[]>([
  ['llm', CUTS.filter(c => c.stream === 'llm')],
  ['call', CUTS.filter(c => c.stream === 'call')],
]);

export function cutsForStream(stream: 'llm' | 'call'): UsageCut[] {
  return BY_STREAM.get(stream) ?? [];
}

export function findCut(name: string): UsageCut | undefined {
  return CUTS.find(c => c.name === name);
}
