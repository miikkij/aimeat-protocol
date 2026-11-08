/**
 * @file src/services/dataspace/agreement.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a DSP agreement IS on this node (plan doc-mvwxcas3dom3, D8.3): the grants that
 *   exist already, never a third list of agreements. The negotiation record names what it made.
 *
 *     open or share offer   a named share (a consent record, services/parties/shares.ts) of the package
 *                           to the participant's party (./participant.ts), its purpose and end copied
 *                           from the offer, marked with the agreement (`dspAgreement`, node-written).
 *                           The share is no wider than the offer: an open offer stood on the package
 *                           being public, so its share reads what a public reader reads (`publicOnly`);
 *                           a share offer keeps the version the share it stood on pins, and stands
 *                           on that share (`sourceShare`): it is made only while that share is live,
 *                           and reads only while it stays live (services/parties/shares.ts
 *                           standingShares).
 *     exchange offer        an EXCHANGE contract: an entitlement on the listing's coordinate, prepaid
 *                           for what the compensate duty prices (a month of reads, or a block of
 *                           PER_READ_BLOCK reads), the share bound to it (`contract`), and the sale
 *                           booked on the manual-invoice rail (commerce/invoice-handler.ts): DSP moves
 *                           no money, so the provider collects it from the participant out of band.
 *                           That is why a priced agreement always waits for the owner's approval. The
 *                           sale is booked once, when the agreement is made: after the record is AGREED
 *                           and the consumer took the agreement (./negotiation.ts calls bookAgreementSale).
 *
 *   The share is granted in the owner's name: the owner's published policy (autoAgree) or the owner's
 *   approval is the consent, as listing a package for sale is in services/exchange-party-buy.ts.
 *   ENDING an agreement (a termination, the owner's decline after it was finalised) revokes the share
 *   and deletes every transfer key of the share, so the next read is refused. The contract is one slot
 *   per participant and package, which later agreements stack onto: ending one agreement takes back
 *   what that agreement added (its month or its block of reads) while another agreement of the same
 *   participant on the package is live, and revokes the contract when it was the last one.
 * @structure Materialised · AgreementSale · materialiseAgreement · bookAgreementSale · endAgreement
 * @usage const m = await materialiseAgreement(deps, negotiation); if (!m.ok) terminate(m.message);
 * @version-history
 *   2026-11-08 — A share offer's agreement records the share it stood on and is made only while that
 *     share is live (secaudit2026nov08 round 14).
 *   v1.1.0 — 2026-11-02 — The sale is booked once, when the agreement is made (bookAgreementSale), never
 *     for one that is not; ending one of several stacked priced agreements takes back only what it
 *     added (secaudit2026nov02d round 13).
 *   v1.0.1 — 2026-11-02 — The share carries the offer's scope: an open offer's share reads what a public
 *     reader reads, a share offer's keeps its pin (secaudit2026nov02d round 13).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { localAccountName } from '../../utils/gaii.js';
import { grantConsent } from '../consent-write.js';
import { endShares, isLiveShare, setShareMeta, shareMetaOf, sharePatternOf } from '../parties/shares.js';
import { partyRefOf } from '../parties/contract.js';
import { changeParty } from '../parties/store.js';
import { UNCHANGED } from '../record-cas.js';
import { getOffering } from '../exchange-market.js';
import {
    createEntitlement, persistEntitlement, readContractForCall, revokeEntitlement, type PricingSpec,
} from '../metered-entitlements.js';
import { PER_MONTH_SECONDS } from '../exchange-datapackage.js';
import { getPaymentHandler } from '../../commerce/payment-handlers.js';
import { INVOICE_HANDLER_ID } from '../../commerce/invoice-handler.js';
import { bookSessionlessSale } from '../../commerce/session-service.js';
import { emitChange } from '../event-bus.js';
import type { NegotiationRecord } from './contract.js';
import { ensureParticipantParty } from './participant.js';
import { PER_READ_BLOCK } from './policy.js';
import { listNegotiations } from './store.js';

type Deps = { storage: Storage; config: AimeatConfig };
/** The sale a priced agreement books on the invoice rail once it is made. */
export interface AgreementSale { gross: number; currency: string; sellerGhii: string; buyerRef: string; ext: string; action: string; owner: string }
export type Materialised =
    | { ok: true; value: NonNullable<NegotiationRecord['materialised']> | null; sale?: AgreementSale }
    | { ok: false; code: string; message: string };

/** The prepaid pricing one priced agreement buys, on top of what an earlier one of the same party left. */
function prepaid(model: 'per_month' | 'per_read', amount: number, plan: { callsPerWindow?: number; windowSeconds?: number } | undefined, before: PricingSpec | null): PricingSpec {
    const now = Date.now();
    if (model === 'per_month') {
        const from = before?.model === 'subscription' ? Math.max(now, Date.parse(before.validUntil)) : now;
        return {
            model: 'subscription', periodSeconds: PER_MONTH_SECONDS, periodPrice: amount,
            callsPerWindow: plan?.callsPerWindow ?? 60, windowSeconds: plan?.windowSeconds ?? 60,
            validUntil: new Date(from + PER_MONTH_SECONDS * 1000).toISOString(), windowStart: new Date(now).toISOString(), windowCount: 0,
        };
    }
    const left = before?.model === 'bundle' ? before.callsRemaining : 0;
    return { model: 'bundle', blockSize: PER_READ_BLOCK, blockPrice: amount * PER_READ_BLOCK, callsRemaining: left + PER_READ_BLOCK };
}

/**
 * Take back from the contract what one priced agreement added to it (prepaid above): its month, or its
 * block of reads. The other agreements stacked on the slot keep the rest.
 */
async function takeBack(storage: Storage, ref: string, ext: string, model: 'per_month' | 'per_read'): Promise<void> {
    const ent = await readContractForCall(storage, ref, ext, 'read');
    if (!ent || ent.state === 'revoked' || !ent.pricing) return;
    const p = ent.pricing;
    if (model === 'per_read' && p.model === 'bundle') {
        ent.pricing = { ...p, callsRemaining: Math.max(0, p.callsRemaining - PER_READ_BLOCK) };
    } else if (model === 'per_month' && p.model === 'subscription') {
        const until = Math.max(Date.now(), Date.parse(p.validUntil) - PER_MONTH_SECONDS * 1000);
        ent.pricing = { ...p, validUntil: new Date(until).toISOString() };
    } else {
        return;
    }
    ent.updatedAt = new Date().toISOString();
    await persistEntitlement(storage, ent);
}

/** Is another agreement of the same participant on the same package live, besides `n`? */
async function anotherLiveAgreement(storage: Storage, n: NegotiationRecord): Promise<boolean> {
    return (await listNegotiations(storage, n.ownerGhii)).some(o => o.providerPid !== n.providerPid
        && o.participantId === n.participantId && o.packageName === n.packageName && !!o.materialised?.entitlementId
        && ['AGREED', 'VERIFIED', 'FINALIZED'].includes(o.state) && !o.agreementEndedAt);
}

/**
 * Undo what an agreement added to the contract slot of its participant and package: revoke the slot
 * when no other agreement of the participant on the package is live, else take back its share only.
 */
async function undoContract(storage: Storage, n: NegotiationRecord, ref: string, owner: string): Promise<void> {
    const ext = `datapkg:${owner}/${n.packageName}`;
    if (n.priced && await anotherLiveAgreement(storage, n)) await takeBack(storage, ref, ext, n.priced.model);
    else await revokeEntitlement(storage, ref, ext, 'read');
}

/** The version a share offer's share pins: recorded at the request, or read from the share itself. */
async function sharePin(storage: Storage, n: NegotiationRecord): Promise<string | undefined> {
    if (n.offerKind !== 'share') return undefined;
    if (n.terms?.pinnedVersion) return n.terms.pinnedVersion;
    const source = n.offerRef ? await storage.getConsent(n.offerRef) : null;
    return source ? shareMetaOf(source).pinnedVersion : undefined;
}

/** Make the grants an agreement stands for. A TCK seed agreement makes none. The sale is booked later. */
export async function materialiseAgreement(deps: Deps, n: NegotiationRecord): Promise<Materialised> {
    const { storage, config } = deps;
    if (n.offerKind === 'tck' || !n.packageName || !n.agreementId) return { ok: true, value: null };
    // A share offer stands on a live share: one the owner ended before the agreement makes nothing.
    let sourceShare: string | undefined;
    if (n.offerKind === 'share') {
        const source = n.offerRef ? await storage.getConsent(n.offerRef) : null;
        if (!source || !isLiveShare(source)) return { ok: false, code: 'OFFER_GONE', message: 'The share this offer stood on has ended.' };
        sourceShare = source.id;
    }
    const party = await ensureParticipantParty(storage, n.ownerGhii, n.participantId, `dsp:${n.providerPid}`);
    if (party === 'full') return { ok: false, code: 'QUOTA_EXCEEDED', message: 'The provider holds the most outside parties one account may.' };
    if (party === 'taken') return { ok: false, code: 'PARTY_EXISTS', message: 'The provider has another party under this participant\'s name.' };
    const owner = localAccountName(n.ownerGhii);
    const ref = partyRefOf(owner, party.name, config.nodeId);
    let entitlementId: string | undefined;
    let contract: { offeringId: string; entitlementId: string; ifaceVersion: number } | undefined;
    let sale: AgreementSale | undefined;

    if (n.offerKind === 'exchange') {
        const o = n.offerRef ? await getOffering(storage, n.offerRef) : null;
        if (!o || o.state !== 'listed' || o.unit !== 'money' || o.surface?.kind !== 'datapackage') return { ok: false, code: 'OFFERING_GONE', message: 'The EXCHANGE listing this offer stood on is no longer listed.' };
        const surface = o.surface;
        const plan = o.plans.find(p => p.id === 'per_month' && p.model === 'subscription') as { periodPrice?: number; callsPerWindow?: number; windowSeconds?: number } | undefined;
        const amount = surface.model === 'per_month' ? plan?.periodPrice ?? o.basePrice : o.basePrice;
        const before = await readContractForCall(storage, ref, o.ext, o.action);
        const pricing = prepaid(surface.model, amount, plan, before?.state === 'revoked' ? null : before?.pricing ?? null);
        const ent = await createEntitlement(storage, {
            consumerGaii: ref, providerGhii: o.providerGhii, ext: o.ext, action: o.action,
            capabilityLabel: `${surface.packageName} v${surface.ifaceVersion}`, unit: 'money', pricePerCall: o.basePrice,
            currency: o.currency ?? 'EUR', pricing, capUnits: null, contractRef: `offering:${o.offeringId}`, surface, tollMorsels: 0,
            createdBy: `dsp:agreement:${n.agreementId}`, carrySpend: before && before.state !== 'revoked' ? before : null,
        });
        entitlementId = ent.entitlementId;
        contract = { offeringId: o.offeringId, entitlementId: ent.entitlementId, ifaceVersion: surface.ifaceVersion };
        const gross = pricing.model === 'subscription' ? pricing.periodPrice : pricing.model === 'bundle' ? pricing.blockPrice : o.basePrice;
        sale = { gross, currency: o.currency ?? 'EUR', sellerGhii: o.providerGhii, buyerRef: ref, ext: o.ext, action: o.action, owner };
    }

    const pin = await sharePin(storage, n);
    const granted = await grantConsent({ storage, config }, { ownerGaii: n.ownerGhii, roles: ['owner'], scopes: [], collectionMethod: 'dataspace-agreement' }, {
        recipient: ref, dataPattern: sharePatternOf(n.packageName),
        purpose: n.terms?.purpose || `Dataspace agreement ${n.agreementId} with ${n.participantId}.`,
        ...(n.terms?.expires ? { expires: n.terms.expires } : {}),
        metadata: { terms_required: false, ...(pin ? { pinned_version: pin } : {}) },
    });
    if (!granted.ok) {
        if (entitlementId && contract) await undoContract(storage, n, ref, owner);
        return { ok: false, code: granted.code, message: granted.message };
    }
    const publicOnly = n.offerKind === 'open';
    const share = await setShareMeta(storage, granted.value, {
        dspAgreement: n.agreementId, termsAcceptedAt: new Date().toISOString(), ...(contract ? { contract } : {}), ...(publicOnly ? { publicOnly: true } : {}),
        ...(sourceShare ? { sourceShare } : {}),
    });
    if (!share && publicOnly) {
        // A share that does not say it reads what a public reader reads would be wider than the offer.
        await endShares(storage, n.ownerGhii, c => c.id === granted.value.id, 'dsp-agreement-not-made');
        return { ok: false, code: 'AGREEMENT_NOT_MADE', message: 'The share of the agreement could not be written. Try again.' };
    }
    emitChange('consent', n.ownerGhii);
    return {
        ok: true, value: { partyName: party.name, partyUid: party.uid, shareId: (share ?? granted.value).id, ...(entitlementId ? { entitlementId } : {}) },
        ...(sale ? { sale } : {}),
    };
}

/**
 * Book the sale of a priced agreement on the manual-invoice rail: the participant pays the provider out
 * of band. Called once, after the agreement is AGREED and the consumer took it.
 */
export async function bookAgreementSale(deps: Deps, n: NegotiationRecord, sale: AgreementSale): Promise<void> {
    const handler = getPaymentHandler(INVOICE_HANDLER_ID);
    if (!handler || !n.agreementId) return;
    const { config, storage } = deps;
    const { trackingCode } = await handler.collect({ config, storage }, {
        buyerGhii: sale.buyerRef, amount: sale.gross, currency: sale.currency, reference: n.agreementId, fee: 0, instrument: undefined,
        seller: { ghii: sale.sellerGhii, owner: sale.owner, psp: null },
    });
    await bookSessionlessSale(storage, config, {
        gross: sale.gross, currency: sale.currency, sellerGhii: sale.sellerGhii, buyerRef: sale.buyerRef, ext: sale.ext, action: sale.action,
        trackingCode, handler: INVOICE_HANDLER_ID, reference: n.agreementId,
    });
}

/** End what an agreement made: its share, its part of the contract, and every transfer key of the share. */
export async function endAgreement(deps: Deps, n: NegotiationRecord, reason: string): Promise<number> {
    const { storage, config } = deps;
    const m = n.materialised;
    if (!m) return 0;
    const ended = await endShares(storage, n.ownerGhii, c => c.id === m.shareId, reason);
    const owner = localAccountName(n.ownerGhii);
    const ref = partyRefOf(owner, m.partyName, config.nodeId);
    if (m.entitlementId && n.packageName) await undoContract(storage, n, ref, owner);
    await changeParty(storage, n.ownerGhii, m.partyName, p => {
        const keys = p.keys.filter(k => k.share !== m.shareId);
        return keys.length === p.keys.length ? UNCHANGED : { ...p, keys };
    });
    emitChange('consent', n.ownerGhii);
    return ended;
}
