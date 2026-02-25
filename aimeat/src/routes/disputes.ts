import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import type { MeatConfig } from '../config.js';
import type { Storage, DisputeAuditEntry } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { returnEscrow, settlePayment } from '../services/morsel.js';

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

export function disputesRouter(config: MeatConfig, storage: Storage): Router {
    const router = Router();

    // POST /v1/work/:tc/dispute — Open dispute
    router.post('/v1/work/:tc/dispute', requireAuth(), requireRole('agent'), async (req, res) => {
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
        if (!reason) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'reason is required'));
            return;
        }

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
    router.post('/v1/work/:tc/counter-dispute', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can counter-dispute')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { reason } = req.body ?? {};
        if (!reason) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'reason is required')); return; }

        await storage.updateDispute(dispute.id, { status: 'contested', updatedAt: new Date().toISOString() });
        await storage.updateWork(tc, { status: 'contested', updatedAt: new Date().toISOString() });
        await appendAuditEntry(storage, dispute.id, 'counter_dispute', req.auth!.sub, { reason });

        res.json(success(config.nodeId, { dispute_id: dispute.id, status: 'contested' }, [
            { description: 'Escalate to operator', method: 'POST', url: `/v1/work/${tc}/escalate` },
            { description: 'Offer partial refund', method: 'POST', url: `/v1/work/${tc}/offer-partial` },
        ]));
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
    });

    // POST /v1/work/:tc/offer-partial — Provider offers partial refund
    router.post('/v1/work/:tc/offer-partial', requireAuth(), requireRole('agent'), async (req, res) => {
        const tc = param(req.params.tc);
        const work = await storage.getWork(tc);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Work item not found: ${tc}`)); return; }
        if (work.providerGaii !== req.auth!.sub) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the provider can offer partial refund')); return; }

        const dispute = await storage.getDisputeByTrackingCode(tc);
        if (!dispute || dispute.status === 'resolved') { res.status(404).json(error(config.nodeId, 'DISPUTE_CLOSED', 'No active dispute')); return; }

        const { refund_morsels, message } = req.body ?? {};
        if (!refund_morsels || refund_morsels < 1) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'refund_morsels must be >= 1')); return; }

        await appendAuditEntry(storage, dispute.id, 'partial_offer', req.auth!.sub, { refund_morsels, message });

        res.json(success(config.nodeId, { dispute_id: dispute.id, offer: { refund_morsels, message } }, [
            { description: 'Requester accepts partial', method: 'POST', url: `/v1/work/${tc}/accept-partial` },
            { description: 'Requester rejects partial', method: 'POST', url: `/v1/work/${tc}/reject-partial` },
        ]));
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
        const refundAmount = lastOffer ? (lastOffer.data.refund_morsels as number) : 0;

        if (refundAmount > 0) {
            await returnEscrow(storage, work, refundAmount);
            // Pay remaining to provider
            const remaining = work.cost.total - refundAmount;
            if (remaining > 0) {
                const provider = await storage.getAgent(work.providerGaii);
                if (provider) {
                    await storage.updateAgent(work.providerGaii, { morselBalance: provider.morselBalance + remaining });
                    await storage.addTransaction({
                        id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
    });

    // POST /v1/admin/disputes/:id/rule — Operator rules on dispute
    router.post('/v1/admin/disputes/:id/rule', requireAuth(), requireRole('operator'), async (req, res) => {
        const disputeId = param(req.params.id);
        const dispute = await storage.getDispute(disputeId);
        if (!dispute) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Dispute not found')); return; }
        if (dispute.status === 'resolved') { res.status(409).json(error(config.nodeId, 'DISPUTE_CLOSED', 'Dispute already resolved')); return; }

        const { ruling, distribution, reason } = req.body ?? {};
        if (!ruling || !distribution) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'ruling and distribution are required'));
            return;
        }

        const work = await storage.getWork(dispute.trackingCode);
        if (!work) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Associated work item not found')); return; }

        const { to_requester = 0, to_provider = 0, burned = 0 } = distribution;

        // Distribute funds
        if (to_requester > 0) {
            await returnEscrow(storage, work, to_requester);
        }
        if (to_provider > 0) {
            const provider = await storage.getAgent(work.providerGaii);
            if (provider) {
                await storage.updateAgent(work.providerGaii, { morselBalance: provider.morselBalance + to_provider });
                await storage.addTransaction({
                    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
                id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
        const otk = await storage.consumeOtk(otkKey);
        if (!otk) { res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'OTK not found, expired, or used')); return; }
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
        const otk = await storage.consumeOtk(otkKey);
        if (!otk) { res.status(401).json(error(config.nodeId, 'OTK_EXPIRED', 'OTK not found, expired, or used')); return; }
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
