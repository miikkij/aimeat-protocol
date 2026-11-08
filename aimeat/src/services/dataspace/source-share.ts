/**
 * @file src/services/dataspace/source-share.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A Dataspace agreement made on a share offer ends when the share it stood on ends
 *   (secaudit2026nov08 round 14b, approved by the developer on 2026-11-08). The share is named by the
 *   agreement share's `sourceShare` (services/parties/shares.ts), or, for an agreement made before that
 *   field, by its negotiation's `offerRef`.
 *
 *   WHEN. After an owner's named share ends (a revocation, a decline by the party, a withdrawal of the
 *   package, the party's deletion: services/parties/shares.ts sharesEnded, registered here at boot by
 *   installSourceShareEnd), and when the owner reads the negotiations (./owner.ts), which is where a
 *   share that reached its own end date is noticed. standingShares already refuses the reads from the
 *   moment the share ends; this step moves the agreement itself.
 *
 *   HOW, as the protocol and ./owner.ts end an agreement. AGREED or VERIFIED: the negotiation moves to
 *   TERMINATED and the consumer gets a ContractNegotiationTerminationMessage. FINALIZED (the protocol
 *   allows no termination of a finalised negotiation): the negotiation records `agreementEndedAt`, and
 *   every live transfer of it is terminated with a TransferTerminationMessage. In both cases the
 *   agreement's share is revoked, so the owner's "Data you share" view no longer lists it, and what it
 *   added to a contract is taken back. The local end is written before any message is sent, and the
 *   messages go after the answer: a failed callback is recorded on the process (`callbackError`) and
 *   does not undo the end. The transfer keys of the share stay on the party until they expire; they
 *   open nothing once the share is revoked, and a read with one answers SHARE_ENDED.
 *
 *   OFF. While AIMEAT_DATASPACE_ENABLED is off, nothing here runs.
 * @structure SOURCE_ENDED_REASON · endAgreementsOnEndedSources · installSourceShareEnd
 * @usage installSourceShareEnd({ storage, config }); // once, at boot
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14b, item B).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { emitChange } from '../event-bus.js';
import { recordAccountEvent } from '../account-events.js';
import { UNCHANGED } from '../record-cas.js';
import { isLiveShare, onSharesEnded, shareMetaOf } from '../parties/shares.js';
import { locatePid, withHistory, type NegotiationRecord } from './contract.js';
import { changeNegotiation, listNegotiations } from './store.js';
import { endAgreement } from './agreement.js';
import { endAgreementTransfers } from './transfer.js';
import { providerTerminate } from './negotiation.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** What the negotiation and the consumer's messages say. */
export const SOURCE_ENDED_REASON = 'The share this agreement stood on has ended.';
const LIVE_AGREEMENT = ['AGREED', 'VERIFIED', 'FINALIZED'];

/** The share a share-offer agreement stood on: its share's `sourceShare`, else the negotiation's offerRef. */
async function sourceOf(storage: Storage, n: NegotiationRecord): Promise<string | undefined> {
    const own = n.materialised ? await storage.getConsent(n.materialised.shareId) : null;
    return (own ? shareMetaOf(own).sourceShare : undefined) ?? n.offerRef ?? undefined;
}

/** End one agreement whose source share ended. Answers whether this call ended it. */
async function endOne(deps: Deps, n: NegotiationRecord): Promise<boolean> {
    const opts = { keepKey: true, sendLater: true };
    if (n.state !== 'FINALIZED') return providerTerminate(deps, n, 'SHARE_ENDED', SOURCE_ENDED_REASON, 'provider', opts);
    const hex = locatePid(n.providerPid, 'cn')!.hex;
    let claimed = false;
    const after = await changeNegotiation(deps.storage, n.ownerGhii, hex, cur => {
        claimed = false;
        if (cur.state !== 'FINALIZED' || cur.agreementEndedAt) return UNCHANGED;
        claimed = true;
        return withHistory({ ...cur, agreementEndedAt: new Date().toISOString(), endedReason: SOURCE_ENDED_REASON },
            { event: 'agreement-ended', from: cur.state, to: cur.state, by: 'provider' });
    });
    if (!claimed || !after) return false;
    await endAgreement(deps, after, 'dsp-source-share-ended', { keepKeys: true });
    await endAgreementTransfers(deps, after, SOURCE_ENDED_REASON, opts);
    emitChange('dataspace', n.ownerGhii);
    return true;
}

/**
 * End every live share-offer agreement of the owner whose source share is no longer live (revoked,
 * declined, withdrawn, past its end, or gone). An agreement on a live share is not touched. Answers
 * how many ended.
 */
export async function endAgreementsOnEndedSources(deps: Deps, ownerGhii: string, nowMs = Date.now()): Promise<number> {
    if (deps.config.dataspaceEnabled !== true) return 0;
    let ended = 0;
    for (const n of await listNegotiations(deps.storage, ownerGhii)) {
        if (n.offerKind !== 'share' || !n.materialised || !LIVE_AGREEMENT.includes(n.state) || n.agreementEndedAt) continue;
        const sourceId = await sourceOf(deps.storage, n);
        if (!sourceId) continue;
        const source = await deps.storage.getConsent(sourceId);
        if (source && ownerGhiiOf(source.ownerGaii) === ownerGhii && isLiveShare(source, nowMs)) continue;
        if (!(await endOne(deps, n))) continue;
        ended++;
        void recordAccountEvent(deps.storage, {
            ownerGhii, kind: 'contract_ended', actorGaii: `dsp:${n.participantId}`, subject: n.agreementId ?? n.providerPid,
            link: '/v1/dataspace/negotiations', data: { name: `${n.packageName ?? n.datasetId} (Dataspace: ${n.participantId})` },
        }, deps.config);
    }
    return ended;
}

let installed: (() => void) | null = null;

/** Register the step with services/parties/shares.ts, once per process (a second call replaces the first). */
export function installSourceShareEnd(deps: Deps): void {
    installed?.();
    installed = onSharesEnded((_storage, ownerGhii) => endAgreementsOnEndedSources(deps, ownerGhii));
}
