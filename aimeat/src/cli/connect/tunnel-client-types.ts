/**
 * @file tunnel-client-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shapes and constants the Connector Forward Tunnel client is built from.
 *
 *   PURE EXTRACTION FROM `tunnel-client.ts`, which reached the 800-line limit. Nothing here changed
 *   in the move except visibility: `PendingForward` and `TunnelFrame` are exported now because they
 *   have to cross a file boundary, and `tunnel-client.ts` re-exports every type that was public
 *   before, so no importer anywhere had to be touched.
 *
 *   What belongs here: the frame vocabulary, the option and identity shapes, the code sets that
 *   decide whether a failure is a verdict or a hiccup, and the one pure function. What does not:
 *   anything that reads `this`. That line is what keeps the split a move rather than a rewrite.
 * @version-history
 *   v1.1.0 — 2026-09-05 — `gaii` on the options: the socket's own identity, so a frame for a name
 *     the client does not hold can be told apart from a frame for itself and dropped rather than
 *     handed to the opener's handlers.
 *   v1.0.0 — 2026-09-04 — Extracted from tunnel-client.ts, verbatim.
 */

/** Result of a forwarded API call — HTTP status + parsed (envelope) body. */
export interface ForwardResult {
  status: number;
  body: unknown;
}

export interface ForwardOptions {
  body?: unknown;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export type TunnelStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'stopped';

/**
 * Outcome of the FIRST connection attempt (`start()`):
 * - 'online'      — tunnel established; the client now auto-reconnects on drops.
 * - 'unsupported' — node has the tunnel disabled or is too old (upgrade 404 /
 *                   no handler). Caller should degrade to direct fetch + poll.
 * - 'auth_failed' — upgrade rejected 401/403. Caller should surface re-auth
 *                   guidance; the client is stopped (no retry loop).
 * - 'unreachable' — network-level failure. Caller should degrade; the client
 *                   is stopped.
 */
export type TunnelStartOutcome = 'online' | 'unsupported' | 'auth_failed' | 'unreachable';

export interface ConnectTunnelClientOptions {
  /** Base HTTP(S) URL of the AIMEAT node (e.g. https://aimeat.io). */
  nodeUrl: string;
  /**
   * The identity that OPENS this socket, so a frame can be told apart three ways: for me, for an
   * identity riding my socket, or for an identity I no longer hold.
   *
   * Without it the third looked like the first. The node stamps every outbound frame with the
   * principal it is for; an identity evicted on a dead credential left the map; and a frame for it
   * then missed the map and fell back to the OPENER's handlers, which is how one owner's task landed
   * in another owner's queue and started its runner. Found by an adversarial review on 2026-09-05.
   * Optional only so a pre-existing caller keeps compiling; the hub and the private socket both
   * set it, and a client without it keeps the old fallback for a legacy node that never stamps.
   */
  gaii?: string;
  /**
   * Full WebSocket endpoint to dial (connector profile §6). When set, it is used verbatim instead of
   * deriving `{nodeUrl}/v1/connect/tunnel` — lets the same client target a non-AIMEAT, ecosystem-hosted
   * tunnel endpoint (the AIMEAT→ecosystem initiation direction). Default: derive from `nodeUrl`.
   */
  wsUrl?: string;
  /**
   * Returns the current agent JWT. Called on EVERY (re)connect so a token
   * refreshed via `aimeat connect` is picked up without restarting serve.
   *
   * Null means there is no credential and a person has to act. A THROW means one could not be
   * obtained right now and the caller should wait rather than stop — see `MintFailedError` in
   * agent-key.ts for what that distinction cost when it did not exist.
   */
  getToken: () => Promise<string | null>;
  /** Log label, e.g. "tunnel:claude". Defaults to "tunnel". */
  label?: string;
  /** Realtime reverse delivery (the client acks automatically). */
  onDeliver?: (kind: string, payload: unknown, id: string) => void;
  /**
   * A server-initiated `invoke` (the node asks THIS principal to run a capability and waits for
   * `invoke_result`). The handler answers through `replyInvoke(id, ok, result)`, now or later. With
   * no handler the frame is refused at once as `ok:false, result.code = UNSUPPORTED`, so the node
   * does not sit on its timeout for a client that cannot answer.
   */
  onInvoke?: (frame: { id: string; capability: string; input: unknown; caller?: string; timeout_ms?: number }) => void;
  /** On-connect snapshot of queued tasks + pending messages. */
  onBacklog?: (payload: { tasks: unknown[]; messages: unknown[] }) => void;
  /**
   * Fired after each (re)connect is welcomed — used to RE-SEND subscriptions (which die with the
   * old socket) and to drive a catch-up read on the consumer. `connectCount` is 1 on first connect,
   * incrementing per reconnect.
   */
  onConnect?: (connectCount: number) => void;
  /** Fired once when the client stops due to an auth failure. */
  onAuthFailure?: (message: string) => void;
  onStatusChange?: (status: TunnelStatus) => void;
  /** Defaults below are pre-welcome fallbacks; the server `welcome` overrides them. */
  heartbeatIntervalMs?: number;
  requestTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  reconnectJitter?: boolean;
  /** Reconnect this long before the advertised `token_expires_at`. Default 60s. */
  tokenRefreshLeadMs?: number;
}

export interface PendingForward {
  resolve: (r: ForwardResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * ONE MORE IDENTITY ON THIS SOCKET.
 *
 * The client used to be one-agent-one-socket, which is how 38 agents became 38 TCP connections to
 * one node from one machine. The socket is now the connector's connection to a NODE, and each
 * agent is an identity riding it with its own credential and its own handlers.
 *
 * The handlers are per identity because the work is: a deliver for `concierge#alice` must reach
 * alice's channel and not bob's, and a dead credential must stop that one agent and leave the
 * other eleven running.
 */
export interface TunnelIdentity {
  gaii: string;
  getToken: () => Promise<string | null>;
  onDeliver?: (kind: string, payload: unknown, id: string) => void;
  onInvoke?: (frame: { id: string; capability: string; input: unknown; caller?: string; timeout_ms?: number }) => void;
  onBacklog?: (payload: { tasks: unknown[]; messages: unknown[] }) => void;
  onConnect?: (connectCount: number) => void;
  onAuthFailure?: (message: string) => void;
}

export interface TunnelFrame {
  type: string;
  id?: string;
  /** Which identity this frame belongs to on a shared socket. Absent = the socket's own. */
  agent?: string;
  method?: string;
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  status?: number;
  kind?: string;
  payload?: unknown;
  code?: string;
  message?: string;
  timestamp?: string;
  // ── invoke (S→C) / invoke_result (C→S) ──
  capability?: string;
  input?: unknown;
  caller?: string;
  timeout_ms?: number;
  ok?: boolean;
  result?: unknown;
}

/**
 * Forwarded-response auth codes that mean the pinned bearer itself is dead
 * (stop the client, surface re-auth guidance). Deliberately NARROWER than the
 * poller's AUTH_ERROR_CODES: FORBIDDEN/SCOPE_DENIED on a forwarded call is a
 * per-route scope denial, not token death — killing the whole tunnel for one
 * scope-denied tool call would be wrong.
 */
export const TOKEN_DEAD_CODES = new Set(['UNAUTHORIZED', 'INVALID_TOKEN', 'TOKEN_EXPIRED']);

/**
 * The node's answers to `attach` that are a VERDICT ON THE CREDENTIAL rather than a hiccup: it did
 * not verify, it was revoked, it is not an agent, it names someone else. Each one means retrying
 * with the same credential will be refused again for the same reason, so the identity comes off
 * this socket and its owner is told.
 *
 * ATTACH_FAILED is deliberately NOT here. It is what the node sends when the socket went away
 * underneath the frame or the attach threw — a transient, and evicting on it would take an agent
 * off a working fleet for a blip.
 */
export const ATTACH_REFUSAL_CODES = new Set(['ATTACH_UNAUTHORIZED', 'ATTACH_FORBIDDEN']);

export const RE_AUTH_GUIDANCE = 'Run: aimeat connect';
/** Cap a single token-refresh timer chunk; the chain re-evaluates each firing. */
export const MAX_TIMER_CHUNK_MS = 24 * 60 * 60 * 1000;

export function wsUrl(nodeUrl: string): string {
  return nodeUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/v1/connect/tunnel';
}
