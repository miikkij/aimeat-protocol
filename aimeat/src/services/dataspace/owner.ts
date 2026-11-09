/**
 * @file src/services/dataspace/owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's side of the Dataspace Protocol (plan doc-mvwxcas3dom3, D8.3): the
 *   negotiations of the owner's packages, approving or declining a request that waits, ending an
 *   agreement, and the per-package choice to agree on its own. REST (/v1/dataspace) and the MCP tool
 *   aimeat_dataspace call these functions, so the permission, the checks and the writes are one.
 *
 *   WHO. The owner in person, or a principal of the owner holding party:manage (an agreement makes an
 *   outside party and shares a package with it, which is what that word governs, and no wildcard
 *   carries it). A visitor from another node and the anonymous identity are refused. Every refusal
 *   comes before any write.
 *
 *   DECLINE. A request that waits is terminated, with a termination message to the consumer. An
 *   agreement not yet finalised is terminated the same way. A finalised agreement is ended: its share
 *   and contract end, its transfers are terminated, and the negotiation records `agreementEndedAt`.
 * @structure DataspaceAnswer · DataspaceOwnerCtx · negotiationView · listOwnerNegotiations ·
 *   getOwnerNegotiation · approveNegotiation · declineNegotiation · dataspaceSettings
 * @usage const out = await approveNegotiation(ctx, providerPid); if (!out.ok) render(out);
 * @version-history
 *   2026-11-08 — Reading the negotiations first ends a share-offer agreement whose share reached its
 *     end date (./source-share.ts; secaudit2026nov08 round 14b).
 *   2026-11-08 — An approval that arrives while another one makes the agreement answers 409 NOT_WAITING
 *     and writes nothing (secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { PARTY_MANAGE_SCOPE } from '../parties/contract.js';
import { readPointer } from '../datapackage/version-audience.js';
import { PACKAGE_NAME_RE } from '../datapackage/contract.js';
import { emitChange } from '../event-bus.js';
import { locatePid, withHistory, type NegotiationRecord, type TransferRecord } from './contract.js';
import { changeNegotiation, listNegotiations, listTransfers, readNegotiation } from './store.js';
import { providerAgree, providerTerminate } from './negotiation.js';
import { endAgreement } from './agreement.js';
import { endAgreementTransfers } from './transfer.js';
import { readOwnerSettings, writeOwnerSettings } from './settings.js';
import { endAgreementsOnEndedSources } from './source-share.js';

export type DataspaceAnswer<T> =
    | { ok: true; data: T }
    | { ok: false; status: number; code: string; message: string };

export interface DataspaceOwnerCtx {
    deps: { storage: Storage; config: AimeatConfig };
    caller: CallerContext;
}

type Refusal = Extract<DataspaceAnswer<never>, { ok: false }>;
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

function managerRefusal(caller: CallerContext): Refusal | null {
    if (caller.visitor || caller.kind === 'anonymous') return refuse(403, 'FORBIDDEN', 'Dataspace negotiations belong to an account of this node. Sign in to your own account.');
    if (!caller.has(PARTY_MANAGE_SCOPE)) return refuse(403, 'SCOPE_DENIED', `Deciding on dataspace agreements needs the "${PARTY_MANAGE_SCOPE}" permission, which only the owner gives, on the agent's page.`);
    return null;
}

/** A negotiation as the owner reads it. */
export function negotiationView(n: NegotiationRecord, transfers: TransferRecord[] = []): Record<string, unknown> {
    return {
        provider_pid: n.providerPid, consumer_pid: n.consumerPid, state: n.state,
        waiting_for_you: n.waitingForOwner === true && n.state === 'REQUESTED',
        participant: n.participantId, auth: n.authMethod, ...(n.dataspace ? { dataspace: n.dataspace } : {}),
        dataset: n.datasetId, package: n.packageName ?? null, offer_id: n.offerId, offer_kind: n.offerKind,
        ...(n.priced ? { price: { amount: n.priced.amount, currency: n.priced.currency, model: n.priced.model, offering_id: n.priced.offeringId, paid_by: 'invoice, outside this server' } } : {}),
        policy: n.offer,
        ...(n.agreementId ? { agreement_id: n.agreementId } : {}),
        ...(n.materialised ? { party: n.materialised.partyName, share_id: n.materialised.shareId, ...(n.materialised.entitlementId ? { entitlement_id: n.materialised.entitlementId } : {}) } : {}),
        ...(n.agreementEndedAt ? { agreement_ended_at: n.agreementEndedAt } : {}),
        ...(n.endedReason ? { ended_reason: n.endedReason } : {}),
        ...(n.decidedBy ? { decided_by: n.decidedBy, decided_at: n.decidedAt } : {}),
        ...(n.callbackError ? { callback_error: n.callbackError } : {}),
        created_at: n.createdAt, updated_at: n.updatedAt,
        history: n.history,
        ...(transfers.length ? {
            transfers: transfers.map(t => ({ provider_pid: t.providerPid, consumer_pid: t.consumerPid, state: t.state, token_expires_at: t.tokenExpiresAt ?? null, created_at: t.createdAt, updated_at: t.updatedAt, ...(t.callbackError ? { callback_error: t.callbackError } : {}) })),
        } : {}),
    };
}

/** The negotiation of the caller's account a pid names, or the 404. */
async function ownNegotiation(ctx: DataspaceOwnerCtx, pid: string): Promise<NegotiationRecord | Refusal> {
    const at = locatePid(pid, 'cn');
    const n = at && `${at.owner}@${ctx.deps.config.nodeId}` === ctx.caller.ownerGhii ? await readNegotiation(ctx.deps.storage, ctx.caller.ownerGhii, at.hex) : null;
    return n ?? refuse(404, 'NOT_FOUND', 'You have no dataspace negotiation with that id.');
}
const isRefusal = (v: unknown): v is Refusal => !!v && (v as Refusal).ok === false;

export async function listOwnerNegotiations(ctx: DataspaceOwnerCtx, filter: { state?: string; waiting?: boolean } = {}): Promise<DataspaceAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    // A share an agreement stood on may have reached its end date since: that agreement ends first.
    await endAgreementsOnEndedSources(ctx.deps, ctx.caller.ownerGhii);
    let list = await listNegotiations(ctx.deps.storage, ctx.caller.ownerGhii);
    if (filter.state) list = list.filter(n => n.state === filter.state);
    if (filter.waiting) list = list.filter(n => n.waitingForOwner && n.state === 'REQUESTED');
    const waiting = list.filter(n => n.waitingForOwner && n.state === 'REQUESTED').length;
    return { ok: true, data: { negotiations: list.map(n => negotiationView(n)), total: list.length, waiting_for_you: waiting } };
}

export async function getOwnerNegotiation(ctx: DataspaceOwnerCtx, pid: string): Promise<DataspaceAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    await endAgreementsOnEndedSources(ctx.deps, ctx.caller.ownerGhii);
    const n = await ownNegotiation(ctx, pid);
    if (isRefusal(n)) return n;
    const transfers = (await listTransfers(ctx.deps.storage, ctx.caller.ownerGhii)).filter(t => t.negotiationPid === n.providerPid);
    return { ok: true, data: { negotiation: negotiationView(n, transfers) } };
}

/** Approve a request that waits: the agreement is made and sent. */
export async function approveNegotiation(ctx: DataspaceOwnerCtx, pid: string): Promise<DataspaceAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const n = await ownNegotiation(ctx, pid);
    if (isRefusal(n)) return n;
    if (n.state !== 'REQUESTED' && n.state !== 'ACCEPTED') return refuse(409, 'NOT_WAITING', `This negotiation is ${n.state}; there is nothing to approve.`);
    const after = await providerAgree(ctx.deps, n, 'owner', ctx.caller.principal);
    if (!after) return refuse(404, 'NOT_FOUND', 'The negotiation is gone.');
    // Another approval (a second press, or the agent and the owner together) is making this agreement now.
    if ((after.state === 'REQUESTED' || after.state === 'ACCEPTED') && after.agreeing) {
        return refuse(409, 'NOT_WAITING', 'Another approval of this request is making the agreement now. Read the negotiation again in a moment.');
    }
    if (after.state !== 'AGREED') {
        return refuse(after.state === 'TERMINATED' ? 409 : 502, after.state === 'TERMINATED' ? 'AGREEMENT_REFUSED' : 'CALLBACK_FAILED',
            after.state === 'TERMINATED' ? `The agreement could not be made: ${after.endedReason ?? 'see the negotiation'}.` : `The consumer did not take the agreement: ${after.callbackError ?? 'no answer'}. The request still waits; try again later.`);
    }
    return { ok: true, data: { negotiation: negotiationView(after), say: `${after.participantId} can now pull "${after.packageName}" once its connector finishes the negotiation. You can end the agreement at any time, and the next read is refused.` } };
}

/** Decline a request, terminate an agreement not yet finalised, or end a finalised one. */
export async function declineNegotiation(ctx: DataspaceOwnerCtx, pid: string, reason?: string): Promise<DataspaceAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const n = await ownNegotiation(ctx, pid);
    if (isRefusal(n)) return n;
    const why = (reason ?? '').trim().slice(0, 300) || 'The owner declined.';
    if (n.state === 'TERMINATED' || n.agreementEndedAt) return refuse(409, 'ALREADY_ENDED', 'This negotiation has ended already.');
    const hex = locatePid(n.providerPid, 'cn')!.hex;
    if (n.state === 'FINALIZED') {
        await endAgreement(ctx.deps, n, 'dsp-ended-by-owner');
        await endAgreementTransfers(ctx.deps, n, why);
        await changeNegotiation(ctx.deps.storage, n.ownerGhii, hex, cur => withHistory({
            ...cur, agreementEndedAt: new Date().toISOString(), endedReason: why, decidedBy: ctx.caller.principal, decidedAt: new Date().toISOString(),
        }, { event: 'agreement-ended', from: cur.state, to: cur.state, by: 'owner' }));
    } else {
        await changeNegotiation(ctx.deps.storage, n.ownerGhii, hex, cur => ({ ...cur, decidedBy: ctx.caller.principal, decidedAt: new Date().toISOString() }));
        await providerTerminate(ctx.deps, n, 'DECLINED', why, 'owner');
    }
    emitChange('dataspace', n.ownerGhii);
    const after = await readNegotiation(ctx.deps.storage, n.ownerGhii, hex);
    return { ok: true, data: { negotiation: negotiationView(after ?? n) } };
}

/** Read the per-package choices, or set one: { package, auto_agree: true | false | null }. */
export async function dataspaceSettings(ctx: DataspaceOwnerCtx, body?: Record<string, unknown>): Promise<DataspaceAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const { storage } = ctx.deps;
    if (body && body.package !== undefined) {
        const pkg = typeof body.package === 'string' ? body.package.trim() : '';
        if (!PACKAGE_NAME_RE.test(pkg)) return refuse(400, 'INVALID_INPUT', 'package is the name of one of your data packages.');
        const auto = body.auto_agree;
        if (auto !== true && auto !== false && auto !== null) return refuse(400, 'INVALID_INPUT', 'auto_agree is true (agree at once on an offer within the published policy), false (wait for you), or null (back to the default, wait).');
        const pointer = await readPointer(ctx.deps, ctx.caller.ownerGhii, pkg);
        if (!pointer?.contentHash && auto !== null) return refuse(404, 'NOT_FOUND', `You have no data package called "${pkg}".`);
        await writeOwnerSettings(storage, ctx.caller.ownerGhii, pkg, auto as boolean | null, ctx.caller.principal);
        emitChange('dataspace', ctx.caller.ownerGhii);
    }
    const s = await readOwnerSettings(storage, ctx.caller.ownerGhii);
    return {
        ok: true, data: {
            packages: Object.entries(s.packages).map(([name, p]) => ({ package: name, auto_agree: p.autoAgree, updated_at: p.updatedAt, updated_by: p.updatedBy })),
            default: 'A package that is not listed waits for your approval of each agreement. A priced offer always waits, because the price is paid outside this server.',
            enabled: ctx.deps.config.dataspaceEnabled === true,
        },
    };
}
