/**
 * @file federation-availability.ts
 * @description Heartbeat-derived uptime/availability for federation peers (Phase B).
 *   The heartbeat job records each ping outcome (ok/fail) per peer; this module keeps
 *   lifetime counters plus a compact 30-day daily-bucket ring on the peer record and
 *   derives a coarse availability label: 'permanent' (reliable, ≥ threshold% over the
 *   window once a minimum sample is reached), 'temporary' (below threshold), or
 *   'unknown' (not enough samples yet). Buckets are one-per-day so the field stays tiny
 *   regardless of ping frequency, and the heartbeat already persists the peer row each
 *   cycle — so this piggybacks that write with no new table.
 * @structure recordHeartbeatOutcome(peer, ok, now, opts) — mutates peer in place
 *   AvailabilityOpts: { windowDays, permanentThreshold, minSamples }
 * @usage import { recordHeartbeatOutcome } from './federation-availability.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial uptime measurement (lifetime counters + daily buckets + label).
 */
import type { PeerInfo } from './federation.js';

export interface AvailabilityOpts {
  windowDays: number;
  permanentThreshold: number; // percent (0-100)
  minSamples: number;         // minimum total pings in window before a real label
}

interface DayBucket { d: string; ok: number; total: number }

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function parseWindow(raw: string | null | undefined): DayBucket[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { days?: DayBucket[] };
    return Array.isArray(parsed.days) ? parsed.days.filter(b => b && typeof b.d === 'string') : [];
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    return [];
  }
}

/**
 * Record one heartbeat outcome on a peer (mutates it in place). The caller persists the
 * peer afterwards (the heartbeat cycle already does). Returns the same peer for convenience.
 */
export function recordHeartbeatOutcome(peer: PeerInfo, ok: boolean, now: Date, opts: AvailabilityOpts): PeerInfo {
  peer.heartbeatTotal = (peer.heartbeatTotal ?? 0) + 1;
  if (ok) peer.heartbeatOk = (peer.heartbeatOk ?? 0) + 1;

  // Upsert today's bucket.
  const today = dayKey(now);
  const days = parseWindow(peer.availabilityWindow);
  let bucket = days.find(b => b.d === today);
  if (!bucket) { bucket = { d: today, ok: 0, total: 0 }; days.push(bucket); }
  bucket.total += 1;
  if (ok) bucket.ok += 1;

  // Trim to the window: drop buckets older than windowDays before today.
  const cutoffMs = now.getTime() - opts.windowDays * 86_400_000;
  const kept = days.filter(b => {
    const t = new Date(b.d + 'T00:00:00Z').getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  }).sort((a, b) => a.d.localeCompare(b.d));
  peer.availabilityWindow = JSON.stringify({ days: kept });

  // Compute % + label over the kept window.
  let okSum = 0, totalSum = 0;
  for (const b of kept) { okSum += b.ok; totalSum += b.total; }
  if (totalSum < opts.minSamples) {
    peer.availabilityPct = totalSum > 0 ? Math.round((okSum / totalSum) * 100) : null;
    peer.availability = 'unknown';
  } else {
    const pct = Math.round((okSum / totalSum) * 100);
    peer.availabilityPct = pct;
    peer.availability = pct >= opts.permanentThreshold ? 'permanent' : 'temporary';
  }
  return peer;
}
