/**
 * @file src/services/agent-stop.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stop an agent, and start it again. One implementation behind
 *   POST /v1/agents/:name/stop, POST /v1/agents/:name/start, aimeat_agent_stop and
 *   aimeat_agent_start.
 *
 *   WHAT A STOP WRITES: `stoppedAt` and `stoppedBy` on the agent's record, and the same fact on the
 *   agent's live tunnel identity, so the next delivery is already held. Nothing else: no key is
 *   revoked, no task is changed, no schedule is switched off. What stopped means is read from that
 *   one field at every place work can start (./agent-stop-rules.ts names them).
 *
 *   WHAT A START DOES, in this order, because a runtime woken before its tasks are released would
 *   find them waiting:
 *     1. clears the two fields;
 *     2. takes each task that waits in `queued` back through the start decision
 *        (agent-task-rules.ts decideTaskStart). One that would have started on its own, had the
 *        agent not been stopped, starts now, with the same 'started' event. One that waits for the
 *        owner's OK for another reason goes on waiting;
 *     3. sends ONE backlog down the agent's connector socket: the released tasks as running, the
 *        tasks that still wait, and the unread messages. One frame, so the runtime is woken once.
 *        A released task gets no delivery frame of its own;
 *     4. sends the direct messages that arrived during the stop, one `dm.inbound` each, because a
 *        direct message is in no backlog (sendHeldDirectMessages says why);
 *     5. for an agent that is reached by webhook, which has no backlog, sends the events that were
 *        held: the released tasks, the tasks that still wait, and the unread messages.
 *   Scheduled runs that were skipped are NOT run: a week of hourly runs must not arrive in one
 *   minute. The schedule's next run happens at its time.
 *
 *   WHO. The owner, or another agent of the same owner holding `agent:write`, the permission that
 *   can change the agent anyway. Never the agent itself: an agent that could start itself would
 *   make the stop a request, and one that stops itself has a simpler way, which is to do nothing.
 *
 *   IDEMPOTENT. Stopping a stopped agent and starting a running one answer ok and change nothing,
 *   so a person or an AI that presses twice is not told it failed.
 * @structure setAgentStopped(deps, callerOwner, callerPrincipal, identifier, stop) · releaseWaitingTasks() ·
 *   sendHeldDirectMessages() · sendHeldWebhookEvents() · agentIsStopped()
 * @usage
 *   const out = await setAgentStopped({ storage, config }, req.auth!.owner, principal, name, true);
 * @version-history
 *   v1.1.0 — 2026-10-11 — Two defects a live fleet measured the day this shipped. A direct message
 *     that arrived during the stop was never delivered after the start: it is sent now. A start
 *     woke a runtime twice, by a frame per released task and then by the backlog: the backlog alone
 *     carries the released tasks now.
 *   v1.0.0 — 2026-10-11 — Initial (wish-pys-yt-agentti-agentille-pys-ytetty-tila-ja-k-ynnistys-uudel).
 */
import { randomUUID } from 'node:crypto';
import type { AgentRecord, AgentTaskRecord } from '../storage/interface.js';
import { resolveAgentTarget, type AgentWriteDeps, type AgentWriteRefusal } from './agent-profile-write.js';
import { decideTaskStart, autoStartEvent } from './agent-task-rules.js';
import { readAgentDmInbox } from './agent-dm-reads.js';
import { messagePreview } from '../utils/messaging.js';
import { withWildcardFacts } from './scope-use.js';
import { recordTaskStarted } from './activity-recorder.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { emitChange, emitDelivery } from './event-bus.js';
import { isStopped } from './agent-stop-rules.js';
import { createWebhookDispatcher } from './webhook-dispatcher.js';
import { logger } from '../utils/logger.js';

/**
 * Is this agent stopped, for a caller on a hot read path. The agent's live tunnel identity knows
 * without a query; an agent with no socket here is read from its record.
 */
export async function agentIsStopped(storage: AgentWriteDeps['storage'], gaii: string): Promise<boolean> {
  const live = getActiveConnectTunnelManager()?.stoppedOf(gaii);
  if (live !== undefined) return live;
  return isStopped(await storage.getAgent(gaii));
}

export type AgentStopOutcome =
  | { ok: true; agent: AgentRecord; changed: boolean; released: number }
  | AgentWriteRefusal;

/**
 * The queued tasks of an agent that has just been started go back through the start decision.
 * Returns how many started. A task that fails to update is logged and left queued: the owner can
 * still start it by hand, and the rest must not wait for it.
 */
export async function releaseWaitingTasks(deps: AgentWriteDeps, agent: AgentRecord): Promise<AgentTaskRecord[]> {
  const { storage } = deps;
  const startAgent = await withWildcardFacts(storage, agent);
  const { tasks } = await storage.listAgentTasks(agent.gaii, { status: 'queued' });
  const started: AgentTaskRecord[] = [];
  for (const task of tasks) {
    const decision = decideTaskStart(startAgent, { policy: task.startPolicy, todos: task.todos });
    if (!decision.startsNow) continue;
    const now = new Date().toISOString();
    try {
      const updated = await storage.updateAgentTask(task.id, { status: 'active', lastEventAt: now, updatedAt: now });
      if (!updated) continue;
      await storage.appendTaskEvent({
        id: randomUUID(), taskId: task.id, type: 'started', timestamp: now,
        ...autoStartEvent(decision, ' when the agent was started'),
      });
      await recordTaskStarted(storage, agent.gaii);
      // No delivery of its own: the one backlog that follows the release lists it as running. A
      // frame per task beside that backlog woke a runtime twice for one start.
      started.push(updated);
    } catch (err) {
      logger.warn('agent-stop: a waiting task could not be started', { gaii: agent.gaii, taskId: task.id, error: String(err) });
    }
  }
  if (started.length) emitChange('agent-tasks');
  return started;
}

/**
 * What a webhook-driven agent missed while it was stopped, sent when it is started. A connector
 * socket gets a backlog and a polling runtime reads its own lists; a webhook is told once, so the
 * held events are sent now, in the shapes their own call sites send them (agent-task-write.ts,
 * task-start-op.ts, agent-message-send.ts). Best effort, as every webhook is.
 */
async function sendHeldWebhookEvents(deps: AgentWriteDeps, agent: AgentRecord, started: AgentTaskRecord[]): Promise<void> {
  if (!agent.webhookUrl || !agent.webhookEnabled) return;
  const { dispatchWebhookEvent } = createWebhookDispatcher(deps);
  const now = new Date().toISOString();
  for (const t of started) {
    void dispatchWebhookEvent(agent.gaii, 'task.approved', {
      task_id: t.id, title: t.title, status: 'active', todo_count: t.todos?.length ?? 0,
      pending_todo_count: (t.todos ?? []).filter(todo => todo.status === 'pending').length, approved_at: now,
    });
  }
  const [{ tasks: waiting }, messages] = await Promise.all([
    deps.storage.listAgentTasks(agent.gaii, { status: 'queued' }),
    deps.storage.listPendingMessages(agent.gaii),
  ]);
  for (const t of waiting) {
    void dispatchWebhookEvent(agent.gaii, 'task.queued', {
      task_id: t.id, title: t.title, description: t.description ?? '', has_todos: (t.todos?.length ?? 0) > 0,
      todo_count: t.todos?.length ?? 0, scope_summary: [], created_at: t.createdAt, auto_activated: false,
    });
  }
  for (const m of messages) {
    void dispatchWebhookEvent(agent.gaii, 'message.inbound', {
      message_id: m.id, thread_id: m.threadId, linked_task_id: m.linkedTaskId ?? null, preview: m.content.substring(0, 200),
      has_proposed_task: !!(m.metadata?.proposedTask), has_prompt_answer: !!(m.metadata?.promptAnswer), created_at: m.createdAt,
    });
  }
}

/** The most direct messages one start sends again. More than this have piled up only on an agent stopped for a long time; the rest stay readable with aimeat_dm_inbox. */
const HELD_DM_LIMIT = 100;

/**
 * The direct messages that arrived while the agent was stopped, sent down its connector socket now.
 *
 * A DIRECT MESSAGE IS NOT PART OF A BACKLOG. It wakes an agent with one `dm.inbound` delivery when
 * it arrives, and nothing lists it again; an agent that was offline reads `aimeat_dm_inbox` when it
 * wants to. So a stop that held that one delivery has to send it at the start, or the message is
 * never heard. Measured on a live fleet on 2026-10-11: an always-on agent answered a new message in
 * 9.8 s after its start and never answered the one that had waited.
 *
 * "While it was stopped" is `createdAt` at or after the stop, read from the agent's own inbox
 * (agent-dm-reads.ts), oldest first, with the payload a live delivery carries (message-send.ts).
 * A message from before the stop was delivered when it arrived and is not sent again.
 */
async function sendHeldDirectMessages(deps: AgentWriteDeps, agent: AgentRecord, stoppedAt: string): Promise<number> {
  const { messages } = await readAgentDmInbox(deps.storage, agent.gaii, { page: 1, perPage: HELD_DM_LIMIT });
  const held = messages.filter(m => m.createdAt >= stoppedAt).reverse();
  const sent = new Set<string>();
  for (const m of held) {
    if (sent.has(m.id)) continue;
    sent.add(m.id);
    emitDelivery({
      target: agent.gaii, kind: 'dm.inbound', id: m.id,
      payload: {
        id: m.id, conversationId: m.conversationId, subject: m.subject ?? null, senderGhii: m.senderGhii,
        preview: messagePreview(m.body), attachments: m.attachments?.length ?? 0, createdAt: m.createdAt,
        interactive: m.interactive?.role ?? null,
      },
    });
  }
  return sent.size;
}

export async function setAgentStopped(
  deps: AgentWriteDeps, callerOwner: string, callerPrincipal: string, identifier: string, stop: boolean,
): Promise<AgentStopOutcome> {
  const gaii = resolveAgentTarget(deps.config, callerOwner, identifier);
  const agent = await deps.storage.getAgent(gaii);
  if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
  if (agent.owner !== callerOwner) {
    return { ok: false, code: 'ACCESS_DENIED', message: 'You can only stop and start your own agents.' };
  }
  if (callerPrincipal === gaii) {
    return { ok: false, code: 'ACCESS_DENIED',
      message: 'An agent cannot stop or start itself. Ask the owner, or another of their agents with agent:write.' };
  }

  if (isStopped(agent) === stop) return { ok: true, agent, changed: false, released: 0 };

  const updated = await deps.storage.updateAgent(gaii, stop
    ? { stoppedAt: new Date().toISOString(), stoppedBy: callerPrincipal }
    : { stoppedAt: null, stoppedBy: null });
  if (!updated) return { ok: false, code: 'UPDATE_FAILED', message: `The agent could not be ${stop ? 'stopped' : 'started'}.` };

  const tunnels = getActiveConnectTunnelManager();
  let released = 0;
  if (stop) {
    tunnels?.setStopped(gaii, true);
  } else {
    // Release first, then ONE backlog: it lists the released tasks as running, the tasks that still
    // wait and the unread messages, so the runtime is woken once for all of them.
    const started = await releaseWaitingTasks(deps, updated);
    released = started.length;
    tunnels?.setStopped(gaii, false);
    // Direct messages are in no backlog; the ones that arrived during the stop go out one by one.
    if (agent.stoppedAt) {
      await sendHeldDirectMessages(deps, updated, agent.stoppedAt).catch(err =>
        logger.warn('agent-stop: the held direct messages could not be sent', { gaii, error: String(err) }));
    }
    void sendHeldWebhookEvents(deps, updated, started).catch(err =>
      logger.warn('agent-stop: the held webhook events could not be sent', { gaii, error: String(err) }));
  }
  logger.info(stop ? 'Agent stopped' : 'Agent started', {
    event: stop ? 'agent.stopped' : 'agent.started', gaii, by: callerPrincipal, released,
  });
  emitChange('agents');
  return { ok: true, agent: updated, changed: true, released };
}
