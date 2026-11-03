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
 * @usage if (nodePhase() !== 'ready') res.status(503)...
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: liveness and readiness).
 */

export type NodePhase = 'starting' | 'ready' | 'draining';

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
