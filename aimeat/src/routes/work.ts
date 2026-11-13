/**
 * @file src/routes/work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Work-queue routes — the agent-to-agent paced work lifecycle: request/batch submission,
 *   inbox/sent listing, accept/progress/reject/deliver/rate, plus escrow holds and settlement, webhook
 *   delivery with exponential-backoff retries, cross-node work resolution, and a work→task bridge.
 *
 * @structure
 *   - getWebhookLog(): re-exported from services/work-lifecycle.ts, where fireWebhook now lives
 *   - createWorkItem(...) and workErrorText(): in services/work/create-work-item.ts since 2026-11-13
 *   - Routes: POST /v1/work[/request|/batch], GET inbox/sent/:tc, POST :tc/{accept,progress,reject,deliver,rate}
 *
 * @version-history
 *   2026-11-13 — createWorkItem and workErrorText moved unchanged to services/work/create-work-item.ts,
 *     so aimeat_action_execute no longer imports a route file (structure programme unit 2).
 *   2026-10-27 — The provider node's answer is read under OUTBOUND_READ_MAX_BYTES (secaudit2026oct26,
 *     keyIsPublished:uncapped-body siblings).
 *   2026-10-27 — Progress (accepted to in_progress) and rate (delivered to rated) move the status with
 *     storage.transitionWorkStatus, so a call that read before a delivery or a dispute cannot reopen or
 *     relabel the item; the call that lost answers 409 CONFLICT (secaudit2026oct26,
 *     work-status-overwrite-after-stale-read).
 *   2026-10-25 — Reject moves the item pending → cancelled on its status (storage.transitionWorkStatus)
 *     in the same transaction as the refund, so concurrent rejects return the escrow once; a call that
 *     lost answers 409 CONFLICT (secaudit2026oct22, work-status-transition-without-cas).
 *   2026-10-16 — Work the provider's node refused answers HTTP 502 PEER_REFUSED; the far node's status is
 *     only in details.peer_status, so its 401 cannot read as the caller's own session ending (decision 2026-10-16).
 *   2026-10-16 — The escrow hold and the work item's creation are one transaction (QA audit E6-03).
 *   2026-10-15 — Rate and reject store the provider's recomputed trust score (refreshTrustScore) (feature-list audit #144).
 *   v1.7.0 — 2026-10-11 — The escrow holds the action's pacing amount (`toll`, was `basePrice`) plus
 *     the network fee; a morsel is pacing, not a price. Every response's `cost` carries `toll` and,
 *     until 4.0.0, the old `base_price` / `basePrice` as a deprecated mirror (presentWorkCost).
 *   v1.6.0 — 2026-10-08 — GET /v1/work/:tc and POST /v1/work/:tc/deliver carry the output's
 *     provenance record (ai_provenance_id and the ai_provenance block), which the node now stamps on
 *     delivery (aiprov D8).
 *   v1.5.2 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts;
 *     secaudit 2026-10, C4).
 *   v1.5.1 — 2026-09-26 — A person's inbox and sent list read their ecosystem apps' identities beside
 *     their agents' (services/db/owner-identity.ts identitiesActingFor), so work on an action an app of
 *     theirs published, a cortex's action among them, reaches the person (secaudit 2026-09, R4 3).
 *   2026-10-16 — Work the provider's node refused is an error result, PEER_REFUSED with the far node's
 *     status and answer in details, and a warn line; it was the far node's own body passed through as
 *     this node's answer (a 401 that read as the caller's own session ending), and the MCP tool
 *     answered "routed" whatever came back (QA audit F14b-01, F18-01).
 *   v1.5.0 — 2026-09-26 — Work for a provider on another node checks the node's address first, then
 *     takes the 1-morsel routing fee as the call goes out (routingFee, services/morsel.ts). The fee
 *     goes back when the node cannot be reached or answers with an error (secaudit 2026-09, R4 6).
 *   v1.4.3 — 2026-09-26 — createWorkItem refuses INVALID_INPUT (400) when provider_gaii is not a full
 *     identity (a GHII, a GAII or a GEAI), for every work endpoint and MCP tool (secaudit 2026-09, R4 5).
 *   v1.4.2 — 2026-09-26 — createWorkItem asks refuseWorkBetween (services/work-parties.ts) for SELF_WORK
 *     and SAME_OWNER_WORK, the same function EXCHANGE agent work asks (secaudit 2026-09, R4 5).
 *   v1.4.1 — 2026-09-26 — createWorkItem refuses SAME_OWNER_WORK when the requester and the provider
 *     have the same owner (ownerGhiiOf), whatever kind of principal each is: a person and their own
 *     agent either way round, or two agents of one person (secaudit 2026-09, R3 7d).
 *   v1.4.0 — 2026-09-26 — Every door names the caller by its resolved identity (resolveIdentity): a
 *     person by their GHII, an agent by its GAII. A request stores it as the requester, the provider
 *     doors compare it, and a person's inbox, sent list and Work tab read their own GHII beside their
 *     agents'. An action a person publishes carries the same identity (routes/actions.ts), so they
 *     take the work on it themselves (secaudit 2026-09: N6, F-1).
 *   v1.3.1 — 2026-09-24 — The federated test is isForeignPrincipal(), the one question (secaudit 2026-09, F-1).
 *   v1.3.0 — 2026-09-13 — Forwarding a work request to a remote node goes through safeFetch. The
 *     validateOutboundUrl() above it reads the first hop only, so a node that passed it could 302
 *     the call to loopback; safeFetch re-validates every hop. The pre-check stays, because it is
 *     what turns a bad address into a 400 the caller can act on rather than a 502.
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
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { MailboxNotificationService } from '../services/mailbox-notification.js';
import { requireAuth, requireExternalPrincipal, requireScope } from '../auth/middleware.js';
import { isOwnerInPerson, resolveIdentity } from '../utils/gaii.js';
import { success, error } from '../middleware/envelope.js';
import { presentWorkCost } from '../services/morsel.js';
import { createWorkTabService } from '../services/db/work-tab-db-service.js';
import { WorkRequestSchema, WorkBatchSchema, WorkDeliverySchema, WorkRatingSchema, validateBody } from '../models/schemas.js';
import type { PeerInfo } from '../services/federation.js';
import { emitChange } from '../services/event-bus.js';
import { createWorkItem } from '../services/work/create-work-item.js';
import { acceptWork, deliverWork, fireWebhook } from '../services/work-lifecycle.js';
import { refreshTrustScore } from '../services/trust.js';
import { identitiesActingFor } from '../services/db/owner-identity.js';
import { listPendingWork } from '../services/work/work-inbox.js';
import { loadServedProvenance, provenanceItemBlock } from '../services/ai/provenance-marks.js';

// The webhook log kept its address here when fireWebhook moved to the shared service.
export { getWebhookLog } from '../services/work-lifecycle.js';

function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

export function workRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>, notificationService?: MailboxNotificationService | null): Router {
  const router = Router();
  /** A work item's output record, for its two parties: the id and the record itself. */
  const outputProvenance = async (id: string | undefined) => (id
    ? { ai_provenance_id: id, ...provenanceItemBlock(await loadServedProvenance(storage, config, id)) }
    : {});

  // POST /v1/work/request — submit a work request (spec path)
  router.post('/v1/work/request', requireAuth(), requireExternalPrincipal(), requireScope('work:request'), validateBody(WorkRequestSchema, config.nodeId), async (req, res) => {
    const result = await createWorkItem(config, storage, resolveIdentity(req.auth!, config.nodeId), req.body ?? {}, peers, notificationService);
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
      cost: presentWorkCost(work.cost, 'snake'),
      ttl_expires_at: work.ttlExpiresAt,
      created_at: work.createdAt,
    }, [
      { description: 'Check work status', method: 'GET', url: `/v1/work/${work.trackingCode}` },
      { description: 'View your work inbox', method: 'GET', url: '/v1/work/inbox' },
    ]));
    emitChange('work');
  });

  // POST /v1/work — legacy submit path (alias)
  router.post('/v1/work', requireAuth(), requireExternalPrincipal(), requireScope('work:request'), validateBody(WorkRequestSchema, config.nodeId), async (req, res) => {
    const result = await createWorkItem(config, storage, resolveIdentity(req.auth!, config.nodeId), req.body ?? {}, peers, notificationService);
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
      cost: presentWorkCost(work.cost, 'snake'),
      ttl_expires_at: work.ttlExpiresAt,
      created_at: work.createdAt,
    }, [
      { description: 'Check work status', method: 'GET', url: `/v1/work/${work.trackingCode}` },
    ]));
    emitChange('work');
  });

  // POST /v1/work/batch — batch work requests
  router.post('/v1/work/batch', requireAuth(), requireExternalPrincipal(), requireScope('work:request'), validateBody(WorkBatchSchema, config.nodeId), async (req, res) => {
    const { requests } = req.body ?? {};
    const requester = resolveIdentity(req.auth!, config.nodeId);

    const results = [];
    for (const r of requests) {
      const result = await createWorkItem(config, storage, requester, r, peers, notificationService);
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
  router.get('/v1/work/inbox', requireAuth(), requireExternalPrincipal(), requireScope('work:read'), async (req, res) => {
    // Not a federated session: the fan-out below resolves agents from the owner NAME, which for a
    // visitor from another node is the local part of their own name and names the local namesake.
    const isOwnerSession = isOwnerInPerson(req.auth);
    const me = resolveIdentity(req.auth!, config.nodeId);
    // In person: the person's own work (their GHII), their agents' and their ecosystem apps', in
    // one query (services/work/work-inbox.ts). Otherwise the caller's own work.
    const pending = await listPendingWork(storage, isOwnerSession
      ? { principal: me, actingFor: req.auth!.owner as string }
      : { principal: me });

    res.json(success(config.nodeId, {
      items: pending.map(w => ({
        tracking_code: w.trackingCode,
        status: w.status,
        action_id: w.actionId,
        requester_gaii: w.requesterGaii,
        cost: presentWorkCost(w.cost, 'camel'),
        ttl_expires_at: w.ttlExpiresAt,
        created_at: w.createdAt,
      })),
      total: pending.length,
    }));
  });

  // GET /v1/work/sent — work items sent by requester (agent or owner auth)
  router.get('/v1/work/sent', requireAuth(), requireExternalPrincipal(), requireScope('work:read'), async (req, res) => {
    // Same reason as /v1/work/inbox and /v1/work/overview, and this door was the one that missed it
    // when the other two were fixed: the fan-out below resolves agents from the owner NAME, which
    // for a session signed in from another node is the local part of THEIR name — so a visitor
    // called `alice` was handed the work sent by the local `alice`'s agents. requireExternalPrincipal
    // admits the `owner` role and asks nothing about where the session came from, so it does not
    // cover this. Found by the AI triage of 2026-09-13.
    const isOwnerSession = isOwnerInPerson(req.auth);
    const me = resolveIdentity(req.auth!, config.nodeId);
    let items: Awaited<ReturnType<typeof storage.listWorkByRequester>>;
    if (isOwnerSession) {
      // ONE requesterGaii IN (…) query across the person's own GHII, their agents and their
      // ecosystem apps (identitiesActingFor).
      items = await storage.listWorkByRequesters(await identitiesActingFor(storage, req.auth!.owner as string, me));
    } else {
      items = await storage.listWorkByRequester(me);
    }

    res.json(success(config.nodeId, {
      items: items.map(w => ({
        tracking_code: w.trackingCode,
        status: w.status,
        action_id: w.actionId,
        provider_gaii: w.providerGaii,
        cost: presentWorkCost(w.cost, 'camel'),
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
  router.get('/v1/work/overview', requireAuth(), requireExternalPrincipal(), requireScope('work:read'), async (req, res) => {
    // Same reason as /v1/work/inbox above: an owner-name fan-out is not a visitor's own work.
    const isOwnerSession = isOwnerInPerson(req.auth);
    const data = await workTabDb.overview(isOwnerSession, req.auth!.owner as string, resolveIdentity(req.auth!, config.nodeId));
    res.json(success(config.nodeId, data));
  });

  // GET /v1/work/:tc — work status (agent auth)
  router.get('/v1/work/:tc', requireAuth(), requireExternalPrincipal(), requireScope('work:read'), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }

    const gaii = resolveIdentity(req.auth!, config.nodeId);
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
      cost: presentWorkCost(work.cost, 'camel'),
      rating: work.rating,
      ttl_expires_at: work.ttlExpiresAt,
      created_at: work.createdAt,
      updated_at: work.updatedAt,
      // How the output was made, with the record itself: it is private, and the requester could
      // not resolve the id at /v1/provenance/:id (aiprov D8).
      ...(await outputProvenance(work.aiProvenanceId)),
    }));
  });

  // POST /v1/work/:tc/accept — accept work (provider, agent auth)
  router.post('/v1/work/:tc/accept', requireAuth(), requireExternalPrincipal(), requireScope('work:accept'), async (req, res) => {
    const tc = param(req.params.tc);
    const accepted = await acceptWork({ storage, config }, resolveIdentity(req.auth!, config.nodeId), tc);
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
  router.post('/v1/work/:tc/progress', requireAuth(), requireExternalPrincipal(), requireScope('work:accept'), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== resolveIdentity(req.auth!, config.nodeId)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can update work status'));
      return;
    }
    if (work.status !== 'accepted') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `This work is ${work.status}. It has to be accepted before it can start.`));
      return;
    }

    // accepted -> in_progress in one conditional UPDATE: a call whose read came before a delivery
    // must not reopen the delivered item for a second payment (secaudit2026oct26).
    if (!await storage.transitionWorkStatus(tc, ['accepted'], 'in_progress', new Date().toISOString())) {
      const now = await storage.getWork(tc);
      res.status(409).json(error(config.nodeId, 'CONFLICT', `This work is ${now?.status ?? 'gone'}. It has to be accepted before it can start.`));
      return;
    }
    const updated = await storage.getWork(tc);

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
  router.post('/v1/work/:tc/reject', requireAuth(), requireExternalPrincipal(), requireScope('work:accept'), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.providerGaii !== resolveIdentity(req.auth!, config.nodeId)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can reject work'));
      return;
    }
    if (work.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot reject`));
      return;
    }

    const { reason } = req.body ?? {};

    // Return escrow to requester. The item moves pending → cancelled on its status in the same
    // transaction as the refund, and only the call that moved it refunds: the status was read, the
    // escrow returned and the status written apart, so two concurrent rejects returned the escrow
    // twice (secaudit2026oct22, work-status-transition-without-cas).
    const { returnEscrow } = await import('../services/morsel.js');
    const updated = await storage.transaction(async () => {
      if (!await storage.transitionWorkStatus(tc, ['pending'], 'cancelled', new Date().toISOString())) return null;
      await returnEscrow(storage, work);
      return storage.getWork(tc);
    });
    if (!updated) {
      res.status(409).json(error(config.nodeId, 'CONFLICT', 'This work is no longer pending; it was accepted, rejected or expired in the meantime.'));
      return;
    }
    // A declined request counts against the provider's score (feature-list audit #144).
    await refreshTrustScore(storage, work.providerGaii);

    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
      reason,
    }));
    emitChange('work');
  });

  // POST /v1/work/:tc/deliver — deliver work output (provider, agent auth)
  router.post('/v1/work/:tc/deliver', requireAuth(), requireExternalPrincipal(), requireScope('work:accept'), validateBody(WorkDeliverySchema, config.nodeId), async (req, res) => {
    const tc = param(req.params.tc);
    const { output } = req.body ?? {};

    const delivered = await deliverWork({ storage, config }, resolveIdentity(req.auth!, config.nodeId), tc, output);
    if (!delivered.ok) {
      res.status(delivered.status).json(error(config.nodeId, delivered.code, delivered.message));
      return;
    }

    res.json(success(config.nodeId, {
      tracking_code: delivered.work.trackingCode,
      status: delivered.work.status,
      output: delivered.work.output,
      ...(await outputProvenance(delivered.work.aiProvenanceId)),
    }, [
      { description: 'Rate this delivery', method: 'POST', url: `/v1/work/${tc}/rate` },
    ]));
  });

  // POST /v1/work/:tc/rate — rate delivered work (requester, agent auth)
  router.post('/v1/work/:tc/rate', requireAuth(), requireExternalPrincipal(), requireScope('work:request'), validateBody(WorkRatingSchema, config.nodeId), async (req, res) => {
    const tc = param(req.params.tc);
    const work = await storage.getWork(tc);
    if (!work) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
      return;
    }
    if (work.requesterGaii !== resolveIdentity(req.auth!, config.nodeId)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can rate work'));
      return;
    }
    if (work.status !== 'delivered') {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${work.status}", cannot rate`));
      return;
    }

    const { rating, comment } = req.body ?? {};

    // delivered -> rated on the stored status, so a rate call that read before a dispute opened does
    // not relabel the disputed item (secaudit2026oct26).
    if (!await storage.transitionWorkStatus(tc, ['delivered'], 'rated', new Date().toISOString())) {
      const now = await storage.getWork(tc);
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Work is in status "${now?.status ?? 'unknown'}", cannot rate`));
      return;
    }
    const updated = await storage.updateWork(tc, {
      rating: { score: rating === 'positive' ? 5 : 1, comment },
      updatedAt: new Date().toISOString(),
    });
    // A rating changes the provider's score; the stored one follows now (feature-list audit #144).
    await refreshTrustScore(storage, work.providerGaii);

    res.json(success(config.nodeId, {
      tracking_code: updated!.trackingCode,
      status: updated!.status,
      rating: { rating, comment },
    }));
    emitChange('work');
  });

  return router;
}
