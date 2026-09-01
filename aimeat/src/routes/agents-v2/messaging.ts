/**
 * @file src/routes/agents-v2/messaging.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agent v2 message doors, and the delivery target a principal registers.
 *
 *     POST   /v1/agents/v2/messages              send one turn
 *     GET    /v1/agents/v2/messages              read them back (by context, task, party or since)
 *     GET    /v1/agents/v2/messages/:messageId   one turn
 *     PUT    /v1/agents/v2/push-config           register or replace a delivery target
 *     GET    /v1/agents/v2/push-config           what is registered
 *     DELETE /v1/agents/v2/push-config/:id       stop delivering there
 *
 *   NOTHING HERE TOUCHES THE FIVE MESSAGE KINDS THIS NODE ALREADY HAS. Agent messages, direct
 *   messages, notifications, web push and boards answer their own questions and answer them
 *   unchanged; the reasoning for a sixth is in storage/types/agent-v2-messaging.ts.
 *
 *   THIS FILE IS A SHAPE, NOT A DECISION. Every gate, resolution and refusal lives in
 *   services/agent-v2-messaging-ops.ts, which the MCP and CLI doors call too. What is here is the
 *   HTTP of it: which scope the middleware checks, which status a refusal takes, what the envelope
 *   looks like. Put a rule in here and the other three doors will not have it.
 *
 * @structure registerAgentV2MessagingRoutes(router, config, storage)
 * @usage registerAgentV2MessagingRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import type { Router, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { MESSAGE_SPEC } from '../../models/agent-v2-message.js';
import {
  sendTurn, listTurns, getTurn, setPushTarget, listPushTargets, deletePushTarget,
  type OpResult,
} from '../../services/agent-v2-messaging-ops.js';

/** One refusal, in HTTP. The operation already decided the status and the words. */
function refuse(res: Response, nodeId: string, out: Extract<OpResult<unknown>, { ok: false }>): void {
  res.status(out.status).json(error(nodeId, out.code, out.message, undefined, out.details));
}

export function registerAgentV2MessagingRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // `messages:send` is the same permission word the existing direct-message door uses, because it
  // is the same act: this principal may send on this account's behalf. A new word would mean an
  // owner granting two permissions to describe one thing.
  router.post('/v1/agents/v2/messages', requireAuth(), requireScope('messages:send'), async (req, res) => {
    const out = await sendTurn(storage, config, req.auth!, req.body);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.status(201).json(success(config.nodeId, { spec: MESSAGE_SPEC, message: out.value }, [
      { description: 'Read the exchange', method: 'GET', url: `/v1/agents/v2/messages?context_id=${encodeURIComponent(out.value.contextId)}` },
    ]));
  });

  router.get('/v1/agents/v2/messages', requireAuth(), requireScope('messages:read'), async (req, res) => {
    const out = await listTurns(storage, req.auth!, {
      context_id: req.query.context_id as string | undefined,
      task_id: req.query.task_id as string | undefined,
      to: req.query.to as string | undefined,
      from: req.query.from as string | undefined,
      since: req.query.since as string | undefined,
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
    });
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { spec: MESSAGE_SPEC, messages: out.value, count: out.value.length }));
  });

  router.get('/v1/agents/v2/messages/:messageId', requireAuth(), requireScope('messages:read'), async (req, res) => {
    const out = await getTurn(storage, req.auth!, req.params.messageId as string);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { spec: MESSAGE_SPEC, message: out.value }));
  });

  // `agent:write` rather than a messaging word: this configures a PRINCIPAL, and what it configures
  // is where this node will make an outbound call carrying a secret. Same class of act as setting
  // an agent's webhook, same permission.
  router.put('/v1/agents/v2/push-config', requireAuth(), requireScope('agent:write'), async (req, res) => {
    const out = await setPushTarget(storage, config, req.auth!, req.body);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.status(out.value.created ? 201 : 200).json(success(config.nodeId, { push_config: out.value.config }, [
      { description: 'What is registered', method: 'GET', url: '/v1/agents/v2/push-config' },
    ]));
  });

  router.get('/v1/agents/v2/push-config', requireAuth(), requireScope('messages:read'), async (req, res) => {
    const out = await listPushTargets(storage, config, req.auth!, req.query.principal as string | undefined);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { push_configs: out.value, count: out.value.length }));
  });

  router.delete('/v1/agents/v2/push-config/:id', requireAuth(), requireScope('agent:write'), async (req, res) => {
    const out = await deletePushTarget(storage, config, req.auth!, req.params.id as string);
    if (!out.ok) { refuse(res, config.nodeId, out); return; }
    res.json(success(config.nodeId, { deleted: out.value }));
  });
}
