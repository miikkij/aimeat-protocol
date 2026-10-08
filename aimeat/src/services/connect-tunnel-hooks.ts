/**
 * @file src/services/connect-tunnel-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Listeners for "an identity opened a socket on the connect tunnel".
 *
 *   WHY A SEPARATE MODULE. The tunnel manager is imported by the services that would listen (the
 *   enrolment offer reaches the daemon through it), so a listener the manager imported would be an
 *   import cycle. This module imports nothing from either side: the manager emits here, a service
 *   registers here, and the dependency points one way.
 *
 *   ONE EVENT PER SOCKET, NOT PER IDENTITY. It fires when an upgrade opens a socket, which is a
 *   connector connecting or reconnecting. An identity attached to a socket that is already open is
 *   the connector taking on one more agent, not the connector arriving, and it does not fire.
 *
 *   A LISTENER NEVER BREAKS THE CONNECT. Each one is called in its own try/catch, and anything
 *   asynchronous is the listener's own to schedule and to catch.
 * @structure TunnelSocketOpened · onTunnelSocketOpened(fn) · emitTunnelSocketOpened(info)
 * @usage
 *   onTunnelSocketOpened(info => schedulePendingEnrolment(deps, info));
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial: the pending-enrolment offer listens for a connector connecting.
 */
import { logger } from '../utils/logger.js';

/** What the tunnel knows about the socket that just opened, from the verified upgrade token. */
export interface TunnelSocketOpened {
  /** The node whose tunnel took the socket. A test process can serve several; a listener keeps to its own. */
  nodeId: string;
  /** The upgrade token's `sub`: a GAII, or a GEAI for an ecosystem app. */
  principal: string;
  /** The bare owner name from the verified token. */
  owner: string;
  /** The install id the connector presented, or null from one older than 2026-09-01. */
  installId: string | null;
}

type Listener = (info: TunnelSocketOpened) => void;
const listeners = new Set<Listener>();

/** Register a listener. Returns the function that removes it. */
export function onTunnelSocketOpened(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called by the tunnel manager once per socket an upgrade opens. */
export function emitTunnelSocketOpened(info: TunnelSocketOpened): void {
  for (const fn of listeners) {
    try { fn(info); } catch (err) {
      logger.warn('A tunnel connect listener threw', { event: 'connect_tunnel.listener_failed', principal: info.principal, error: String(err) });
    }
  }
}
