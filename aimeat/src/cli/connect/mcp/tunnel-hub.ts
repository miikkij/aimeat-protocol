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
 * @structure TunnelHub — hubFor() · ownerOf() · isShared() · sockets()
 * @usage const hub = await hubs.hubFor(entry, identity);
 * @version-history
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

  /** How many sockets this daemon holds upstream. The number the whole change is about. */
  get socketCount(): number { return this.byNode.size; }
}
