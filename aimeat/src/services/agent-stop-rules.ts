/**
 * @file src/services/agent-stop-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What "stopped" means for an agent, as the pure rules every enforcement site reads.
 *   No storage and no socket here, so the tunnel, the webhook dispatcher, the scheduler and the
 *   routes can all import it without importing each other.
 *
 *   A STOPPED AGENT STARTS NO NEW WORK, AND FINISHES WHAT IT HAS. Ruled by Jouni on 2026-10-11:
 *   work that is running finishes; scheduled runs are skipped while it is stopped; tasks and
 *   messages the owner gives it wait and are handled after it is started. Its key and its
 *   permissions are untouched, so a start is one write and no enrolment.
 *
 *   WHY "DO NOT WAKE" IS THE RULE, AND NOT ONLY "DO NOT START". A queued task is pushed to the
 *   agent's runtime so it can plan it, and planning is a model call. `taskStart: 'confirm'` holds a
 *   task's status and still wakes the agent for exactly that reason. So a stopped agent is held in
 *   two places: the start decision (services/agent-task-rules.ts, reason `stopped`) keeps the status
 *   honest, and the wake channels listed here keep the runtime asleep.
 *
 *   WHAT STILL REACHES A STOPPED AGENT: a cancelled task (it must be able to stop work it is
 *   doing), updates to work in flight, a changed crew definition, and management asks (enrolment,
 *   the crew menu, a definition check). None of those starts work.
 * @structure isStopped · stoppedView · isWakeDelivery · isWakeWebhookEvent
 * @usage if (conn.stopped && isWakeDelivery(evt.kind)) return;
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-pys-yt-agentti-agentille-pys-ytetty-tila-ja-k-ynnistys-uudel).
 */
import type { AgentRecord } from '../storage/interface.js';

export function isStopped(agent: Pick<AgentRecord, 'stoppedAt'> | null | undefined): boolean {
  return !!agent?.stoppedAt;
}

/** The three fields every list and answer shows for it. */
export function stoppedView(agent: Pick<AgentRecord, 'stoppedAt' | 'stoppedBy'>): {
  stopped: boolean; stopped_at: string | null; stopped_by: string | null;
} {
  return { stopped: isStopped(agent), stopped_at: agent.stoppedAt ?? null, stopped_by: agent.stoppedAt ? (agent.stoppedBy ?? null) : null };
}

/**
 * The tunnel deliveries that hand an agent NEW work or wake it to look for some: a task, a direct
 * message, a v2 turn or task, a record of a space it watches. Everything else passes.
 */
const WAKE_DELIVERY_KINDS: ReadonlySet<string> = new Set([
  'task_assigned', 'dm.inbound', 'v2.message', 'v2.task.assigned', 'workspace.record',
]);
export function isWakeDelivery(kind: string): boolean {
  return WAKE_DELIVERY_KINDS.has(kind);
}

/** The webhook events that do the same over an agent's webhook. `task.updated` and `task.paused` are about work in flight. */
const WAKE_WEBHOOK_EVENTS: ReadonlySet<string> = new Set(['task.queued', 'task.approved', 'message.inbound']);
export function isWakeWebhookEvent(event: string): boolean {
  return WAKE_WEBHOOK_EVENTS.has(event);
}
