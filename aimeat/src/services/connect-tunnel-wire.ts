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
    | 'backlog'        // S→C: on-connect snapshot of queued+active tasks + pending messages
    | 'disconnect'
    | 'error';
  /** Correlation id (request↔response, heartbeat↔ack, deliver↔ack, invoke↔invoke_result, subscribe↔subscribed). */
  id?: string;
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
