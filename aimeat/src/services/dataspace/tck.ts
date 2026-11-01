/**
 * @file src/services/dataspace/tck.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Eclipse Dataspace TCK test mode (plan doc-mvwxcas3dom3, D8.6): the dataset, offer
 *   and agreement ids the TCK's sample configuration names, and what this node does in each scripted
 *   scenario. In remote mode the TCK tells the connector under test nothing, so the connector must know
 *   from the id what the test expects (the EDC does the same with a TCK extension).
 *
 *   IN FORCE ONLY WHERE ./settings.ts tckModeOn says so: set, on a loopback address, on a test node.
 *   Its datasets are virtual (no package behind them), its records are kept under the service owner
 *   `dsp-tck@<node>` (no account), and an agreement on one materialises nothing.
 *
 *   NEGOTIATION, provider side (dataset ACNxxyy, offer `CD123:ACNxxyy:456`): what to do on the
 *   request, a counter-offer, the ACCEPTED event and the verification, from the TCK's own table.
 *   TRANSFER, provider side (agreement ATPxxyy, format HttpData-PULL): the steps to send after the
 *   transfer request. CATALOG: CAT0101 is listed, CAT0102 is read by id, CAT0103 does not exist.
 *   The TCK's own participant authenticates with a static token (AIMEAT_DATASPACE_STATIC_TOKENS),
 *   which the run's `dataspacetck.dsp.connector.http.headers.authorization` sends verbatim.
 *   Measured 2026-11-01 with eclipsedataspacetck/dsp-tck-runtime 1.0.2: the 34 provider-side tests pass
 *   (TP:02-04 is @Disabled in the TCK itself).
 * @structure TCK_OWNER · tckOwnerGhii · NegotiationScript · negotiationScript ·
 *   TransferStep · transferScript · tckDatasets · tckDataset · isTckAgreement · tckOfferId
 * @usage const s = negotiationScript('ACN0103');   // { onRequest: 'offer', onAccepted: 'agree', onVerified: 'finalize' }
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.6).
 */
import { offerOf } from './policy.js';

/** The owner the TCK's records are filed under: a service name, never an account. */
export const TCK_OWNER = 'dsp-tck';
export const tckOwnerGhii = (nodeId: string): string => `${TCK_OWNER}@${nodeId}`;

/** What the provider does at each step of a scripted negotiation. */
export interface NegotiationScript {
    onRequest: 'offer' | 'agree' | 'terminate' | 'none';
    onCounter: 'terminate' | 'none';
    onAccepted: 'agree' | 'terminate' | 'none';
    onVerified: 'finalize' | 'terminate';
    /** After the offer, a termination (CN:02-05). */
    terminateAfterOffer?: boolean;
}

const N = (onRequest: NegotiationScript['onRequest'], rest: Partial<NegotiationScript> = {}): NegotiationScript =>
    ({ onRequest, onCounter: 'none', onAccepted: 'agree', onVerified: 'finalize', ...rest });

const NEGOTIATIONS: Record<string, NegotiationScript> = {
    ACN0101: N('offer'),
    ACN0102: N('offer', { onCounter: 'terminate' }),
    ACN0103: N('offer'),
    ACN0104: N('agree'),
    ACN0201: N('terminate'),
    ACN0202: N('none'),
    ACN0203: N('agree'),
    ACN0204: N('offer'),
    ACN0205: N('offer', { terminateAfterOffer: true }),
    ACN0206: N('offer', { onAccepted: 'terminate' }),
    ACN0207: N('agree', { onVerified: 'terminate' }),
    ACN0301: N('agree'),
    ACN0302: N('offer'),
    ACN0303: N('offer', { onAccepted: 'none' }),
    ACN0304: N('offer'),
};

/** The script of a TCK dataset, or null for any other id. */
export function negotiationScript(datasetId: string): NegotiationScript | null {
    return NEGOTIATIONS[datasetId] ?? null;
}

export const tckOfferId = (datasetId: string): string => `CD123:${datasetId}:456`;

/** A provider step of a scripted transfer. */
export type TransferStep = 'start' | 'terminate' | 'complete' | 'suspend';

const TRANSFERS: Record<string, TransferStep[]> = {
    ATP0101: ['start', 'terminate'],
    ATP0102: ['start', 'complete'],
    ATP0103: ['start', 'suspend', 'terminate'],
    ATP0104: ['start', 'suspend', 'start', 'complete'],
    ATP0105: ['terminate'],
    ATP0201: ['start'], ATP0202: ['start'], ATP0203: ['start'], ATP0204: ['start'],
    ATP0205: [],
    ATP0301: [], ATP0302: [],
    ATP0303: ['start'], ATP0304: ['start'], ATP0305: ['start'], ATP0306: ['start'],
};

/** The provider steps after a transfer request on a TCK agreement, or null for any other agreement. */
export function transferScript(agreementId: string): TransferStep[] | null {
    return TRANSFERS[agreementId] ?? null;
}

export const isTckAgreement = (id: string): boolean => id in TRANSFERS;

/** The TCK's datasets: CAT0101, CAT0102 and every negotiation dataset, one offer each. */
export function tckDatasets(): Array<{ id: string; offers: Array<{ offer: Record<string, unknown>; kind: 'tck' }> }> {
    const ids = ['CAT0101', 'CAT0102', ...Object.keys(NEGOTIATIONS)];
    return ids.map(id => ({ id, offers: [{ kind: 'tck' as const, offer: offerOf(id.startsWith('ACN') ? tckOfferId(id) : `${id}:offer`, {}) }] }));
}

export function tckDataset(id: string): ReturnType<typeof tckDatasets>[number] | null {
    return tckDatasets().find(d => d.id === id) ?? null;
}
