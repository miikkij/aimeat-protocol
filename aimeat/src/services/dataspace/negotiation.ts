/**
 * @file src/services/dataspace/negotiation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provider side of DSP 2025-1 contract negotiation (plan doc-mvwxcas3dom3, D8.3): the
 *   consumer's messages, the state machine, and what the provider does next.
 *
 *   THE CONSUMER'S MESSAGES. A request opens a negotiation in REQUESTED (201) when its offer is one this
 *   node published for the target dataset to this participant; a counter-offer moves OFFERED to
 *   REQUESTED; the ACCEPTED event moves OFFERED to ACCEPTED, and only when the offer on the table was the
 *   provider's; the verification moves AGREED to VERIFIED; a termination moves any live state to
 *   TERMINATED. Anything else is 400 with a ContractNegotiationError and changes nothing. A negotiation of
 *   another participant, or one that does not exist, is 404 (DSP: unauthorized access is 404).
 *
 *   WHAT THE PROVIDER DOES NEXT, after the answer is sent (./callbacks.ts later):
 *     on a request   agree at once when the owner set the package to agree on its own and the offer is
 *                    free (an open or a share offer); otherwise the request waits for the owner, who is
 *                    told (account event `dataspace_request`) and approves or declines (./owner.ts). A
 *                    priced offer always waits: DSP moves no money (./agreement.ts).
 *     on agreeing    the agreement materialises first (./agreement.ts), then the record is AGREED, then
 *                    the ContractAgreementMessage goes out. The record moves before the send, because the
 *                    consumer answers the agreement with its verification at once; a send that fails
 *                    puts the record back and ends what the agreement made.
 *     on VERIFIED    the FINALIZED event.
 *   In the TCK mode a TCK dataset follows its scripted reactions instead (./tck.ts).
 * @structure DspAnswer · requestNegotiation · readNegotiationFor · counterOffer · negotiationEvent ·
 *   verifyAgreement · terminateNegotiation · providerAgree · providerTerminate · providerFinalize ·
 *   providerOffer · locateNegotiation
 * @usage const out = await requestNegotiation(deps, participant, req.body); res.status(out.status).json(out.body);
 * @version-history
 *   v1.0.1 — 2026-11-02 — A new request asks the process room (./settings.ts processRoomRefusal): ended
 *     processes take none, one participant a share only (secaudit2026nov02d round 13).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { recordAccountEvent } from '../account-events.js';
import { emitChange } from '../event-bus.js';
import { localAccountName } from '../../utils/gaii.js';
import { UNCHANGED } from '../record-cas.js';
import {
    NEGOTIATION_TERMINAL, agreementIdOf, callbackUrl, dspBody, locatePid, negotiationAck,
    negotiationError, negotiationNext, negotiationPid, newProcessHex, parseDatasetId, withHistory,
    type NegotiationRecord, type NegotiationState,
} from './contract.js';
import { datasetFor, offerById, type OfferEntry } from './catalog.js';
import { agreementOf } from './policy.js';
import { materialiseAgreement, endAgreement } from './agreement.js';
import { callbackAllowed, later, sendCallback } from './callbacks.js';
import { changeNegotiation, createNegotiation, readNegotiation, sweepArchive } from './store.js';
import { autoAgreeFor, nodeParticipantId, processRoomRefusal, tckModeOn } from './settings.js';
import { negotiationScript, tckDataset, tckOwnerGhii } from './tck.js';
import type { Participant } from './verifier.js';
import { endAgreementTransfers } from './transfer.js';

type Deps = { storage: Storage; config: AimeatConfig };
export interface DspAnswer { status: number; body: Record<string, unknown> }

const FIRST_STEP_MS = 300;
const NEXT_STEP_MS = 1000;
const bad = (n: { providerPid?: string; consumerPid?: string }, code: string, reason: string, status = 400): DspAnswer =>
    ({ status, body: negotiationError(n.providerPid ?? '', n.consumerPid ?? '', code, reason) });
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The owner and record hex a provider pid names, or null (any other pid is 404). */
export function locateNegotiation(pid: string, nodeId: string): { ownerGhii: string; hex: string } | null {
    const at = locatePid(pid, 'cn');
    return at ? { ownerGhii: `${at.owner}@${nodeId}`, hex: at.hex } : null;
}

/** The negotiation this participant may act on, or the 404 answer. */
async function own(deps: Deps, participant: Participant, pid: string, consumerPid = ''): Promise<{ n: NegotiationRecord; hex: string } | DspAnswer> {
    const at = locateNegotiation(pid, deps.config.nodeId);
    const n = at ? await readNegotiation(deps.storage, at.ownerGhii, at.hex) : null;
    if (!at || !n || n.participantId !== participant.id) return bad({ providerPid: pid, consumerPid }, 'NOT_FOUND', 'No such negotiation for this participant.', 404);
    return { n, hex: at.hex };
}
const isAnswer = (v: unknown): v is DspAnswer => !!v && typeof (v as DspAnswer).status === 'number';

/** The callback a negotiation message goes to. */
const cbUrl = (n: NegotiationRecord, action: string) => callbackUrl(n.callbackAddress, 'negotiations', n.consumerPid, action);
const to = (n: NegotiationRecord) => ({ participantId: n.participantId, authMethod: n.authMethod });

/** Move a record to `to` before a send; answers the record or null when it was no longer in `from`. */
async function move(deps: Deps, n: NegotiationRecord, from: readonly NegotiationState[], next: NegotiationState, event: string, by: 'provider' | 'owner', extra: Partial<NegotiationRecord> = {}) {
    const hex = locatePid(n.providerPid, 'cn')!.hex;
    let moved = false;
    const after = await changeNegotiation(deps.storage, n.ownerGhii, hex, cur => {
        if (!from.includes(cur.state)) { moved = false; return UNCHANGED; }
        moved = true;
        return withHistory({ ...cur, ...extra, state: next }, { event, from: cur.state, to: next, by });
    });
    emitChange('dataspace', n.ownerGhii);
    return moved ? after : null;
}

/** Put a record back after a send that failed, if nothing moved it meanwhile. */
async function moveBack(deps: Deps, n: NegotiationRecord, was: NegotiationState, now: NegotiationState, error: string, extra: Partial<NegotiationRecord> = {}) {
    const hex = locatePid(n.providerPid, 'cn')!.hex;
    await changeNegotiation(deps.storage, n.ownerGhii, hex, cur => (cur.state === now
        ? withHistory({ ...cur, ...extra, state: was, callbackError: error }, { event: 'callback-failed', from: now, to: was, by: 'provider' })
        : { ...cur, callbackError: error }));
}

/** Send the provider's offer (TCK scripts only: this node publishes its offers in the catalog). */
export async function providerOffer(deps: Deps, n: NegotiationRecord): Promise<void> {
    const moved = await move(deps, n, ['REQUESTED'], 'OFFERED', 'offer', 'provider', { lastOfferFrom: 'provider' });
    if (!moved) return;
    const out = await sendCallback(deps.config, to(n), cbUrl(n, 'offers'), dspBody('ContractOfferMessage', {
        providerPid: n.providerPid, consumerPid: n.consumerPid, offer: { ...n.offer, target: n.datasetId },
    }));
    if (!out.ok) await moveBack(deps, n, 'REQUESTED', 'OFFERED', out.error, { lastOfferFrom: 'consumer' });
}

/** Agree: materialise, move to AGREED, send the agreement. Answers the record as it stands after. */
export async function providerAgree(deps: Deps, n: NegotiationRecord, by: 'provider' | 'owner', decidedBy?: string): Promise<NegotiationRecord | null> {
    if (n.state !== 'REQUESTED' && n.state !== 'ACCEPTED') return n;
    const hex = locatePid(n.providerPid, 'cn')!.hex;
    const agreementId = agreementIdOf(localAccountName(n.ownerGhii), hex);
    const made = await materialiseAgreement(deps, { ...n, agreementId });
    if (!made.ok) {
        await providerTerminate(deps, n, made.code, made.message, by);
        return readNegotiation(deps.storage, n.ownerGhii, hex);
    }
    const agreement = agreementOf(agreementId, n.offer, { target: n.datasetId, assigner: nodeParticipantId(deps.config), assignee: n.participantId });
    const moved = await move(deps, n, ['REQUESTED', 'ACCEPTED'], 'AGREED', 'agreement', by, {
        agreementId, agreement, waitingForOwner: false,
        ...(made.value ? { materialised: made.value } : {}),
        ...(decidedBy ? { decidedBy, decidedAt: new Date().toISOString() } : {}),
    });
    if (!moved) {
        // Terminated meanwhile: what was made for it ends again.
        if (made.value) await endAgreement(deps, { ...n, agreementId, materialised: made.value }, 'dsp-terminated');
        return readNegotiation(deps.storage, n.ownerGhii, hex);
    }
    const out = await sendCallback(deps.config, to(n), cbUrl(n, 'agreement'), dspBody('ContractAgreementMessage', {
        providerPid: n.providerPid, consumerPid: n.consumerPid, agreement,
    }));
    if (!out.ok) {
        if (made.value) await endAgreement(deps, { ...n, agreementId, materialised: made.value }, 'dsp-callback-failed');
        await moveBack(deps, n, n.state, 'AGREED', out.error, { agreementId: undefined, agreement: undefined, materialised: undefined });
    } else if (made.value) {
        void recordAccountEvent(deps.storage, {
            ownerGhii: n.ownerGhii, kind: 'contract_started', actorGaii: `dsp:${n.participantId}`, subject: agreementId,
            link: '/v1/dataspace/negotiations', data: { name: `${n.packageName} (Dataspace: ${n.participantId})` },
        }, deps.config);
    }
    return readNegotiation(deps.storage, n.ownerGhii, hex);
}

/** Send the FINALIZED event of a verified negotiation. */
export async function providerFinalize(deps: Deps, n: NegotiationRecord): Promise<void> {
    const moved = await move(deps, n, ['VERIFIED'], 'FINALIZED', 'finalized', 'provider');
    if (!moved) return;
    const out = await sendCallback(deps.config, to(n), cbUrl(n, 'events'), dspBody('ContractNegotiationEventMessage', {
        providerPid: n.providerPid, consumerPid: n.consumerPid, eventType: 'FINALIZED',
    }));
    if (!out.ok) await moveBack(deps, n, 'VERIFIED', 'FINALIZED', out.error);
}

/** Terminate as the provider: end what an agreement made, move to TERMINATED, send the termination. */
export async function providerTerminate(deps: Deps, n: NegotiationRecord, code: string, reason: string, by: 'provider' | 'owner'): Promise<void> {
    const moved = await move(deps, n, ['REQUESTED', 'OFFERED', 'ACCEPTED', 'AGREED', 'VERIFIED'], 'TERMINATED', 'termination', by, { waitingForOwner: false, endedReason: reason });
    if (!moved) return;
    if (moved.materialised) {
        await endAgreement(deps, moved, 'dsp-terminated');
        await endAgreementTransfers(deps, moved, 'The agreement was terminated.');
    }
    const out = await sendCallback(deps.config, to(n), cbUrl(n, 'termination'), dspBody('ContractNegotiationTerminationMessage', {
        providerPid: n.providerPid, consumerPid: n.consumerPid, code, reason: [reason],
    }));
    if (!out.ok) await changeNegotiation(deps.storage, n.ownerGhii, locatePid(n.providerPid, 'cn')!.hex, cur => ({ ...cur, callbackError: out.error }));
}

/** The offer of a request: the one published for the dataset to this participant, or the refusal. */
async function offerFor(deps: Deps, participant: Participant, target: string, offerId: string):
    Promise<{ ok: true; owner: string; entry: OfferEntry; packageName?: string; tck?: string } | { ok: false; code: string; reason: string; status: number }> {
    if (tckModeOn(deps.config) && negotiationScript(target)) {
        const ds = tckDataset(target)!;
        return { ok: true, owner: tckOwnerGhii(deps.config.nodeId), entry: { ...ds.offers[0]!, offer: { ...ds.offers[0]!.offer, '@id': offerId || ds.offers[0]!.offer['@id'] } }, tck: target };
    }
    if (!parseDatasetId(target)) return { ok: false, status: 400, code: 'UNKNOWN_DATASET', reason: 'offer.target is not a dataset of this server.' };
    const ds = await datasetFor(deps, participant, target);
    if (!ds) return { ok: false, status: 400, code: 'UNKNOWN_DATASET', reason: 'offer.target is not a dataset this server offers you.' };
    const entry = offerById(ds, offerId);
    if (!entry) return { ok: false, status: 400, code: 'UNKNOWN_OFFER', reason: 'offer.@id is not an offer this server published for that dataset. Read the dataset from the catalog and send one of its offers.' };
    return { ok: true, owner: ds.ownerGhii, entry, packageName: ds.name };
}

/** POST /negotiations/request: the consumer's first ContractRequestMessage. */
export async function requestNegotiation(deps: Deps, participant: Participant, msg: Record<string, unknown>): Promise<DspAnswer> {
    const consumerPid = str(msg.consumerPid);
    if (msg['@type'] !== 'ContractRequestMessage' || !consumerPid) return bad({ consumerPid }, 'INVALID_MESSAGE', 'A ContractRequestMessage with consumerPid is expected.');
    if (msg.providerPid !== undefined) return bad({ consumerPid }, 'INVALID_MESSAGE', 'The first request carries no providerPid; a counter-offer goes to /negotiations/{providerPid}/request.');
    if (!callbackAllowed(deps.config, msg.callbackAddress)) return bad({ consumerPid }, 'INVALID_CALLBACK', 'callbackAddress is an https URL this server can reach.');
    const offer = (msg.offer ?? {}) as Record<string, unknown>;
    const target = str(offer.target);
    const offerId = str(offer['@id']);
    if (!target || !offerId) return bad({ consumerPid }, 'INVALID_MESSAGE', 'offer carries its @id and its target, the dataset id.');
    const found = await offerFor(deps, participant, target, offerId);
    if (!found.ok) return bad({ consumerPid }, found.code, found.reason, found.status);

    await sweepArchive(deps.storage, found.owner);
    const full = await processRoomRefusal(deps.storage, deps.config, found.owner, participant.id, 'negotiations');
    if (full) return bad({ consumerPid }, full.code, full.reason);
    const hex = newProcessHex();
    const now = new Date().toISOString();
    const n: NegotiationRecord = {
        providerPid: negotiationPid(localAccountName(found.owner), hex), consumerPid, state: 'REQUESTED', ownerGhii: found.owner,
        participantId: participant.id, authMethod: participant.method, ...(participant.dataspace ? { dataspace: participant.dataspace } : {}),
        callbackAddress: msg.callbackAddress as string, datasetId: target, ...(found.packageName ? { packageName: found.packageName } : {}),
        offerId, offerKind: found.entry.kind, offer: found.entry.offer, ...(found.entry.ref ? { offerRef: found.entry.ref } : {}),
        ...(found.entry.kind === 'share' ? { terms: { purpose: found.entry.purpose, expires: found.entry.expires ?? null } } : {}),
        ...(found.entry.priced ? { priced: found.entry.priced } : {}),
        lastOfferFrom: 'consumer', ...(found.tck ? { tck: found.tck } : {}),
        history: [{ at: now, event: 'request', from: '', to: 'REQUESTED', by: 'consumer' }], createdAt: now, updatedAt: now,
    };
    await createNegotiation(deps.storage, n, hex);
    emitChange('dataspace', n.ownerGhii);
    later(() => afterRequest(deps, n), FIRST_STEP_MS);
    return { status: 201, body: negotiationAck(n) };
}

/** What the provider does after a request. */
async function afterRequest(deps: Deps, n: NegotiationRecord): Promise<void> {
    if (n.tck) {
        const s = negotiationScript(n.tck)!;
        if (s.onRequest === 'offer') {
            await providerOffer(deps, n);
            if (s.terminateAfterOffer) {
                await new Promise(r => setTimeout(r, NEXT_STEP_MS));
                const cur = await readNegotiation(deps.storage, n.ownerGhii, locatePid(n.providerPid, 'cn')!.hex);
                if (cur) await providerTerminate(deps, cur, 'TCK', 'Scripted termination after the offer.', 'provider');
            }
        } else if (s.onRequest === 'agree') await providerAgree(deps, n, 'provider');
        else if (s.onRequest === 'terminate') await providerTerminate(deps, n, 'TCK', 'Scripted termination of the request.', 'provider');
        return;
    }
    const free = n.offerKind === 'open' || n.offerKind === 'share';
    if (free && n.packageName && await autoAgreeFor(deps.storage, n.ownerGhii, n.packageName)) {
        await providerAgree(deps, n, 'provider');
        return;
    }
    await changeNegotiation(deps.storage, n.ownerGhii, locatePid(n.providerPid, 'cn')!.hex, cur => (cur.state === 'REQUESTED' ? { ...cur, waitingForOwner: true } : UNCHANGED));
    void recordAccountEvent(deps.storage, {
        ownerGhii: n.ownerGhii, kind: 'dataspace_request', actorGaii: `dsp:${n.participantId}`, subject: n.providerPid,
        link: '/v1/dataspace/negotiations', data: { name: n.packageName ?? n.datasetId, who: n.participantId },
    }, deps.config);
    emitChange('dataspace', n.ownerGhii);
}

/** GET /negotiations/:pid */
export async function readNegotiationFor(deps: Deps, participant: Participant, pid: string): Promise<DspAnswer> {
    const o = await own(deps, participant, pid);
    return isAnswer(o) ? o : { status: 200, body: negotiationAck(o.n) };
}

/** Apply one consumer message's transition. Answers 200 or the 400 of a transition the state does not allow. */
async function consumerMove(deps: Deps, n: NegotiationRecord, hex: string, msg: 'counter' | 'accepted' | 'verification' | 'termination', extra: (cur: NegotiationRecord) => Partial<NegotiationRecord> = () => ({})): Promise<{ ok: true; n: NegotiationRecord } | { ok: false; answer: DspAnswer }> {
    let refusedIn: NegotiationState | null = null;
    const after = await changeNegotiation(deps.storage, n.ownerGhii, hex, cur => {
        const next = negotiationNext(cur.state, msg);
        if (!next) { refusedIn = cur.state; return UNCHANGED; }
        refusedIn = null;
        return withHistory({ ...cur, ...extra(cur), state: next }, { event: msg, from: cur.state, to: next, by: 'consumer' });
    });
    if (refusedIn) return { ok: false, answer: bad(n, 'INVALID_STATE', `A ${msg} is not allowed in state ${refusedIn}.`) };
    emitChange('dataspace', n.ownerGhii);
    return { ok: true, n: after! };
}

/** The pids of a message must match the negotiation it was sent to. */
function pidsMatch(n: NegotiationRecord, msg: Record<string, unknown>): boolean {
    return (msg.providerPid === undefined || msg.providerPid === n.providerPid) && (msg.consumerPid === undefined || msg.consumerPid === n.consumerPid);
}

/** POST /negotiations/:pid/request: a counter-offer. */
export async function counterOffer(deps: Deps, participant: Participant, pid: string, msg: Record<string, unknown>): Promise<DspAnswer> {
    const o = await own(deps, participant, pid, str(msg.consumerPid));
    if (isAnswer(o)) return o;
    if (msg['@type'] !== 'ContractRequestMessage' || !pidsMatch(o.n, msg)) return bad(o.n, 'INVALID_MESSAGE', 'A ContractRequestMessage with this negotiation\'s pids is expected.');
    if (msg.callbackAddress !== undefined) return bad(o.n, 'INVALID_MESSAGE', 'A counter-offer carries providerPid and no callbackAddress.');
    const moved = await consumerMove(deps, o.n, o.hex, 'counter', () => ({ lastOfferFrom: 'consumer' }));
    if (!moved.ok) return moved.answer;
    if (moved.n.tck && negotiationScript(moved.n.tck)?.onCounter === 'terminate') {
        later(() => providerTerminate(deps, moved.n, 'TCK', 'Scripted termination of the counter-offer.', 'provider'), FIRST_STEP_MS);
    } else if (!moved.n.tck) {
        // This node does not negotiate terms: its offers are the published ones. A counter-offer waits for the owner.
        later(() => afterRequest(deps, moved.n), FIRST_STEP_MS);
    }
    return { status: 200, body: negotiationAck(moved.n) };
}

/** POST /negotiations/:pid/events: the consumer's ACCEPTED (a FINALIZED from a consumer is 400). */
export async function negotiationEvent(deps: Deps, participant: Participant, pid: string, msg: Record<string, unknown>): Promise<DspAnswer> {
    const o = await own(deps, participant, pid, str(msg.consumerPid));
    if (isAnswer(o)) return o;
    if (msg['@type'] !== 'ContractNegotiationEventMessage' || !pidsMatch(o.n, msg)) return bad(o.n, 'INVALID_MESSAGE', 'A ContractNegotiationEventMessage with this negotiation\'s pids is expected.');
    const ev = str(msg.eventType).replace(/^.*[/:]/, '');
    if (ev !== 'ACCEPTED') return bad(o.n, 'INVALID_EVENT', 'A consumer sends the ACCEPTED event only; FINALIZED is the provider\'s.');
    if (o.n.lastOfferFrom !== 'provider') return bad(o.n, 'INVALID_STATE', 'The offer on the table is the consumer\'s own; it is not accepted with an event.');
    const moved = await consumerMove(deps, o.n, o.hex, 'accepted');
    if (!moved.ok) return moved.answer;
    const script = moved.n.tck ? negotiationScript(moved.n.tck) : null;
    const next = script ? script.onAccepted : 'agree';
    if (next === 'agree') later(() => providerAgree(deps, moved.n, 'provider'), FIRST_STEP_MS);
    else if (next === 'terminate') later(() => providerTerminate(deps, moved.n, 'TCK', 'Scripted termination after ACCEPTED.', 'provider'), FIRST_STEP_MS);
    return { status: 200, body: negotiationAck(moved.n) };
}

/** POST /negotiations/:pid/agreement/verification */
export async function verifyAgreement(deps: Deps, participant: Participant, pid: string, msg: Record<string, unknown>): Promise<DspAnswer> {
    const o = await own(deps, participant, pid, str(msg.consumerPid));
    if (isAnswer(o)) return o;
    if (msg['@type'] !== 'ContractAgreementVerificationMessage' || !pidsMatch(o.n, msg)) return bad(o.n, 'INVALID_MESSAGE', 'A ContractAgreementVerificationMessage with this negotiation\'s pids is expected.');
    const moved = await consumerMove(deps, o.n, o.hex, 'verification');
    if (!moved.ok) return moved.answer;
    const script = moved.n.tck ? negotiationScript(moved.n.tck) : null;
    if (script?.onVerified === 'terminate') later(() => providerTerminate(deps, moved.n, 'TCK', 'Scripted termination after the verification.', 'provider'), FIRST_STEP_MS);
    else later(() => providerFinalize(deps, moved.n), FIRST_STEP_MS);
    return { status: 200, body: negotiationAck(moved.n) };
}

/** POST /negotiations/:pid/termination: the consumer ends the negotiation, and with it what an agreement made. */
export async function terminateNegotiation(deps: Deps, participant: Participant, pid: string, msg: Record<string, unknown>): Promise<DspAnswer> {
    const o = await own(deps, participant, pid, str(msg.consumerPid));
    if (isAnswer(o)) return o;
    if (msg['@type'] !== 'ContractNegotiationTerminationMessage' || !pidsMatch(o.n, msg)) return bad(o.n, 'INVALID_MESSAGE', 'A ContractNegotiationTerminationMessage with this negotiation\'s pids is expected.');
    if (NEGOTIATION_TERMINAL.includes(o.n.state)) return bad(o.n, 'INVALID_STATE', `The negotiation is ${o.n.state}; nothing is left to terminate.`);
    const reason = Array.isArray(msg.reason) ? msg.reason.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('; ').slice(0, 500) : '';
    const moved = await consumerMove(deps, o.n, o.hex, 'termination', () => ({ waitingForOwner: false, endedReason: reason || 'Terminated by the consumer.' }));
    if (!moved.ok) return moved.answer;
    if (moved.n.materialised) {
        await endAgreement(deps, moved.n, 'dsp-terminated');
        await endAgreementTransfers(deps, moved.n, 'The agreement was terminated.');
    }
    return { status: 200, body: negotiationAck(moved.n) };
}
