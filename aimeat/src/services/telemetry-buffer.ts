/**
 * @file telemetry-buffer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description In-memory accumulator for high-frequency agent signals (raw telemetry
 *   events, telemetry-derived activity counters, and heartbeat lastSeen timestamps),
 *   flushed to storage on a fixed interval instead of per request. This decouples the
 *   write rate from the agent signal rate: N agents reporting K events/sec produce at
 *   most one getAgent + one updateAgent + a handful of recordActivity upserts per agent
 *   per flush window, and ZERO unbounded raw-event rows.
 *
 *   Design rationale: the raw `telemetry_events` table was append-only with no retention
 *   and was never read for business logic (only ad-hoc dashboard listing, an onboarding
 *   existence check, and a 7-day continuity score derivable from agent_activity). With
 *   48+ agents streaming telemetry it dominated DB memory/CPU. We keep only a bounded
 *   in-memory ring per agent for the dashboard list; the refined agent_activity time
 *   series and embedded activityStats remain the persisted source of truth.
 * @structure
 *   - initTelemetryBuffer(storage)   -- wire storage + start the flush interval
 *   - shutdownTelemetryBuffer()      -- stop the interval + final flush (graceful exit)
 *   - pushTelemetry(event)           -- buffer a raw event in the per-agent ring (no DB)
 *   - recordTelemetryActivity(...)   -- accumulate telemetry_events/tokens/ai_calls deltas
 *   - markAgentSeen(gaii, iso)       -- accumulate a heartbeat lastSeen (no DB)
 *   - listTelemetryBuffered(...)     -- read the ring for GET /telemetry
 *   - bufferedTelemetryCount(gaii)   -- existence check for onboarding validation
 *   - flushTelemetryBuffer()         -- write accumulated deltas to storage
 * @usage
 *   import { pushTelemetry, recordTelemetryActivity } from './telemetry-buffer.js';
 * @version-history
 *   v1.0.0 -- 2026-06-21 -- Initial: move per-request telemetry + heartbeat writes to a
 *                            60s batched flush; stop persisting raw telemetry_events rows.
 */
import type { Storage, TelemetryEvent, AgentActivityStats } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { emitChange } from './event-bus.js';

/** Flush cadence. Dashboards reading agent_activity / lastSeen are at most this stale. */
const FLUSH_INTERVAL_MS = 60_000;
/** Bounded ring size per agent for the dashboard telemetry list. Older events drop. */
const MAX_RING_PER_AGENT = 200;

interface StatsDelta { tokens: number; aiCalls: number }

let storageRef: Storage | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

/** Bounded per-agent ring of recent raw telemetry events (newest pushed last). */
const ring = new Map<string, TelemetryEvent[]>();
/** Summed activity deltas keyed `${gaii}\0${date}\0${hour}\0${metric}`. */
let activityDeltas = new Map<string, number>();
/** Summed telemetry-derived activityStats deltas, per agent. */
let statsDeltas = new Map<string, StatsDelta>();
/** Latest heartbeat timestamp per agent (overwrite — only the newest matters). */
let lastSeen = new Map<string, string>();

/** Push a raw telemetry event into the bounded per-agent ring. No DB write. */
export function pushTelemetry(event: TelemetryEvent): void {
  let events = ring.get(event.agentGaii);
  if (!events) {
    events = [];
    ring.set(event.agentGaii, events);
  }
  events.push(event);
  if (events.length > MAX_RING_PER_AGENT) {
    events.splice(0, events.length - MAX_RING_PER_AGENT);
  }
}

function addActivityDelta(gaii: string, date: string, hour: number, metric: string, value: number): void {
  const key = `${gaii}\0${date}\0${hour}\0${metric}`;
  activityDeltas.set(key, (activityDeltas.get(key) ?? 0) + value);
}

/**
 * Accumulate the activity counters a telemetry event implies. Mirrors the former
 * synchronous recordTelemetryEvent: always bumps 'telemetry_events'; for llm_call with
 * token data also accumulates 'tokens_used'/'ai_calls' and the embedded activityStats
 * deltas. All accumulation is in-memory; the flush performs the actual storage writes.
 *
 * Tolerant about field names: agents send { tokens_in, tokens_out } or { tokens_used }.
 */
export function recordTelemetryActivity(gaii: string, event: { type: string; data: Record<string, unknown> }): void {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const hour = now.getUTCHours();

  addActivityDelta(gaii, date, hour, 'telemetry_events', 1);

  if (event.type !== 'llm_call') return;

  const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0);
  const tokensIn = num(event.data.tokens_in);
  const tokensOut = num(event.data.tokens_out);
  const tokensUsedExplicit = num(event.data.tokens_used);
  const totalTokens = tokensUsedExplicit > 0 ? tokensUsedExplicit : tokensIn + tokensOut;

  if (totalTokens > 0) {
    addActivityDelta(gaii, date, hour, 'tokens_used', totalTokens);
  }
  addActivityDelta(gaii, date, hour, 'ai_calls', 1);

  const sd = statsDeltas.get(gaii) ?? { tokens: 0, aiCalls: 0 };
  sd.tokens += totalTokens;
  sd.aiCalls += 1;
  statsDeltas.set(gaii, sd);
}

/** Record a heartbeat. Only the newest timestamp per agent is kept. No DB write. */
export function markAgentSeen(gaii: string, iso: string): void {
  lastSeen.set(gaii, iso);
}

/**
 * Read the per-agent ring for GET /telemetry. Matches the former storage.listTelemetry
 * semantics: `since` is a strict lower bound on createdAt, optional exact type filter,
 * newest-first, capped at limit.
 */
export function listTelemetryBuffered(
  gaii: string,
  opts: { since?: string; type?: string; limit?: number },
): TelemetryEvent[] {
  const events = ring.get(gaii) ?? [];
  const limit = opts.limit ?? 50;
  return events
    .filter(e => (opts.since ? e.createdAt > opts.since : true))
    .filter(e => (opts.type ? e.type === opts.type : true))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, limit);
}

/** Number of buffered events for an agent (onboarding existence check). */
export function bufferedTelemetryCount(gaii: string): number {
  return ring.get(gaii)?.length ?? 0;
}

/** Drop all in-memory state for a deleted agent (called from agent deletion paths). */
export function evictAgentTelemetry(gaii: string): void {
  ring.delete(gaii);
  statsDeltas.delete(gaii);
  lastSeen.delete(gaii);
  for (const key of activityDeltas.keys()) {
    if (key.startsWith(`${gaii}\0`)) activityDeltas.delete(key);
  }
}

/**
 * Write all accumulated deltas to storage. Snapshot-and-clear up front so events arriving
 * mid-flush accumulate for the next window (at-most-once: a transient storage error drops
 * that window's delta rather than risking a double count). Best-effort by design — the
 * caller accepts up to one flush window of metric loss on crash.
 */
export async function flushTelemetryBuffer(): Promise<void> {
  if (!storageRef || flushing) return;
  flushing = true;
  const storage = storageRef;

  const deltas = activityDeltas; activityDeltas = new Map();
  const stats = statsDeltas; statsDeltas = new Map();
  const seen = lastSeen; lastSeen = new Map();

  let wrote = false;
  try {
    // 1. Refined activity time series (upsert-increment per agent/date/hour/metric).
    for (const [key, value] of deltas) {
      const [agentGaii, date, hourStr, metric] = key.split('\0');
      try {
        await storage.recordActivity({ agentGaii, date, hour: Number(hourStr), metric, value });
        wrote = true;
      } catch (err) {
        logger.warn('telemetry flush: recordActivity failed', { key, error: String(err) });
      }
    }

    // 2. Per-agent patch: heartbeat lastSeen + embedded activityStats token/call deltas.
    //    One getAgent (only when stats need merging) + one updateAgent per agent.
    const agents = new Set<string>([...seen.keys(), ...stats.keys()]);
    for (const gaii of agents) {
      try {
        const patch: { lastSeen?: string; activityStats?: AgentActivityStats } = {};
        if (seen.has(gaii)) patch.lastSeen = seen.get(gaii);

        const sd = stats.get(gaii);
        if (sd && (sd.tokens > 0 || sd.aiCalls > 0)) {
          const agent = await storage.getAgent(gaii);
          if (!agent) continue; // agent deleted mid-window — drop its deltas
          const ex = agent.activityStats;
          patch.activityStats = {
            tasksCompleted: ex?.tasksCompleted ?? 0,
            tasksFailed: ex?.tasksFailed ?? 0,
            tokensUsed30d: (ex?.tokensUsed30d ?? 0) + sd.tokens,
            aiCalls30d: (ex?.aiCalls30d ?? 0) + sd.aiCalls,
            successRate: ex?.successRate ?? 0,
            lastTaskAt: ex?.lastTaskAt,
            extensionsCreated: ex?.extensionsCreated ?? 0,
            appsPublished: ex?.appsPublished ?? 0,
          };
        }

        if (patch.lastSeen !== undefined || patch.activityStats !== undefined) {
          await storage.updateAgent(gaii, patch);
          wrote = true;
        }
      } catch (err) {
        logger.warn('telemetry flush: agent patch failed', { gaii, error: String(err) });
      }
    }
  } finally {
    flushing = false;
  }

  // One coalesced SSE nudge per flush instead of one per request.
  if (wrote) emitChange('agents');
}

/** Wire storage and start the flush interval. Idempotent. */
export function initTelemetryBuffer(storage: Storage): void {
  storageRef = storage;
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushTelemetryBuffer(); }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive solely for the flush timer (matters for in-process tests).
  flushTimer.unref?.();
}

/** Stop the interval and perform one final flush. Called from graceful shutdown. */
export async function shutdownTelemetryBuffer(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushTelemetryBuffer();
}
