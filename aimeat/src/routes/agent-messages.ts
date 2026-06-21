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
 *   v1.2.0 -- 2026-06-06 -- Task-based threads: threadId defaults to linked_task_id when no
 *     thread_id is given (a task's whole conversation stays in one thread). The threads list now
 *     resolves the linked task's title so the UI can label threads by task name, not "Thread".
 *   v1.1.0 -- 2026-05-23 -- Add webhook dispatch for message.inbound events
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentMessageRecord } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { AgentMessageCreateSchema, AgentMessageStatusSchema } from '../models/agent-message-schemas.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';

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

    // Validate body
    const parsed = AgentMessageCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const body = parsed.data;
    const now = new Date().toISOString();
    const id = randomUUID();
    // Thread = task: when a message is linked to a task but no explicit thread is
    // given, group it under the task's id so a task's whole conversation (the
    // agent's clarifications + the owner's answers) stays in ONE thread instead
    // of spawning a fresh random thread per message. Falls back to a random
    // thread only for ad-hoc, task-less chat.
    const threadId = body.thread_id ?? body.linked_task_id ?? randomUUID();

    // Determine sender identity
    const roles = req.auth!.roles as string[];
    const isOwnerSession = roles.includes('owner') && !roles.includes('agent');
    const senderGaii = isOwnerSession
      ? `${req.auth!.owner}@${config.nodeId}`
      : req.auth!.sub as string;

    // Owner sends inbound (user->agent), agent sends outbound (agent->user)
    const status = body.direction === 'inbound' ? 'pending' : 'delivered';

    const record: AgentMessageRecord = {
      id,
      agentGaii,
      threadId,
      direction: body.direction,
      senderGaii,
      content: body.content,
      status,
      linkedTaskId: body.linked_task_id,
      metadata: body.metadata ? {
        tokensUsed: body.metadata.tokens_used,
        processingMs: body.metadata.processing_ms,
        proposedTask: body.metadata.proposed_task,
        prompt: body.metadata.prompt ? {
          promptId: body.metadata.prompt.prompt_id,
          question: body.metadata.prompt.question,
          options: body.metadata.prompt.options,
          allowOther: body.metadata.prompt.allow_other,
        } : undefined,
        promptAnswer: body.metadata.prompt_answer ? {
          promptId: body.metadata.prompt_answer.prompt_id,
          choice: body.metadata.prompt_answer.choice,
          isOther: body.metadata.prompt_answer.is_other,
        } : undefined,
      } : undefined,
      createdAt: now,
    };

    const created = await storage.createMessage(record);

    // Push: webhook + MCP notification (parallel, fire-and-forget)
    if (record.direction === 'inbound') {
      if (webhookDispatcher) {
        webhookDispatcher.dispatchWebhookEvent(agentGaii, 'message.inbound', {
          message_id: record.id,
          thread_id: record.threadId,
          linked_task_id: record.linkedTaskId ?? null,
          preview: record.content.substring(0, 200),
          has_proposed_task: !!(record.metadata?.proposedTask),
          has_prompt_answer: !!(record.metadata?.promptAnswer),
          created_at: record.createdAt,
        });
      }
      try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/messages`); } catch { /* MCP not connected */ }
    }

    res.status(201).json(success(config.nodeId, { message: created }, [
      { description: 'View messages', method: 'GET', url: `/v1/agents/${agentName}/messages` },
      { description: 'View thread', method: 'GET', url: `/v1/agents/${agentName}/messages?thread_id=${threadId}` },
      { description: 'View inbox', method: 'GET', url: `/v1/agents/${agentName}/messages/inbox` },
    ]));
    emitChange('agent-messages', resolve(req));
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

    res.json(success(config.nodeId, { messages }));
  });

  /* ── GET /v1/agents/:name/messages/threads -- List conversation threads ── */
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
      const task = await storage.getAgentTask(threadId).catch(() => null);
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
      messages: result.messages,
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
