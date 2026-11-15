/**
 * @file src/services/disputes/audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A work dispute's audit trail and its once-only resolution: the SHA-256 hash chain over
 *   a canonical serialisation, the entry appended to it, the dispute and work statuses still open to a
 *   move, and resolveDisputeOnce, which claims a dispute and moves the morsels in one transaction.
 *   Moved unchanged out of routes/disputes.ts, so the operator's ruling (disputes/operator.ts) is one
 *   implementation for REST and MCP.
 * @structure canonicalJson · computeAuditHash · appendAuditEntry · ACTIVE_DISPUTE · DISPUTED_WORK · resolveDisputeOnce
 * @usage await appendAuditEntry(storage, dispute.id, 'escalated', me, {});
 * @version-history
 *   v1.0.0 — 2026-11-15 — Moved from routes/disputes.ts without change (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida).
 */
import { createHash } from 'node:crypto';
import type { Storage, DisputeAuditEntry } from '../../storage/interface.js';

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
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function computeAuditHash(entry: Omit<DisputeAuditEntry, 'hash'>, previousHash: string): string {
    const payload = canonicalJson({ ...entry, previousHash });
    return createHash('sha256').update(payload).digest('hex');
}

export async function appendAuditEntry(
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

/** The statuses of a dispute that is still open to a resolution or a move. */
export const ACTIVE_DISPUTE: readonly string[] = ['open', 'contested', 'escalated'];
/** The statuses of a work item whose dispute is still active. */
export const DISPUTED_WORK: readonly string[] = ['disputed', 'contested', 'escalated'];

/** Thrown inside the resolution transaction so the claim on the dispute rolls back with it. */
class ProviderBalanceShort extends Error {}

/**
 * Resolve a dispute once: claim it (active → resolved, one conditional UPDATE), then move the
 * morsels and settle the work, in ONE transaction. The status was read and then written apart, with
 * the refund between the two, so concurrent accept-partial, accept-fault or ruling calls each took
 * the refund back from the provider (secaudit2026oct22, dispute-resolution-without-cas). The claim is
 * the compare-and-swap: a call that did not move the status moves no morsel and answers 'closed'.
 * When `moveMorsels` answers false (the provider's balance is short) the claim rolls back, so the
 * dispute stays open for the next try.
 */
export async function resolveDisputeOnce(
    storage: Storage,
    disputeId: string,
    trackingCode: string,
    moveMorsels: () => Promise<boolean>,
): Promise<'resolved' | 'closed' | 'short'> {
    try {
        return await storage.transaction(async () => {
            const now = new Date().toISOString();
            if (!await storage.transitionDisputeStatus(disputeId, ACTIVE_DISPUTE, 'resolved', now)) return 'closed' as const;
            if (!await moveMorsels()) throw new ProviderBalanceShort();
            await storage.updateWork(trackingCode, { status: 'settled', updatedAt: now });
            return 'resolved' as const;
        });
    } catch (err) {
        if (err instanceof ProviderBalanceShort) return 'short';
        throw err;
    }
}
