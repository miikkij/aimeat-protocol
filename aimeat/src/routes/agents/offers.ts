/**
 * @file src/routes/agents/offers.ts
 * @description Agent offers routes (publish/read per-agent offers, owner aggregate feed, callable-offer invoke with settlement). Extracted from agents.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from agents.ts (max-file-lines)
 */
import type { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { buildGAII, resolveIdentity } from '../../utils/gaii.js';
import { emitChange } from '../../services/event-bus.js';
import { OffersDocSchema, type Offer } from '../../models/offer-schemas.js';
import { evaluateOfferPrereqs, offerHasPrereqs } from '../../services/offer-prereqs.js';
import { settleMarketplaceFee } from '../../services/marketplace-fee.js';
import { listWorkflows } from '../../services/workflow/store.js';

export function registerOffersRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // ── Agent OFFERS — the "what can I do with my agents" surface ──
  // An offer is the human-readable face of the agent's machine contract (ask + example + outcome +
  // sample deliverable). Stored as memory `agents.{name}.offers` under the agent's GAII; the same
  // record is consumed by the mesh (delegate selection). See docs/plans/2026-06-12-agent-offers-*.md.

  // PUT /v1/agents/:name/offers — an agent publishes its own offers, or the owner publishes for one of theirs.
  router.put('/v1/agents/:name/offers', requireAuth(), requireRole('agent'), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const owner = req.auth!.owner as string;
    const agentGaii = identifier.includes('#') ? identifier : buildGAII(identifier, owner, config.nodeId);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) { res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`)); return; }
    if (agent.owner !== owner) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You can only publish offers for your own agents')); return; }

    const parsed = OffersDocSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_OFFERS', parsed.error.message)); return; }

    const key = `agents.${agent.name}.offers`;
    const existing = await storage.getMemory(agentGaii, key);
    const now = new Date().toISOString();
    const prevDocVersion = (existing?.value as { version?: number } | undefined)?.version ?? 0;
    const value = { version: prevDocVersion + 1, updatedAt: now, offers: parsed.data.offers };
    await storage.setMemory({
      key, ownerGaii: agentGaii, value, visibility: 'owner', tags: ['offers'], ttlHours: null,
      version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    });
    emitChange('agents');
    res.json(success(config.nodeId, { agent: agent.name, count: parsed.data.offers.length, version: value.version }));
  });

  // GET /v1/agents/:name/offers — read one agent's published offers.
  router.get('/v1/agents/:name/offers', requireAuth(), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const owner = req.auth!.owner as string;
    const agentGaii = identifier.includes('#') ? identifier : buildGAII(identifier, owner, config.nodeId);
    const name = identifier.split('#')[0];
    const rec = await storage.getMemory(agentGaii, `agents.${name}.offers`);
    res.json(success(config.nodeId, (rec?.value as Record<string, unknown> | undefined) ?? { offers: [] }));
  });

  // GET /v1/offers — owner aggregate (the goal-first "Do" feed): every agent's offers + the runtime
  // context the cards need (mode, last-seen/online), so the client can search across all agents.
  router.get('/v1/offers', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const ownerGhii = `${owner}@${config.nodeId}`;
    const agents = await storage.getAgentsByOwner(owner);
    const now = Date.now();
    // Workflows that BUNDLE an offer: the offer is a step of a multi-step chain, so the card can offer
    // "run the whole workflow" instead of just the one step. Listed once (owner-shared), matched below.
    const workflows = await listWorkflows(storage, ownerGhii).catch(() => []);
    const agentInStep = (step: { agent?: string | string[] }, name: string): boolean =>
      Array.isArray(step.agent) ? step.agent.includes(name) : step.agent === name;

    const out: Array<Record<string, unknown>> = [];
    let total = 0;
    for (const a of agents) {
      const rec = await storage.getMemory(a.gaii, `agents.${a.name}.offers`);
      const offers = ((rec?.value as { offers?: Offer[] } | undefined)?.offers) ?? [];
      if (!offers.length) continue;
      const online = !!(a.lastSeen && (now - new Date(a.lastSeen).getTime()) < 10 * 60 * 1000);

      const enriched: Array<Record<string, unknown>> = [];
      for (const offer of offers) {
        const o: Record<string, unknown> = { ...offer };
        // Prerequisites — evaluated only when the offer declares any (bounds the per-feed cost).
        if (offerHasPrereqs(offer)) {
          try { o.prereq = await evaluateOfferPrereqs(storage, config, owner, a.name, offer); }
          catch { /* a prereq-eval error must never break the whole feed */ }
        }
        // Bundling workflows (a multi-step chain this offer is a step of). Each carries `scheduled`
        // (the workflow fires on a cron) so the client can surface "runs automatically" standing.
        const bundles = workflows
          .filter(w => (w.steps?.length ?? 0) > 1 && w.steps.some(s => agentInStep(s, a.name) && s.offer === offer.id))
          .map(w => ({ id: w.id, title: w.title, scheduled: w.trigger?.kind === 'schedule' }));
        if (bundles.length) o.workflows = bundles;
        // `auto`: this offer produces on a cadence — schedule-born, or a step of a scheduled workflow.
        // Drives the "⏱ Automatiikassa" pin + standing sort (value ≠ run-count).
        o.auto = !!(offer.availability?.scheduleBorn) || bundles.some(b => b.scheduled);
        enriched.push(o);
      }

      out.push({ agent: a.name, gaii: a.gaii, mode: a.mode ?? 'interactive', last_seen: a.lastSeen ?? null, online, offers: enriched });
      total += offers.length;
    }
    res.json(success(config.nodeId, { agents: out, total }));
  });

  // POST /v1/agents/:name/offers/:offerId/invoke — invoke a callable offer. Free for the owner's own
  // agent; a different owner's invocation debits the caller and credits the provider (morsels) on
  // success, refunding if dispatch fails. The offer must declare a `callable.action_id` backing
  // capability; human-prompt / task offers use the Ask flow instead. `visibility:'private'` blocks
  // cross-owner invocation. See docs/plans/2026-06-12-services-to-offers-migration.md.
  router.post('/v1/agents/:name/offers/:offerId/invoke', requireAuth(), async (req, res) => {
    const identifier = decodeURIComponent(req.params.name as string);
    const offerId = decodeURIComponent(req.params.offerId as string);
    const callerOwner = req.auth!.owner as string;
    // Cross-owner: identifier may be a full provider GAII; a bare name resolves to the caller's own agent.
    const providerGaii = identifier.includes('#') ? identifier : buildGAII(identifier, callerOwner, config.nodeId);
    const agent = await storage.getAgent(providerGaii);
    if (!agent) { res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${identifier}`)); return; }

    const offerName = providerGaii.split('#')[0];
    const rec = await storage.getMemory(providerGaii, `agents.${offerName}.offers`);
    const offers = ((rec?.value as { offers?: Offer[] } | undefined)?.offers) ?? [];
    const offer = offers.find((o) => o.id === offerId);
    if (!offer) { res.status(404).json(error(config.nodeId, 'OFFER_NOT_FOUND', `Offer not found: ${offerId}`)); return; }

    const isSelf = agent.owner === callerOwner;
    const visibility = (offer.visibility as string) ?? 'private';
    if (!isSelf && visibility === 'private') {
      res.status(403).json(error(config.nodeId, 'OFFER_PRIVATE', 'This offer is private to its owner')); return;
    }
    const actionId = offer.callable?.action_id as string | undefined;
    if (!actionId) {
      res.status(422).json(error(config.nodeId, 'OFFER_NOT_CALLABLE', 'This offer has no machine-invocable binding; use the Ask (prompt/task) flow')); return;
    }
    const cap = await storage.getCapability(actionId);
    if (!cap) { res.status(404).json(error(config.nodeId, 'CAPABILITY_NOT_FOUND', `Backing capability not found: ${actionId}`)); return; }

    const callerGhii = resolveIdentity(req.auth!, config.nodeId);
    const price = (!isSelf && offer.price && offer.price.morsels > 0) ? Number(offer.price.morsels) : 0;

    // Reserve funds up front (atomic debit); refund if dispatch fails.
    if (price > 0) {
      const debited = await storage.debitBalance(callerGhii, price);
      if (!debited) {
        const ghii = await storage.getGHIIByOwner(callerOwner);
        res.status(402).json(error(config.nodeId, 'INSUFFICIENT_BALANCE', `This offer costs ${price} morsels; you have ${ghii?.morselBalance ?? 0}`)); return;
      }
    }

    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    const mode = (req.query.mode as string) === 'raw' ? 'raw' as const : 'normal' as const;
    const input = req.body?.input ?? {};
    let result: unknown;
    try {
      const { invokeCapability } = await import('../../services/capability-invoke.js');
      result = await invokeCapability(config, storage, cap, input, callerGhii, jwt, mode);
    } catch (err) {
      if (price > 0) await storage.creditBalance(callerGhii, price); // refund the reservation
      const e = err as { statusCode?: number; code?: string; message?: string };
      res.status(e.statusCode || 502).json(error(config.nodeId, e.code || 'OFFER_INVOKE_FAILED', e.message || 'Offer invocation failed')); return;
    }

    // Success → settle: credit the provider (price minus the marketplace fee) + record the audit
    // trail. The fee leg routes to the operator or burns per AIMEAT_MARKETPLACE_FEE_MODE.
    let receipt: Record<string, unknown> = { charged: 0 };
    if (price > 0) {
      const providerGhii = `${agent.owner}@${config.nodeId}`;
      const feePercent = config.marketplaceTransactionFeePercent ?? 5;
      const fee = Math.ceil(price * feePercent / 100);
      const earnings = price - fee;
      await storage.creditBalance(providerGhii, earnings);
      const now = new Date().toISOString();
      const trackingCode = `offtx_${Date.now()}_${randomBytes(6).toString('hex')}`;
      await storage.addTransaction({ id: `tx-${randomUUID()}`, gaii: callerGhii, type: 'offer_spend', amount: -price, counterpartyGaii: providerGhii, trackingCode, timestamp: now });
      await storage.addTransaction({ id: `tx-${randomUUID()}`, gaii: providerGhii, type: 'offer_earn', amount: earnings, counterpartyGaii: callerGhii, trackingCode, timestamp: now });
      await settleMarketplaceFee(storage, config, { fee, payerGhii: callerGhii, trackingCode, source: 'offer' });
      receipt = { charged: price, earned: earnings, fee, trackingCode };
    }
    res.json(success(config.nodeId, { offer: offerId, agent: agent.name, result, receipt }));
  });
}
