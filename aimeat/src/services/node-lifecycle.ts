/**
 * @file node-lifecycle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where this process is in its life: starting, ready to take requests, or draining on
 *   its way out. GET /v1/health/ready answers from it (routes/health.ts), so a load balancer or a
 *   process manager sends traffic only to a process that has finished its boot and is not stopping,
 *   and the shutdown in index-start.ts marks the process draining before anything else.
 *
 *   Process-local by nature: the question is about this process, and a second process answers for
 *   itself.
 * @structure
 *   - nodePhase() — 'starting' | 'ready' | 'draining'
 *   - markReady() — the boot finished (server.ts createServer, after the routes are mounted)
 *   - markDraining() — a stop began; the phase never goes back to ready
 *   - endOnDrain(res) / endDrainableStreams() — the live streams a stop ends at once
 * @usage if (nodePhase() !== 'ready') res.status(503)...
 * @version-history
 *   v1.1.0 — 2026-11-04 — endOnDrain(): the live notification streams the drain ends first, so the
 *     server can close (HA stage 1: drain-first shutdown).
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: liveness and readiness).
 */

import { logger } from '../utils/logger.js';

export type NodePhase ='starting' | 'ready' | 'draining';

// process-local: each process answers its own readiness; nothing to share.
let phase: NodePhase = 'starting';

export function nodePhase(): NodePhase {
  return phase;
}

/** The boot finished: storage is migrated, the services are up and the routes are mounted. */
export function markReady(): void {
  if (phase === 'starting') phase = 'ready';
}

/** A stop began. Readiness answers 503 from here on, and a later markReady() does not undo it. */
export function markDraining(): void {
  phase = 'draining';
}

// process-local: the open live streams of this process, ended when this process drains.
const drainableStreams = new Set<{ end(): unknown; once(event: 'close', fn: () => void): unknown }>();

/**
 * A long-lived notification stream (the SPA's live stream, the public activity stream) that a stop
 * may end at once: the client reconnects by itself, to another process or to this node when it
 * is back. Work answered as a stream (a chat turn, a model's answer) is NOT registered here; it is
 * an in-flight request and gets the drain's wait.
 */
export function endOnDrain(res: { end(): unknown; once(event: 'close', fn: () => void): unknown }): void {
  drainableStreams.add(res);
  res.once('close', () => { drainableStreams.delete(res); });
}

/** End every registered stream. Answers how many it ended. */
export function endDrainableStreams(): number {
  const open = [...drainableStreams];
  drainableStreams.clear();
  for (const res of open) {
    try { res.end(); } catch (err) {
      // The socket went first; nothing is left to end.
      logger.debug('node-lifecycle: a live stream was already gone at the drain', { error: String(err) });
    }
  }
  return open.length;
}
