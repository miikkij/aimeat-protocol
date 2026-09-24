/**
 * @file tunnel-traffic.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What one tunnel socket has carried: bytes on the wire in each direction, frames
 *   received, and the forwarded API calls with their outcome and round-trip time. Read by the serve
 *   daemon's `/local/stats` and shown by `aimeat connect tui`.
 *
 *   Bytes are the TCP socket's own counters (`bytesRead` / `bytesWritten`), taken from the upgrade
 *   response, so they are what actually crossed the network, TLS and framing included. A socket
 *   starts at zero, so the counters of every closed socket are folded into a running total and a
 *   reconnect does not reset the figure.
 * @structure TrafficSnapshot · TunnelTraffic (attachSocket, frameIn, startForward, snapshot)
 * @usage
 *   const traffic = new TunnelTraffic();
 *   ws.on('upgrade', res => traffic.attachSocket(res.socket));
 *   const done = traffic.startForward(); ... done(status);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Created for `aimeat connect tui`.
 */
import type { Socket } from 'node:net';

export interface TrafficSnapshot {
  bytes_in: number;
  bytes_out: number;
  frames_in: number;
  forwards: number;
  /** Forwards answered 5xx, or not answered at all (the local timeout's synthetic 504). */
  forward_errors: number;
  forwards_in_flight: number;
  forward_ms_total: number;
  forward_ms_max: number;
}

export class TunnelTraffic {
  private closedIn = 0;
  private closedOut = 0;
  private socket: Socket | null = null;
  private framesIn = 0;
  private forwards = 0;
  private forwardErrors = 0;
  private inFlight = 0;
  private msTotal = 0;
  private msMax = 0;

  /** The socket a (re)connect upgraded. Its counters are folded into the total when it closes. */
  attachSocket(socket: Socket | null | undefined): void {
    if (!socket) return;
    this.socket = socket;
    socket.once('close', () => {
      this.closedIn += socket.bytesRead;
      this.closedOut += socket.bytesWritten;
      if (this.socket === socket) this.socket = null;
    });
  }

  frameIn(): void { this.framesIn++; }

  /** Call when a forward is sent; call the returned function with the answer's status. */
  startForward(): (status: number) => void {
    const started = Date.now();
    this.forwards++;
    this.inFlight++;
    let settled = false;
    return (status: number) => {
      if (settled) return;
      settled = true;
      this.inFlight--;
      const ms = Date.now() - started;
      this.msTotal += ms;
      if (ms > this.msMax) this.msMax = ms;
      if (status >= 500) this.forwardErrors++;
    };
  }

  snapshot(): TrafficSnapshot {
    return {
      bytes_in: this.closedIn + (this.socket?.bytesRead ?? 0),
      bytes_out: this.closedOut + (this.socket?.bytesWritten ?? 0),
      frames_in: this.framesIn,
      forwards: this.forwards,
      forward_errors: this.forwardErrors,
      forwards_in_flight: this.inFlight,
      forward_ms_total: this.msTotal,
      forward_ms_max: this.msMax,
    };
  }
}
