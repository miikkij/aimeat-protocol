/**
 * @file src/services/connect-tunnel-connection.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One identity's entry in the connect tunnel manager's connection map.
 *
 *   PURE EXTRACTION from connect-tunnel.ts, which passed the 800-line cap when the connection
 *   gained the run modes its connector presents. The type is the same type; the manager imports it
 *   and nothing else changed.
 * @structure ConnectConnection
 * @usage import type { ConnectConnection } from './connect-tunnel-connection.js';
 * @version-history
 *   v1.0.0 — 2026-10-02 — Extracted from connect-tunnel.ts, with the `runModes` field added there.
 */
import type { WebSocket } from 'ws';
import type { VerifiedToken } from '../auth/jwt.js';

export interface ConnectConnection {
  principal: string;
  ws: WebSocket;
  /**
   * Which physical socket this identity rides.
   *
   * `connections` is still keyed by principal, so every lookup in the manager is unchanged — what
   * is new is that several entries may now share one `ws`. This id is how the close path finds the
   * others, and how a frame is checked against the identities its socket actually proved.
   */
  socketId: string;
  identity: VerifiedToken;
  /**
   * Which INSTALLATION this socket belongs to, or null from a connector that does not say.
   *
   * One `connect serve` holds one socket per agent, so an owner's sockets used to be one
   * undifferentiated set and two machines were indistinguishable from one. The daemon presents a
   * stable id it minted once, and that is what turns "this owner's principals" into "this owner's
   * daemons". Null is a connector older than 2026-09-01, and every one of those is grouped as a
   * single legacy daemon — exactly the behaviour they had before, and no worse.
   */
  installId: string | null;
  /** The name the connector reported for its installation (X-AIMEAT-Install-Name), or null. Unsigned; shown to the owner only. */
  installName: string | null;
  /** The run modes the connector presented at upgrade (X-AIMEAT-Run-Modes), or null when it did not say. */
  runModes: string[] | null;
  /** The raw agent JWT verified at upgrade, reused verbatim as the forward bearer. */
  rawToken: string;
  lastHeartbeat: number;
}
