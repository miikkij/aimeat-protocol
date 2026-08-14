/**
 * @file src/routes/work.ts
 * @description Work-queue routes — the agent-to-agent paid work lifecycle: request/batch submission,
 *   inbox/sent listing, accept/progress/reject/deliver/rate, plus escrow holds and settlement, webhook
 *   delivery with exponential-backoff retries, cross-node work resolution, and a work→task bridge.
 *
 * @structure
 *   - getWebhookLog(): re-exported from services/work-lifecycle.ts, where fireWebhook now lives
 *   - createWorkItem(...): builds a work item (escrow, tracking code, notification)
 *   - Routes: POST /v1/work[/request|/batch], GET inbox/sent/:tc, POST :tc/{accept,progress,reject,deliver,rate}
 *
 * @version-history
 *   v1.2.0 — 2026-08-11 — the two Tier 0.5 doors are gone: GET /v1/work/:tc/accept?otk= and
 *     GET /v1/work/:tc/reject?otk=. RFC v4.0 deprecates one-time keys, and these two were a third
 *     implementation of accept and reject that wrote the status straight to storage: no work→task
 *     bridge, no callback webhook, no extension hook and no change event, so a Work tab watching SSE
 *     never saw the transition. They also ran outside the keyedBrowseEnabled flag the deprecation
 *     put the feature behind. The POST routes above are the remaining doors.
 *   v1.1.0 — 2026-08-11 — accept and deliver call services/work-lifecycle.ts, the same functions
 *     aimeat_work_accept and aimeat_work_deliver call. The tools were a second implementation that
 *     skipped the work→task bridge, the requester's callback webhook and both extension hooks.
 *     fireWebhook moved into that service with them; this file imports it back for in_progress.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { MailboxNotificationService } from '../services/mailbox-notification.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { generateTrackingCode } from '../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow } from '../services/morsel.js';
import { logger } from '../utils/logger.js';
import { createWorkTabService } from '../services/db/work-tab-db-service.js';
import { executeHooks } from '../services/hooks.js';
import { WorkRequestSchema, WorkBatchSchema, WorkDeliverySchema, WorkRatingSchema, validateBody } from '../models/schemas.js';
import { resolveGaii } from '../services/federation.js';
import type { PeerInfo } from '../services/federation.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { emitChange } from '../services/event-bus.js';
import { acceptWork, deliverWork, fireWebhook } from '../services/work-lifecycle.js';

// The webhook log kept its address here when fireWebhook moved to the shared service.
export { getWebhookLog } from '../services/work-lifecycle.js';

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

/**
 * Commission one work item, from wherever the request arrived.
 *
 * Exported since 2026-08-11 because aimeat_action_execute was a second implementation of it, and a
 * thinner one: it never resolved the provider, so cross-node work commissioned over MCP created a
 * local row and held the requester's morsels in escrow while the provider's node heard nothing; it
 * skipped the visiting-tier peer policy that makes the lightweight join safe; and it skipped the
 * pending-queue ceiling, so one agent could flood another's inbox past a cap this door enforces.
 *
 * Returns a refusal as { error, status, code } — the caller renders it in its own terms.
 */
export async function createWorkItem(
  config: AimeatConfig,
  storage: Storage,
  requesterGaii: string,
  body: {
    action_id?: string;
    provider_gaii?: string;
    input?: unknown;
    ttl_hours?: number;
    callback_url?: string;
    priority?: 'low' | 'normal' | 'high';
  },
  peers: Map<string, PeerInfo>,
  notificationService?: MailboxNotificationService | null,
) {
  const { action_id, provider_gaii, input, ttl_hours, callback_url, priority } = body;

  if (!action_id || !provider_gaii || input === undefined) {
    return { error: 'action_id, provider_gaii, and input are required', status: 400, code: 'INVALID_INPUT' };
  }

  // SECURITY: Prevent self-work (trust score manipulation)
  if (requesterGaii === provider_gaii) {
    return { error: 'Cannot create work request to yourself', status: 400, code: 'SELF_WORK' };
  }

  // SECURITY: Prevent same-owner work (different agent, same human)
  const requesterAgent = await storage.getAgent(requesterGaii);
  const providerAgent = await storage.getAgent(provider_gaii);
  if (requesterAgent && providerAgent && requesterAgent.owner === providerAgent.owner) {
    return { error: 'Cannot create work request between your own agents', status: 400, code: 'SAME_OWNER_WORK' };
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
    // Visiting-tier peers are not providers-of-record: never route work to them
    // (allowRouting=false). This is the cap that makes the lightweight join safe.
    const targetPeer = peers.get(resolved.nodeId) ?? [...peers.values()].find(p => p.nodeId === resolved.nodeId);
    if (targetPeer && targetPeer.allowRouting === false) {
      return { error: 'Target node does not accept routed work (visiting tier)', status: 403, code: 'POLICY_DENIED' };
    }
    // Charge 1 morsel cross-node routing fee (§15) — atomic debit prevents double-spending
    const debited = await storage.debitBalance(requesterGaii, 1);
    if (!debited) {
      return { error: 'Insufficient morsels for cross-node routing fee (1 morsel)', status: 402, code: 'INSUFFICIENT_MORSELS' };
    }
    await storage.addTransaction({
      id: `tx-${randomUUID()}`,
      gaii: requesterGaii,
      type: 'routing_fee',
      amount: -1,
      trackingCode: `route:${resolved.nodeId}`,
      timestamp: new Date().toISOString(),
    });

    // Forward work request to the remote node
    try {
      // SSRF validation: block requests to private/reserved IPs
      const remoteUrlCheck = await validateOutboundUrl(resolved.nodeUrl);
      if (!remoteUrlCheck.valid) {
        logger.warn(`Blocked outbound work request to ${resolved.nodeUrl}: ${remoteUrlCheck.reason}`);
        return { error: `Remote node URL blocked: ${remoteUrlCheck.reason}`, status: 400, code: 'INVALID_URL' };
      }
      const resp = await fetch(`${resolved.nodeUrl}/v1/work/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AIMEAT-Origin-Node': config.nodeId,
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
    input: input as Record<string, unknown>,
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
    const enqueuedItem = await mailboxService.enqueue(personalNodeTarget, {
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
    }).catch(err => {
      logger.warn('Failed to queue work notification for personal node', { nodeId: personalNodeTarget, error: String(err) });
      return null;
    });

    // Fire-and-forget push notification to node owner (REQ-007)
    if (enqueuedItem && notificationService) {
      void notificationService.notify(personalNodeTarget, enqueuedItem);
    }
  }

  return { work, personalNodeTarget };
}

export function workRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>, notificationService?: MailboxNotificationService | null): Router {
  const router = Router();

  // POST /v1/work/request — submit a work request (spec path)
  router.post('/v1/work/request', requireAuth(), requireRole('agent'), requireScope('work:request'), validateBody(WorkRequestSchema, config.nodeId), async (req, res) => {
    const result = await createWorkItem(config, storage, req.auth!.sub, req.body ?? {}, peers, notificationService);
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
    emitChange('work');
  });

  // POST /v1/work — legacy submit path (alias)
  router.post('/v1/work', requireAuth(), requireRole('agent'), requireScope('work:request'), validateBody(WorkRequestSchema, config.nodeId), async (req, res) => {
    const result = await createWorkItem(config, storage, req.auth!.sub, req.body ?? {}, peers, notificationService);
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
    emitChange('work');
  });

  // POST /v1/work/batch — batch work requests
  router.post('/v1/work/batch', requireAuth(), requireRole('agent'), requireScope('work:request'), validateBody(WorkBatchSchema, config.nodeId), async (req, res) => {
    const { requests } = req.body ?? {};

    const results = [];
    for (const r of requests) {
      const result = await createWorkItem(config, storage, req.auth!.sub, r, peers, notificationService);
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
    emitChange('work');
  });

  // GET /v1/work/inbox — pending work items for provider (agent or owner auth)
  router.get('/v1/work/inbox', requireAuth(), requireRole('agent'), requireScope('work:read'), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let items: Awaited<ReturnType<typeof storage.listWorkByProvider>>;
    if (isOwnerSession) {
      // Owner sees work across all their agents — ONE providerGaii IN (…) query, not one per agent.
      const agents = await storage.getAgentsByOwner(req.auth!.owner as string);
      items = agents.length ? await storage.listWorkByProviders(agents.map(a => a.gaii)) : [];
    } else {
      items = await storage.listWorkByProvider(req.auth!.sub);
    }
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

  // GET /v1/work/sent — work items sent by requester (agent or owner auth)
  router.get('/v1/work/sent', requireAuth(), requireRole('agent'), requireScope('work:read'), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    let items: Awaited<ReturnType<typeof storage.listWorkByRequester>>;
    if (isOwnerSession) {
      // ONE requesterGaii IN (…) query across the owner's agents, not one per agent.
      const agents = await storage.getAgentsByOwner(req.auth!.owner as string);
      items = agents.length ? await storage.listWorkByRequesters(agents.map(a => a.gaii)) : [];
    } else {
      items = await storage.listWorkByRequester(req.auth!.sub);
    }

    res.json(success(config.nodeId, {
      items: items.map(w => ({
        tracking_code: w.trackingCode,
        status: w.status,
        action_id: w.actionId,
        provider_gaii: w.providerGaii,
        cost: w.cost,
        rating: w.rating,
        ttl_expires_at: w.ttlExpiresAt,
        created_at: w.createdAt,
      })),
      total: items.length,
    }));
  });

  // GET /v1/work/overview — the Work tab mount in ONE call: inbox (provider) + sent (requester). Folds
  // GET /v1/work/inbox + /v1/work/sent, resolving the owner's agents once. Same gate as the folded reads.
  // MUST be registered before /v1/work/:tc (a literal 'overview' would otherwise match the :tc capture).
  const workTabDb = createWorkTabService(storage);
  router.get('/v1/work/overview', requireAuth(), requireRole('agent'), requireScope('work:read'), async (req, res) => {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const data = await workTabDb.overview(isOwnerSession, req.auth!.owner as string, req.auth!.sub as string);
    res.json(success(config.nodeId, data));
  });

  // GET /v1/work/:tc — work status (agent auth)
  router.get('/v1/work/:tc', requireAuth(), requireRole('agent'), requireScope('work:read'), async (req, res) => {
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
  router.post('/v1/work/:tc/accept', requireAuth(), requireRole('agent'), requireScope('work:accept'), async (req, res) => {
    const tc = param(req.params.tc);
    const accepted = await acceptWork({ storage, config }, req.auth!.sub, tc);
    if (!accepted.ok) {
      res.status(accepted.status).json(error(config.nodeId, accepted.code, accepted.message));
      return;
    }

    res.json(success(config.nodeId, {
      tracking_code: accepted.work.trackingCode,
      status: accepted.work.status,
    }, [
      { description: 'Mark work in progress', method: 'POST', url: `/v1/work/${tc}/progress` },
      { description: 'Deliver the work result', method: 'POST', url: `/v1/work/${tc}/deliver` },
    ]));
  });

  // POST /v1/work/:tc/progress — transition accepted → in_progress (§10.3)
  router.post('/v1/work/:tc/progress', requireAuth(), requireRole('agent'), requireScope('work:accept'), async (req, res) => {
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
    emitChange('work');
  });

  // POST /v1/work/:tc/reject — reject work (provider, agent auth)
  router.post('/v1/work/:tc/reject', requireAuth(), requireRole('agent'), requireScope('work:accept'), async (req, res) => {
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
    emitChange('work');
  });

  // POST /v1/work/:tc/deliver — deliver work output (provider, agent auth)
  router.post('/v1/work/:tc/deliver', requireAuth(), requireRole('agent'), requireScope('work:accept'), validateBody(WorkDeliverySchema, config.nodeId), async (req, res) => {
    const tc = param(req.params.tc);
    const { output } = req.body ?? {};

    const delivered = await deliverWork({ storage, config }, req.auth!.sub, tc, output);
    if (!delivered.ok) {
      res.status(delivered.status).json(error(config.nodeId, delivered.code, delivered.message));
      return;
    }

    res.json(success(config.nodeId, {
      tracking_code: delivered.work.trackingCode,
      status: delivered.work.status,
      output: delivered.work.output,
    }, [
      { description: 'Rate this delivery', method: 'POST', url: `/v1/work/${tc}/rate` },
    ]));
  });

  // POST /v1/work/:tc/rate — rate delivered work (requester, agent auth)
  router.post('/v1/work/:tc/rate', requireAuth(), requireRole('agent'), requireScope('work:request'), validateBody(WorkRatingSchema, config.nodeId), async (req, res) => {
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
    emitChange('work');
  });

  return router;
}
