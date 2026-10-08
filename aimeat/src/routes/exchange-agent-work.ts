/**
 * @file src/routes/exchange-agent-work.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description EXCHANGE agent work (TARGET-045 Gap 2), the third kind of thing sold on EXCHANGE beside
 *   data and services: the consumer starts a task under an agent-work contract, the provider delivers
 *   it, and the per-task price is settled on delivery through the same metered settlement as a
 *   synchronous call. exchangeRouter (routes/exchange.ts) registers these routes on its own router.
 * @structure registerExchangeAgentWorkRoutes — POST /v1/exchange/work · POST /v1/exchange/work/:id/deliver ·
 *   GET /v1/exchange/work
 * @usage
 *   registerExchangeAgentWorkRoutes(router, config, storage, notify);
 * @version-history
 *   v1.2.0 — 2026-10-08 — POST /v1/exchange/work/:id/deliver records how the answer was made, as
 *     aimeat_exchange_work_deliver does: it takes ai_provenance and ai_provenance_id, refuses a
 *     declaration the caller may not make (403 SCOPE_DENIED) before anything settles, stamps the
 *     delivery on both the prepaid and the settled branch, and stores the record id on the work. It
 *     minted nothing before, so an agent delivering over REST left the buyer with no record. Every
 *     work view is services/exchange-work.ts workView, with the record embedded.
 *   v1.1.0 — 2026-09-26 — POST /v1/exchange/work refuses SELF_WORK and SAME_OWNER_WORK (400) when the
 *     consumer and the agent that does the work belong to the same owner, before it reads the
 *     contract: the rule for every endpoint that creates work, from services/work-parties.ts
 *     (secaudit 2026-09, R4 5).
 *   v1.0.0 — 2026-09-26 — Moved out of routes/exchange.ts as it was, to keep that file under the
 *     800-line limit.
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { readEntitlementForCall } from '../services/metered-entitlements.js';
import { getOffering } from '../services/exchange-market.js';
import { settleMeteredCoordinate } from './extensions/entitlement-gate.js';
import {
  type AgentWork, newWorkId, putWork, getWork, listWorkByConsumer, listWorkByProvider, workView, workViews,
} from '../services/exchange-work.js';
import { refuseWorkBetween } from '../services/work-parties.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import { provenanceForWrite, provenanceDeclarationRefusal } from '../services/ai-provenance.js';

/** Deliver a same-node inbox message about a work event: exchangeRouter's own `notify`. */
export type ExchangeNotify = (senderOwner: string, recipientOwner: string, subject: string, body: string) => Promise<void>;

export function registerExchangeAgentWorkRoutes(router: Router, config: AimeatConfig, storage: Storage, notify: ExchangeNotify): void {
  // ── AGENT WORK (async surface — settled per delivered task, Gap 2) ───────────
  const view = (w: AgentWork) => workView(storage, config, w);

  /**
   * POST /v1/exchange/work — the CONSUMER starts a task under an agent-work contract. Body:
   * `{ offering_id, input, note? }`. Requires an active metered entitlement for the offering's coordinate
   * (contract first). Nothing is charged yet — the per-task price is metered when the provider DELIVERS.
   * The consumer and the agent that does the work belong to different owners.
   */
  router.post('/v1/exchange/work', requireAuth(), requireScope('exchange:write'), async (req: Request, res: Response) => {
    const consumerGaii = resolveIdentity(req.auth!, config.nodeId);
    const owner = req.auth!.owner;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const offeringId = typeof b.offering_id === 'string' ? b.offering_id : '';
    if (!offeringId) return res.status(400).json(error(config.nodeId, 'BAD_REQUEST', 'offering_id is required'));
    const o = await getOffering(storage, offeringId);
    if (!o || o.state !== 'listed' || o.kind !== 'agent-work' || !o.surface || o.surface.kind !== 'agent-work') {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such listed agent-work offering'));
    }
    // The provider of agent work is the agent that does it. No work with yourself and none between two
    // principals of one owner: the rule for every endpoint that creates work (services/work-parties.ts).
    const s = o.surface;
    const agentGaii = `${s.agentName}#${o.providerOwner}@${config.nodeId}`;
    const refused = refuseWorkBetween(consumerGaii, agentGaii);
    if (refused) return res.status(400).json(error(config.nodeId, refused.code, refused.message));
    const ent = await readEntitlementForCall(storage, consumerGaii, o.ext, o.action);
    if (!ent || ent.state !== 'active') {
      return res.status(402).json(error(config.nodeId, 'NO_CONTRACT', 'Accept a contract for this agent-work offering before starting a task'));
    }
    const now = new Date().toISOString();
    const work: AgentWork = {
      workId: newWorkId(), offeringId, consumerGaii, consumerOwner: owner,
      providerGhii: o.providerGhii, providerOwner: o.providerOwner,
      agentGaii, taskType: s.taskType,
      ext: o.ext, action: o.action, input: b.input ?? {}, output: null,
      note: typeof b.note === 'string' ? b.note.slice(0, 2000) : '',
      state: 'open', unit: ent.unit, currency: ent.currency, chargedUnits: 0, createdAt: now, deliveredAt: null,
    };
    await putWork(storage, work);
    await notify(owner, o.providerOwner, 'EXCHANGE — new agent work started',
      `${owner} started a "${s.taskType}" task for your agent ${s.agentName} (work ${work.workId}). Deliver it in the EXCHANGE app to get paid.`);
    return res.status(201).json(success(config.nodeId, { work: await view(work) }));
  });

  /**
   * POST /v1/exchange/work/:id/deliver — the PROVIDER delivers a task → settle ON DELIVERY (charge the
   * consumer the per-task price, credit the provider, route the rake, decrement the budget). Body:
   * `{ output, note?, ai_provenance?, ai_provenance_id? }`. A 402/429 (budget/rate) leaves the work
   * open and unpaid, and so does a 403 for a declaration the caller may not make.
   */
  router.post('/v1/exchange/work/:id/deliver', requireAuth(), requireScope('exchange:write'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const w = await getWork(storage, typeof req.params.id === 'string' ? req.params.id : '');
    if (!w || w.providerOwner !== owner) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such work of yours to deliver'));
    if (w.state !== 'open') return res.status(409).json(error(config.nodeId, 'WORK_NOT_OPEN', `This work is ${w.state}, so it cannot be changed now. Open it to see where it got to.`));
    const b = (req.body ?? {}) as Record<string, unknown>;

    // How the delivered answer was made: the same declaration aimeat_exchange_work_deliver takes.
    // Validated, and the scope refusal asked, BEFORE anything settles (invariant 14): a refusal heard
    // after the charge leaves the buyer paying for work that is still open.
    const parsedProvenance = parseDeclaredProvenanceInput(b.ai_provenance);
    if (!parsedProvenance.ok) {
      return res.status(400).json(error(config.nodeId, 'INVALID_PROVENANCE',
        'The ai_provenance block does not validate.', undefined, { violations: parsedProvenance.violations }));
    }
    const declared = parsedProvenance.declared;
    const declaredId = typeof b.ai_provenance_id === 'string' ? b.ai_provenance_id : undefined;
    // The RESOLVED caller, never a field off the work item: whoever holds this token delivered.
    const principal = resolveIdentity(req.auth!, config.nodeId);
    const scopes = req.auth!.scopes ?? [];
    const provenanceRefused = await provenanceDeclarationRefusal(storage, {
      principal, declaredId, declared, enabled: config.aiProvenance, scopes,
    });
    if (provenanceRefused) {
      return res.status(403).json(error(config.nodeId, provenanceRefused.code, provenanceRefused.message));
    }
    // The hash covers the output as stored plus the note, which is what the buyer receives and reads:
    // the same bytes the MCP tool hashes.
    const stampDelivery = (output: unknown, note: string): Promise<string | undefined> => provenanceForWrite(storage, {
      principal, scopes,
      content: `${JSON.stringify(output ?? null)}\n\n${note}`,
      declaredId, declared,
      pipeline: 'rest.exchange_work_deliver',
      // Delivered privately to one buyer, a person deciding what to do with an answer.
      surface: { visibility: 'private', humanAudience: true },
      labelPolicy: config.aiLabelPublic,
      nodeId: config.nodeId,
      baseUrl: config.baseUrl,
      enabled: config.aiProvenance,
    });
    const noteOf = (): string => (typeof b.note === 'string' ? b.note : '');

    // WORK PAID UP FRONT SETTLES ONCE, AND IT ALREADY HAS. A buyer from another node holds no
    // contract and no balance here — its money moved onchain at the A2A door before the work was
    // opened — so metering it again on delivery would either refuse a task the provider was paid
    // for or charge for it twice. The two markers are both written by that door and neither can be
    // produced through this one: `/v1/exchange/work` always stamps `consumerOwner` from the caller,
    // so an empty one means there was no local caller, and `chargedUnits` is 0 until something
    // settles.
    const prepaid = w.consumerOwner === '' && w.chargedUnits > 0;
    if (prepaid) {
      const aiProvenanceId = await stampDelivery(b.output ?? null, noteOf());
      w.state = 'delivered'; w.output = b.output ?? null; w.deliveredAt = new Date().toISOString();
      if (aiProvenanceId) w.aiProvenanceId = aiProvenanceId;
      if (typeof b.note === 'string' && b.note) w.note = b.note.slice(0, 2000);
      await putWork(storage, w);
      // No notification: there is nobody on this node to tell. The buyer reads the result at the
      // A2A endpoint it created the work through.
      return res.json(success(config.nodeId, { work: await view(w) }));
    }

    // Settle the per-task price against the CONSUMER's contract (the consumer pays; the provider is credited).
    const before = await readEntitlementForCall(storage, w.consumerGaii, w.ext, w.action);
    if (!before || before.state !== 'active') {
      return res.status(402).json(error(config.nodeId, 'CONTRACT_INACTIVE', 'The agreement behind this work has ended, so it cannot be settled. Ask the other side to renew it.'));
    }
    const outcome = await settleMeteredCoordinate({
      config, storage, coordExt: w.ext, coordAction: w.action, label: `${w.agentGaii}:${w.taskType}`,
      callerGaii: w.consumerGaii, res,
    });
    if (!outcome) return res.status(402).json(error(config.nodeId, 'NO_CONTRACT', 'There is no live agreement to settle against. Accept one first, then deliver.'));
    if (!outcome.ok) return; // 402/429 already sent (budget/rate) — work stays open
    const after = await readEntitlementForCall(storage, w.consumerGaii, w.ext, w.action);
    const charged = after && before ? Math.max(0, (after.budget.spentUnits) - (before.budget.spentUnits)) : 0;
    const aiProvenanceId = await stampDelivery(b.output ?? null, noteOf());
    w.state = 'delivered'; w.output = b.output ?? null; w.chargedUnits = charged; w.deliveredAt = new Date().toISOString();
    if (aiProvenanceId) w.aiProvenanceId = aiProvenanceId;
    if (typeof b.note === 'string' && b.note) w.note = b.note.slice(0, 2000);
    await putWork(storage, w);
    await notify(owner, w.consumerOwner, 'EXCHANGE — your agent work was delivered',
      `Your "${w.taskType}" task (work ${w.workId}) was delivered by ${owner} and charged to your contract. See it in the EXCHANGE app.`);
    return res.json(success(config.nodeId, { work: await view(w) }));
  });

  /** GET /v1/exchange/work?role=consumer|provider — the caller-owner's agent-work items (default: consumer). */
  router.get('/v1/exchange/work', requireAuth(), requireScope('exchange:read'), async (req: Request, res: Response) => {
    const owner = req.auth!.owner;
    const role = req.query.role === 'provider' ? 'provider' : 'consumer';
    const items = role === 'provider' ? await listWorkByProvider(storage, owner) : await listWorkByConsumer(storage, owner);
    return res.json(success(config.nodeId, { work: await workViews(storage, config, items), count: items.length, role }));
  });
}
