/**
 * @file connect-tunnel-multiplex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One socket, many identities: the bookkeeping that lets a single connector
 *   WebSocket carry every agent of every owner it serves, instead of one socket per agent.
 *
 *   WHY. A `connect serve` holding one socket per registered agent was measured at 38 sockets to
 *   one node from one machine (2026-08-31). The count follows the number of REGISTERED agents, so
 *   210 agents across 5 nodes is 210 sockets per machine where the intent was 5. It also forced a
 *   daemon restart to take on a new agent, because the tunnel set was built from the registry at
 *   startup. One socket and dynamic attach are the same fix.
 *
 *   WHAT THIS MODULE OWNS, AND WHAT IT DOES NOT. It owns the socket↔identity index and the
 *   per-identity fairness counters. It does NOT verify anything: `attach` is authenticated by the
 *   manager with the same three checks the upgrade makes, because a second implementation of that
 *   is exactly the drift this codebase keeps paying for.
 *
 *   THE SECURITY MODEL IS UNCHANGED. Every identity on a shared socket proved its own credential —
 *   at upgrade for the first, in an `attach` frame for the rest — and the manager keeps that
 *   identity's own raw bearer. A forward frame is still replayed through the real Express stack
 *   with THAT identity's bearer, so `requireAuth` and `requireScope` still hold by construction.
 *   The socket carries no authority of its own; it is a pipe with several authenticated speakers.
 *
 *   THE FENCE. One identity's revoked credential detaches THAT identity and leaves the socket up
 *   for the other eleven. Closing the socket is the last-one-out case, never a per-identity act.
 *
 * @structure
 *   - SocketRecord — one physical socket and the identities riding it
 *   - SocketIndex — attach/detach/close bookkeeping, and the "does this socket hold X" question
 *   - Fairness — per-identity in-flight cap and response-size cap (a counter and an `if`)
 * @usage
 *   const index = new SocketIndex();
 *   const socketId = index.open(ws, primaryPrincipal);
 *   index.attach(socketId, principal); index.holds(socketId, principal);
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-tunnel-one-socket-many-agents).
 */
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

/** One physical socket, and every identity that has proved itself on it. */
export interface SocketRecord {
  id: string;
  ws: WebSocket;
  /**
   * The identity that authenticated the WebSocket upgrade.
   *
   * It is NOT privileged — it is simply the one a frame without an `agent` field belongs to, which
   * is what makes a pre-multiplex client (aimeat@3.10.0 and older) work unchanged: it opens one
   * socket per agent and never names one, so its every frame lands on its only identity.
   */
  primary: string;
  principals: Set<string>;
}

/**
 * Which identities are on which socket.
 *
 * The manager's `connections` map stays keyed by PRINCIPAL, so every existing lookup — deliverTo,
 * invokeOnPrincipal, isConnected, the subscription indexes — is untouched by this change. What is
 * new is only that several of those entries may now share one `ws`, and this index is what can
 * answer "which ones" when the socket closes or a frame has to be routed.
 */
export class SocketIndex {
  private bySocket = new Map<string, SocketRecord>();

  /** Register a newly upgraded socket and the identity that authenticated it. */
  open(ws: WebSocket, primary: string): string {
    const id = randomUUID();
    this.bySocket.set(id, { id, ws, primary, principals: new Set([primary]) });
    return id;
  }

  get(socketId: string): SocketRecord | undefined {
    return this.bySocket.get(socketId);
  }

  /** Add a further identity that has just proved its own credential on this socket. */
  attach(socketId: string, principal: string): boolean {
    const rec = this.bySocket.get(socketId);
    if (!rec) return false;
    rec.principals.add(principal);
    return true;
  }

  /**
   * Remove ONE identity. Answers whether the socket still carries anyone.
   *
   * This is the fence in one line: a revoked credential, a deleted agent or a deactivated owner
   * detaches its own identity and the caller closes the socket only when this says nobody is left.
   */
  detach(socketId: string, principal: string): { remaining: number } {
    const rec = this.bySocket.get(socketId);
    if (!rec) return { remaining: 0 };
    rec.principals.delete(principal);
    return { remaining: rec.principals.size };
  }

  /** Every identity on a socket, for the close path. */
  principalsOn(socketId: string): string[] {
    return [...(this.bySocket.get(socketId)?.principals ?? [])];
  }

  /**
   * Does this socket hold that identity?
   *
   * The whole routing gate. A frame naming an identity this socket has not proved is refused
   * rather than served, so naming someone else's agent buys nothing: a daemon can drive only the
   * identities whose credentials it presented on this very socket.
   */
  holds(socketId: string, principal: string): boolean {
    return this.bySocket.get(socketId)?.principals.has(principal) === true;
  }

  close(socketId: string): void {
    this.bySocket.delete(socketId);
  }

  get socketCount(): number {
    return this.bySocket.size;
  }
}

/**
 * FAIRNESS, WHICH A SHARED SOCKET NEEDS AND A PRIVATE ONE DID NOT.
 *
 * One socket per agent was natural isolation: an agent that flooded or blocked hurt only itself.
 * Sharing removes that, so one identity's large or slow answer can delay eleven others.
 *
 * This is deliberately a counter and an `if`, not credit windows. The measured load is 38 agents
 * sending occasional JSON with the daemon at 1.09% of one core idle; a scheduler for that would be
 * machinery guarding against a shape of traffic nobody has. What it does stop is the two runaway
 * cases already on record from the crew side: an idle tunnel storm at 2-4 Mbit/s, and the same
 * call repeated 347 times.
 *
 * Both caps are per IDENTITY, never per socket, so the noisy one is the one that is refused.
 */
export class Fairness {
  private inFlight = new Map<string, number>();

  constructor(
    private readonly maxInFlight: number,
    private readonly maxResponseBytes: number,
  ) {}

  /** Take a slot, or refuse. Refusing costs nothing and does no work on the noisy identity's behalf. */
  tryAcquire(principal: string): boolean {
    const n = this.inFlight.get(principal) ?? 0;
    if (n >= this.maxInFlight) return false;
    this.inFlight.set(principal, n + 1);
    return true;
  }

  release(principal: string): void {
    const n = (this.inFlight.get(principal) ?? 1) - 1;
    if (n <= 0) this.inFlight.delete(principal); else this.inFlight.set(principal, n);
  }

  /** Drop everything owed to an identity that has gone. */
  forget(principal: string): void {
    this.inFlight.delete(principal);
  }

  current(principal: string): number {
    return this.inFlight.get(principal) ?? 0;
  }

  get limitInFlight(): number { return this.maxInFlight; }
  get limitResponseBytes(): number { return this.maxResponseBytes; }

  /** Is this answer too big to put on a shared wire? Measured on the encoded body, which is what
   *  actually occupies the socket, rather than on a parsed size nobody transmits. */
  responseTooLarge(bytes: number): boolean {
    return bytes > this.maxResponseBytes;
  }
}
