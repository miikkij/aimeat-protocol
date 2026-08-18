/**
 * @file src/services/call-timing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How long a capability actually takes to answer, measured per (ext, action) coordinate so
 *   a provider can commit to a service level from EVIDENCE instead of a guess.
 *
 *   An SLA typed from imagination is worse than no SLA: it is a promise the provider has no reason to
 *   believe they can keep, and a buyer has no reason to trust. The honest sequence is the other way
 *   round — serve real calls, measure them, then commit to a number with headroom over what was measured.
 *   That is what this file supplies: the measurement. The commitment stays a human act.
 *
 *   Durations vary enormously by capability (a register lookup answers in tens of milliseconds, an LLM
 *   call can take half a minute), so the number that matters is per-capability p95, never a node-wide
 *   average. Timings buffer in memory and flush on an interval — the same shape the telemetry buffer
 *   uses — so a metered call never pays for an extra write.
 * @structure recordCallDuration · readCallTiming · timingKey · flushCallTimings
 * @usage
 *   const started = Date.now();
 *   ... invoke ...
 *   recordCallDuration(storage, providerGhii, ext, action, Date.now() - started);
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial: measure so an ODPS service commitment can be proposed from data.
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** The public record a coordinate's timings live in, under the PROVIDER's GHII. */
export function timingKey(ext: string, action: string): string {
  return `exchange.timing.${ext}.${action}`;
}

/** What a buyer (and the provider's own editor) can read about a capability's observed speed. */
export interface CallTiming {
  /** Calls actually timed. Not the same as billed calls: only successful invokes are measured. */
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** The most recent durations, kept bounded so percentiles stay recomputable without a metrics store. */
  samples: number[];
  updatedAt: string;
}

const SAMPLE_CAP = 200;
const FLUSH_MS = 60_000;

interface Pending { providerGhii: string; ext: string; action: string; durations: number[] }
const pending = new Map<string, Pending>();
let timer: NodeJS.Timeout | null = null;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
}

/**
 * Buffer one observed duration. Never awaited by the call path: a slow or failing metrics write must
 * not slow down, or fail, the call it is measuring.
 */
export function recordCallDuration(storage: Storage, providerGhii: string, ext: string, action: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const k = `${providerGhii}|${ext}|${action}`;
  const entry = pending.get(k) ?? { providerGhii, ext, action, durations: [] };
  entry.durations.push(Math.round(ms));
  pending.set(k, entry);
  if (!timer) {
    timer = setInterval(() => { void flushCallTimings(storage); }, FLUSH_MS);
    timer.unref?.();
  }
}

/** Merge the buffer into the stored records. Safe to call at any time; a failure only loses samples. */
export async function flushCallTimings(storage: Storage): Promise<void> {
  if (!pending.size) return;
  const batch = [...pending.values()];
  pending.clear();
  for (const item of batch) {
    try {
      const key = timingKey(item.ext, item.action);
      const existing = (await storage.getMemory(item.providerGhii, key))?.value as CallTiming | undefined;
      const samples = [...(existing?.samples ?? []), ...item.durations].slice(-SAMPLE_CAP);
      const sorted = [...samples].sort((a, b) => a - b);
      const now = new Date().toISOString();
      const value: CallTiming = {
        count: (existing?.count ?? 0) + item.durations.length,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        maxMs: Math.max(existing?.maxMs ?? 0, ...item.durations),
        samples,
        updatedAt: now,
      };
      await storage.setMemory({
        key, ownerGaii: item.providerGhii, value, visibility: 'public',
        tags: ['exchange', 'timing'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      });
    } catch (err) {
      logger.warn('[call-timing] could not flush timings', { ext: item.ext, action: item.action, error: String(err) });
    }
  }
}

/**
 * Read what has been measured for a coordinate, INCLUDING durations still sitting in the buffer.
 * Reader and recorder share a process, so there is no reason to make a provider wait out a flush
 * interval to see the call they just made: an empty measurement they cannot explain is exactly the
 * kind of thing that makes a UI look broken.
 */
export async function readCallTiming(storage: Storage, providerGhii: string, ext: string, action: string): Promise<CallTiming | null> {
  let stored: CallTiming | null;
  try {
    stored = ((await storage.getMemory(providerGhii, timingKey(ext, action)))?.value as CallTiming | undefined) ?? null;
  } catch (err) {
    logger.warn('call-timing: suppressed failure, continuing', { error: String(err) });
    stored = null;
  }
  const buffered = pending.get(`${providerGhii}|${ext}|${action}`)?.durations ?? [];
  if (!buffered.length) return stored;
  const samples = [...(stored?.samples ?? []), ...buffered].slice(-SAMPLE_CAP);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: (stored?.count ?? 0) + buffered.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: Math.max(stored?.maxMs ?? 0, ...buffered),
    samples,
    updatedAt: new Date().toISOString(),
  };
}
