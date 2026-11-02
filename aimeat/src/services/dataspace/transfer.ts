/**
 * @file src/services/dataspace/transfer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provider side of the DSP 2025-1 transfer process, pull only (plan doc-mvwxcas3dom3,
 *   D8.4).
 *
 *   A REQUEST names an agreement this node made with the same participant (AGREED, VERIFIED or
 *   FINALIZED, and not ended) and the format HttpData-PULL; it opens a transfer in REQUESTED (201), or
 *   answers the open transfer of the same consumerPid again. Then the provider starts it: a key for the
 *   transfer on the participant's party and its token (./transfer-token.ts), the record STARTED, and a
 *   TransferStartMessage whose dataAddress points at the package's OData feed:
 *     { endpointType: https://w3id.org/idsa/v4.1/HTTP, endpoint: <base>/v1/odata/<owner>/<package>,
 *       endpointProperties: authorization = the token, authType = bearer }.
 *   THE CONSUMER'S MESSAGES: a suspension (STARTED → SUSPENDED) removes the key; a start (SUSPENDED →
 *   STARTED) puts it back, so the token handed out reads again (a token past its life gets a new key and
 *   a new TransferStartMessage); a completion (STARTED → COMPLETED) and a termination (any live state →
 *   TERMINATED) remove it for good. Any other message is 400 with a TransferError; a transfer of another
 *   participant, or none, is 404.
 *   ENDING THE AGREEMENT terminates every live transfer of it (endAgreementTransfers), with a
 *   TransferTerminationMessage to the consumer.
 *   TCK mode: an ATPxxyy agreement is a seed, its data address is a placeholder, and the provider acts
 *   out the scripted steps (./tck.ts), one at a time, a second apart.
 * @structure requestTransfer · readTransferFor · transferMessage · endAgreementTransfers · locateTransfer
 * @usage const out = await requestTransfer(deps, participant, req.body);
 * @version-history
 *   v1.0.1 — 2026-11-02 — A new transfer asks the process room (./settings.ts processRoomRefusal): ended
 *     processes take none, one participant a share only (secaudit2026nov02d round 13).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.4).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { localAccountName } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { UNCHANGED } from '../record-cas.js';
import {
    DSP_PATH, HTTP_ENDPOINT_TYPE, PULL_FORMAT, TRANSFER_TERMINAL, callbackUrl, dspBody,
    locateAgreement, locatePid, newProcessHex, transferAck, transferError, transferNext, transferPid, withHistory,
    type NegotiationRecord, type TransferRecord, type TransferState,
} from './contract.js';
import { callbackAllowed, later, sendCallback } from './callbacks.js';
import { changeTransfer, createTransfer, listTransfers, readNegotiation, readTransfer, sweepArchive } from './store.js';
import { processRoomRefusal, tckModeOn } from './settings.js';
import { isTckAgreement, tckOwnerGhii, transferScript, type TransferStep } from './tck.js';
import { dropTransferKey, mintTransferKey, restoreTransferKey } from './transfer-token.js';
import type { Participant } from './verifier.js';

type Deps = { storage: Storage; config: AimeatConfig };
export interface DspAnswer { status: number; body: Record<string, unknown> }

const FIRST_STEP_MS = 300;
const NEXT_STEP_MS = 1000;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const bad = (t: { providerPid?: string; consumerPid?: string }, code: string, reason: string, status = 400): DspAnswer =>
    ({ status, body: transferError(t.providerPid ?? '', t.consumerPid ?? '', code, reason) });

export function locateTransfer(pid: string, nodeId: string): { ownerGhii: string; hex: string } | null {
    const at = locatePid(pid, 'tp');
    return at ? { ownerGhii: `${at.owner}@${nodeId}`, hex: at.hex } : null;
}

const hexOf = (t: TransferRecord): string => locatePid(t.providerPid, 'tp')!.hex;
const to = (t: TransferRecord) => ({ participantId: t.participantId, authMethod: t.authMethod });

/** The agreement a request names, for this participant: the negotiation that made it, or a TCK seed. */
async function agreementFor(deps: Deps, participant: Participant, agreementId: string): Promise<{ ownerGhii: string; n: NegotiationRecord | null } | null> {
    if (tckModeOn(deps.config) && isTckAgreement(agreementId)) return { ownerGhii: tckOwnerGhii(deps.config.nodeId), n: null };
    const at = locateAgreement(agreementId);
    if (!at) return null;
    const ownerGhii = `${at.owner}@${deps.config.nodeId}`;
    const n = await readNegotiation(deps.storage, ownerGhii, at.hex);
    if (!n || n.participantId !== participant.id || n.agreementId !== agreementId) return null;
    if (!['AGREED', 'VERIFIED', 'FINALIZED'].includes(n.state) || n.agreementEndedAt) return null;
    return { ownerGhii, n };
}

/** Move a transfer from one of `from` to `next`; the record after, or null when it was elsewhere. */
async function move(deps: Deps, t: TransferRecord, from: readonly TransferState[], next: TransferState, event: string, extra: Partial<TransferRecord> = {}): Promise<TransferRecord | null> {
    let moved = false;
    const after = await changeTransfer(deps.storage, t.ownerGhii, hexOf(t), cur => {
        if (!from.includes(cur.state)) { moved = false; return UNCHANGED; }
        moved = true;
        return withHistory({ ...cur, ...extra, state: next }, { event, from: cur.state, to: next, by: 'provider' });
    });
    emitChange('dataspace', t.ownerGhii);
    return moved ? after : null;
}

/** The data address of a started transfer. */
function dataAddress(deps: Deps, t: TransferRecord, n: NegotiationRecord | null, token: string): Record<string, unknown> {
    const base = deps.config.baseUrl.replace(/\/+$/, '');
    const endpoint = n?.packageName
        ? `${base}/v1/odata/${encodeURIComponent(localAccountName(n.ownerGhii))}/${encodeURIComponent(n.packageName)}`
        : `${base}${DSP_PATH}/tck/data/${encodeURIComponent(t.agreementId)}`;
    return {
        '@type': 'DataAddress', endpointType: HTTP_ENDPOINT_TYPE, endpoint,
        endpointProperties: [
            { '@type': 'EndpointProperty', name: 'authorization', value: token },
            { '@type': 'EndpointProperty', name: 'authType', value: 'bearer' },
        ],
    };
}

/** Start (or start again) a transfer as the provider: a key, STARTED, the TransferStartMessage. */
async function providerStart(deps: Deps, t: TransferRecord): Promise<TransferRecord | null> {
    const n = t.negotiationPid ? await readNegotiation(deps.storage, t.ownerGhii, locatePid(t.negotiationPid, 'cn')!.hex) : null;
    let token = 'tck-placeholder-token';
    let keyId: string | undefined, expiresAt: string | undefined, partyName: string | undefined;
    if (n?.materialised) {
        const share = await deps.storage.getConsent(n.materialised.shareId);
        const minted = await mintTransferKey(deps.storage, t.ownerGhii, n.materialised.partyName, { shareId: n.materialised.shareId, transfer: t.providerPid, shareExpires: share?.expires ?? null });
        if (!minted) { await providerEnd(deps, t, 'terminate', 'This provider cannot hand out a key for the transfer now.'); return null; }
        ({ token, keyId, expiresAt } = minted);
        partyName = n.materialised.partyName;
    } else if (!t.tck) {
        await providerEnd(deps, t, 'terminate', 'The agreement made nothing to read.');
        return null;
    }
    const was = t.state;
    const moved = await move(deps, t, ['REQUESTED', 'SUSPENDED'], 'STARTED', 'start', { ...(keyId ? { keyId, tokenExpiresAt: expiresAt, partyName } : {}) });
    if (!moved) { if (keyId && partyName) await dropTransferKey(deps.storage, t.ownerGhii, partyName, keyId); return null; }
    const out = await sendCallback(deps.config, to(t), callbackUrl(t.callbackAddress, 'transfers', t.consumerPid, 'start'), dspBody('TransferStartMessage', {
        providerPid: t.providerPid, consumerPid: t.consumerPid, dataAddress: dataAddress(deps, t, n, token),
    }));
    if (!out.ok) {
        if (keyId && partyName) await dropTransferKey(deps.storage, t.ownerGhii, partyName, keyId);
        await changeTransfer(deps.storage, t.ownerGhii, hexOf(t), cur => (cur.state === 'STARTED'
            ? withHistory({ ...cur, state: was, callbackError: out.error }, { event: 'callback-failed', from: 'STARTED', to: was, by: 'provider' })
            : { ...cur, callbackError: out.error }));
        return null;
    }
    return moved;
}

/** End, complete or suspend as the provider: the key goes, the record moves, the message goes out. */
async function providerEnd(deps: Deps, t: TransferRecord, step: Exclude<TransferStep, 'start'>, reason: string): Promise<void> {
    const plan = { terminate: { from: ['REQUESTED', 'STARTED', 'SUSPENDED'], to: 'TERMINATED', type: 'TransferTerminationMessage', path: 'termination' },
        complete: { from: ['STARTED'], to: 'COMPLETED', type: 'TransferCompletionMessage', path: 'completion' },
        suspend: { from: ['STARTED'], to: 'SUSPENDED', type: 'TransferSuspensionMessage', path: 'suspension' } }[step] as { from: TransferState[]; to: TransferState; type: string; path: string };
    const moved = await move(deps, t, plan.from, plan.to, step);
    if (!moved) return;
    if (moved.keyId && moved.partyName) await dropTransferKey(deps.storage, t.ownerGhii, moved.partyName, moved.keyId);
    const out = await sendCallback(deps.config, to(t), callbackUrl(t.callbackAddress, 'transfers', t.consumerPid, plan.path), dspBody(plan.type, {
        providerPid: t.providerPid, consumerPid: t.consumerPid, ...(step !== 'complete' ? { code: 'PROVIDER', reason: [reason] } : {}),
    }));
    if (!out.ok) await changeTransfer(deps.storage, t.ownerGhii, hexOf(t), cur => ({ ...cur, callbackError: out.error }));
}

/** Act out a TCK script's steps, a second apart. */
async function runScript(deps: Deps, t: TransferRecord, steps: TransferStep[]): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
        if (i) await new Promise(r => setTimeout(r, NEXT_STEP_MS));
        const cur = await readTransfer(deps.storage, t.ownerGhii, hexOf(t));
        if (!cur || TRANSFER_TERMINAL.includes(cur.state)) return;
        const step = steps[i]!;
        if (step === 'start') { if (!(await providerStart(deps, cur))) return; }
        else await providerEnd(deps, cur, step, `Scripted ${step}.`);
    }
}

/** POST /transfers/request */
export async function requestTransfer(deps: Deps, participant: Participant, msg: Record<string, unknown>): Promise<DspAnswer> {
    const consumerPid = str(msg.consumerPid);
    const agreementId = str(msg.agreementId);
    if (msg['@type'] !== 'TransferRequestMessage' || !consumerPid || !agreementId) return bad({ consumerPid }, 'INVALID_MESSAGE', 'A TransferRequestMessage with consumerPid and agreementId is expected.');
    if (str(msg.format) !== PULL_FORMAT) return bad({ consumerPid }, 'UNSUPPORTED_FORMAT', `This server serves the format ${PULL_FORMAT} only.`);
    if (!callbackAllowed(deps.config, msg.callbackAddress)) return bad({ consumerPid }, 'INVALID_CALLBACK', 'callbackAddress is an https URL this server can reach.');
    const ag = await agreementFor(deps, participant, agreementId);
    if (!ag) return bad({ consumerPid }, 'UNKNOWN_AGREEMENT', 'agreementId names no live agreement between this server and you.');

    // Idempotent on consumerPid: the open transfer of the same consumer answers again.
    const open = (await listTransfers(deps.storage, ag.ownerGhii)).find(x => x.consumerPid === consumerPid && x.participantId === participant.id && x.agreementId === agreementId && !TRANSFER_TERMINAL.includes(x.state));
    if (open) return { status: 201, body: transferAck(open) };
    await sweepArchive(deps.storage, ag.ownerGhii);
    const full = await processRoomRefusal(deps.storage, deps.config, ag.ownerGhii, participant.id, 'transfers');
    if (full) return bad({ consumerPid }, full.code, full.reason);

    const hex = newProcessHex();
    const now = new Date().toISOString();
    const t: TransferRecord = {
        providerPid: transferPid(localAccountName(ag.ownerGhii), hex), consumerPid, state: 'REQUESTED', ownerGhii: ag.ownerGhii,
        participantId: participant.id, authMethod: participant.method, agreementId, ...(ag.n ? { negotiationPid: ag.n.providerPid } : {}),
        wireFormat: PULL_FORMAT, callbackAddress: msg.callbackAddress as string, ...(ag.n ? {} : { tck: agreementId }),
        history: [{ at: now, event: 'request', from: '', to: 'REQUESTED', by: 'consumer' }], createdAt: now, updatedAt: now,
    };
    await createTransfer(deps.storage, t, hex);
    emitChange('dataspace', t.ownerGhii);
    const steps = t.tck ? transferScript(t.tck) ?? [] : ['start' as const];
    if (steps.length) later(() => runScript(deps, t, steps), FIRST_STEP_MS);
    return { status: 201, body: transferAck(t) };
}

async function own(deps: Deps, participant: Participant, pid: string, consumerPid = ''): Promise<TransferRecord | DspAnswer> {
    const at = locateTransfer(pid, deps.config.nodeId);
    const t = at ? await readTransfer(deps.storage, at.ownerGhii, at.hex) : null;
    if (!at || !t || t.participantId !== participant.id) return bad({ providerPid: pid, consumerPid }, 'NOT_FOUND', 'No such transfer for this participant.', 404);
    return t;
}
const isAnswer = (v: unknown): v is DspAnswer => !!v && typeof (v as DspAnswer).status === 'number' && !('providerPid' in (v as object));

/** GET /transfers/:pid */
export async function readTransferFor(deps: Deps, participant: Participant, pid: string): Promise<DspAnswer> {
    const t = await own(deps, participant, pid);
    return isAnswer(t) ? t : { status: 200, body: transferAck(t) };
}

const MESSAGE_TYPES = {
    start: 'TransferStartMessage', completion: 'TransferCompletionMessage', suspension: 'TransferSuspensionMessage', termination: 'TransferTerminationMessage',
} as const;

/** POST /transfers/:pid/{start,completion,suspension,termination} from the consumer. */
export async function transferMessage(
    deps: Deps, participant: Participant, pid: string, kind: keyof typeof MESSAGE_TYPES, msg: Record<string, unknown>,
): Promise<DspAnswer> {
    const t = await own(deps, participant, pid, str(msg.consumerPid));
    if (isAnswer(t)) return t;
    if (msg['@type'] !== MESSAGE_TYPES[kind] || (msg.providerPid !== undefined && msg.providerPid !== t.providerPid) || (msg.consumerPid !== undefined && msg.consumerPid !== t.consumerPid)) {
        return bad(t, 'INVALID_MESSAGE', `A ${MESSAGE_TYPES[kind]} with this transfer's pids is expected.`);
    }
    let refusedIn: TransferState | null = null;
    const after = await changeTransfer(deps.storage, t.ownerGhii, hexOf(t), cur => {
        const next = transferNext(cur.state, kind);
        if (!next) { refusedIn = cur.state; return UNCHANGED; }
        refusedIn = null;
        return withHistory({ ...cur, state: next }, { event: kind, from: cur.state, to: next, by: 'consumer' });
    });
    if (refusedIn) return bad(t, 'INVALID_STATE', `A ${kind} is not allowed in state ${refusedIn}.`);
    emitChange('dataspace', t.ownerGhii);
    const rec = after!;
    if (rec.keyId && rec.partyName) {
        if (kind === 'start') {
            const n = rec.negotiationPid ? await readNegotiation(deps.storage, rec.ownerGhii, locatePid(rec.negotiationPid, 'cn')!.hex) : null;
            const ok = n?.materialised && rec.tokenExpiresAt
                ? await restoreTransferKey(deps.storage, rec.ownerGhii, rec.partyName, { keyId: rec.keyId, shareId: n.materialised.shareId, transfer: rec.providerPid, expiresAt: rec.tokenExpiresAt })
                : false;
            // A token past its life gets a new key, and the consumer a new TransferStartMessage with it.
            if (!ok && n?.materialised) {
                await changeTransfer(deps.storage, rec.ownerGhii, hexOf(rec), cur => ({ ...cur, state: 'SUSPENDED' }));
                later(async () => { const cur = await readTransfer(deps.storage, rec.ownerGhii, hexOf(rec)); if (cur) await providerStart(deps, cur); }, FIRST_STEP_MS);
            }
        } else {
            await dropTransferKey(deps.storage, rec.ownerGhii, rec.partyName, rec.keyId);
        }
    }
    return { status: 200, body: transferAck(rec) };
}

/** Terminate every live transfer of an agreement, as the provider. */
export async function endAgreementTransfers(deps: Deps, n: NegotiationRecord, reason: string): Promise<number> {
    let ended = 0;
    for (const t of await listTransfers(deps.storage, n.ownerGhii)) {
        if (t.negotiationPid !== n.providerPid || TRANSFER_TERMINAL.includes(t.state)) continue;
        await providerEnd(deps, t, 'terminate', reason);
        ended++;
    }
    return ended;
}
