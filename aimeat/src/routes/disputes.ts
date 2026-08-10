/**
 * @file src/routes/disputes.ts
 * @description Work dispute routes — opening disputes, counter-disputes, partial offers, and
 *   operator rulings, backed by a hash-chained tamper-evident audit log and morsel escrow
 *   settlement/return on resolution.
 *
 * @structure
 *   - computeAuditHash/appendAuditEntry: build the SHA-256 hash-chained dispute audit log
 *   - disputesRouter(config, storage): mounts POST /v1/work/:tc/dispute and related endpoints
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-08-10 — Security audit C-3: a partial refund is bounded by the escrow, refused at
 *     the offer and clamped again at accept. `refund_morsels` was validated as any positive integer
 *     and credited unconditionally, so a provider and a requester the same person controls could
 *     mint an arbitrary balance out of a trivially cheap piece of work.
 */
import { Router } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, DisputeAuditEntry } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { returnEscrow, settlePayment } from '../services/morsel.js';
import { DisputeOpenSchema, CounterDisputeSchema, PartialOfferSchema, OperatorRulingSchema, validateBody } from '../models/schemas.js';
import { checkOtkSession } from './auth.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

function computeAuditHash(entry: Omit<DisputeAuditEntry, 'hash'>, previousHash: string): string {
    const payload = JSON.stringify({ ...entry, previousHash });
    return createHash('sha256').update(payload).digest('hex');
}

async function appendAuditEntry(
    storage: Storage,
    disputeId: string,
    event: string,
    actor: string,
    data: Record<string, unknown>,
): Promise<DisputeAuditEntry> {
    const existing = await storage.getDisputeAuditLog(disputeId);
    const sequence = existing.length + 1;
    const previousHash = existing.length > 0 ? existing[existing.length - 1].hash : '0'.repeat(64);
    const timestamp = new Date().toISOString();

    const entry: Omit<DisputeAuditEntry, 'hash'> = {
        sequence,
        event,
        actor,
        timestamp,
        data,
        previousHash,
    };

    const hash = computeAuditHash(entry, previousHash);
    const full: DisputeAuditEntry = { ...entry, hash };

    return storage.addDisputeAuditEntry(disputeId, full);
}

export function disputesRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // POST /v1/work/:tc/dispute — Open dispute
    router.post('/v1/work/:tc/dispute', requireAuth(), requireRole('agent'), validateBody(DisputeOpenSchema, config.nodeId), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
            return;
        }
        if (work.requesterGaii !== req.auth!.sub) {
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

        const dispute = await storage.createDispute({
            id: disputeId,
            trackingCode: tc,
            status: 'open',
            openedBy: req.auth!.sub,
            reason,
            createdAt: now,
            updatedAt: now,
        });

        await storage.updateWork(tc, { status: 'disputed', updatedAt: now });

        await appendAuditEntry(storage, disputeId, 'dispute_opened', req.auth!.sub, { reason });

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
    router.get('/v1/work/:tc/dispute', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`));
            return;
        }

        const gaii = req.auth!.sub;
        if (work.providerGaii !== gaii && work.requesterGaii !== gaii && !req.auth!.roles.includes('operator')) {
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
    router.post('/v1/work/:tc/counter-dispute', requireAuth(), requireRole('agent'), validateBody(CounterDisputeSchema, config.nodeId), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can counter-dispute')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { reason } = req.body ?? {};

        await storage.updateDispute(dispute.id, { status: 'contested', updatedAt: new Date().toISOString() });
        await storage.updateWork(tc, { status: 'contested', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'counter_dispute', req.auth!.sub, { reason });

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'contested' }, [
            { description: 'Escalate to operator', method: 'POST', url: `/v1/work/${tc}/escalate` },
            { description: 'Offer partial refund', method: 'POST', url: `/v1/work/${tc}/offer-partial` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/redeliver — Re-deliver after dispute
    router.post('/v1/work/:tc/redeliver', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can re-deliver')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { output } = req.body ?? {};
        if (output === undefined) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'output is required')); return; }

        await storage.updateWork(tc, { output, updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 're_delivery', req.auth!.sub, { output_provided: true });

        res.json(success(config.nodeId, { tracking_code: tc, redelivered: true }, [
            { description: 'Requester can accept re-delivery', method: 'POST', url: `/v1/work/${tc}/accept-redelivery` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/accept-fault — Provider accepts fault
    router.post('/v1/work/:tc/accept-fault', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can accept fault')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // Return escrow to requester
        await returnEscrow(storage, work);

        await storage.updateDispute(dispute.id, { status: 'resolved', updatedAt: new Date().toISOString() });
        await storage.updateWork(tc, { status: 'settled', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'accept_fault', req.auth!.sub, { full_refund: true });

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', outcome: 'requester_refunded' }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/offer-partial — Provider offers partial refund
    router.post('/v1/work/:tc/offer-partial', requireAuth(), requireRole('agent'), validateBody(PartialOfferSchema, config.nodeId), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can offer partial refund')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { refund_morsels, message } = req.body ?? {};

        // SECURITY (C-3): the offer names an amount that `accept-partial` later credits with an
        // unconditional creditBalance. The schema bounds it to a positive integer and nothing bounds
        // it above, so an offer larger than the escrow mints the difference out of nothing — and both
        // sides of a dispute are cheap for one person to control. The escrow is the ceiling.
        const escrowed = work.cost.inEscrow;
        if (typeof refund_morsels === 'number' && refund_morsels > escrowed) {
            res.status(400).json(error(config.nodeId, 'REFUND_EXCEEDS_ESCROW',
                `A partial refund cannot exceed the ${escrowed} morsels held in escrow for this work.`));
            return;
        }

        await appendAuditEntry(storage, dispute.id, 'partial_offer', req.auth!.sub, { refund_morsels, message });

        res.json(success(config.nodeId, { dispute_id: dispute.id, offer: { refund_morsels, message } }, [
            { description: 'Requester accepts partial', method: 'POST', url: `/v1/work/${tc}/accept-partial` },
            { description: 'Requester rejects partial', method: 'POST', url: `/v1/work/${tc}/reject-partial` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/accept-redelivery — Requester accepts re-delivery
    router.post('/v1/work/:tc/accept-redelivery', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can accept re-delivery')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // Settle: pay provider
        await settlePayment(storage, config, work);

        await storage.updateDispute(dispute.id, { status: 'resolved', updatedAt: new Date().toISOString() });
        await storage.updateWork(tc, { status: 'settled', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'accept_redelivery', req.auth!.sub, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', outcome: 'redelivery_accepted' }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/accept-partial — Requester accepts partial offer
    router.post('/v1/work/:tc/accept-partial', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can accept partial')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // Find the last partial_offer in audit log
        const auditLog = await storage.getDisputeAuditLog(dispute.id);
        const lastOffer = [...auditLog].reverse().find(e => e.event === 'partial_offer');
        const offered = lastOffer ? Number(lastOffer.data.refund_morsels) : 0;
        // SECURITY (C-3): clamped again on the way out of the audit log, not only on the way in. The
        // offer route refuses an over-escrow amount, but this reads a value stored earlier — including
        // rows written before that gate existed — and it is the line that actually moves the money.
        const refundAmount = Number.isFinite(offered) ? Math.max(0, Math.min(offered, work.cost.inEscrow)) : 0;

        if (refundAmount > 0) {
            await returnEscrow(storage, work, refundAmount);
            // Pay remaining to provider (atomic credit)
            const remaining = work.cost.total - refundAmount;
            if (remaining > 0) {
                const credited = await storage.creditBalance(work.providerGaii, remaining);
                if (credited) {
                    await storage.addTransaction({
                        id: `tx-${randomUUID()}`,
                        gaii: work.providerGaii,
                        type: 'earned',
                        amount: remaining,
                        counterpartyGaii: work.requesterGaii,
                        trackingCode: tc,
                        timestamp: new Date().toISOString(),
                    });
                }
            }
        }

        await storage.updateDispute(dispute.id, { status: 'resolved', updatedAt: new Date().toISOString() });
        await storage.updateWork(tc, { status: 'settled', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'partial_accepted', req.auth!.sub, { refund_morsels: refundAmount });

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', refund_morsels: refundAmount }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/reject-partial — Requester rejects partial offer
    router.post('/v1/work/:tc/reject-partial', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can reject partial')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        await appendAuditEntry(storage, dispute.id, 'partial_rejected', req.auth!.sub, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: dispute.status, partial_rejected: true }, [
            { description: 'Escalate to operator', method: 'POST', url: `/v1/work/${tc}/escalate` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/withdraw-dispute — Requester withdraws dispute
    router.post('/v1/work/:tc/withdraw-dispute', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.requesterGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the requester can withdraw a dispute')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        // Settle normally — provider gets paid
        await settlePayment(storage, config, work);

        await storage.updateDispute(dispute.id, { status: 'resolved', updatedAt: new Date().toISOString() });
        await storage.updateWork(tc, { status: 'settled', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'withdraw_dispute', req.auth!.sub, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'resolved', outcome: 'withdrawn' }));
        emitChange('disputes');
    });

    // POST /v1/work/:tc/escalate — Escalate to operator
    router.post('/v1/work/:tc/escalate', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }

        const gaii = req.auth!.sub;
        if (work.providerGaii !== gaii && work.requesterGaii !== gaii) {
            res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'You are not a party to this work item'));
            return;
        }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        await storage.updateDispute(dispute.id, { status: 'escalated', updatedAt: new Date().toISOString() });
        await storage.updateWork(tc, { status: 'escalated', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'escalated', gaii, {});

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'escalated' }, [
            { description: 'View dispute thread', method: 'GET', url: `/v1/work/${tc}/dispute` },
        ]));
        emitChange('disputes');
    });

    // POST /v1/admin/disputes/:id/rule — Operator rules on dispute
    router.post('/v1/admin/disputes/:id/rule', requireAuth(), requireRole('operator'), validateBody(OperatorRulingSchema, config.nodeId), async (req, res) => {
        const disputeId = param(req.params.id);
        const dispute = await storage.getDispute(disputeId);
        if (!dispute) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Dispute not found')); return; }
        if (dispute.status === 'resolved') { res.status(409).json(error(config.nodeId, 'DISPUTE_CLOSED', 'Dispute already resolved')); return; }

        const { ruling, distribution, reason } = req.body ?? {};

        const work = await storage.getWork(dispute.trackingCode);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Associated work item not found')); return; }

        const { to_requester = 0, to_provider = 0, burned = 0 } = distribution;

        // Distribute funds
        if (to_requester > 0) {
            await returnEscrow(storage, work, to_requester);
        }
        if (to_provider > 0) {
            const credited = await storage.creditBalance(work.providerGaii, to_provider);
            if (credited) {
                await storage.addTransaction({
                    id: `tx-${randomUUID()}`,
                    gaii: work.providerGaii,
                    type: 'earned',
                    amount: to_provider,
                    counterpartyGaii: work.requesterGaii,
                    trackingCode: dispute.trackingCode,
                    timestamp: new Date().toISOString(),
                });
            }
        }
        if (burned > 0) {
            await storage.addTransaction({
                id: `tx-${randomUUID()}`,
                gaii: work.requesterGaii,
                type: 'burn',
                amount: -burned,
                trackingCode: dispute.trackingCode,
                timestamp: new Date().toISOString(),
            });
        }

        await storage.updateDispute(dispute.id, {
            status: 'resolved',
            ruling: { ruling, distribution: { toRequester: to_requester, toProvider: to_provider, burned }, reason },
            updatedAt: new Date().toISOString(),
        });
        await storage.updateWork(dispute.trackingCode, { status: 'settled', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'operator_ruled', req.auth!.sub, { ruling, distribution, reason });

        res.json(success(config.nodeId, {
            dispute_id: dispute.id,
            status: 'resolved',
            ruling: { ruling, distribution: { to_requester, to_provider, burned }, reason },
        }));
        emitChange('disputes');
    });

    // GET /v1/admin/disputes/:id/audit-log — Tamper-evident audit trail
    router.get('/v1/admin/disputes/:id/audit-log', requireAuth(), requireRole('operator'), async (req, res) => {
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

    // -----------------------------------------------
    // Tier 0.5 — GET-based dispute operations via OTK
    // -----------------------------------------------

    // GET /v1/work/:tc/accept-redelivery?otk= — accept redelivery via OTK
    router.get('/v1/work/:tc/accept-redelivery', async (req, res) => {
        const otkKey = req.query.otk as string;
        if (!otkKey) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'otk query parameter is required')); return; }
        const otk = await storage.consumeOtk(otkKey, config.otkGraceMs);
        if (!otk) { res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'OTK not found, expired, or used')); return; }
        if (!await checkOtkSession(otk, storage)) { res.status(401).json(error(config.nodeId, 'SESSION_EXPIRED', 'Session expired due to inactivity')); return; }
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Work not found')); return; }
        if (work.requesterGaii !== otk.ownerGaii) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not requester')); return; }
        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No dispute for this work')); return; }
        const { settlePayment: settlePaymentFn } = await import('../services/morsel.js');
        await settlePaymentFn(storage, config, work);
        await storage.updateWork(tc, { status: 'delivered', updatedAt: new Date().toISOString() });
        await storage.updateDispute(dispute.id, { status: 'resolved', updatedAt: new Date().toISOString() });
        res.json(success(config.nodeId, { tracking_code: tc, dispute_resolved: true, tier: '0.5' }));
    });

    // GET /v1/work/:tc/escalate?otk= — escalate dispute via OTK
    router.get('/v1/work/:tc/escalate', async (req, res) => {
        const otkKey = req.query.otk as string;
        if (!otkKey) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'otk query parameter is required')); return; }
        const otk = await storage.consumeOtk(otkKey, config.otkGraceMs);
        if (!otk) { res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'OTK not found, expired, or used')); return; }
        if (!await checkOtkSession(otk, storage)) { res.status(401).json(error(config.nodeId, 'SESSION_EXPIRED', 'Session expired due to inactivity')); return; }
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Work not found')); return; }
        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No dispute for this work')); return; }
        await storage.updateDispute(dispute.id, { status: 'escalated', updatedAt: new Date().toISOString() });
        const auditEntry = { sequence: 0, event: 'escalated_tier_0_5', actor: otk.ownerGaii, timestamp: new Date().toISOString(), data: { via: 'otk' }, hash: '', previousHash: '' };
        const existingLog = await storage.getDisputeAuditLog(dispute.id);
        auditEntry.sequence = existingLog.length + 1;
        auditEntry.previousHash = existingLog.length > 0 ? existingLog[existingLog.length - 1].hash : '0';
        const { createHash } = await import('node:crypto');
        auditEntry.hash = createHash('sha256').update(JSON.stringify({ ...auditEntry, hash: undefined })).digest('hex');
        await storage.addDisputeAuditEntry(dispute.id, auditEntry);
        res.json(success(config.nodeId, { tracking_code: tc, dispute_status: 'escalated', tier: '0.5' }));
    });

    return router;
}
