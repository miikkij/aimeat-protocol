import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { generateTrackingCode } from '../utils/tracking-code.js';

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

export function workRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/work — submit a work request (agent auth)
  router.post('/v1/work', requireAuth(), requireRole('agent'), async (req, res) => {
    const { action_id, provider_gaii, input, ttl_hours, callback_url } = req.body ?? {};

    if (!action_id || !provider_gaii || input === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action_id, provider_gaii, and input are required'));
      return;
    }

    const requesterGaii = req.auth!.sub;
    const ttl = ttl_hours ?? 24;
    const now = new Date();
    const trackingCode = generateTrackingCode();

    // Look up action to get pricing
    const actions = await storage.listActions();
    const action = actions.find(a => a.id === action_id && a.providerGaii === provider_gaii);

    const basePrice = action?.pricing.baseMorsels ?? 0;
    const networkFee = Math.ceil(basePrice * 0.1);
    const total = basePrice + networkFee;

    // Check requester balance
    const requester = await storage.getAgent(requesterGaii);
    if (!requester || requester.morselBalance < total) {
      res.status(402).json(error(config.nodeId, 'INSUFFICIENT_MORSELS',
        `You need ${total} morsels but have ${requester?.morselBalance ?? 0}`,
        402, { required: total, available: requester?.morselBalance ?? 0 }));
      return;
    }

    // Create work item with escrow
    const work = await storage.createWork({
      trackingCode,
      status: 'pending',
      actionId: action_id,
      providerGaii: provider_gaii,
      requesterGaii,
      input,
      cost: { basePrice, networkFee, total, inEscrow: total },
      ttlExpiresAt: new Date(now.getTime() + ttl * 3600_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    // Deduct morsels and put in escrow
    await storage.updateAgent(requesterGaii, {
      morselBalance: requester.morselBalance - total,
    });

    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii: requesterGaii,
      type: 'escrow_hold',
      amount: -total,
      counterpartyGaii: provider_gaii,
      trackingCode,
      timestamp: now.toISOString(),
    });

    res.status(201).json(success(config.nodeId, {
      tracking_code: work.trackingCode,
      status: work.status,
      action_id: work.actionId,
      provider_gaii: work.providerGaii,
      requester_gaii: work.requesterGaii,
      cost: {
        base_price: work.cost.basePrice,
        network_fee: work.cost.networkFee,
        total: work.cost.total,
        in_escrow: work.cost.inEscrow,
      },
      ttl_expires_at: work.ttlExpiresAt,
      created_at: work.createdAt,
    }, [
      { description: 'Check work status', method: 'GET', url: `/v1/work/${trackingCode}` },
      { description: 'View your work queue', method: 'GET', url: '/v1/work/inbox' },
    ]));
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

    // Settle: pay provider, deduct network fee, apply burn
    const provider = await storage.getAgent(work.providerGaii);
    if (provider) {
      const providerEarnings = work.cost.basePrice;
      await storage.updateAgent(work.providerGaii, {
        morselBalance: provider.morselBalance + providerEarnings,
      });
      await storage.addTransaction({
        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        gaii: work.providerGaii,
        type: 'earned',
        amount: providerEarnings,
        counterpartyGaii: work.requesterGaii,
        trackingCode: work.trackingCode,
        timestamp: new Date().toISOString(),
      });
    }

    const updated = await storage.updateWork(tc, {
      status: 'delivered',
      output,
      updatedAt: new Date().toISOString(),
    });

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

  return router;
}
