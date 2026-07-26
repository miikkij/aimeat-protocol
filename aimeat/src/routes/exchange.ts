/**
 * @file src/routes/exchange.ts
 * @description EXCHANGE contract-acceptance surface (TARGET-045) — the WRITE side of the G1 metered
 *   entitlement. When a negotiation concludes (a human in an MCP chat, or a closed negotiation agent),
 *   the CONSUMER's owner accepts the contract here, which mints the durable entitlement the G2 gateway
 *   then honours on every call. Safety by construction: the consumer chooses only the BUDGET (their own
 *   spend cap) and the contract ref — the per-call PRICE is read authoritatively from the provider's
 *   extension action (`commercial.payMorsels`), so a consumer can neither undercut the provider nor be
 *   charged a price they did not accept. The entitlement's consumer is always the caller's own owner
 *   (strictly cross-owner via resolveIdentity), so accepting a contract authorises only one's own spend.
 *
 *   Slice-1 covers the `morsels` unit (fully in-repo); the money unit rides the same acceptance flow once
 *   the Stripe/EE drawdown is wired. Dynamic agent-negotiated pricing (a signed price quote that differs
 *   from the list price) is a later addition — slice-1 accepts the provider's listed price + a budget.
 * @structure exchangeRouter — POST /v1/exchange/entitlements · GET /v1/exchange/entitlements ·
 *   POST /v1/exchange/entitlements/off
 * @usage
 *   import { exchangeRouter } from './routes/exchange.js';
 *   app.use(exchangeRouter(config, storage));
 * @version-history
 *   v1.3.0 — 2026-07-21 — Agent work (Gap 2): POST /work (start) + /work/:id/deliver (settle on delivery) +
 *     GET /work — the async third sellable surface, metered per delivered task via the shared settlement.
 *   v1.2.0 — 2026-07-21 — Renegotiation + history: POST/GET /proposals (+ accept/decline/withdraw) with a
 *     Profile>Messages notification; GET /entitlements/history + /provider/history (superseded contracts).
 *   v1.1.0 — 2026-07-21 — Accept by `offering_id` (works for ext-action AND app-tool kinds; app-tool contract
 *     pins the offering's interface version) via the shared resolveOfferingPricing; legacy ext+action retained.
 *   v1.0.0 — 2026-07-20 — Initial acceptance surface: mint (authoritative price) / list mine / pause+revoke.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';
import { percentFee } from '../commerce/money.js';
import {
  createEntitlement, readEntitlementForCall, listEntitlementsByConsumer,
  pauseEntitlement, revokeEntitlement,
  listEntitlementHistoryByConsumer, listEntitlementHistoryByProvider,
  type MeteredEntitlement, type EntitlementHistoryEntry,
} from '../services/metered-entitlements.js';
import { resolveActionPricing, resolveOfferingPricing, getOffering, type ActionCommercial } from '../services/exchange-market.js';
import {
  type ContractProposal, newProposalId, putProposal, getProposal, listProposalsForOwner,
  supersedeWithProposal, ownerOfGaii,
} from '../services/exchange-proposals.js';
import { sendDirectMessage } from '../services/message-send.js';
import type { PeerInfo } from '../services/federation.js';
import { settleMeteredCoordinate } from './extensions/entitlement-gate.js';
import { logger } from '../utils/logger.js';
import {
  type AgentWork, newWorkId, putWork, getWork, listWorkByConsumer, listWorkByProvider,
} from '../services/exchange-work.js';

function ownerOf(gaii: string): string {
  return gaii.split('@')[0].split('#').pop() ?? gaii;
}

function view(config: AimeatConfig, e: MeteredEntitlement) {
  const rakePct = e.rakePercent ?? commerceFeePercent(config);
  return {
    entitlement_id: e.entitlementId,
    consumer_gaii: e.consumerGaii,
    app_id: e.appId,
    provider: e.providerGhii,
    ext: e.ext,
    action: e.action,
    surface: e.surface ?? null,
    capability: e.capabilityLabel,
    unit: e.unit,
    currency: e.currency,
    price_per_call: e.pricePerCall,
    // The pacing burn this contract was signed at — a cost to the consumer that is not a payment, so it
    // belongs beside the price rather than inside it.
    toll_morsels: e.tollMorsels ?? null,
    pricing: e.pricing ?? { model: 'per_call' },
    rake_percent: rakePct,
    rake_per_call: percentFee(e.pricePerCall, rakePct),
    contract_ref: e.contractRef,
    escrow_party: e.escrowParty,
    state: e.state,
    budget: {
      cap_units: e.budget.capUnits,
      spent_units: e.budget.spentUnits,
      remaining_units: e.budget.capUnits === null ? null : Math.max(0, e.budget.capUnits - e.budget.spentUnits),
      calls: e.budget.calls,
    },
  };
}

export function exchangeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * POST /v1/exchange/entitlements — accept a contract → mint a durable entitlement for the caller's
   * owner. Body: { ext, action, contract_ref, cap_units?, app_id?, escrow_party? }. The per-call price
   * is taken from the provider's ext action (authoritative), never the request.
   */
  router.post('/v1/exchange/entitlements', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const capUnits = typeof b.cap_units === 'number' && Number.isFinite(b.cap_units) && b.cap_units >= 0
      ? Math.floor(b.cap_units) : null;
    const appId = typeof b.app_id === 'string' && b.app_id ? b.app_id : null;
    const escrowParty = b.escrow_party === 'consumer' || b.escrow_party === 'provider' ? b.escrow_party : null;
    const planId = typeof b.plan_id === 'string' && b.plan_id ? b.plan_id : null;

    // ── Preferred path: accept an OFFERING by id (works for BOTH ext-action and app-tool kinds). The
    // offering pins the metered coordinate (+ the app-tool interface version); pricing is authoritative. ──
    if (typeof b.offering_id === 'string' && b.offering_id) {
      const contractRef = typeof b.contract_ref === 'string' && b.contract_ref ? b.contract_ref : `offering:${b.offering_id}`;
      const o = await getOffering(storage, b.offering_id);
      if (!o || o.state !== 'listed') return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such listed offering'));
      const priced = await resolveOfferingPricing(storage, o, planId);
      if (!priced.ok) return res.status(priced.status).json(error(config.nodeId, priced.code, priced.message));
      const minCharge = priced.pricing?.model === 'bundle' ? priced.pricing.blockPrice : priced.pricing?.model === 'subscription' ? priced.pricing.periodPrice : priced.pricePerCall;
      if (capUnits !== null && capUnits < minCharge) {
        return res.status(400).json(error(config.nodeId, 'BUDGET_TOO_LOW',
          `Budget cap (${capUnits}) is below the ${minCharge}-${priced.unit === 'money' ? priced.currency : 'morsel'} minimum charge`));
      }
      const existing = await readEntitlementForCall(storage, consumerGaii, priced.ext, priced.action);
      const ent = await createEntitlement(storage, {
        consumerGaii, appId, providerGhii: priced.providerGhii, ext: priced.ext, action: priced.action,
        capabilityLabel: priced.capabilityLabel, unit: priced.unit, pricePerCall: priced.pricePerCall,
        currency: priced.currency, pricing: priced.pricing, capUnits, contractRef, surface: priced.surface,
        tollMorsels: priced.tollMorsels, escrowParty, createdBy: owner, carrySpend: existing,
      });
      return res.status(201).json(success(config.nodeId, { entitlement: view(config, ent) }, [
        { description: 'This app’s cost & contracts', method: 'GET', url: appId ? `/v1/apps/cost?app_id=${encodeURIComponent(appId)}` : '/v1/exchange/entitlements' },
      ]));
    }

    // ── Legacy path: accept a raw ext-action directly by (ext, action). ──
    const ext = typeof b.ext === 'string' ? b.ext : '';
    const action = typeof b.action === 'string' ? b.action : '';
    const contractRef = typeof b.contract_ref === 'string' ? b.contract_ref : '';
    if (!ext || !action || !contractRef) {
      return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'ext, action and contract_ref are required (or pass offering_id)'));
    }

    // Resolve the provider + AUTHORITATIVE price from the extension action.
    const extRec = await storage.getExtension(ext);
    if (!extRec) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${ext}" not found`));
    const act = extRec.actions.find(a => a.id === action);
    if (!act) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Action "${action}" not found on "${ext}"`));

    // AUTHORITATIVE price + unit + (optional plan) pricing — shared resolver, so a consumer can never
    // undercut the provider. `plan_id` picks a provider-declared bundle/subscription plan; none → per_call.
    const priced = resolveActionPricing(act.commercial as ActionCommercial | undefined, planId);
    if (!priced.ok) return res.status(priced.code === 'NOT_PRICED' ? 400 : 404).json(error(config.nodeId, priced.code, `Action "${ext}/${action}": ${priced.message}`));
    const { unit, pricePerCall, currency, pricing } = priced;
    // Budget floor: the cap must cover a single charge (per-call price, or a bundle block / subscription period).
    const minCharge = pricing?.model === 'bundle' ? pricing.blockPrice : pricing?.model === 'subscription' ? pricing.periodPrice : pricePerCall;
    if (capUnits !== null && capUnits < minCharge) {
      return res.status(400).json(error(config.nodeId, 'BUDGET_TOO_LOW',
        `Budget cap (${capUnits}) is below the ${minCharge}-${unit === 'money' ? currency : 'morsel'} minimum charge`));
    }
    const providerGhii = `${extRec.installedBy}@${config.nodeId}`;

    // Carry spend forward on re-acceptance (renegotiation) so a new contract does not reset the meter.
    const existing = await readEntitlementForCall(storage, consumerGaii, ext, action);
    const ent = await createEntitlement(storage, {
      consumerGaii, appId, providerGhii, ext, action, capabilityLabel: `${ext}/${action}`,
      unit, pricePerCall, currency, pricing, capUnits, contractRef, escrowParty, createdBy: owner,
      tollMorsels: act.tollMorsels ?? null, carrySpend: existing,
    });
    return res.status(201).json(success(config.nodeId, { entitlement: view(config, ent) }, [
      { description: 'This app’s cost & contracts', method: 'GET', url: appId ? `/v1/apps/cost?app_id=${encodeURIComponent(appId)}` : '/v1/exchange/entitlements' },
    ]));
  });

  /** GET /v1/exchange/entitlements — every entitlement the caller's owner holds (as consumer). */
  router.get('/v1/exchange/entitlements', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const mine = await listEntitlementsByConsumer(storage, consumerGaii);
    return res.json(success(config.nodeId, { entitlements: mine.map(e => view(config, e)) }));
  });

  /**
   * POST /v1/exchange/entitlements/off — the consumer's off-switch. Body: { ext, action, mode }
   * with mode `pause` (reversible) or `revoke` (terminal). Only the entitlement's own consumer may.
   */
  router.post('/v1/exchange/entitlements/off', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ext = typeof b.ext === 'string' ? b.ext : '';
    const action = typeof b.action === 'string' ? b.action : '';
    const mode = b.mode === 'revoke' ? 'revoke' : 'pause';
    if (!ext || !action) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'ext and action are required'));

    const ent = await readEntitlementForCall(storage, consumerGaii, ext, action);
    if (!ent || ownerOf(ent.consumerGaii) !== owner) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No entitlement of yours for that capability'));
    }
    const ok = mode === 'revoke'
      ? await revokeEntitlement(storage, consumerGaii, ext, action)
      : await pauseEntitlement(storage, consumerGaii, ext, action);
    return res.json(success(config.nodeId, { ext, action, mode, applied: ok }));
  });

  // ── RENEGOTIATION (proposals) + HISTORY ─────────────────────────────────────
  const gh = (owner: string) => `${owner}@${config.nodeId}`;
  /** Deliver a same-node inbox message (Profile > Messages) to notify a party of a proposal event. */
  async function notify(senderOwner: string, recipientOwner: string, subject: string, body: string): Promise<void> {
    try {
      await sendDirectMessage({ config, storage, peers: new Map<string, PeerInfo>() }, {
        senderGhii: gh(senderOwner), recipientGhii: gh(recipientOwner), body, subject, respondable: false, skipContactGate: true,
      });
    } catch (err) { logger.warn('notify: a notification failure must not fail the proposal itself', { error: String(err) }); }
  }
  function proposalView(p: ContractProposal) {
    return {
      proposal_id: p.proposalId, consumer_gaii: p.consumerGaii, provider: p.providerGhii,
      ext: p.ext, action: p.action, capability: p.capabilityLabel,
      proposed_by: p.proposedByRole, proposer_owner: p.proposerOwner, counterparty_owner: p.counterpartyOwner,
      new_price_per_call: p.newPricePerCall, new_cap_units: p.newCapUnits, note: p.note,
      current_terms: p.currentTerms, status: p.status, created_at: p.createdAt, resolved_at: p.resolvedAt,
    };
  }
  function historyView(config2: AimeatConfig, e: EntitlementHistoryEntry) {
    return { ...view(config2, e), archived_at: e.archivedAt, archive_reason: e.archiveReason, superseded_by_proposal: e.supersededByProposal };
  }

  /**
   * POST /v1/exchange/proposals — propose new terms for a live contract (renegotiation). Either party may:
   * a consumer renegotiates their own contract; a provider renegotiates a specific consumer's contract
   * (pass `consumer_gaii`). Body: `{ ext, action, consumer_gaii?, new_price_per_call?, new_cap_units?, note? }`.
   * A message is delivered to the counterparty; they accept/decline. Nothing changes until accepted.
   */
  router.post('/v1/exchange/proposals', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const ext = typeof b.ext === 'string' ? b.ext : '';
    const action = typeof b.action === 'string' ? b.action : '';
    if (!ext || !action) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'ext and action are required'));
    const targetConsumer = typeof b.consumer_gaii === 'string' && b.consumer_gaii ? b.consumer_gaii : resolveIdentity(req.auth!, config.nodeId);
    const ent = await readEntitlementForCall(storage, targetConsumer, ext, action);
    if (!ent) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such contract'));
    const isConsumer = ownerOfGaii(ent.consumerGaii) === owner;
    const isProvider = ownerOfGaii(ent.providerGhii) === owner;
    if (!isConsumer && !isProvider) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'You are not a party to this contract'));
    const proposedByRole: 'provider' | 'consumer' = isConsumer ? 'consumer' : 'provider';
    const proposerGhii = proposedByRole === 'consumer' ? ent.consumerGaii : ent.providerGhii;
    const counterpartyGhii = proposedByRole === 'consumer' ? ent.providerGhii : ent.consumerGaii;
    const newPrice = typeof b.new_price_per_call === 'number' && Number.isFinite(b.new_price_per_call) && b.new_price_per_call >= 0 ? Math.floor(b.new_price_per_call) : null;
    const newCap = typeof b.new_cap_units === 'number' && Number.isFinite(b.new_cap_units) && b.new_cap_units >= 0 ? Math.floor(b.new_cap_units) : null;
    if (newPrice === null && newCap === null) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'Propose at least a new_price_per_call or new_cap_units'));
    const now = new Date().toISOString();
    const proposal: ContractProposal = {
      proposalId: newProposalId(), consumerGaii: ent.consumerGaii, providerGhii: ent.providerGhii,
      ext, action, capabilityLabel: ent.capabilityLabel, proposedByRole,
      proposerGhii, proposerOwner: owner, counterpartyGhii, counterpartyOwner: ownerOfGaii(counterpartyGhii),
      newPricePerCall: newPrice, newCapUnits: newCap, note: typeof b.note === 'string' ? b.note.slice(0, 2000) : '',
      currentTerms: { unit: ent.unit, pricePerCall: ent.pricePerCall, pricingModel: (ent.pricing?.model ?? 'per_call'), capUnits: ent.budget.capUnits },
      status: 'pending', createdAt: now, resolvedAt: null,
    };
    await putProposal(storage, proposal);
    const priceLine = newPrice !== null ? `price → ${newPrice} ${ent.unit === 'money' ? (ent.currency ?? '') : 'morsels'}/call` : '';
    const capLine = newCap !== null ? `budget cap → ${newCap}` : '';
    await notify(owner, proposal.counterpartyOwner, 'EXCHANGE — contract change proposed',
      `${owner} proposed a change to your contract for ${ent.capabilityLabel}: ${[priceLine, capLine].filter(Boolean).join(', ')}. ${proposal.note ? `Note: ${proposal.note}. ` : ''}Review it in the EXCHANGE app (Proposals) to accept or decline.`);
    return res.status(201).json(success(config.nodeId, { proposal: proposalView(proposal) }));
  });

  /** GET /v1/exchange/proposals — every proposal the caller is party to (incoming + outgoing). */
  router.get('/v1/exchange/proposals', requireAuth(), async (req: Request, res: Response) => {
    const list = await listProposalsForOwner(storage, req.auth!.owner);
    return res.json(success(config.nodeId, { proposals: list.map(proposalView), count: list.length }));
  });

  /** POST /v1/exchange/proposals/:id/accept — the COUNTERPARTY accepts → supersede (archive old + mint new). */
  router.post('/v1/exchange/proposals/:id/accept', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const p = await getProposal(storage, typeof req.params.id === 'string' ? req.params.id : '');
    if (!p || p.status !== 'pending') return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such pending proposal'));
    if (p.counterpartyOwner !== owner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the counterparty may accept this proposal'));
    const ent = await supersedeWithProposal(storage, p);
    if (!ent) return res.status(409).json(error(config.nodeId, 'CONTRACT_GONE', 'The contract no longer exists'));
    p.status = 'accepted'; p.resolvedAt = new Date().toISOString(); await putProposal(storage, p);
    await notify(owner, p.proposerOwner, 'EXCHANGE — contract change accepted',
      `${owner} accepted your proposed change to ${p.capabilityLabel}. The new contract is in effect; the previous one is in your contract history.`);
    return res.status(200).json(success(config.nodeId, { proposal: proposalView(p), entitlement: view(config, ent) }));
  });

  /** POST /v1/exchange/proposals/:id/decline — the counterparty declines (no change). */
  router.post('/v1/exchange/proposals/:id/decline', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const p = await getProposal(storage, typeof req.params.id === 'string' ? req.params.id : '');
    if (!p || p.status !== 'pending') return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such pending proposal'));
    if (p.counterpartyOwner !== owner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the counterparty may decline this proposal'));
    p.status = 'declined'; p.resolvedAt = new Date().toISOString(); await putProposal(storage, p);
    await notify(owner, p.proposerOwner, 'EXCHANGE — contract change declined', `${owner} declined your proposed change to ${p.capabilityLabel}. The contract is unchanged.`);
    return res.json(success(config.nodeId, { proposal: proposalView(p) }));
  });

  /** POST /v1/exchange/proposals/:id/withdraw — the PROPOSER withdraws their own pending proposal. */
  router.post('/v1/exchange/proposals/:id/withdraw', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const p = await getProposal(storage, typeof req.params.id === 'string' ? req.params.id : '');
    if (!p || p.status !== 'pending') return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such pending proposal'));
    if (p.proposerOwner !== owner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the proposer may withdraw'));
    p.status = 'withdrawn'; p.resolvedAt = new Date().toISOString(); await putProposal(storage, p);
    return res.json(success(config.nodeId, { proposal: proposalView(p) }));
  });

  /** GET /v1/exchange/entitlements/history — the caller-owner's PAST (archived/superseded) contracts as consumer. */
  router.get('/v1/exchange/entitlements/history', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const past = await listEntitlementHistoryByConsumer(storage, consumerGaii);
    return res.json(success(config.nodeId, { history: past.map(e => historyView(config, e)), count: past.length }));
  });

  /** GET /v1/exchange/provider/history — the caller-owner's PAST (archived/superseded) contracts as provider. */
  router.get('/v1/exchange/provider/history', requireAuth(), async (req: Request, res: Response) => {
    const providerGhii = resolveIdentity(req.auth!, config.nodeId);
    const past = await listEntitlementHistoryByProvider(storage, providerGhii);
    return res.json(success(config.nodeId, { history: past.map(e => historyView(config, e)), count: past.length }));
  });

  // ── AGENT WORK (async surface — settled per delivered task, Gap 2) ───────────
  function workView(w: AgentWork) {
    return {
      work_id: w.workId, offering_id: w.offeringId, consumer: w.consumerGaii, provider: w.providerGhii,
      agent: w.agentGaii, task_type: w.taskType, ext: w.ext, action: w.action, input: w.input, output: w.output,
      note: w.note, state: w.state, unit: w.unit, currency: w.currency, charged_units: w.chargedUnits,
      created_at: w.createdAt, delivered_at: w.deliveredAt,
    };
  }

  /**
   * POST /v1/exchange/work — the CONSUMER starts a task under an agent-work contract. Body:
   * `{ offering_id, input, note? }`. Requires an active metered entitlement for the offering's coordinate
   * (contract first). Nothing is charged yet — the per-task price is metered when the provider DELIVERS.
   */
  router.post('/v1/exchange/work', requireAuth(), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const offeringId = typeof b.offering_id === 'string' ? b.offering_id : '';
    if (!offeringId) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'offering_id is required'));
    const o = await getOffering(storage, offeringId);
    if (!o || o.state !== 'listed' || o.kind !== 'agent-work' || !o.surface || o.surface.kind !== 'agent-work') {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such listed agent-work offering'));
    }
    const ent = await readEntitlementForCall(storage, consumerGaii, o.ext, o.action);
    if (!ent || ent.state !== 'active') {
      return res.status(402).json(error(config.nodeId, 'NO_CONTRACT', 'Accept a contract for this agent-work offering before starting a task'));
    }
    const s = o.surface;
    const now = new Date().toISOString();
    const work: AgentWork = {
      workId: newWorkId(), offeringId, consumerGaii, consumerOwner: owner,
      providerGhii: o.providerGhii, providerOwner: o.providerOwner,
      agentGaii: `${s.agentName}#${o.providerOwner}@${config.nodeId}`, taskType: s.taskType,
      ext: o.ext, action: o.action, input: b.input ?? {}, output: null,
      note: typeof b.note === 'string' ? b.note.slice(0, 2000) : '',
      state: 'open', unit: ent.unit, currency: ent.currency, chargedUnits: 0, createdAt: now, deliveredAt: null,
    };
    await putWork(storage, work);
    await notify(owner, o.providerOwner, 'EXCHANGE — new agent work started',
      `${owner} started a "${s.taskType}" task for your agent ${s.agentName} (work ${work.workId}). Deliver it in the EXCHANGE app to get paid.`);
    return res.status(201).json(success(config.nodeId, { work: workView(work) }));
  });

  /**
   * POST /v1/exchange/work/:id/deliver — the PROVIDER delivers a task → settle ON DELIVERY (charge the
   * consumer the per-task price, credit the provider, route the rake, decrement the budget). Body:
   * `{ output, note? }`. A 402/429 (budget/rate) leaves the work open and unpaid.
   */
  router.post('/v1/exchange/work/:id/deliver', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const w = await getWork(storage, typeof req.params.id === 'string' ? req.params.id : '');
    if (!w || w.providerOwner !== owner) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such work of yours to deliver'));
    if (w.state !== 'open') return res.status(409).json(error(config.nodeId, 'WORK_NOT_OPEN', `Work is ${w.state}`));
    const b = (req.body ?? {}) as Record<string, unknown>;
    // Settle the per-task price against the CONSUMER's contract (the consumer pays; the provider is credited).
    const before = await readEntitlementForCall(storage, w.consumerGaii, w.ext, w.action);
    if (!before || before.state !== 'active') {
      return res.status(402).json(error(config.nodeId, 'CONTRACT_INACTIVE', 'The consumer contract is no longer active — cannot settle this delivery'));
    }
    const outcome = await settleMeteredCoordinate({
      config, storage, coordExt: w.ext, coordAction: w.action, label: `${w.agentGaii}:${w.taskType}`,
      callerGaii: w.consumerGaii, res,
    });
    if (!outcome) return res.status(402).json(error(config.nodeId, 'NO_CONTRACT', 'No active contract to settle against'));
    if (!outcome.ok) return; // 402/429 already sent (budget/rate) — work stays open
    const after = await readEntitlementForCall(storage, w.consumerGaii, w.ext, w.action);
    const charged = after && before ? Math.max(0, (after.budget.spentUnits) - (before.budget.spentUnits)) : 0;
    w.state = 'delivered'; w.output = b.output ?? null; w.chargedUnits = charged; w.deliveredAt = new Date().toISOString();
    if (typeof b.note === 'string' && b.note) w.note = b.note.slice(0, 2000);
    await putWork(storage, w);
    await notify(owner, w.consumerOwner, 'EXCHANGE — your agent work was delivered',
      `Your "${w.taskType}" task (work ${w.workId}) was delivered by ${owner} and charged to your contract. See it in the EXCHANGE app.`);
    return res.json(success(config.nodeId, { work: workView(w) }));
  });

  /** GET /v1/exchange/work?role=consumer|provider — the caller-owner's agent-work items (default: consumer). */
  router.get('/v1/exchange/work', requireAuth(), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const role = req.query.role === 'provider' ? 'provider' : 'consumer';
    const items = role === 'provider' ? await listWorkByProvider(storage, owner) : await listWorkByConsumer(storage, owner);
    return res.json(success(config.nodeId, { work: items.map(workView), count: items.length, role }));
  });

  return router;
}
