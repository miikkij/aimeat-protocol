/**
 * @file drain.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first half of a stop: the HTTP server takes no new request, finishes the ones in
 *   flight, and lets the server close, before index-start.ts stops the background work, writes the
 *   buffers and exits 0.
 *
 *   WHY. Until 2026-11-04 the stop waited up to 4 s for scheduled runs while it still accepted new
 *   requests, then cut them; and an open live stream kept server.close() from ever finishing, so
 *   every stop left through the 5 s hard exit with code 1 (codebase analysis 2026-11-03, HA stage 1).
 *
 *   ORDER. Mark the process draining (GET /v1/health/ready answers 503), close the listening socket
 *   (a new connection is refused, so a load balancer tries the next process), answer every later
 *   request on an open connection with `Connection: close`, end the live notification streams
 *   (services/node-lifecycle.ts endOnDrain; the browser reconnects by itself), close idle
 *   keep-alive connections, and wait for the requests in flight up to the drain limit. Whatever is
 *   still open then is cut, and the caller goes on with the rest of the stop.
 * @structure
 *   - trackRequests(server) → { inFlight() } — counts the requests this server is answering
 *   - drainServer(server, tracker, opts) → { endedStreams, cut, waitedMs }
 * @usage const tracker = trackRequests(server); ... await drainServer(server, tracker, { timeoutMs: 5000 });
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 1: drain-first shutdown).
 */
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { markDraining, nodePhase, endDrainableStreams } from '../services/node-lifecycle.js';

export interface RequestTracker {
  /** Requests whose response has not finished, the registered live streams included until they end. */
  inFlight(): number;
}

/**
 * Count the requests the server is answering, and mark every response given while the process
 * drains with `Connection: close`, so a keep-alive connection carries no further request after it.
 * Attach right after listen(): it runs ahead of the application's own request handler.
 */
export function trackRequests(server: Server): RequestTracker {
  let open = 0;
  server.prependListener('request', (_req: IncomingMessage, res: ServerResponse) => {
    open++;
    let done = false;
    const finish = (): void => { if (!done) { done = true; open--; } };
    res.once('finish', finish);
    res.once('close', finish);
    if (nodePhase() === 'draining' && !res.headersSent) res.setHeader('Connection', 'close');
  });
  return { inFlight: () => open };
}

export interface DrainResult {
  /** Live notification streams ended at the start of the drain. */
  endedStreams: number;
  /** Requests still unfinished at the limit, whose connections were cut. */
  cut: number;
  waitedMs: number;
}

/** Stop taking requests, finish the ones in flight up to `timeoutMs`, cut the rest. Never throws. */
export async function drainServer(
  server: Server,
  tracker: RequestTracker,
  opts: { timeoutMs: number; pollMs?: number },
): Promise<DrainResult> {
  const started = Date.now();
  const pollMs = opts.pollMs ?? 100;
  markDraining();
  // The listening socket closes now; the callback runs once every connection has ended.
  const closed = new Promise<void>((resolve) => { server.close(() => resolve()); });
  const endedStreams = endDrainableStreams();
  server.closeIdleConnections();
  while (tracker.inFlight() > 0 && Date.now() - started < opts.timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    // A keep-alive connection becomes idle when its last response ends; close it then.
    server.closeIdleConnections();
  }
  const cut = tracker.inFlight();
  if (cut > 0) server.closeAllConnections();
  // Upgraded sockets (tunnels, realtime rooms) still count as the server's connections until their
  // managers close them later in the stop, so the close is awaited for a moment, not for ever.
  await Promise.race([closed, new Promise((r) => setTimeout(r, 500))]);
  return { endedStreams, cut, waitedMs: Date.now() - started };
}
