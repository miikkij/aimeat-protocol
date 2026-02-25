import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { generateTrackingCode } from '../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow, settlePayment } from '../services/morsel.js';
import { logger } from '../utils/logger.js';
import { executeHooks } from '../services/hooks.js';

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

/** Fire-and-forget webhook POST to callback_url. Retries once on failure. */
function fireWebhook(url: string, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  const doFetch = (attempt: number) => {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    }).catch(err => {
      logger.warn(`Webhook delivery failed (attempt ${attempt})`, { url, error: String(err) });
      if (attempt < 2) setTimeout(() => doFetch(attempt + 1), 5000);
    });
  };
  doFetch(1);
}

async function createWorkItem(
  config: MeatConfig,
  storage: Storage,
  requesterGaii: string,
  body: any,
) {
  const { action_id, provider_gaii, input, ttl_hours, callback_url } = body;

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

  const ttl = ttl_hours ?? 24;
  const now = new Date();
  const trackingCode = generateTrackingCode();

  // Look up action to get pricing
  const actions = await storage.listActions();
  const action = actions.find(a => a.id === action_id && a.providerGaii === provider_gaii);

  const baseMorsels = action?.pricing.baseMorsels ?? 0;
  const cost = calculateWorkCost(baseMorsels, config.burnRate);

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

  return { work };
}

export function workRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/work/request — submit a work request (spec path)
  router.post('/v1/work/request', requireAuth(), requireRole('agent'), async (req, res) => {
    const result = await createWorkItem(config, storage, req.auth!.sub, req.body ?? {});
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
  router.post('/v1/work', requireAuth(), requireRole('agent'), async (req, res) => {
    const result = await createWorkItem(config, storage, req.auth!.sub, req.body ?? {});
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
  router.post('/v1/work/batch', requireAuth(), requireRole('agent'), async (req, res) => {
    const { requests } = req.body ?? {};
    if (!Array.isArray(requests) || requests.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'requests array is required'));
      return;
    }

    const results = [];
    for (const r of requests) {
      const result = await createWorkItem(config, storage, req.auth!.sub, r);
      if ('error' in result) {
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
  router.post('/v1/work/:tc/deliver', requireAuth(), requireRole('agent'), async (req, res) => {
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
    if (output === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'output is required'));
      return;
    }

    // Settle: pay provider, network fee, burn
    await settlePayment(storage, config, work);

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
      });
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
  router.post('/v1/work/:tc/rate', requireAuth(), requireRole('agent'), async (req, res) => {
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
    if (rating !== 'positive' && rating !== 'negative') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'rating must be "positive" or "negative"'));
      return;
    }

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
    const otk = await storage.consumeOtk(otkKey);
    if (!otk) {
      res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'One-time key not found, expired, or already used'));
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
    const otk = await storage.consumeOtk(otkKey);
    if (!otk) {
      res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'One-time key not found, expired, or already used'));
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
