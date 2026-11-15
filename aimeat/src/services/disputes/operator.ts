/**
 * @file src/services/disputes/operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's side of a work dispute, one implementation for REST and MCP: the
 *   disputes that wait for a ruling, one dispute with its audit trail, and the ruling itself. The
 *   routes GET /v1/admin/disputes, GET /v1/admin/disputes/:id and POST /v1/admin/disputes/:id/rule
 *   (routes/disputes.ts) and the MCP tools aimeat_admin_disputes and aimeat_admin_dispute_rule
 *   (mcp/disputes.ts) call these, so the ceiling, the once-only claim and the audit entry are written
 *   once.
 * @structure listOperatorDisputes · getOperatorDispute · ruleDispute · DISPUTE_LIST_STATUSES
 * @usage const r = await ruleDispute(storage, me, id, { ruling, distribution, reason });
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida): the ruling
 *     moved here from its route unchanged, and the list is new; an operator told that a dispute waits
 *     could rule it only with a hand-written REST call.
 */
import type { Storage, DisputeAuditEntry, DisputeRecord, WorkRecord } from '../../storage/interface.js';
import { disputedAmount, takeBackFromProvider } from '../morsel.js';
import { refreshTrustScore } from '../trust.js';
import { appendAuditEntry, resolveDisputeOnce } from './audit.js';

/** The list's three readings: what waits for the operator, also what the parties still settle, everything. */
export const DISPUTE_LIST_STATUSES = ['escalated', 'open', 'all'] as const;
export type DisputeListStatus = typeof DISPUTE_LIST_STATUSES[number];

/** The audit event the 30-day timeout writes when the provider cannot cover the refund (services/core-jobs.ts). */
const TIMEOUT_WAITS = 'timeout_waiting_operator';

/** One dispute as the operator reads it. */
export interface OperatorDisputeView {
  id: string;
  tracking_code: string;
  status: DisputeRecord['status'];
  opened_by: string;
  reason: string;
  requester: string | null;
  provider: string | null;
  paid_morsels: number;
  timed_out: boolean;
  waits_since: string;
  created_at: string;
  ruling: DisputeRecord['ruling'] | null;
}

function view(d: DisputeRecord, work: WorkRecord | null, log: readonly DisputeAuditEntry[]): OperatorDisputeView {
  const timeout = log.find(e => e.event === TIMEOUT_WAITS);
  const escalation = [...log].reverse().find(e => e.event === 'escalated');
  return {
    id: d.id,
    tracking_code: d.trackingCode,
    status: d.status,
    opened_by: d.openedBy,
    reason: d.reason,
    requester: work?.requesterGaii ?? null,
    provider: work?.providerGaii ?? null,
    paid_morsels: work ? disputedAmount(work) : 0,
    timed_out: Boolean(timeout),
    waits_since: timeout?.timestamp ?? escalation?.timestamp ?? d.updatedAt,
    created_at: d.createdAt,
    ruling: d.ruling ?? null,
  };
}

/** Does the list reading take this dispute? */
function wanted(d: DisputeRecord, status: DisputeListStatus): boolean {
  if (status === 'all') return true;
  if (status === 'open') return d.status !== 'resolved';
  return d.status === 'escalated';
}

/**
 * The disputes for one reading, the longest wait first. Each row reads its work item and its audit
 * trail; the waiting disputes are few, and "all" is the operator's own choice to read more.
 */
export async function listOperatorDisputes(storage: Storage, status: DisputeListStatus = 'escalated'): Promise<OperatorDisputeView[]> {
  const all = await storage.listAllDisputes();
  const rows: OperatorDisputeView[] = [];
  for (const d of all.filter(x => wanted(x, status))) {
    rows.push(view(d, await storage.getWork(d.trackingCode), await storage.getDisputeAuditLog(d.id)));
  }
  return rows.sort((a, b) => a.waits_since.localeCompare(b.waits_since));
}

/** One dispute and its whole audit trail, or null for an unknown id. */
export async function getOperatorDispute(storage: Storage, id: string): Promise<{ dispute: OperatorDisputeView; entries: DisputeAuditEntry[] } | null> {
  const d = await storage.getDispute(id);
  if (!d) return null;
  const entries = await storage.getDisputeAuditLog(d.id);
  return { dispute: view(d, await storage.getWork(d.trackingCode), entries), entries };
}

export interface RulingInput {
  ruling: string;
  distribution: { to_requester?: number; to_provider?: number; burned?: number };
  reason?: string;
}

export type RulingOutcome =
  | { ok: true; data: { dispute_id: string; status: 'resolved'; ruling: { ruling: string; distribution: { to_requester: number; to_provider: number; burned: number }; reason?: string } } }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

/**
 * The operator rules one dispute: shares out what delivery paid the provider and closes it. `me` is
 * the ruling operator's resolved identity, written to the audit trail. The checks run before anything
 * is written, and the claim on the dispute and the morsel move are one transaction (resolveDisputeOnce).
 */
export async function ruleDispute(storage: Storage, me: string, disputeId: string, input: RulingInput): Promise<RulingOutcome> {
  const dispute = await storage.getDispute(disputeId);
  if (!dispute) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Dispute not found' };
  if (dispute.status === 'resolved') return { ok: false, status: 409, code: 'DISPUTE_CLOSED', message: 'Dispute already resolved' };

  const { ruling, distribution, reason } = input;

  const work = await storage.getWork(dispute.trackingCode);
  if (!work) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Associated work item not found' };

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
  //
  // What is shared out is what delivery paid the provider: a dispute opens only on delivered
  // work, so the escrow was already settled. cost.inEscrow still read the whole escrow, and the
  // ruling paid the requester and the provider on top of that settlement (QA audit S8-02).
  const paid = disputedAmount(work);
  if (to_requester + to_provider + burned > paid) {
    return {
      ok: false, status: 400, code: 'RULING_EXCEEDS_ESCROW',
      message: `A ruling shares out the ${paid} morsels this work paid its provider. Choose how they split; `
        + `${to_requester + to_provider + burned} were named. Nothing was written.`,
      details: { paid_morsels: paid },
    };
  }

  // The requester's share and the burned share come back from the provider in one debit; the
  // provider keeps the rest of what delivery paid.
  const outcome = await resolveDisputeOnce(storage, dispute.id, dispute.trackingCode,
    () => takeBackFromProvider(storage, work, { toRequester: to_requester, burned }));
  if (outcome === 'closed') return { ok: false, status: 409, code: 'DISPUTE_CLOSED', message: 'Dispute already resolved' };
  if (outcome === 'short') {
    return {
      ok: false, status: 409, code: 'PROVIDER_BALANCE_SHORT',
      message: `The provider's balance holds less than the ${to_requester + burned} morsels this ruling takes back, so nothing was written. Rule a smaller share instead.`,
      details: { take_back_morsels: to_requester + burned, dispute_id: dispute.id },
    };
  }
  const keptByProvider = paid - to_requester - burned;

  await storage.updateDispute(dispute.id, {
    ruling: { ruling, distribution: { toRequester: to_requester, toProvider: keptByProvider, burned }, reason },
    updatedAt: new Date().toISOString(),
  });
  await refreshTrustScore(storage, work.providerGaii);
  await appendAuditEntry(storage, dispute.id, 'operator_ruled', me, { ruling, distribution: { to_requester, to_provider: keptByProvider, burned }, reason });

  return {
    ok: true,
    data: { dispute_id: dispute.id, status: 'resolved', ruling: { ruling, distribution: { to_requester, to_provider: keptByProvider, burned }, reason } },
  };
}
