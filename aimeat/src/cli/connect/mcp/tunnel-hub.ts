/**
 * @file tunnel-hub.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One WebSocket per NODE, carrying every identity that node serves.
 *
 *   A `connect serve` used to open one socket per registered agent: 38 TCP connections to one node
 *   from one machine, measured 2026-08-31, growing with the number of agents rather than with the
 *   number of nodes. Four owners with three agents each was twelve connections where the model said
 *   one. This is the bookkeeping that makes it one.
 *
 *   THE SOCKET BELONGS TO THE NODE, NOT TO AN AGENT. Keyed by node_url, because that is the
 *   connection's actual identity: two owners served by one node share a socket, and one owner with
 *   agents on two nodes has two — which is right, those are connections to two different places.
 *
 *   THE FIRST IDENTITY OPENS IT and its credential authenticates the upgrade; every later one
 *   proves its own in an `attach` frame, so riding a socket someone else opened grants nothing.
 *
 *   AN OLDER NODE IS NOT AN ERROR. `hubFor` answers null when the node does not advertise
 *   multiplex, and the caller opens a private socket exactly as before. Nobody chooses a version.
 *
 * @structure TunnelHub — hubFor() · join() · owns() · release() · retire() · socketCount; rehome()
 * @usage const hub = await hubs.hubFor(entry, identity);
 * @version-history
 *   v1.2.0 — 2026-10-11 — retire() and rehome(): when the identity that opened the shared socket
 *     loses its credential, the other identities get a new socket and keep their channels. They
 *     read `stopped` until a restart.
 *   v1.1.0 — 2026-09-05 — The hub client is built with the opener's own `gaii`, so a frame for an
 *     identity it has since evicted is dropped rather than landing on these handlers by default —
 *     which is how one owner's task reached another owner's queue.
 *   v1.0.0 — 2026-09-03 — Initial, extracted from local-server.ts (wish-tunnel-one-socket-many-agents).
 */
import { ConnectTunnelClient, type TunnelIdentity } from '../tunnel-client.js';
import type { RegisteredAgent } from '../agent-registry.js';
import { logger } from '../../../utils/logger.js';

/** What release() needs of a tunnel, so it accepts a shared hub and a private client alike. */
type TunnelLike = { detachIdentity(gaii: string): void; close(): Promise<void> };

/**
 * THE STATUS OF ONE IDENTITY, WHICH IS NOT THE STATUS OF ITS SOCKET.
 *
 * `tunnel.getStatus()` answers for the CONNECTION, and on a shared socket that connection is
 * perfectly healthy while one identity riding it has had its credential refused. Reporting the
 * socket's word made a deleted agent read `online` on /local/status — caught by the loopback
 * suite's own assertion, which exists because this surface lying about a dead credential has cost
 * an afternoon before. The identity's own verdict wins wherever it has one.
 */
export function statusOfIdentity(ch: { transportMode: string; tunnel?: { getStatus(): string } | null } | undefined): string | null {
  if (!ch) return null;
  if (ch.transportMode === 'auth_failed') return 'auth_failed';
  return ch.tunnel?.getStatus() ?? null;
}

/**
 * One row of the principals projection, which serve.json and /local/status BOTH carry.
 *
 * Two copies of one shape is how the `id` field kept the bare agent name after it was documented to
 * be the GAII: the fix landed in one copy. It is one function now, so the next change reaches both.
 */
export function principalRow(e: { gaii: string; agent: string; owner: string; config: { node_url: string } },
                             ch: { transportMode: string; tunnel?: { getStatus(): string } | null } | undefined) {
  return {
    type: e.agent.startsWith('eco:') ? 'ecosystem' : 'agent',
    id: e.gaii,
    owner: e.owner,
    node_url: e.config.node_url,
    transport: ch?.transportMode ?? null,
    tunnel_status: statusOfIdentity(ch),
  };
}

export class TunnelHub {
  private byNode = new Map<string, ConnectTunnelClient>();
  private owners = new Map<string, { entry: RegisteredAgent; hub: ConnectTunnelClient }>();

  /**
   * The socket for this node, opened on the FIRST identity that needs it.
   *
   * Returns null when there is no shared socket to join — an older node, or a socket that failed to
   * come up — and the caller then opens a private one, which is what every agent did before this.
   */
  async hubFor(entry: RegisteredAgent, handlers: TunnelIdentity): Promise<ConnectTunnelClient | null> {
    const url = entry.config.node_url;
    const existing = this.byNode.get(url);
    if (existing) return existing.supportsMultiplex() ? existing : null;

    const hub = new ConnectTunnelClient({
      nodeUrl: url,
      // The opener's own identity, so the client can tell a frame for itself from a frame for an
      // identity it has since evicted. Without this the two were the same miss on the same map and
      // both landed on these handlers — one owner's task in another owner's queue.
      gaii: entry.gaii,
      getToken: handlers.getToken,
      label: `tunnel:${url}`,
      onDeliver: handlers.onDeliver,
      onInvoke: handlers.onInvoke,
      onBacklog: handlers.onBacklog,
      onConnect: handlers.onConnect,
      onAuthFailure: handlers.onAuthFailure,
    });
    const outcome = await hub.start();
    if (outcome !== 'online') return null;
    this.owners.set(url, { entry, hub });
    if (!hub.supportsMultiplex()) {
      // An older node. This is a working single-agent tunnel for the identity that opened it, so it
      // is kept and used — it is simply not registered as a hub, and the next agent opens its own.
      return null;
    }
    this.byNode.set(url, hub);
    return hub;
  }

  /**
   * Put this identity on its node's shared socket, opening that socket if it is the first.
   *
   * Answers the client to use and WHO to stamp on its frames — undefined for the identity that
   * opened the socket, because its frames are the socket's own and a node that does not multiplex
   * expects exactly that. Null means there is no shared socket to join and the caller should open a
   * private one, which is what every agent did before this change.
   */
  async join(entry: RegisteredAgent, identity: TunnelIdentity): Promise<{ client: ConnectTunnelClient; who?: string } | null> {
    const hub = await this.hubFor(entry, identity);
    if (!hub) return null;
    // The identity that OPENED the socket is already on it — its credential authenticated the
    // upgrade — so it attaches nothing and simply uses the connection.
    if (this.owns(entry)) return { client: hub };
    if (await hub.attachIdentity(identity)) return { client: hub, who: entry.gaii };
    console.error(`[serve] ${entry.agent}@${entry.owner}: could not join the shared tunnel — opening its own`);
    return null;
  }

  /** Did this identity OPEN its node's socket? If so it is already on it and attaches nothing. */
  owns(entry: RegisteredAgent): boolean {
    return this.owners.get(entry.config.node_url)?.entry.gaii === entry.gaii;
  }

  /**
   * Forget one identity's place on whatever socket it had.
   *
   * ONE IDENTITY OFF A SHARED SOCKET, or the whole socket if that identity had one to itself. A
   * hub's socket is never closed here: it belongs to the node, and every other agent served by that
   * node is on it.
   */
  release(client: TunnelLike | null | undefined, gaii: string): void {
    if (!client) return;
    if ([...this.byNode.values()].includes(client as ConnectTunnelClient)) { client.detachIdentity(gaii); return; }
    void client.close().catch((err: unknown) => logger.warn('tunnel-hub release: ignore', { error: String(err) }));
  }

  /**
   * The identity that OPENED its node's socket has lost its credential.
   *
   * The client stops when that happens, by design: the upgrade stood on that credential, and a
   * reconnect would present it again. So the socket is forgotten here, and the next join opens a new
   * one on another identity's credential. Answers the stopped client when this identity was the
   * opener, null when it only rode the socket (the client detached it alone, and nothing else moved).
   */
  retire(entry: RegisteredAgent): ConnectTunnelClient | null {
    const url = entry.config.node_url;
    const own = this.owners.get(url);
    if (!own || own.entry.gaii !== entry.gaii) return null;
    this.owners.delete(url);
    this.byNode.delete(url);
    return own.hub;
  }

  /** How many sockets this daemon holds upstream. The number the whole change is about. */
  get socketCount(): number { return this.byNode.size; }
}

/** What rehome() needs of a channel: the socket it is on, and what it had subscribed to there. */
interface RidingChannel {
  tunnel?: unknown;
  getSubscriptions(): unknown[];
}

/**
 * Every identity that rode a socket whose opener lost its credential gets a new socket.
 *
 * WHY THIS EXISTS. One agent's dead credential must stop that agent and nobody else. That held for
 * an identity that JOINED a shared socket and failed for the one that OPENED it: the client stopped,
 * and every other agent of that connector read `stopped` until the daemon was restarted. Deleting a
 * connector's first agent did it, and so does moving that agent to another connector, which an owner
 * now does from their home page (measured with a real daemon on 2026-10-11:
 * test/e2e-connect-serve-loopback.ts, "Losing the agent that opened the shared socket").
 *
 * EACH KEEPS ITS CHANNEL. `attach` is given the channel the identity already has, so a runtime
 * parked on a long-poll, the queued deliveries and the subscriptions are the same objects afterwards;
 * only the socket under them is new. One after another, because the first to attach opens the
 * socket the others join. The subscriptions are sent again: they die with the socket they were on.
 */
export async function rehome<E extends { gaii: string; agent: string; owner: string }, C extends RidingChannel>(
  stopped: unknown, lost: string, entries: E[], channelOf: (gaii: string) => C | undefined,
  attach: (entry: E, kept: C) => Promise<void>, resubscribe: (entry: E, ch: C) => void,
): Promise<number> {
  let moved = 0;
  for (const e of entries) {
    const ch = channelOf(e.gaii);
    if (e.gaii === lost || !ch || ch.tunnel !== stopped) continue;
    try {
      await attach(e, ch);
      if (ch.getSubscriptions().length) resubscribe(e, ch);
      moved++;
    } catch (err) {
      console.error(`[serve] ${e.agent}@${e.owner}: could not be put on a new tunnel: ${String(err)}`);
    }
  }
  if (moved) console.error(`[serve] the agent that opened the shared tunnel lost its credential; ${moved} other agent(s) are on a new tunnel`);
  return moved;
}
