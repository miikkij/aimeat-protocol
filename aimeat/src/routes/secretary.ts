/**
 * @file routes/secretary.ts
 * @description Secretary-specific server endpoints that must act AS the secretary agent (which the
 *   owner's browser session can't do directly). Currently: the clarify channel — when a task lacks
 *   facts, the Secretary asks the owner a batch of structured questions (a federated AskUserQuestion)
 *   in the inbox rather than hallucinating, and records a pending "produce" job the autonomous tick
 *   resumes once the owner answers. The questions/answers reuse the DM interactive payload, so the
 *   exact same mechanism serves specialists/agents.
 * @structure secretaryRouter(config, storage, peers) -> Router
 *   - POST /v1/secretary/clarify — send the questions secretary#owner→owner + store the produce job
 * @usage app.use(secretaryRouter(config, storage, peers));
 * @version-history
 *   v0.1.0 — 2026-06-28 — Clarify channel: ask-don't-hallucinate via inbox questions + a tick-resumed job.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { sendDirectMessage } from '../services/message-send.js';
import { InteractiveQuestionSchema } from '../models/message-schemas.js';

const ClarifySchema = z.object({
  contextId: z.string().min(1).max(200),
  contextName: z.string().max(200).optional().default(''),
  action: z.object({ summary: z.string().min(1).max(2000), why: z.string().max(2000).optional().default('') }),
  questions: z.array(InteractiveQuestionSchema).min(1).max(20),
  facts: z.string().max(200000).optional().default(''),
  organismId: z.string().max(200).optional().default(''),
  wsId: z.string().max(200).optional().default(''),
  body: z.string().max(4000).optional().default(''),
});

export function secretaryRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
  const router = Router();

  // ── POST /v1/secretary/clarify ── ask the owner a batch of questions AS the secretary, store the job.
  router.post('/v1/secretary/clarify', requireAuth(), requireRole('owner'), async (req, res) => {
    const parsed = ClarifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Invalid clarify payload'));
      return;
    }
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const secretaryGaii = `secretary#${owner}@${config.nodeId}`;
    const { contextId, contextName, action, questions, facts, organismId, wsId, body } = parsed.data;

    const result = await sendDirectMessage({ config, storage, peers }, {
      senderGhii: secretaryGaii,
      recipientGhii: ownerGhii,
      body: body || `I need a few details before I can do this well: "${action.summary}".`,
      interactive: { role: 'questions', v: 1, questions },
      skipContactGate: true,
    });
    if (!result.ok) {
      res.status(502).json(error(config.nodeId, 'SEND_FAILED', `Could not post the questions (${result.code})`));
      return;
    }

    const messageId = result.message.id;
    const now = new Date().toISOString();
    const key = `secretary.clarify.${messageId}`;
    await storage.setMemory({
      key, ownerGaii: ownerGhii,
      value: { id: messageId, conversationId: result.message.conversationId, questionId: messageId, questions, action, facts, contextId, contextName, organismId, wsId, status: 'asked', createdAt: now },
      visibility: 'private', tags: ['secretary', 'clarify', 'asked'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });

    res.json(success(config.nodeId, { messageId, conversationId: result.message.conversationId, status: 'asked' }, [
      { description: 'Answer in your inbox', method: 'GET', url: '/v1/messages/inbox' },
    ]));
  });

  return router;
}
