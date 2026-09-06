/**
 * @file src/services/connect-tunnel-wire.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Connector Forward Tunnel's WIRE CONTRACT and its pure helpers: the frame shape
 *   every message on the socket takes, the workspace space reference an agent subscribes with, the
 *   stats an operator reads, and the three pure functions that parse or build a key. Nothing here
 *   holds state or touches a socket -- the manager in ./connect-tunnel.ts owns all of that and
 *   re-exports these names, so every existing import keeps working.
 * @structure ConnectFrame; WorkspaceSpaceRef; ConnectTunnelStats; parseWorkspaceRecordKey();
 *   spaceKeyOf(); coerceSpaceRef()
 * @usage import type { ConnectFrame } from './connect-tunnel-wire.js';
 * @version-history
 *   v1.4.0 -- 2026-09-06 -- `scopes_changed` frame: a stale credential, not a dead one.
 *   v1.1.0 -- 2026-08-28 -- `timeout_ms` on the invoke frame, so a connector daemon can drop an
 *     invoke nobody collected once the server has stopped waiting for it.
 *   v1.0.0 -- 2026-08-19 -- Pure extraction from connect-tunnel.ts, which passed the 800-line cap.
 *     Bodies verbatim; no behaviour change.
 */

/** A single tunnel wire frame. JSON-encoded, id-correlated where applicable. */
export interface ConnectFrame {
  type:
    | 'welcome'
    | 'heartbeat'
    | 'heartbeat_ack'
    | 'request'
    | 'response'
    | 'deliver'
    | 'ack'
    | 'invoke'         // S→C: server invokes a capability ON the connected principal (a GEAI)
    | 'invoke_result'  // C→S: the principal's reply to an invoke, correlated by id
    | 'subscribe'      // C→S: subscribe to workspace record events for one or more (organism, ws, space)
    | 'subscribed'     // S→C: subscribe ack — which space refs were accepted vs rejected
    | 'auth_revoked'   // S→C: the connected principal's bearer was revoked — stop + re-auth
    // S→C: this identity's permissions changed, so the token it holds is stale. NOT auth_revoked,
    // and the difference is the whole reason it is a separate frame: auth_revoked stops the
    // identity, which is right for a dead credential and catastrophic for a granted one — sending
    // a GRANT down the revocation channel would kill an agent for gaining a permission. This one
    // asks for nothing but a fresh mint; the identity keeps running throughout.
    | 'scopes_changed'
    | 'backlog'        // S→C: on-connect snapshot of queued+active tasks + pending messages
    | 'attach'         // C→S: prove one more identity's credential on THIS socket
    | 'attached'       // S→C: attach accepted — that identity now rides this socket
    | 'detach'         // C→S: this socket stops carrying that identity
    | 'disconnect'
    | 'error';
  /** Correlation id (request↔response, heartbeat↔ack, deliver↔ack, invoke↔invoke_result, subscribe↔subscribed). */
  id?: string;
  /**
   * WHICH IDENTITY THIS FRAME BELONGS TO, on a socket carrying several.
   *
   * The full GAII or GEAI, never a bare name — two owners with an agent called `concierge` are two
   * identities and a bare name cannot tell them apart. Absent means the socket's upgrade identity,
   * which is what makes a client older than 2026-09-03 work unchanged: it opens one socket per
   * agent and names none.
   *
   * A frame naming an identity the socket has not proved is REFUSED. The field routes; it never
   * grants. The credential behind each identity was presented on this same socket, and the forward
   * call still runs with that identity's own bearer.
   */
  agent?: string;
  /** attach (C→S): the credential for `agent`, verified exactly as the upgrade verifies its own. */
  token?: string;
  // ── request (C→S) ──
  method?: string;
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  // ── response (S→C) ──
  status?: number;
  // ── deliver (S→C) ──
  kind?: string;
  payload?: unknown;
  // ── invoke (S→C) / invoke_result (C→S) ──
  capability?: string;       // invoke: the capability id/name to run on the principal
  timeout_ms?: number;       // invoke: how long the server waits — a daemon drops an uncollected invoke after this
  input?: unknown;           // invoke: the input payload
  caller?: string;           // invoke: the AIMEAT caller GHII (the principal maps this to its account)
  ok?: boolean;              // invoke_result: whether the principal handled it successfully
  result?: unknown;          // invoke_result: the capability output
  // ── subscribe (C→S) ──
  spaces?: WorkspaceSpaceRef[];  // the (organism_id, ws, space) tuples to subscribe to
  // ── error (S→C) ──
  code?: string;
  message?: string;
  timestamp?: string;
}

/** One workspace records-space an agent can subscribe to for record-write push. */
export interface WorkspaceSpaceRef {
  organism_id: string;
  ws: string;
  /** The key segment for the records space (the manifest objectType's `namespace`), e.g. 'task'. */
  space: string;
}

interface ParsedRecordKey { organismId: string; ws: string; rest: string }

/**
 * Parse a workspace record memory key `organism.{orgId}.w.{ws}.{rest}` into (orgId, ws, rest), or null
 * if it is not a workspace-scoped key (legacy `organism.{id}.…` roots without `.w.{ws}.`, or any
 * non-organism key). `orgId` and `ws` carry no dots so positional split is safe; `rest` is
 * `{namespace}.{instanceId}[.role]` and is matched by PREFIX against a subscription's space
 * (the manifest objectType namespace can be multi-segment, e.g. `shared.tasks`).
 */
export function parseWorkspaceRecordKey(key: string): ParsedRecordKey | null {
  const seg = key.split('.');
  if (seg.length < 6 || seg[0] !== 'organism' || seg[2] !== 'w') return null;
  const organismId = seg[1], ws = seg[3];
  if (!organismId || !ws) return null;
  return { organismId, ws, rest: seg.slice(4).join('.') };
}

/** Stable composite key for the (organism, ws, space) subscription index. Ids carry no '|'. */
export function spaceKeyOf(organismId: string, ws: string, space: string): string {
  return `${organismId}|${ws}|${space}`;
}

/** Validate one subscribe-frame entry into a WorkspaceSpaceRef, or null if malformed. */
export function coerceSpaceRef(raw: unknown): WorkspaceSpaceRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const organism_id = typeof r.organism_id === 'string' ? r.organism_id : '';
  const ws = typeof r.ws === 'string' ? r.ws : '';
  const space = typeof r.space === 'string' ? r.space : '';
  if (!organism_id || !ws || !space) return null;
  return { organism_id, ws, space };
}

export interface ConnectTunnelStats {
  activeConnections: number;
  connectionsTotal: number;
  forwardRequestsTotal: number;
  forwardErrorsTotal: number;
  deliveriesTotal: number;
  acksTotal: number;
  malformedFramesTotal: number;
  /** Delivery ids currently held for in-session dedup, summed over every live socket. Capped at
   *  ACK_DEDUP_WINDOW per socket. Reported so an operator can watch the number instead of taking a
   *  heap snapshot — the way this structure was found the first time. */
  ackDedupEntries: number;
  /** Space subscriptions currently held, summed over every live socket. Bounded by what agents
   *  actually subscribe to, and reported for the same reason. */
  subscriptionEntries: number;
}
