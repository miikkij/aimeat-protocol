/**
 * @file agent-messages.ts
 * @description REST endpoints for agent direct messaging (send, list, inbox, threads, status updates)
 * @structure
 *   - POST   /v1/agents/:name/messages         -- Send message
 *   - GET    /v1/agents/:name/messages/inbox   -- Get pending inbound messages
 *   - GET    /v1/agents/:name/messages/threads -- List conversation threads
 *   - GET    /v1/agents/:name/messages         -- List message history
 *   - PATCH  /v1/agents/:name/messages/:id     -- Update message status
 * @version-history
 *   v1.6.0 -- 2026-08-15 -- PATCH /:name/messages/:id authorizes against the MESSAGE, not just the
 *     agent name in the path. canAccessAgent() answers "may you act as this agent", built against
 *     the caller's own owner, and the message id was a second, unchecked coordinate — so any agent
 *     could flip the status of any message on the node by id, and the response returns the whole
 *     updated row, which made the write a read of somebody else's message too. E2E test-quality
 *     audit finding A11.
 *   v1.5.0 -- 2026-08-11 -- The send is one implementation again: validation, the record build, the
 *     provenance stamp, the message.inbound webhook, the MCP resource notification and the live-update
 *     emit moved to services/agent-message-send.ts, which aimeat_message_send now calls as well. The
 *     two copies had drifted on `processedAt`, on the emit's owner scope, on the notified resource URI
 *     and on the option-prompt metadata. What stays here: the access check, the agent 404, the
 *     identity resolution and the HTTP answer.
 *   v1.4.0 -- 2026-08-01 -- TARGET-058 Phase 9 step 0. A message sent here is stamped, and all three
 *     read paths (inbox, history, the mount composite) carry the record on the row via one shared
 *     withProvenance(). Before this the agent→owner chat was the last human-facing surface where a
 *     model could write prose into a person's reading and nothing on the row said so.
 *   v1.3.0 -- 2026-07-16 -- Add GET /:name/messages/overview composite (commands + enriched threads +
 *     page-1 messages) folding the Messages subtab mount (AgentMessagesOverviewService).
 *   v1.2.0 -- 2026-06-06 -- Task-based threads: threadId defaults to linked_task_id when no
 *     thread_id is given (a task's whole conversation stays in one thread). The threads list now
 *     resolves the linked task's title so the UI can label threads by task name, not "Thread".
 *   v1.1.0 -- 2026-05-23 -- Add webhook dispatch for message.inbound events
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentMessageRecord } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, buildGAII, isSameOwner } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { AgentMessageStatusSchema } from '../models/agent-message-schemas.js';
import { createAgentMessagesOverviewService } from '../services/db/agent-messages-overview-db-service.js';
import { loadServedProvenanceMany, provenanceItemBlock } from '../services/ai-provenance-marks.js';
import { sendAgentMessage } from '../services/agent-message-send.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
import { logger } from '../utils/logger.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

export function agentMessagesRouter(config: AimeatConfig, storage: Storage, webhookDispatcher?: WebhookDispatcher): Router {
  const router = Router();

  /** Resolve effective identity -- owner sessions use GHII, agents use GAII */
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /**
   * TARGET-058: attach each message's provenance record to the rows about to be served.
   *
   * Every read path here goes through this one function rather than each shaping its own block, so
   * the inbox, the history page and the mount composite cannot end up disagreeing about whether a
   * message says how it was made. ONE query for the whole page (loadServedProvenanceMany); a page of
   * human-written messages costs an empty map and adds no key.
   *
   * The caller has already passed canAccessAgent() — that is the authorization argument, and it is
   * the same one every other surface uses: provenance travels with the content it describes.
   */
  async function withProvenance(messages: AgentMessageRecord[]): Promise<unknown[]> {
    const byId = await loadServedProvenanceMany(storage, config, messages.map(m => m.aiProvenanceId));
    return messages.map(m => ({
      ...m,
      ...provenanceItemBlock(m.aiProvenanceId ? byId.get(m.aiProvenanceId) : undefined),
    }));
  }

  /** Check if current session can access an agent's messages */
  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const roles = req.auth!.roles as string[];
    const isOwnerSession = roles.includes('owner') && !roles.includes('agent');
    if (isOwnerSession) return true;
    // Agent can access own messages
    if (roles.includes('agent')) {
      const gaii = resolveAgentGaii(req, agentName);
      return req.auth!.sub === gaii;
    }
    return false;
  }

  /* ── POST /v1/agents/:name/messages -- Send a message ── */
  router.post('/v1/agents/:name/messages', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    // Verify agent exists
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Determine sender identity
    const roles = req.auth!.roles as string[];
    const isOwnerSession = roles.includes('owner') && !roles.includes('agent');
    const senderGaii = isOwnerSession
      ? `${req.auth!.owner}@${config.nodeId}`
      : req.auth!.sub as string;

    // Validation, the record build, the provenance stamp and the push side effects live in the
    // service, which aimeat_message_send calls too, so the two doors cannot describe the same
    // message differently. What is left here is the HTTP answer.
    const result = await sendAgentMessage(
      { storage, config, webhooks: webhookDispatcher, emitResourceUpdated },
      { agentGaii, senderGaii, body: req.body, pipeline: 'rest.agent_message_send' },
    );
    if (!result.ok) {
      res.status(result.status).json(error(config.nodeId, result.code, result.message));
      return;
    }
    const created = result.message;

    res.status(201).json(success(config.nodeId, { message: created }, [
      { description: 'View messages', method: 'GET', url: `/v1/agents/${agentName}/messages` },
      { description: 'View thread', method: 'GET', url: `/v1/agents/${agentName}/messages?thread_id=${created.threadId}` },
      { description: 'View inbox', method: 'GET', url: `/v1/agents/${agentName}/messages/inbox` },
    ]));
  });

  /* ── GET /v1/agents/:name/messages/inbox -- Pending inbound messages ── */
  router.get('/v1/agents/:name/messages/inbox', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const messages = await storage.listPendingMessages(agentGaii);

    res.json(success(config.nodeId, { messages: await withProvenance(messages) }));
  });

  /* ── GET /v1/agents/:name/messages/threads -- List conversation threads ── */
  // GET /v1/agents/:name/messages/overview — the Messages subtab mount in ONE call: command palette
  // (memory) + enriched threads + message history (page 1). Folds getAgentCommands + /messages/threads +
  // /messages. Owner-or-self via canAccessAgent. Registered before /messages/threads and /messages (a more
  // specific literal path, no shadow).
  const messagesOverviewDb = createAgentMessagesOverviewService(storage);
  router.get('/v1/agents/:name/messages/overview', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }
    const agentGaii = resolveAgentGaii(req, agentName);
    const data = await messagesOverviewDb.overview(agentGaii, agentName);
    // The composite mirrors GET /messages page 1, so it carries the same provenance block — a mount
    // that showed no label while the interactive re-fetch showed one would be a label that appears
    // when you click and vanishes when you reload.
    res.json(success(config.nodeId, {
      ...data,
      messages: { ...data.messages, messages: await withProvenance(data.messages.messages as AgentMessageRecord[]) },
    }));
  });

  router.get('/v1/agents/:name/messages/threads', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const threads = await storage.listThreads(agentGaii);

    // Threads are task-based: a task-linked thread uses the task id as its
    // threadId. Resolve the task title so the UI can label the thread with the
    // task name instead of a generic "Thread". Cache lookups so several threads
    // pointing at the same task only hit storage once.
    const taskCache = new Map<string, string | null>();
    const resolveTaskTitle = async (threadId: string): Promise<string | null> => {
      if (taskCache.has(threadId)) return taskCache.get(threadId) ?? null;
      const task = await storage.getAgentTask(threadId).catch(err => { logger.warn('resolveTaskTitle: continuing after a suppressed failure', { error: String(err) }); return null; });
      const title = task?.title ?? null;
      taskCache.set(threadId, title);
      return title;
    };
    const enriched = await Promise.all(threads.map(async (thread) => {
      const title = await resolveTaskTitle(thread.threadId);
      return { ...thread, title, linkedTaskId: title !== null ? thread.threadId : null };
    }));

    res.json(success(config.nodeId, { threads: enriched }));
  });

  /* ── GET /v1/agents/:name/messages -- List message history ── */
  router.get('/v1/agents/:name/messages', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page as string || '20', 10)));
    const direction = req.query.direction as 'inbound' | 'outbound' | undefined;
    const threadId = req.query.thread_id as string | undefined;

    const result = await storage.listMessages(agentGaii, { direction, threadId, page, perPage });

    res.json(success(config.nodeId, {
      messages: await withProvenance(result.messages),
      total: result.total,
      page,
      per_page: perPage,
    }));
  });

  /* ── PATCH /v1/agents/:name/messages/:id -- Update message status ── */
  router.patch('/v1/agents/:name/messages/:id', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const id = req.params.id as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    // Validate body
    const parsed = AgentMessageStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const { status } = parsed.data;
    const processedAt = status === 'delivered' || status === 'error'
      ? new Date().toISOString()
      : undefined;

    // canAccessAgent() above answers "may you act as the agent NAMED IN THE PATH", and it builds
    // that name against the caller's OWN owner — so it is a real check and it is not this one. The
    // message id is a separate, client-supplied coordinate, and updateMessageStatus took it on its
    // own: any agent could flip the status of any message on the node by id, and the response hands
    // back the whole updated row, so the write doubled as a read of somebody else's message. The
    // record decides now, which is the rule the identity model states — authorize against the
    // resolved identity, never against a name in the request.
    const existing = await storage.getMessage(id);
    if (!existing || !isSameOwner(existing.agentGaii, resolve(req))) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Message not found'));
      return;
    }
    if (req.auth!.roles.includes('agent') && existing.agentGaii !== req.auth!.sub) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Message not found'));
      return;
    }

    const updated = await storage.updateMessageStatus(id, status, processedAt);
    if (!updated) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Message not found'));
      return;
    }

    res.json(success(config.nodeId, { message: updated }));
    emitChange('agent-messages', resolve(req));
  });

  return router;
}
