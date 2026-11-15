/**
 * @file src/routes/disputes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Work dispute routes — opening disputes, counter-disputes, partial offers, and
 *   operator rulings, backed by a hash-chained tamper-evident audit log. Delivery settles the escrow;
 *   a resolution re-divides the toll delivery paid the provider (services/morsel.ts takeBackFromProvider).
 *
 * @structure
 *   - disputesRouter(config, storage): mounts POST /v1/work/:tc/dispute and related endpoints, and the
 *     operator's GET /v1/admin/disputes, GET /v1/admin/disputes/:id and POST /v1/admin/disputes/:id/rule
 *   - the audit chain and resolveDisputeOnce: services/disputes/audit.ts
 *
 * @version-history
 *   2026-11-15 — GET /v1/admin/disputes and GET /v1/admin/disputes/:id: what waits for the operator and
 *     one dispute with its trail. The audit chain and resolveDisputeOnce moved unchanged to
 *     services/disputes/audit.ts and the ruling to services/disputes/operator.ts, which
 *     aimeat_admin_disputes and aimeat_admin_dispute_rule call too
 *     (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida).
 *   2026-10-25 — A dispute is resolved once: every resolution (accept-fault, accept-partial,
 *     accept-redelivery, withdraw, the operator ruling) claims it active → resolved with one
 *     conditional UPDATE (storage.transitionDisputeStatus) before the refund moves, in one
 *     transaction; a concurrent call that lost answers 404 DISPUTE_CLOSED (409 on the operator route)
 *     and moves nothing. Opening claims the work delivered|rated → disputed, so one delivery gets one
 *     dispute; counter-dispute and escalate move only an active dispute (secaudit2026oct22,
 *     dispute-resolution-without-cas).
 *   2026-10-16 — A dispute re-divides what delivery paid the provider (the toll) and nothing more:
 *     accept-fault and an accepted partial refund take the requester's share back from the provider,
 *     withdraw and accept-redelivery move no money, and a ruling takes the requester's and the burned
 *     share from the provider, who keeps the rest. Each resolution paid out the escrow a second time
 *     after delivery had settled it, creating morsels. A provider whose balance holds less is refused
 *     409 PROVIDER_BALANCE_SHORT with nothing written (QA audit S8-02).
 *   2026-10-15 — The operator ruling takes only requester_wins, provider_wins or split (OperatorRulingSchema, 400 VALIDATION_ERROR otherwise) (feature-list audit #143). Accept-fault records a requester_wins ruling, and every resolution stores the provider's recomputed trust score (refreshTrustScore) (feature-list audit #144).
 *   v2.3.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail. The operator routes ask requireOperator (askOperator with operator:admin) (secaudit 2026-10, C2).
 *   v2.2.0 — 2026-09-26 — Every door names the caller by its resolved identity (resolveIdentity): a
 *     person by their GHII, an agent by its GAII. A work item carries the same identity for its two
 *     parties, so a person who asked for work or delivered it in person uses the dispute doors on it,
 *     and the log names who acted the way the work item does.
 *   v2.1.0 — 2026-08-16 — The audit hash is computed over a CANONICAL serialisation, so it can be
 *     recomputed from the entry as it is read back. It could not be on the production backend:
 *     `DisputeAudit.data` is JSONB and Postgres returns its keys in its own order, so any entry whose
 *     data carries two or more keys hashed one string on the way in and serialised to a different one
 *     on the way out. A log that is tamper-evident only on sqlite is not tamper-evident. Found by the
 *     E2E test-quality work: the suite's only chain test walked the LINKS and never recomputed a
 *     hash, so the defect was invisible — a random value per entry passed it too. Nothing consumed
 *     these hashes before this, so no stored value changes meaning for a reader that exists.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-08-10 — Security audit C-3: a partial refund is bounded by the escrow, refused at
 *     the offer and clamped again at accept. `refund_morsels` was validated as any positive integer
 *     and credited unconditionally, so a provider and a requester the same person controls could
 *     mint an arbitrary balance out of a trivially cheap piece of work.
 *   v2.0.0 — 2026-08-14 — August 2026 audit: the last two Tier 0.5 write doors are gone,
 *     GET /v1/work/:tc/accept-redelivery?otk= and GET /v1/work/:tc/escalate?otk=. RFC v4.0 deprecates
 *     One-Time Keys and says what survives of Tier 0.5 sits behind keyedBrowseEnabled; these sat
 *     behind no flag at all, and that flag defaults to on regardless. Three siblings of the same
 *     shape (work accept, work reject, board post) went on 2026-08-11. Both moved money or state on
 *     a GET with a key in the URL, so a link in a chat log, a referer header or a proxy access log
 *     was enough to settle a dispute. Neither ran the auth middleware its POST twin runs, and the
 *     escalate one checked nothing at all: the POST refuses anyone who is not the provider or the
 *     requester, while the GET took any live session key and escalated any dispute named by its
 *     tracking code. Two more defects went with them rather than being repaired, which is why this
 *     is a delete and not a flag. (1) accept-redelivery settled payment and then left the work at
 *     `delivered` instead of `settled`, so the requester could open a second dispute on work already
 *     paid for, and the accept-fault route would then return an escrow already paid out. (2) escalate
 *     hand-rolled the audit entry instead of calling appendAuditEntry: it wrote the event name
 *     `escalated_tier_0_5`, which the DisputeAuditEvent enum in openapi.yaml does not contain, and
 *     it seeded a genesis previousHash of '0' where the chain uses sixty-four zeros, so a chain
 *     whose first entry came from that route failed verification against the documented rule. It
 *     also skipped the work-status update its POST twin performs, leaving the work out of step with
 *     its own dispute.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOperator, requireExternalPrincipal, requireAnyScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { disputedAmount, takeBackFromProvider } from '../services/morsel.js';
import { resolveIdentity } from '../utils/gaii.js';
import { isOperatorCaller } from '../services/operator-override.js';
import { refreshTrustScore } from '../services/trust.js';
import { appendAuditEntry, resolveDisputeOnce, ACTIVE_DISPUTE, DISPUTED_WORK } from '../services/disputes/audit.js';
import { listOperatorDisputes, getOperatorDispute, ruleDispute, DISPUTE_LIST_STATUSES, type DisputeListStatus } from '../services/disputes/operator.js';
import { DisputeOpenSchema, CounterDisputeSchema, PartialOfferSchema, OperatorRulingSchema, validateBody } from '../models/schemas.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

export function disputesRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // POST /v1/work/:tc/dispute — Open dispute
    router.post('/v1/work/:tc/dispute', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), validateBody(DisputeOpenSchema, config.nodeId), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
            return;
        }
        if (work.requesterGaii !== me) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can open a dispute'));
            return;
        }
        if (work.status !== 'delivered' && work.status !== 'rated') {
            res.status(409).json(error(config.nodeId, 'CONFLICT', `Cannot dispute work in status "${work.status}"`));
            return;
        }

        const existing = await storage.getDisputeByTrackingCode(tc);
        if (existing && existing.status !== 'resolved') {
            res.status(409).json(error(config.nodeId, 'CONFLICT', 'A dispute is already open for this work item'));
            return;
        }

        const { reason } = req.body ?? {};

        const now = new Date().toISOString();
        const disputeId = `dispute-${randomBytes(8).toString('hex')}`;

        // The work moves to disputed on its status (delivered or rated → disputed) before the dispute
        // is written, so two concurrent openings make one dispute; two disputes on one delivery could
        // each be resolved, and each resolution moves a refund (secaudit2026oct22).
        const dispute = await storage.transaction(async () => {
            if (!await storage.transitionWorkStatus(tc, ['delivered', 'rated'], 'disputed', now)) return null;
            return storage.createDispute({
                id: disputeId,
                trackingCode: tc,
                status: 'open',
                openedBy: me,
                reason,
                createdAt: now,
                updatedAt: now,
            });
        });
        if (!dispute) {
            res.status(409).json(error(config.nodeId, 'CONFLICT', 'A dispute is already open for this work item'));
            return;
        }

        await appendAuditEntry(storage, disputeId, 'dispute_opened', me, { reason });

        res.status(201).json(success(config.nodeId, {
            dispute_id: dispute.id,
            tracking_code: tc,
            status: dispute.status,
            reason: dispute.reason,
            created_at: dispute.createdAt,
        }, [
            { description: 'View dispute thread', method: 'GET', url: `/v1/work/${tc}/dispute` },
            { description: 'Provider can counter-dispute', method: 'POST', url: `/v1/work/${tc}/counter-dispute` },
            { description: 'Provider can re-deliver', method: 'POST', url: `/v1/work/${tc}/redeliver` },
            { description: 'Provider can accept fault', method: 'POST', url: `/v1/work/${tc}/accept-fault` },
            { description: 'Withdraw dispute', method: 'POST', url: `/v1/work/${tc}/withdraw-dispute` },
        ]));
        emitChange('disputes');
    });

    // GET /v1/work/:tc/dispute — View dispute thread
    router.get('/v1/work/:tc/dispute', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:read', 'work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
            return;
        }

        // The operator reads a dispute as its arbiter (POST /v1/admin/disputes/:id/rule), a node duty
        // over two parties rather than an act in one person's account, so no operator trail.
        if (work.providerGaii !== me && work.requesterGaii !== me && !(await isOperatorCaller(storage, req.auth))) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not a party to this dispute'));
            return;
        }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No dispute found for this work item'));
            return;
        }

        const auditLog = await storage.getDisputeAuditLog(dispute.id);

        res.json(success(config.nodeId, {
            dispute_id: dispute.id,
            tracking_code: dispute.trackingCode,
            status: dispute.status,
            opened_by: dispute.openedBy,
            reason: dispute.reason,
            ruling: dispute.ruling,
            messages: auditLog.map(e => ({
                sequence: e.sequence,
                event: e.event,
                actor: e.actor,
                timestamp: e.timestamp,
                data: e.data,
            })),
            created_at: dispute.createdAt,
            updated_at: dispute.updatedAt,
        }));
    });

    // POST /v1/work/:tc/counter-dispute — Provider counter-disputes
    router.post('/v1/work/:tc/counter-dispute', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), validateBody(CounterDisputeSchema, config.nodeId), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can counter-dispute')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { reason } = req.body ?? {};

        // Moved only while the dispute is still active, so a resolution that landed meanwhile is never
        // turned back into an open dispute that could be resolved, and refunded, a second time.
        if (!await storage.transitionDisputeStatus(dispute.id, ACTIVE_DISPUTE, 'contested', new Date().toISOString())) {
            res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return;
        }
        await storage.transitionWorkStatus(tc, DISPUTED_WORK, 'contested', new Date().toISOString());
        await appendAuditEntry(storage, dispute.id, 'counter_dispute', me, { reason });

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'contested' }, [
            { description: 'Escalate to operator', method: 'POST', url: `/v1/work/${tc}/escalate` },
            { description: 'Offer partial refund', method: 'POST', url: `/v1/work/${tc}/offer-partial` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/redeliver — Re-deliver after dispute
    router.post('/v1/work/:tc/redeliver', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can re-deliver')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { output } = req.body ?? {};
        if (output === undefined) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'output is required')); return; }

        await storage.updateWork(tc, { output, updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 're_delivery', me, { output_provided: true });

        res.json(success(config.nodeId, { tracking_code: tc, redelivered: true }, [
            { description: 'Requester can accept re-delivery', method: 'POST', url: `/v1/work/${tc}/accept-redelivery` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/accept-fault — Provider accepts fault
    router.post('/v1/work/:tc/accept-fault', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can accept fault')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // The requester gets back what delivery paid the provider, taken from the provider. It
        // returned the whole escrow while the provider kept the toll, which created the toll out of
        // nothing on every accepted fault (QA audit S8-02). The network fee was burned or split at
        // delivery and is not the provider's to return. Refuse before you write.
        const refund = disputedAmount(work);
        const outcome = await resolveDisputeOnce(storage, dispute.id, tc, () => takeBackFromProvider(storage, work, { toRequester: refund }));
        if (outcome === 'closed') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }
        if (outcome === 'short') {
            res.status(409).json(error(config.nodeId, 'PROVIDER_BALANCE_SHORT',
                `Your balance holds fewer than the ${refund} morsels this work paid you, so nothing changed. Offer a smaller partial refund instead.`,
                409, { refund_morsels: refund, tracking_code: tc }));
            return;
        }

        // Recorded as the verdict it is, so the trust score reads it as a dispute the provider lost.
        // Without a ruling this outcome was invisible to the score (feature-list audit #144).
        await storage.updateDispute(dispute.id, {
            ruling: { ruling: 'requester_wins', distribution: { toRequester: refund, toProvider: 0, burned: 0 }, reason: 'The provider accepted fault.' },
            updatedAt: new Date().toISOString(),
        });
        await refreshTrustScore(storage, work.providerGaii);
        await appendAuditEntry(storage, dispute.id, 'accept_fault', me, { full_refund: true, refund_morsels: refund });

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', outcome: 'requester_refunded', refund_morsels: refund }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/offer-partial — Provider offers partial refund
    router.post('/v1/work/:tc/offer-partial', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), validateBody(PartialOfferSchema, config.nodeId), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can offer partial refund')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { refund_morsels, message } = req.body ?? {};

        // SECURITY (C-3): the offer names an amount that `accept-partial` later credits with an
        // unconditional creditBalance. The schema bounds it to a positive integer and nothing bounds
        // it above, so an offer larger than the escrow mints the difference out of nothing — and both
        // sides of a dispute are cheap for one person to control. What delivery paid the provider is
        // the ceiling: cost.inEscrow still read the whole escrow after delivery had shared it out
        // (QA audit S8-02).
        const paid = disputedAmount(work);
        if (typeof refund_morsels === 'number' && refund_morsels > paid) {
            res.status(400).json(error(config.nodeId, 'REFUND_EXCEEDS_ESCROW',
                `You can refund at most ${paid} morsels, which is what this work paid you. Choose a smaller amount.`,
                400, { max_refund_morsels: paid }));
            return;
        }

        await appendAuditEntry(storage, dispute.id, 'partial_offer', me, { refund_morsels, message });

        res.json(success(config.nodeId, { dispute_id: dispute.id, offer: { refund_morsels, message } }, [
            { description: 'Requester accepts partial', method: 'POST', url: `/v1/work/${tc}/accept-partial` },
            { description: 'Requester rejects partial', method: 'POST', url: `/v1/work/${tc}/reject-partial` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/accept-redelivery — Requester accepts re-delivery
    router.post('/v1/work/:tc/accept-redelivery', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can accept re-delivery')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // No money moves: delivery already paid the provider. This paid them a second time, which
        // created the toll out of nothing (QA audit S8-02).

        if (await resolveDisputeOnce(storage, dispute.id, tc, async () => true) === 'closed') {
            res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return;
        }
        await refreshTrustScore(storage, work.providerGaii);
        await appendAuditEntry(storage, dispute.id, 'accept_redelivery', me, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', outcome: 'redelivery_accepted' }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/accept-partial — Requester accepts partial offer
    router.post('/v1/work/:tc/accept-partial', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can accept partial')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // Find the last partial_offer in audit log
        const auditLog = await storage.getDisputeAuditLog(dispute.id);
        const lastOffer = [...auditLog].reverse().find(e => e.event === 'partial_offer');
        const offered = lastOffer ? Number(lastOffer.data.refund_morsels) : 0;
        // SECURITY (C-3): clamped again on the way out of the audit log, not only on the way in. The
        // offer route refuses an amount over what delivery paid, but this reads a value stored earlier
        // — including rows written before that gate existed — and it is the line that moves the money.
        const refundAmount = Number.isFinite(offered) ? Math.max(0, Math.min(offered, disputedAmount(work))) : 0;

        // The refund comes out of what delivery paid the provider, who keeps the rest. It returned
        // the refund from nowhere and paid the provider the remainder again (QA audit S8-02).
        const outcome = await resolveDisputeOnce(storage, dispute.id, tc, () => takeBackFromProvider(storage, work, { toRequester: refundAmount }));
        if (outcome === 'closed') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }
        if (outcome === 'short') {
            res.status(409).json(error(config.nodeId, 'PROVIDER_BALANCE_SHORT',
                `The provider's balance holds less than the ${refundAmount} morsels offered, so nothing changed. Try again later, or escalate the dispute.`,
                409, { refund_morsels: refundAmount, tracking_code: tc }));
            return;
        }

        await refreshTrustScore(storage, work.providerGaii);
        await appendAuditEntry(storage, dispute.id, 'partial_accepted', me, { refund_morsels: refundAmount });

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', refund_morsels: refundAmount }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/reject-partial — Requester rejects partial offer
    router.post('/v1/work/:tc/reject-partial', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can reject partial')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        await appendAuditEntry(storage, dispute.id, 'partial_rejected', me, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: dispute.status, partial_rejected: true }, [
            { description: 'Escalate to operator', method: 'POST', url: `/v1/work/${tc}/escalate` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/withdraw-dispute — Requester withdraws dispute
    router.post('/v1/work/:tc/withdraw-dispute', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== me) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can withdraw a dispute')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // No money moves: delivery already paid the provider, and a withdrawn dispute leaves it so.
        // This paid them a second time (QA audit S8-02).

        if (await resolveDisputeOnce(storage, dispute.id, tc, async () => true) === 'closed') {
            res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return;
        }
        await refreshTrustScore(storage, work.providerGaii);
        await appendAuditEntry(storage, dispute.id, 'withdraw_dispute', me, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', outcome: 'withdrawn' }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/escalate — Escalate to operator
    router.post('/v1/work/:tc/escalate', requireAuth(), requireExternalPrincipal(), requireAnyScope('work:request', 'work:accept'), async (req, res) => {
        const tc = param(req.params.tc);
        const me = resolveIdentity(req.auth!, config.nodeId);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }

        if (work.providerGaii !== me && work.requesterGaii !== me) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not a party to this work item'));
            return;
        }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // Moved only while the dispute is still active, so a resolution that landed meanwhile is never
        // turned back into an escalated dispute that the operator or the timeout could resolve again.
        if (!await storage.transitionDisputeStatus(dispute.id, ACTIVE_DISPUTE, 'escalated', new Date().toISOString())) {
            res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return;
        }
        await storage.transitionWorkStatus(tc, DISPUTED_WORK, 'escalated', new Date().toISOString());
        await appendAuditEntry(storage, dispute.id, 'escalated', me, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'escalated' }, [
            { description: 'View dispute thread', method: 'GET', url: `/v1/work/${tc}/dispute` },
        ]));
        emitChange('disputes');
    });

    // GET /v1/admin/disputes — The disputes that wait for the operator (services/disputes/operator.ts,
    // which aimeat_admin_disputes reads too). ?status=escalated (default) | open | all.
    router.get('/v1/admin/disputes', requireAuth(), requireOperator(storage), async (req, res) => {
        const status = (typeof req.query.status === 'string' && req.query.status ? req.query.status : 'escalated') as DisputeListStatus;
        if (!DISPUTE_LIST_STATUSES.includes(status)) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'status is escalated, open or all')); return;
        }
        res.json(success(config.nodeId, { disputes: await listOperatorDisputes(storage, status) }, [
            { description: 'Rule one', method: 'POST', url: '/v1/admin/disputes/{id}/rule' },
        ]));
    });

    // GET /v1/admin/disputes/:id — One dispute as the list reads it, with its audit trail.
    router.get('/v1/admin/disputes/:id', requireAuth(), requireOperator(storage), async (req, res) => {
        const one = await getOperatorDispute(storage, param(req.params.id));
        if (!one) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Dispute not found')); return; }
        res.json(success(config.nodeId, one));
    });

    // POST /v1/admin/disputes/:id/rule — Operator rules on dispute. The checks, the once-only claim and
    // the audit entry are services/disputes/operator.ts ruleDispute, which aimeat_admin_dispute_rule calls too.
    router.post('/v1/admin/disputes/:id/rule', requireAuth(), requireOperator(storage), validateBody(OperatorRulingSchema, config.nodeId), async (req, res) => {
        const me = resolveIdentity(req.auth!, config.nodeId);
        const out = await ruleDispute(storage, me, param(req.params.id), req.body ?? {});
        if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message, out.status, out.details)); return; }
        res.json(success(config.nodeId, out.data));
        emitChange('disputes');
    });

    // GET /v1/admin/disputes/:id/audit-log — Tamper-evident audit trail
    router.get('/v1/admin/disputes/:id/audit-log', requireAuth(), requireOperator(storage), async (req, res) => {
        const disputeId = param(req.params.id);
        const dispute = await storage.getDispute(disputeId);
        if (!dispute) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Dispute not found')); return; }

        const entries = await storage.getDisputeAuditLog(disputeId);

        res.json(success(config.nodeId, {
            dispute_id: disputeId,
            tracking_code: dispute.trackingCode,
            entries,
        }));
    });

    // A dispute is settled and escalated through the POST routes above. Both operations also had a
    // Tier 0.5 twin that took a one-time key in the query string and no bearer token; those were
    // removed on 2026-08-14 with the rest of Tier 0.5. See the version history for what they did.

    return router;
}
