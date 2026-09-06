/**
 * @file connect-tunnel-push.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two pushes that read STORAGE rather than react to a frame: the on-connect
 *   backlog, and the cancel-marker fan-out.
 *
 *   Both exist so a daemon does not have to poll. The backlog is why nothing is lost across a
 *   disconnect — it is computed from the store every time, never from what was acked, so an agent
 *   that acked and then crashed still re-learns its task. The cancel push is why a dispatch no
 *   longer scans `agents.cancel.*` before every run.
 *
 *   Extracted from connect-tunnel.ts unchanged when one socket carrying many identities pushed that
 *   file past the 800-line ceiling. A pure move: same bodies, same comments, `this.x` became
 *   `ctx.x`.
 *
 * @structure PushContext · sendBacklog() · pushTaskCancellations() · onMemoryWrite()
 * @usage import { sendBacklog, pushTaskCancellations } from './connect-tunnel-push.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Extracted from connect-tunnel.ts (max-file-lines).
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { ConnectFrame, ConnectTunnelStats } from './connect-tunnel-wire.js';
import { logger } from '../utils/logger.js';
import type { MemoryWriteEvent } from './event-bus.js';
import { parseWorkspaceRecordKey, spaceKeyOf } from './connect-tunnel-wire.js';

/** Just enough of a connection for a push: whose it is and whether its socket is still open. */
export interface PushConn { principal: string; ws: WebSocket }

/** What the manager lends these two. Neither owns state of its own. */
export interface PushContext {
  storage: Storage;
  stats: ConnectTunnelStats;
  connections: Map<string, PushConn>;
  sendTo: (conn: PushConn, frame: ConnectFrame) => void;
}


/**
 * Tell ONE live identity that its permissions changed, so the credential it holds is stale.
 *
 * A push and not a revocation, which is why it lives here rather than beside the three predicates in
 * ./connect-tunnel-revocation.ts: nothing is detached and nothing is closed. `auth_revoked` STOPS an
 * identity, and this news is most often a GRANT — carried on that channel, adding a permission would
 * kill the agent that gained it.
 *
 * Why it has to exist at all: a minted token carries the scopes of the moment it was minted and a
 * connector holds it for up to an hour. Reported by crewaimeat on 2026-09-06, where GET /v1/agents
 * said the agent held `messages:read` while every call it made was refused for lacking it, and the
 * remedy found in the field was restarting the whole serve daemon. The reverse direction is the one
 * nobody reported and the more serious of the two: a REMOVED permission went on being honoured for
 * the rest of the token's life.
 */
export function notifyScopesChanged(ctx: PushContext, gaii: string): void {
  for (const conn of ctx.connections.values()) {
    if (conn.principal !== gaii) continue;
    ctx.sendTo(conn, {
      type: 'scopes_changed',
      agent: gaii,
      message: 'Permissions changed — mint a fresh token',
      timestamp: new Date().toISOString(),
    });
    return;   // one live session per identity
  }
}

/**
 * On connect, send a snapshot of everything outstanding for this agent —
 * queued + active tasks and pending messages — straight from storage (the
 * source of truth), so nothing is lost across a disconnect (mirrors
 * TunnelManager.sendMailboxSummary). A task leaves the backlog only when its
 * status changes (done/failed/etc.), never because of an ack. After this the
 * manager live-pushes via `deliver`.
 */
export async function sendBacklog(ctx: PushContext, conn: PushConn): Promise<void> {
  try {
    const principal = conn.principal;
    const [queued, active, pendingMessages] = await Promise.all([
      ctx.storage.listAgentTasks(principal, { status: 'queued' }),
      ctx.storage.listAgentTasks(principal, { status: 'active' }),
      ctx.storage.listPendingMessages(principal).catch(err => { logger.warn('resolve: continuing after a suppressed failure', { error: String(err) }); return []; }),
    ]);
    // Dedup tasks by id (a task can't be both queued and active, but guard).
    const taskById = new Map<string, unknown>();
    for (const t of [...queued.tasks, ...active.tasks]) taskById.set(t.id, t);
    const tasks = [...taskById.values()];
    const messages = pendingMessages;

    if (conn.ws.readyState !== WebSocket.OPEN) return;
    ctx.sendTo(conn, {
      type: 'backlog',
      id: randomUUID(),
      payload: { tasks, messages },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Connect tunnel backlog failed', { event: 'connect_tunnel.error', principal: conn.principal, error: err instanceof Error ? err.message : String(err) });
  }
}


/**
 * P3: resolve a cancel marker (its value is a list of task ids) to the owning agents and push a
 * `task.cancelled` wake to each online one. The agent records it locally and skips dispatch — no
 * more per-dispatch `agents.cancel.*` memory scan. Best-effort; a missed push is caught by the
 * agent's cheap single-task status re-check.
 */
export async function pushTaskCancellations(ctx: PushContext, ownerGaii: string, key: string): Promise<void> {
  try {
    const rec = await ctx.storage.getMemory(ownerGaii, key);
    const ids = Array.isArray(rec?.value) ? (rec!.value as unknown[]).map(String) : [];
    for (const taskId of ids) {
      const task = await ctx.storage.getAgentTask(taskId);
      if (!task) continue;
      const conn = ctx.connections.get(task.agentGaii);
      if (!conn || conn.ws.readyState !== WebSocket.OPEN) continue;
      ctx.stats.deliveriesTotal++;
      ctx.sendTo(conn, { type: 'deliver', id: `cancel/${taskId}`, kind: 'task.cancelled', payload: { type: 'task.cancelled', id: taskId } });
    }
  } catch (err) {
    logger.warn('Connect tunnel cancel push failed', { event: 'connect_tunnel.error', key, error: err instanceof Error ? err.message : String(err) });
  }
}


/** What the record fan-out borrows. The subscription indexes stay the manager's; this reads them. */
export interface RecordPushContext {
  stats: ConnectTunnelStats;
  connections: Map<string, PushConn>;
  spaceSubscribers: Map<string, Set<string>>;
  sendTo: (conn: PushConn, frame: ConnectFrame) => void;
  canPrincipalReadSpace: (conn: PushConn, organismId: string, ws: string) => Promise<boolean>;
  clearSubscriptionFor: (principal: string, sk: string) => void;
  pushTaskCancellations: (ownerGaii: string, key: string) => Promise<void>;
}

/**
 * Fan a memory write out as a `workspace.record` wake to every online subscriber of its space.
 * Only published/committed state triggers a contract agent: a bare write or `.latest` (drafts are
 * working copies, `.version.N` is history — neither is a contract trigger). The payload is a
 * lightweight envelope (coordinates + op + ts, NO record value): the agent does its own authorized
 * read for content. Access is RE-validated here so a mid-session consent revocation stops delivery
 * immediately (a stale subscription is dropped on the spot). The deliver `id` is unique per write so
 * each update is its own wake (never suppressed by the in-session ack dedup).
 */
export async function onMemoryWrite(ctx: RecordPushContext, evt: MemoryWriteEvent): Promise<void> {
  // P3: a cancel marker write (`agents.cancel.task.<id>` / `agents.cancel.run.<run>`, value = task
  // id list) → push `task.cancelled` to each affected agent's socket, so daemons stop polling the
  // owner-scoped `agents.cancel.*` memory before every dispatch. Handled before the subscriber gate.
  if (evt.key.startsWith('agents.cancel.')) { await ctx.pushTaskCancellations(evt.ownerGaii, evt.key); return; }

  if (ctx.spaceSubscribers.size === 0) return;  // no subscribers anywhere — cheapest exit
  const parsed = parseWorkspaceRecordKey(evt.key);
  if (!parsed) return;
  const op = evt.op ?? 'updated';
  const ts = new Date(evt.timestamp).toISOString();
  // The space (namespace) can be multi-segment, so match by prefix against each subscription in
  // this (organism, ws) rather than positional split. Subscriptions are few, so this stays cheap.
  const wsPrefix = `${spaceKeyOf(parsed.organismId, parsed.ws, '')}`;  // "orgId|ws|"
  for (const [sk, subs] of ctx.spaceSubscribers) {
    if (!sk.startsWith(wsPrefix) || subs.size === 0) continue;
    const namespace = sk.slice(wsPrefix.length);
    if (!(parsed.rest === namespace || parsed.rest.startsWith(`${namespace}.`))) continue;
    const tail = parsed.rest === namespace ? '' : parsed.rest.slice(namespace.length + 1);
    if (tail === '') continue;  // a write to the space root itself — no instance, not a record
    const parts = tail.split('.');
    const instanceId = parts[0];
    const role = parts.slice(1).join('.');
    if (role !== '' && role !== 'latest') continue;  // skip drafts + version history
    for (const principal of [...subs]) {
      const conn = ctx.connections.get(principal);
      if (!conn || conn.ws.readyState !== WebSocket.OPEN) continue;
      const allowed = await ctx.canPrincipalReadSpace(conn, parsed.organismId, parsed.ws);
      if (!allowed) { ctx.clearSubscriptionFor(principal, sk); continue; }
      ctx.stats.deliveriesTotal++;
      ctx.sendTo(conn, {
        type: 'deliver',
        id: `${sk}/${instanceId}#${evt.timestamp}`,
        kind: 'workspace.record',
        payload: {
          type: 'workspace.record',
          organism_id: parsed.organismId, ws: parsed.ws, space: namespace,
          id: instanceId, op, ts,
        },
      });
    }
  }
}
