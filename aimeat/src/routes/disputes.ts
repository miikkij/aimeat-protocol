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
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, DisputeAuditEntry } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { returnEscrow, settlePayment } from '../services/morsel.js';
import { DisputeOpenSchema, CounterDisputeSchema, PartialOfferSchema, OperatorRulingSchema, validateBody } from '../models/schemas.js';

function param(p: string | string[]): string {
    return Array.isArray(p) ? p[0] : p;
}

/**
 * JSON with object keys in a fixed order, at every depth.
 *
 * The hash below has to be computable from the entry as it is READ BACK, or the log is tamper-evident
 * in name only. Plain JSON.stringify is not, because it serialises keys in insertion order and the
 * production backend does not preserve that: `DisputeAudit.data` is JSONB (migration 0001), and
 * Postgres jsonb stores a decomposed form and returns keys in its own normalised order. So an entry
 * whose `data` has two or more keys hashed one string on the way in and serialises to a different
 * one on the way out, and anybody recomputing the hash from the API response concludes the record was
 * edited. Measured 2026-08-15 on the `operator_ruled` entry, which carries three: the recomputation
 * matched on sqlite (JSON text, exact round trip) and failed on postgres-kysely.
 *
 * Sorting the keys makes the two agree, and costs nothing else: nothing consumed these hashes before
 * — no route verified one, and the only test walked the LINKS without recomputing anything — so there
 * is no stored value whose meaning this changes for a reader that exists.
 */
function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function computeAuditHash(entry: Omit<DisputeAuditEntry, 'hash'>, previousHash: string): string {
    const payload = canonicalJson({ ...entry, previousHash });
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

        // SECURITY (C-3, third site). A ruling DISTRIBUTES the escrow — the word the API uses is
        // `distribution` and openapi.yaml types it as requester_wins | provider_wins | split, all of
        // which are ways of dividing what is held. It was the only one of the three money doors on
        // this route with no ceiling: /offer-partial refuses above the escrow (line 268) and
        // /accept-partial clamps again, and this one credited whatever integer it was handed, so
        // `{to_requester: 1000000}` on an 11-morsel escrow minted the difference out of nothing.
        //
        // An operator can already mint — but through mintMorsels(), which enforces
        // config.maxOperatorMintPerDay. A door that creates morsels with no cap at all is not the
        // same authority just because the same person holds it, and nothing here writes the audit
        // trail that door writes. Refuse before you write: this sits above every credit below.
        const escrowed = work.cost.inEscrow;
        if (to_requester + to_provider + burned > escrowed) {
            res.status(400).json(error(config.nodeId, 'RULING_EXCEEDS_ESCROW',
                `A ruling distributes the ${escrowed} morsels held in escrow for this work; `
                + `${to_requester + to_provider + burned} were named. Nothing was written.`));
            return;
        }

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

    // A dispute is settled and escalated through the POST routes above. Both operations also had a
    // Tier 0.5 twin that took a one-time key in the query string and no bearer token; those were
    // removed on 2026-08-14 with the rest of Tier 0.5. See the version history for what they did.

    return router;
}
