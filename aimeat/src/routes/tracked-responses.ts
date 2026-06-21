/**
 * @file tracked-responses.ts
 * @description Generic REST surface for Tracked Responses — the Memory Contract that owes a (possibly
 *   federated) reply to an inbox message once a watched memory key satisfies a condition. Protocol-only:
 *   it reads/writes owner memory + reads direct messages; no service-specific logic. Create authoritatively
 *   derives the reply target from the stored message (the client is not trusted for it). See
 *   docs/specs/tracked-response-contract.md and docs/coding-guidelines/memory-contracts.md.
 * @structure
 *   - GET    /v1/tracked-responses/spec              -- self-description (open)
 *   - POST   /v1/tracked-responses/evaluate-due      -- evaluate the caller's own contracts now
 *   - POST   /v1/tracked-responses                   -- create from a message
 *   - GET    /v1/tracked-responses[?state=]          -- list the caller's contracts
 *   - GET    /v1/tracked-responses/:id               -- one contract
 *   - GET    /v1/tracked-responses/:id/draft         -- the suggested reply (approve mode)
 *   - POST   /v1/tracked-responses/:id/evaluate      -- evaluate one contract now
 *   - POST   /v1/tracked-responses/:id/replied       -- mark replied (after manual send)
 *   - POST   /v1/tracked-responses/:id/cancel        -- cancel + deregister
 * @usage app.use(trackedResponsesRouter(config, storage, peers));
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial Tracked Response routes (first Memory Contract instance).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, parseGaiiLoose } from '../utils/gaii.js';
import { messagePreview } from '../utils/messaging.js';
import type { DeliveryCtx } from '../services/message-delivery.js';
import {
  createTrackedResponse, getTrackedResponse, listTrackedResponses, cancelTrackedResponse,
  markReplied, evaluateOwnerTrackedResponses, evaluateTrackedKey, TRACKED_RESPONSE_SPEC,
  type TrackedResponseState, type CreateTrackedResponseInput,
} from '../services/tracked-response.js';

export function trackedResponsesRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
  const router = Router();
  const ctx: DeliveryCtx = { config, storage, peers };
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  // GET /v1/tracked-responses/spec — self-description (open; any honoring system can fetch it).
  router.get('/v1/tracked-responses/spec', (_req, res) => {
    res.json(success(config.nodeId, TRACKED_RESPONSE_SPEC));
  });

  // POST /v1/tracked-responses/evaluate-due — evaluate the caller's own contracts now (test/manual).
  router.post('/v1/tracked-responses/evaluate-due', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const result = await evaluateOwnerTrackedResponses(ctx, resolve(req));
      res.json(success(config.nodeId, result));
    } catch (e) {
      res.status(500).json(error(config.nodeId, 'EVALUATE_FAILED', (e as Error).message));
    }
  });

  // POST /v1/tracked-responses — create from an inbox message the caller owns.
  router.post('/v1/tracked-responses', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGhii = resolve(req);
    const body = req.body as {
      message_id?: string;
      watch?: { key?: string; condition?: { field?: string; equals?: unknown } };
      references?: Record<string, unknown>;
      response?: { mode?: string; template?: string; inject?: { from?: string; field?: string } };
      title?: string;
      tier?: string;
    };

    if (!body.message_id || typeof body.message_id !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'message_id is required'));
      return;
    }
    if (!body.watch?.key || !body.watch.condition?.field || body.watch.condition.equals === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'watch.key and watch.condition.{field,equals} are required'));
      return;
    }

    // Authoritatively derive the reply target from the stored message (never trust the client).
    const msg = await storage.getDirectMessage(body.message_id, ownerGhii);
    if (!msg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such message in your mailbox'));
      return;
    }
    const peerGhii = msg.direction === 'inbound' ? msg.senderGhii : msg.recipientGhii;

    const mode = body.response?.mode === 'auto' ? 'auto' : 'approve';
    const input: CreateTrackedResponseInput = {
      title: (body.title && body.title.trim()) || messagePreview(msg.body) || 'Tracked response',
      tier: body.tier,
      source: {
        kind: 'message',
        messageId: msg.id,
        conversationId: msg.conversationId,
        peerGhii,
        ownerGhii,
        originNodeId: parseGaiiLoose(peerGhii).node || config.nodeId,
        preview: messagePreview(msg.body),
      },
      watch: { key: body.watch.key, condition: { field: body.watch.condition.field, equals: body.watch.condition.equals } },
      references: body.references || {},
      response: {
        channel: 'message.reply',
        mode,
        template: body.response?.template,
        inject: body.response?.inject?.field ? { from: body.response.inject.from, field: body.response.inject.field } : undefined,
      },
    };

    try {
      const c = await createTrackedResponse(ctx, ownerGhii, input);
      res.status(201).json(success(config.nodeId, { trackedResponse: c }, [
        { description: 'View contract', method: 'GET', url: `/v1/tracked-responses/${c.id}` },
      ]));
    } catch (e) {
      res.status(500).json(error(config.nodeId, 'CREATE_FAILED', (e as Error).message));
    }
  });

  // GET /v1/tracked-responses[?state=] — list.
  router.get('/v1/tracked-responses', requireAuth(), requireRole('owner'), async (req, res) => {
    const state = req.query.state as TrackedResponseState | undefined;
    const list = await listTrackedResponses(storage, resolve(req), state);
    res.json(success(config.nodeId, { trackedResponses: list }));
  });

  // GET /v1/tracked-responses/:id — one.
  router.get('/v1/tracked-responses/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const c = await getTrackedResponse(storage, resolve(req), req.params.id as string);
    if (!c) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such tracked response')); return; }
    res.json(success(config.nodeId, { trackedResponse: c }));
  });

  // GET /v1/tracked-responses/:id/draft — the suggested reply built when an approve-mode contract fired.
  router.get('/v1/tracked-responses/:id/draft', requireAuth(), requireRole('owner'), async (req, res) => {
    const ownerGhii = resolve(req);
    const c = await getTrackedResponse(storage, ownerGhii, req.params.id as string);
    if (!c) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such tracked response')); return; }
    const draft = c.delivery.draftKey ? await storage.getMemory(ownerGhii, c.delivery.draftKey) : null;
    res.json(success(config.nodeId, { draft: draft?.value ?? null, source: c.source, state: c.state }));
  });

  // POST /v1/tracked-responses/:id/evaluate — evaluate this contract's watched key now.
  router.post('/v1/tracked-responses/:id/evaluate', requireAuth(), requireRole('owner'), async (req, res) => {
    const c = await getTrackedResponse(storage, resolve(req), req.params.id as string);
    if (!c) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such tracked response')); return; }
    try {
      await evaluateTrackedKey(ctx, c.watch.key);
      const updated = await getTrackedResponse(storage, resolve(req), req.params.id as string);
      res.json(success(config.nodeId, { trackedResponse: updated }));
    } catch (e) {
      res.status(500).json(error(config.nodeId, 'EVALUATE_FAILED', (e as Error).message));
    }
  });

  // POST /v1/tracked-responses/:id/replied — mark replied after the owner sent the (edited) draft.
  router.post('/v1/tracked-responses/:id/replied', requireAuth(), requireRole('owner'), async (req, res) => {
    const sentId = (req.body as { sent_message_id?: string })?.sent_message_id;
    const c = await markReplied(storage, resolve(req), req.params.id as string, sentId);
    if (!c) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such tracked response')); return; }
    res.json(success(config.nodeId, { trackedResponse: c }));
  });

  // POST /v1/tracked-responses/:id/cancel — cancel + deregister.
  router.post('/v1/tracked-responses/:id/cancel', requireAuth(), requireRole('owner'), async (req, res) => {
    const c = await cancelTrackedResponse(storage, resolve(req), req.params.id as string);
    if (!c) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such tracked response')); return; }
    res.json(success(config.nodeId, { trackedResponse: c }));
  });

  return router;
}
