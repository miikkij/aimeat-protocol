/**
 * @file agent-webhook.ts
 * @description REST endpoints for agent webhook CRUD (register, get, delete, test, delivery log).
 *   Owners can manage webhooks for any of their agents; agents can manage their own.
 * @structure
 *   - PUT    /v1/agents/:name/webhook       -- Register or update webhook
 *   - GET    /v1/agents/:name/webhook       -- Get webhook config and status
 *   - DELETE /v1/agents/:name/webhook       -- Remove webhook
 *   - POST   /v1/agents/:name/webhook/test  -- Send a test event to the webhook
 *   - GET    /v1/agents/:name/webhook/log   -- Get delivery log
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Dashboard webhook management
 */

import { Router } from 'express';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { validateOutboundUrl, safeFetch } from '../utils/url-validator.js';
import { emitChange } from '../services/event-bus.js';

/* ── Zod validation schema ── */
const WebhookPutSchema = z.object({
  url: z.string().url().max(2048),
  secret: z.string().min(16).max(256).optional(),
});

export function agentWebhookRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Build GAII for the named agent under the authenticated owner */
  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  /** Check if current session can access an agent's webhook */
  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const roles = req.auth!.roles as string[];
    const isOwnerSession = roles.includes('owner') && !roles.includes('agent');
    if (isOwnerSession) return true;
    if (roles.includes('agent')) {
      return req.auth!.sub === resolveAgentGaii(req, agentName);
    }
    return false;
  }

  /* ── PUT /v1/agents/:name/webhook -- Register or update webhook ── */
  router.put('/v1/agents/:name/webhook', requireAuth(), async (req, res) => {
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
    const parsed = WebhookPutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')));
      return;
    }

    const { url, secret } = parsed.data;

    // SSRF check
    const urlCheck = await validateOutboundUrl(url);
    if (!urlCheck.valid) {
      res.status(400).json(error(config.nodeId, 'INVALID_URL', urlCheck.reason ?? 'URL is not allowed'));
      return;
    }

    // Generate a random secret if not provided
    const webhookSecret = secret ?? randomBytes(32).toString('hex');

    await storage.updateAgent(agentGaii, {
      webhookUrl: url,
      webhookSecret,
      webhookEnabled: true,
      webhookFailCount: 0,
    });

    emitChange('agents');

    res.json(success(config.nodeId, {
      url,
      secret: webhookSecret,
      enabled: true,
    }));
  });

  /* ── GET /v1/agents/:name/webhook -- Get webhook config and status ── */
  router.get('/v1/agents/:name/webhook', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    if (!agent.webhookUrl) {
      res.json(success(config.nodeId, {
        configured: false,
      }));
      return;
    }

    res.json(success(config.nodeId, {
      configured: true,
      url: agent.webhookUrl,
      enabled: agent.webhookEnabled ?? false,
      last_success: agent.webhookLastSuccess ?? null,
      last_failure: agent.webhookLastFailure ?? null,
      fail_count: agent.webhookFailCount ?? 0,
    }));
  });

  /* ── DELETE /v1/agents/:name/webhook -- Remove webhook ── */
  router.delete('/v1/agents/:name/webhook', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    // Use null (cast through any) to clear nullable fields in MongoDB/Prisma.
    // Prisma treats undefined as "don't update" but null as "set to null".
    await storage.updateAgent(agentGaii, {
      webhookUrl: null,
      webhookSecret: null,
      webhookEnabled: false,
      webhookFailCount: 0,
      webhookLastSuccess: null,
      webhookLastFailure: null,
    } as any);

    emitChange('agents');

    res.json(success(config.nodeId, { removed: true }));
  });

  /* ── POST /v1/agents/:name/webhook/test -- Send test event ── */
  router.post('/v1/agents/:name/webhook/test', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    if (!agent.webhookUrl || !agent.webhookSecret) {
      res.status(400).json(error(config.nodeId, 'NO_WEBHOOK', 'No webhook configured for this agent'));
      return;
    }

    // Build test payload
    const payload = {
      event: 'webhook.test',
      agent: agentGaii,
      node: config.nodeId,
      timestamp: new Date().toISOString(),
      data: { message: 'Webhook test delivery' },
    };

    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', agent.webhookSecret).update(body).digest('hex');

    const startMs = Date.now();
    let httpStatus: number | undefined;
    let deliveryError: string | undefined;

    try {
      // safeFetch validates the stored webhook URL + re-validates redirects (SSRF guard).
      const resp = await safeFetch(agent.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AIMEAT-Signature': `sha256=${signature}`,
          'X-AIMEAT-Event': 'webhook.test',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = resp.status;

      if (!resp.ok) {
        deliveryError = `HTTP ${resp.status}`;
      }
    } catch (err) {
      deliveryError = err instanceof Error ? err.message : 'Delivery failed';
    }

    const latencyMs = Date.now() - startMs;
    const deliveryStatus = deliveryError ? 'failed' : 'success';

    // Log the delivery
    await storage.appendDeliveryLog({
      id: randomUUID(),
      agentGaii,
      event: 'webhook.test',
      payload,
      status: deliveryStatus,
      httpStatus,
      errorMessage: deliveryError,
      attemptCount: 1,
      latencyMs,
      createdAt: new Date().toISOString(),
    });

    // Update last success/failure on the agent
    const now = new Date().toISOString();
    if (deliveryStatus === 'success') {
      await storage.updateAgent(agentGaii, { webhookLastSuccess: now });
    } else {
      await storage.updateAgent(agentGaii, {
        webhookLastFailure: now,
        webhookFailCount: (agent.webhookFailCount ?? 0) + 1,
      });
    }

    res.json(success(config.nodeId, {
      delivered: deliveryStatus === 'success',
      status: deliveryStatus,
      http_status: httpStatus ?? null,
      error: deliveryError ?? null,
      latency_ms: latencyMs,
    }));
  });

  /* ── GET /v1/agents/:name/webhook/log -- Delivery log ── */
  router.get('/v1/agents/:name/webhook/log', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const deliveries = await storage.listDeliveryLog(agentGaii, limit);

    res.json(success(config.nodeId, { deliveries }));
  });

  return router;
}
