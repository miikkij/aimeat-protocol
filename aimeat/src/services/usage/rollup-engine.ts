/**
 * @file src/services/usage/rollup-engine.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fold: raw usage rows in, precomputed UsageRollup deltas out, incrementally and
 *   exactly once. Design: docs/internal/telemetria/02-design.md
 *
 *   EXACTLY-ONCE IS ONE PROPERTY IN ONE PLACE. The deltas and the watermark that accounts for them
 *   commit together (storage.advanceUsageRollup). A crash before that commit replays the same rows;
 *   a crash after it continues past them. Neither double-counts. Everything else here — batching,
 *   pass caps, the fact projection — is bookkeeping around that one guarantee, and none of it is
 *   allowed to advance the cursor on its own.
 *
 *   WHY A FACT IN THE MIDDLE. Each raw row becomes ONE fact carrying every dimension and every
 *   metric, and each cut then picks the dimensions it keys on. Without that step, twenty cuts means
 *   twenty places that each decide what "an error" is, and the day someone adds a metric, nineteen
 *   of them are still right and one is not.
 * @structure
 *   - runUsageRollup(storage) -- fold both streams; returns what it processed
 *   - foldStream(storage, stream) -- one stream, bounded passes
 *   - factOfCall / factOfEvent -- raw row to fact
 *   - accumulate(facts) -- facts to deltas, per declared cut and grain
 * @usage
 *   import { runUsageRollup } from './services/usage/rollup-engine.js';
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial: incremental, transactional fold over the llm and call streams.
 */
import type {
  Storage, UsageCallRecord, AgentUsageEvent, UsageRollupDelta,
} from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { cutsForStream, type UsageCut, type UsageDim } from './rollup-cuts.js';

/** Raw rows per pass. Small enough that one transaction stays short, large enough to catch up. */
const BATCH = Number(process.env.AIMEAT_USAGE_ROLLUP_BATCH) || 5_000;
/** Passes per run, so one run is bounded even after a long outage. The next run continues. */
const MAX_PASSES = Number(process.env.AIMEAT_USAGE_ROLLUP_PASSES) || 20;

/**
 * The separator inside an in-memory grouping key. A dimension value can contain a space, a slash or
 * a colon (`apptool:alice/app.html`, an owner GHII, a model id), so a printable separator would let
 * two DIFFERENT dimension tuples collide into one bucket and silently merge two rows' numbers. A
 * control character cannot appear in any of them. Written as an escape rather than a literal, so it
 * stays visible in an editor and the file stays text to grep.
 */
const DIM_SEPARATOR = '\u0000';

/** Every dimension and every metric one raw row contributes. Cuts pick from this; nothing else does. */
interface Fact {
  ts: string;
  ownerGhii: string;
  actorGaii: string;
  appId: string;
  model: string;
  provider: string;
  surface: string;
  outcome: string;
  coordinate: string;
  counterpartyGhii: string;
  calls: number;
  errors: number;
  refusals: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  unpricedCalls: number;
  chargedUnits: number;
  durationMs: number;
}

function factOfCall(r: UsageCallRecord): Fact {
  return {
    ts: r.ts,
    ownerGhii: r.ownerGhii,
    actorGaii: r.actorGaii,
    appId: r.appId,
    model: '', provider: '',
    surface: r.surface,
    outcome: r.outcome,
    coordinate: r.coordinate,
    counterpartyGhii: r.counterpartyGhii,
    calls: 1,
    // A refusal is the system working and an error is it failing. Counted apart on purpose: a
    // refusal is a demand signal, an error is a defect, and one number covering both is useless
    // for either.
    errors: r.outcome === 'error' ? 1 : 0,
    refusals: r.outcome === 'refused' ? 1 : 0,
    tokensIn: 0, tokensOut: 0, costUsd: 0, unpricedCalls: 0,
    chargedUnits: r.chargedUnits,
    durationMs: r.durationMs,
  };
}

function factOfEvent(e: AgentUsageEvent): Fact {
  return {
    ts: e.ts,
    ownerGhii: e.ownerGhii,
    actorGaii: e.agentGaii,
    appId: e.appId ?? '',
    model: e.model,
    provider: e.provider,
    surface: e.surface ?? '',
    outcome: 'ok',
    coordinate: '',
    // On a capability call the consumer is the other party; on an ordinary call there is none.
    counterpartyGhii: e.consumerGhii ?? '',
    calls: 1,
    errors: 0, refusals: 0,
    tokensIn: e.promptTokens,
    tokensOut: e.completionTokens,
    // null cost is NOT zero. It is a price we did not have, kept visible in its own counter rather
    // than silently averaged into a total that would then understate what the node actually spent.
    costUsd: e.costUsd ?? 0,
    unpricedCalls: e.costUsd === null ? 1 : 0,
    chargedUnits: 0,
    durationMs: 0,
  };
}

/** '2026-08-14' or '2026-08-14T13'. Both sort chronologically as plain text. */
function bucketOf(ts: string, grain: 'hour' | 'day'): string {
  return grain === 'day' ? ts.slice(0, 10) : ts.slice(0, 13);
}

/** The dimension values this cut keys on; everything outside the cut is '' (rolled over). */
function dimsFor(cut: UsageCut, fact: Fact): Record<UsageDim, string> {
  const out: Record<UsageDim, string> = {
    ownerGhii: '', actorGaii: '', appId: '', model: '', provider: '',
    surface: '', outcome: '', coordinate: '', counterpartyGhii: '',
  };
  for (const d of cut.dims) out[d] = fact[d];
  return out;
}

/** Accumulator that also tracks distinct actors, which a plain delta cannot express. */
interface Bucket { delta: UsageRollupDelta; actors: Set<string> }

/**
 * Turn facts into one delta per (cut, grain, bucket, dimension tuple). All in memory: a batch is
 * bounded, and doing it here means the database sees one upsert per distinct key rather than one
 * per raw row.
 */
function accumulate(facts: Fact[], stream: 'llm' | 'call'): UsageRollupDelta[] {
  const buckets = new Map<string, Bucket>();

  for (const fact of facts) {
    for (const cut of cutsForStream(stream)) {
      const dims = dimsFor(cut, fact);
      for (const grain of cut.grains) {
        const bucket = bucketOf(fact.ts, grain);
        const key = [cut.name, grain, bucket, dims.ownerGhii, dims.actorGaii, dims.appId,
          dims.model, dims.provider, dims.surface, dims.outcome, dims.coordinate,
          dims.counterpartyGhii].join(DIM_SEPARATOR);

        let entry = buckets.get(key);
        if (!entry) {
          entry = {
            delta: {
              cut: cut.name, grain, bucket, ...dims,
              calls: 0, errors: 0, refusals: 0, tokensIn: 0, tokensOut: 0, costUsd: 0,
              unpricedCalls: 0, chargedUnits: 0, durationMsSum: 0, durationMsMax: 0, actorsSeen: 0,
            },
            actors: new Set<string>(),
          };
          buckets.set(key, entry);
        }

        const d = entry.delta;
        d.calls += fact.calls;
        d.errors += fact.errors;
        d.refusals += fact.refusals;
        d.tokensIn += fact.tokensIn;
        d.tokensOut += fact.tokensOut;
        d.costUsd += fact.costUsd;
        d.unpricedCalls += fact.unpricedCalls;
        d.chargedUnits += fact.chargedUnits;
        d.durationMsSum += fact.durationMs;
        if (fact.durationMs > d.durationMsMax) d.durationMsMax = fact.durationMs;
        if (fact.actorGaii) entry.actors.add(fact.actorGaii);
      }
    }
  }

  // Distinct within THIS batch only. Across batches the storage layer adds, so the stored number
  // undercounts an actor active in two batches. That is why it is called actorsSeen rather than
  // actors, is served with the caveat attached, and is never used for billing.
  return [...buckets.values()].map(b => ({ ...b.delta, actorsSeen: b.actors.size }));
}

/**
 * The deltas a read would be missing because the fold has not run yet: everything after the
 * watermark, projected through the same cuts, plus the call rows still sitting in the write buffer.
 *
 * WHY A READ NEEDS THIS AT ALL. Without it the serving layer is up to one fold interval stale, and
 * an operator who just watched a spend happen would open the dashboard and see nothing. "It will
 * appear in five minutes" is not something a person accepts from a number they are accountable for.
 *
 * WHY IT IS NOT A SCAN. The tail is bounded by the fold interval, not by history: it reads from the
 * watermark forward with a hard limit, on the same (ts, id) index the fold uses. A node that has
 * been running for a year reads exactly as many rows here as one that started this morning.
 *
 * It reuses `accumulate`, so a top-up can never disagree with the fold about what a row means.
 */
export async function pendingRollupDeltas(
  storage: Storage,
  stream: 'llm' | 'call',
  bufferedCalls: UsageCallRecord[] = [],
): Promise<UsageRollupDelta[]> {
  const cursor = await storage.getUsageCursor(stream);
  const lastTs = cursor?.lastTs ?? '';
  const lastId = cursor?.lastId ?? '';

  const raw = stream === 'call'
    ? await storage.listUsageCallsForFold({ lastTs, lastId, limit: BATCH })
    : await storage.listUsageEventsForFold({ lastTs, lastId, limit: BATCH });

  const facts = stream === 'call'
    ? [...(raw as UsageCallRecord[]), ...bufferedCalls].map(factOfCall)
    : (raw as AgentUsageEvent[]).map(factOfEvent);
  if (facts.length === 0) return [];
  return accumulate(facts, stream);
}

export interface FoldResult { stream: 'llm' | 'call'; rows: number; deltas: number; passes: number }

/** Fold one stream forward from its watermark, in bounded passes. */
async function foldStream(storage: Storage, stream: 'llm' | 'call'): Promise<FoldResult> {
  const cursor = await storage.getUsageCursor(stream);
  let lastTs = cursor?.lastTs ?? '';
  let lastId = cursor?.lastId ?? '';
  let rows = 0, deltas = 0, passes = 0;

  for (; passes < MAX_PASSES; passes++) {
    const raw = stream === 'call'
      ? await storage.listUsageCallsForFold({ lastTs, lastId, limit: BATCH })
      : await storage.listUsageEventsForFold({ lastTs, lastId, limit: BATCH });
    if (raw.length === 0) break;

    const facts = stream === 'call'
      ? (raw as UsageCallRecord[]).map(factOfCall)
      : (raw as AgentUsageEvent[]).map(factOfEvent);
    const batchDeltas = accumulate(facts, stream);

    // The last row IN THE ORDER THE QUERY RETURNED, which is (ts, id) ascending. Taking a maximum
    // by ts alone would skip the tail of a tied timestamp on the next pass.
    const last = raw[raw.length - 1] as { ts: string; id: string };
    await storage.advanceUsageRollup({ stream, deltas: batchDeltas, lastTs: last.ts, lastId: last.id });

    lastTs = last.ts;
    lastId = last.id;
    rows += raw.length;
    deltas += batchDeltas.length;

    // A short batch means the stream is caught up. Stopping here rather than issuing one more empty
    // query is the difference between a quiet node doing one read per run and doing two.
    if (raw.length < BATCH) { passes++; break; }
  }

  return { stream, rows, deltas, passes };
}

/**
 * Fold both streams. Called on a schedule; safe to call concurrently with itself only in the sense
 * that the transaction protects correctness — a second overlapping run wastes work rather than
 * corrupting anything, because it reads the cursor the first one has already advanced.
 */
export async function runUsageRollup(storage: Storage): Promise<FoldResult[]> {
  const results: FoldResult[] = [];
  for (const stream of ['llm', 'call'] as const) {
    try {
      const r = await foldStream(storage, stream);
      results.push(r);
      if (r.rows > 0) {
        logger.info('usage-rollup: folded', {
          stream, rows: r.rows, deltas: r.deltas, passes: r.passes,
        });
      }
      if (r.passes >= MAX_PASSES) {
        // Not an error: the cap did its job. Worth saying, because it means the serving layer is
        // further behind than the run interval suggests and someone reading a chart should know.
        logger.warn('usage-rollup: hit the pass cap, still catching up', { stream, rows: r.rows });
      }
    } catch (err) {
      // One stream failing must not stop the other, and neither may advance a cursor it did not
      // account for — which advanceUsageRollup guarantees, so there is nothing to undo here.
      logger.warn('usage-rollup: stream failed, cursor unchanged', { stream, error: String(err) });
      results.push({ stream, rows: 0, deltas: 0, passes: 0 });
    }
  }
  return results;
}

/**
 * Rebuild a bucket range from raw. Deletes the range first BECAUSE THE FOLD ADDS: re-folding onto
 * existing rows would double every number in the window rather than correcting it. Then rewinds the
 * cursors and lets the ordinary fold refill.
 *
 * Only reaches as far back as the hot window: raw older than that is in the archive, which this
 * does not read. A rebuild across the archive boundary therefore produces a correct recent range
 * and leaves the older buckets deleted, so the caller is given the boundary rather than discovering
 * it as a hole in a chart.
 */
export async function rebuildUsageRollup(
  storage: Storage,
  args: { from: string; grain?: 'hour' | 'day' },
): Promise<{ cleared: number; folded: FoldResult[] }> {
  const cleared = await storage.clearUsageRollupRange({ from: args.from, grain: args.grain });
  // Rewind to the START of the day being rebuilt, not to the bucket string: the cursor compares
  // against an ISO timestamp, and '2026-08-14' sorts before every '2026-08-14T..' on that day.
  const rewindTo = `${args.from.slice(0, 10)}T00:00:00.000Z`;
  await storage.setUsageCursor('llm', rewindTo, '');
  await storage.setUsageCursor('call', rewindTo, '');
  const folded = await runUsageRollup(storage);
  return { cleared, folded };
}
