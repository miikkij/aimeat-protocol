import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { generateTrackingCode } from '../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow, settlePayment } from '../services/morsel.js';
import { logger } from '../utils/logger.js';
import { executeHooks } from '../services/hooks.js';
import { WorkRequestSchema, WorkBatchSchema, WorkDeliverySchema, WorkRatingSchema, validateBody } from '../models/schemas.js';
import { checkOtkSession } from './auth.js';
import { resolveGaii } from '../services/federation.js';
import type { PeerInfo } from '../services/federation.js';

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

/** Webhook delivery log entry (in-memory, recent deliveries only). */
interface WebhookLogEntry {
  url: string;
  trackingCode: string;
  event: string;
  attempt: number;
  status: 'success' | 'failed' | 'retrying';
  httpStatus?: number;
  error?: string;
  timestamp: string;
}
const webhookLog: WebhookLogEntry[] = [];
const MAX_WEBHOOK_LOG = 500;

/** Get recent webhook delivery log entries. */
export function getWebhookLog(): WebhookLogEntry[] {
  return webhookLog;
}

/**
 * Webhook POST with exponential backoff (§10.7).
 * Retries up to maxRetries times with delays: 1s, 2s, 4s, 8s, 16s, ...
 */
function fireWebhook(url: string, payload: Record<string, unknown>, maxRetries: number): void {
  const body = JSON.stringify(payload);
  const event = (payload.event as string) ?? 'unknown';
  const trackingCode = (payload.tracking_code as string) ?? '';
  const doFetch = (attempt: number) => {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    }).then(resp => {
      const entry: WebhookLogEntry = {
        url, trackingCode, event, attempt,
        status: resp.ok ? 'success' : 'failed',
        httpStatus: resp.status,
        timestamp: new Date().toISOString(),
      };
      if (!resp.ok && attempt < maxRetries) {
        entry.status = 'retrying';
      }
      webhookLog.push(entry);
      if (webhookLog.length > MAX_WEBHOOK_LOG) webhookLog.splice(0, webhookLog.length - MAX_WEBHOOK_LOG);
      if (!resp.ok && attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        setTimeout(() => doFetch(attempt + 1), delay);
      }
    }).catch(err => {
      const entry: WebhookLogEntry = {
        url, trackingCode, event, attempt,
        status: attempt < maxRetries ? 'retrying' : 'failed',
        error: String(err),
        timestamp: new Date().toISOString(),
      };
      webhookLog.push(entry);
      if (webhookLog.length > MAX_WEBHOOK_LOG) webhookLog.splice(0, webhookLog.length - MAX_WEBHOOK_LOG);
      logger.warn(`Webhook delivery failed (attempt ${attempt}/${maxRetries})`, { url, error: String(err) });
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        setTimeout(() => doFetch(attempt + 1), delay);
      }
    });
  };
  doFetch(1);
}

async function createWorkItem(
  config: AimeatConfig,
  storage: Storage,
  requesterGaii: string,
  body: any,
  peers: Map<string, PeerInfo>,
) {
  const { action_id, provider_gaii, input, ttl_hours, callback_url, priority } = body;

  if (!action_id || !provider_gaii || input === undefined) {
    return { error: 'action_id, provider_gaii, and input are required', status: 400, code: 'INVALID_INPUT' };
  }

  // Extension hook: pre_work_request
  const hookResult = await executeHooks(config, storage, 'pre_work_request', {
    requester_gaii: requesterGaii, action_id, provider_gaii,
  });
  if (!hookResult.allowed) {
    return { error: hookResult.reason ?? 'Work request denied by extension hook', status: 403, code: 'HOOK_REJECTED' };
  }

  // Resolve provider location — local or remote?
  const resolved = await resolveGaii(provider_gaii, config, storage, peers);

  // Check if the resolved GAII is on a personal node anchored to this operator
  let personalNodeTarget: string | null = null;
  if (resolved && !resolved.local && resolved.nodeUrl === config.baseUrl) {
    // This is a personal node agent — treat as local work, notify via tunnel/mailbox later
    personalNodeTarget = resolved.nodeId;
  } else if (resolved && !resolved.local) {
    // Charge 1 morsel cross-node routing fee (§15)
    const requester = await storage.getAgent(requesterGaii);
    if (!requester || requester.morselBalance < 1) {
      return { error: 'Insufficient morsels for cross-node routing fee (1 morsel)', status: 402, code: 'INSUFFICIENT_MORSELS' };
    }
    await storage.updateAgent(requesterGaii, { morselBalance: requester.morselBalance - 1 });
    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii: requesterGaii,
      type: 'routing_fee',
      amount: -1,
      trackingCode: `route:${resolved.nodeId}`,
      timestamp: new Date().toISOString(),
    });

    // Forward work request to the remote node
    try {
      const resp = await fetch(`${resolved.nodeUrl}/v1/work/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MEAT-Origin-Node': config.nodeId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const remoteResult = await resp.json() as Record<string, unknown>;
      return { forwarded: true, remoteStatus: resp.status, remoteResult };
    } catch (err) {
      logger.warn('Failed to forward work request to remote node', { nodeUrl: resolved.nodeUrl, error: String(err) });
      return { error: `Remote node ${resolved.nodeId} unreachable`, status: 502, code: 'REMOTE_UNREACHABLE' };
    }
  }

  const ttl = ttl_hours ?? 24;
  const now = new Date();
  const trackingCode = generateTrackingCode();

  // Look up action to get pricing
  const actions = await storage.listActions();
  const action = actions.find(a => a.id === action_id && a.providerGaii === provider_gaii);

  // W-2: Enforce max pending work items per provider (Appendix B)
  const providerWork = await storage.listWorkByProvider(provider_gaii);
  const pendingCount = providerWork.filter(w => ['pending', 'accepted', 'in_progress'].includes(w.status)).length;
  if (pendingCount >= config.workQueueMaxPending) {
    return {
      error: `Provider ${provider_gaii} has ${pendingCount} pending work items (max ${config.workQueueMaxPending})`,
      status: 429,
      code: 'QUEUE_FULL',
    };
  }

  const baseMorsels = action?.pricing.baseMorsels ?? 0;
  // §15: priority 'high' costs 2x base price
  const effectiveBase = priority === 'high' ? baseMorsels * 2 : baseMorsels;
  const cost = calculateWorkCost(effectiveBase, config.burnRate);

  // Hold escrow
  const held = await holdEscrow(storage, requesterGaii, provider_gaii, trackingCode, cost.total);
  if (!held) {
    const requester = await storage.getAgent(requesterGaii);
    return {
      error: `You need ${cost.total} morsels but have ${requester?.morselBalance ?? 0}`,
      status: 402,
      code: 'INSUFFICIENT_MORSELS',
      details: { required: cost.total, available: requester?.morselBalance ?? 0 },
    };
  }

  const work = await storage.createWork({
    trackingCode,
    status: 'pending',
    actionId: action_id,
    providerGaii: provider_gaii,
    requesterGaii,
    input,
    cost,
    callbackUrl: callback_url,
    ttlExpiresAt: new Date(now.getTime() + ttl * 3600_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  // If the provider is on a personal node, queue a notification
  if (personalNodeTarget) {
    const { MailboxService } = await import('../services/mailbox.js');
    const mailboxService = new MailboxService(config, storage);
    await mailboxService.enqueue(personalNodeTarget, {
      personalNodeId: personalNodeTarget,
      type: 'work_assignment',
      fromGaii: requesterGaii,
      toGaii: provider_gaii,
      payload: JSON.stringify({
        event: 'work.assigned',
        tracking_code: trackingCode,
        action_id,
        input,
      }),
      sizeBytes: 0,
      retentionDays: 7,
    }).catch(err => logger.warn('Failed to queue work notification for personal node', { nodeId: personalNodeTarget, error: String(err) }));
  }

  return { work, personalNodeTarget };
}

export function workRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
  const router = Router();

  // POST /v1/work/request — submit a work request (spec path)
  router.post('/v1/work/request', requireAuth(), requireRole('agent'), validateBody(WorkRequestSchema, config.nodeId), async (req, res) => {
    const result = await createWorkItem(config, storage, req.auth!.sub, req.body ?? {}, peers);
    if ('forwarded' in result) {
      res.status(result.remoteStatus as number).json(result.remoteResult);
      return;
    }
    if ('error' in result) {
      res.status(result.status!).json(error(config.nodeId, result.code!, result.error!, result.status, result.details));
      return;
    }
    const work = result.work!;
    res.status(201).json(success(config.nodeId, {
      tracking_code: work.trackingCode,
      status: work.status,
      action_id: work.actionId,
      provider_gaii: work.providerGaii,
      requester_gaii: work.requesterGaii,
      cost: { base_price: work.cost.basePrice, network_fee: work.cost.networkFee, total: work.cost.total, in_escrow: work.cost.inEscrow },
      ttl_expires_at: work.ttlExpiresAt,
      created_at: work.createdAt,
    }, [
      { description: 'Check work status', method: 'GET', url: `/v1/work/${work.trackingCode}` },
      { description: 'View your work inbox', method: 'GET', url: '/v1/work/inbox' },
    ]));
  });

  // POST /v1/work — legacy submit path (alias)
  router.post('/v1/work', requireAuth(), requireRole('agent'), validateBody(WorkRequestSchema, config.nodeId), async (req, res) => {
    const result = await createWorkItem(config, storage, req.auth!.sub, req.body ?? {}, peers);
    if ('forwarded' in result) {
      res.status(result.remoteStatus as number).json(result.remoteResult);
      return;
    }
    if ('error' in result) {
      res.status(result.status!).json(error(config.nodeId, result.code!, result.error!, result.status, result.details));
      return;
    }
    const work = result.work!;
    res.status(201).json(success(config.nodeId, {
      tracking_code: work.trackingCode,
      status: work.status,
      action_id: work.actionId,
      provider_gaii: work.providerGaii,
      requester_gaii: work.requesterGaii,
      cost: { base_price: work.cost.basePrice, network_fee: work.cost.networkFee, total: work.cost.total, in_escrow: work.cost.inEscrow },
      ttl_expires_at: work.ttlExpiresAt,
      created_at: work.createdAt,
    }, [
      { description: 'Check work status', method: 'GET', url: `/v1/work/${work.trackingCode}` },
    ]));
  });

  // POST /v1/work/batch — batch work requests
  router.post('/v1/work/batch', requireAuth(), requireRole('agent'), validateBody(WorkBatchSchema, config.nodeId), async (req, res) => {
    const { requests } = req.body ?? {};

    const results = [];
    for (const r of requests) {
      const result = await createWorkItem(config, storage, req.auth!.sub, r, peers);
      if ('forwarded' in result) {
        results.push({ forwarded: true, remote_result: result.remoteResult });
      } else if ('error' in result) {
        results.push({ error: result.error, code: result.code });
      } else {
        results.push({
          tracking_code: result.work!.trackingCode,
          status: result.work!.status,
          action_id: result.work!.actionId,
        });
      }
    }

    res.status(201).json(success(config.nodeId, { results, total: results.length }));
  });

  // GET /v1/work/inbox — pending work items for provider (agent auth)
  router.get('/v1/work/inbox', requireAuth(), requireRole('agent'), async (req, res) => {
    const gaii = req.auth!.sub;
    const items = await storage.listWorkByProvider(gaii);
    const pending = items.filter(w => ['pending', 'accepted', 'in_progress'].includes(w.status));

    res.json(success(config.nodeId, {
      items: pending.map(w => ({
        tracking_code: w.trackingCode,
        status: w.status,
        action_id: w.actionId,
        requester_gaii: w.requesterGaii,
        cost: w.cost,
        ttl_expires_at: w.ttlExpiresAt,
        created_at: w.createdAt,
      })),
      total: pending.length,
    }));
  });

  // GET /v1/work/:tc — work status (agent auth)
  router.get('/v1/work/:tc', requireAuth(), requireRole('agent'), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }

    const gaii = req.auth!.sub;
    if (work.providerGaii !== gaii && work.requesterGaii !== gaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not a party to this work item'));
      return;
    }

    res.json(success(config.nodeId, {
      tracking_code: work.trackingCode,
      status: work.status,
      action_id: work.actionId,
      provider_gaii: work.providerGaii,
      requester_gaii: work.requesterGaii,
      input: work.input,
      output: work.output,
      cost: work.cost,
      rating: work.rating,
      ttl_expires_at: work.ttlExpiresAt,
      created_at: work.createdAt,
      updated_at: work.updatedAt,
    }));
  });

  // POST /v1/work/:tc/accept — accept work (provider, agent auth)
  router.post('/v1/work/:tc/accept', requireAuth(), requireRole('agent'), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== req.auth!.sub) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can accept work'));
      return;
    }
    if (work.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot accept`));
      return;
    }

    const updated = await storage.updateWork(tc, {
      status: 'accepted',
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
    }, [
      { description: 'Mark work in progress', method: 'POST', url: `/v1/work/${tc}/progress` },
      { description: 'Deliver the work result', method: 'POST', url: `/v1/work/${tc}/deliver` },
    ]));
  });

  // POST /v1/work/:tc/progress — transition accepted → in_progress (§10.3)
  router.post('/v1/work/:tc/progress', requireAuth(), requireRole('agent'), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== req.auth!.sub) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can update work status'));
      return;
    }
    if (work.status !== 'accepted') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", can only transition to in_progress from accepted`));
      return;
    }

    const updated = await storage.updateWork(tc, {
      status: 'in_progress',
      updatedAt: new Date().toISOString(),
    });

    // Notify requester via webhook if callback_url provided
    if (work.callbackUrl) {
      fireWebhook(work.callbackUrl, {
        event: 'work.in_progress',
        tracking_code: tc,
        status: 'in_progress',
        timestamp: new Date().toISOString(),
      }, config.webhookMaxRetries);
    }

    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
    }, [
      { description: 'Deliver the work result', method: 'POST', url: `/v1/work/${tc}/deliver` },
    ]));
  });

  // POST /v1/work/:tc/reject — reject work (provider, agent auth)
  router.post('/v1/work/:tc/reject', requireAuth(), requireRole('agent'), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== req.auth!.sub) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can reject work'));
      return;
    }
    if (work.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot reject`));
      return;
    }

    const { reason } = req.body ?? {};

    // Return escrow to requester
    const { returnEscrow } = await import('../services/morsel.js');
    await returnEscrow(storage, work);

    const updated = await storage.updateWork(tc, {
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
      reason,
    }));
  });

  // POST /v1/work/:tc/deliver — deliver work output (provider, agent auth)
  router.post('/v1/work/:tc/deliver', requireAuth(), requireRole('agent'), validateBody(WorkDeliverySchema, config.nodeId), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== req.auth!.sub) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can deliver work'));
      return;
    }
    if (!['accepted', 'in_progress'].includes(work.status)) {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot deliver`));
      return;
    }

    const { output, metadata } = req.body ?? {};

    // Settle: pay provider, network fee, burn
    await settlePayment(storage, config, work);

    // Extension hook: post_settlement (fire-and-forget)
    executeHooks(config, storage, 'post_settlement', {
      tracking_code: tc, provider_gaii: work.providerGaii, requester_gaii: work.requesterGaii,
      cost: work.cost,
    }).catch(() => { });

    const updated = await storage.updateWork(tc, {
      status: 'delivered',
      output,
      updatedAt: new Date().toISOString(),
    });

    // Fire callback webhook if provided (fire-and-forget)
    if (work.callbackUrl) {
      fireWebhook(work.callbackUrl, {
        event: 'work.delivered',
        tracking_code: tc,
        status: 'delivered',
        output,
        timestamp: new Date().toISOString(),
      }, config.webhookMaxRetries);
    }

    // Extension hook: post_work_delivery (fire-and-forget)
    executeHooks(config, storage, 'post_work_delivery', {
      tracking_code: tc, provider_gaii: work.providerGaii, requester_gaii: work.requesterGaii,
    }).catch(() => { });

    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
      output: updated!.output,
    }, [
      { description: 'Rate this delivery', method: 'POST', url: `/v1/work/${tc}/rate` },
    ]));
  });

  // POST /v1/work/:tc/rate — rate delivered work (requester, agent auth)
  router.post('/v1/work/:tc/rate', requireAuth(), requireRole('agent'), validateBody(WorkRatingSchema, config.nodeId), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.requesterGaii !== req.auth!.sub) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can rate work'));
      return;
    }
    if (work.status !== 'delivered') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot rate`));
      return;
    }

    const { rating, comment } = req.body ?? {};

    const updated = await storage.updateWork(tc, {
      status: 'rated',
      rating: { score: rating === 'positive' ? 5 : 1, comment },
      updatedAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
      rating: { rating, comment },
    }));
  });

  // -----------------------------------------------
  // Tier 0.5 — GET-based OTK operations
  // -----------------------------------------------

  // GET /v1/work/:tc/accept?otk= — accept work via OTK (Tier 0.5)
  router.get('/v1/work/:tc/accept', async (req, res) => {
    const otkKey = req.query.otk as string;
    if (!otkKey) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'otk query parameter is required for Tier 0.5'));
      return;
    }
    const otk = await storage.consumeOtk(otkKey, config.otkGraceMs);
    if (!otk) {
      res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'One-time key not found, expired, or already used'));
      return;
    }
    if (!await checkOtkSession(otk, storage)) {
      res.status(401).json(error(config.nodeId, 'SESSION_EXPIRED', 'Session expired due to inactivity'));
      return;
    }
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== otk.ownerGaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'OTK agent is not the provider of this work'));
      return;
    }
    if (work.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot accept`));
      return;
    }
    const updated = await storage.updateWork(tc, { status: 'accepted', updatedAt: new Date().toISOString() });
    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
      tier: '0.5',
    }));
  });

  // GET /v1/work/:tc/reject?otk= — reject work via OTK (Tier 0.5)
  router.get('/v1/work/:tc/reject', async (req, res) => {
    const otkKey = req.query.otk as string;
    if (!otkKey) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'otk query parameter is required for Tier 0.5'));
      return;
    }
    const otk = await storage.consumeOtk(otkKey, config.otkGraceMs);
    if (!otk) {
      res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'One-time key not found, expired, or already used'));
      return;
    }
    if (!await checkOtkSession(otk, storage)) {
      res.status(401).json(error(config.nodeId, 'SESSION_EXPIRED', 'Session expired due to inactivity'));
      return;
    }
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== otk.ownerGaii) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'OTK agent is not the provider of this work'));
      return;
    }
    if (work.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot reject`));
      return;
    }
    const { returnEscrow: returnEscrowFn } = await import('../services/morsel.js');
    await returnEscrowFn(storage, work);
    const updated = await storage.updateWork(tc, { status: 'cancelled', updatedAt: new Date().toISOString() });
    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
      tier: '0.5',
    }));
  });

  return router;
}
