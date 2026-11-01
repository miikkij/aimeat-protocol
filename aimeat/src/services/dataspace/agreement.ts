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
 *     exchange offer        an EXCHANGE contract: an entitlement on the listing's coordinate, prepaid
 *                           for what the compensate duty prices (a month of reads, or a block of
 *                           PER_READ_BLOCK reads), the share bound to it (`contract`), and the sale
 *                           booked on the manual-invoice rail (commerce/invoice-handler.ts): DSP moves
 *                           no money, so the provider collects it from the participant out of band.
 *                           That is why a priced agreement always waits for the owner's approval.
 *
 *   The share is granted in the owner's name: the owner's published policy (autoAgree) or the owner's
 *   approval is the consent, as listing a package for sale is in services/exchange-party-buy.ts.
 *   ENDING an agreement (a termination, the owner's decline after it was finalised) revokes the share
 *   and the contract and deletes every transfer key of the share, so the next read is refused.
 * @structure Materialised · materialiseAgreement · endAgreement
 * @usage const m = await materialiseAgreement(deps, negotiation); if (!m.ok) terminate(m.message);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.3).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { localAccountName } from '../../utils/gaii.js';
import { grantConsent } from '../consent-write.js';
import { endShares, setShareMeta, sharePatternOf } from '../parties/shares.js';
import { partyRefOf } from '../parties/contract.js';
import { changeParty } from '../parties/store.js';
import { UNCHANGED } from '../record-cas.js';
import { getOffering } from '../exchange-market.js';
import { createEntitlement, readContractForCall, revokeEntitlement, type PricingSpec } from '../metered-entitlements.js';
import { PER_MONTH_SECONDS } from '../exchange-datapackage.js';
import { getPaymentHandler } from '../../commerce/payment-handlers.js';
import { INVOICE_HANDLER_ID } from '../../commerce/invoice-handler.js';
import { bookSessionlessSale } from '../../commerce/session-service.js';
import { emitChange } from '../event-bus.js';
import type { NegotiationRecord } from './contract.js';
import { ensureParticipantParty } from './participant.js';
import { PER_READ_BLOCK } from './policy.js';

type Deps = { storage: Storage; config: AimeatConfig };
export type Materialised = { ok: true; value: NonNullable<NegotiationRecord['materialised']> | null } | { ok: false; code: string; message: string };

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

/** Make the grants an agreement stands for. A TCK seed agreement makes none. */
export async function materialiseAgreement(deps: Deps, n: NegotiationRecord): Promise<Materialised> {
    const { storage, config } = deps;
    if (n.offerKind === 'tck' || !n.packageName || !n.agreementId) return { ok: true, value: null };
    const party = await ensureParticipantParty(storage, n.ownerGhii, n.participantId, `dsp:${n.providerPid}`);
    if (party === 'full') return { ok: false, code: 'QUOTA_EXCEEDED', message: 'The provider holds the most outside parties one account may.' };
    if (party === 'taken') return { ok: false, code: 'PARTY_EXISTS', message: 'The provider has another party under this participant\'s name.' };
    const owner = localAccountName(n.ownerGhii);
    const ref = partyRefOf(owner, party.name, config.nodeId);
    let entitlementId: string | undefined;
    let contract: { offeringId: string; entitlementId: string; ifaceVersion: number } | undefined;

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
        // The obligation is booked on the invoice rail: the participant pays the provider out of band.
        const handler = getPaymentHandler(INVOICE_HANDLER_ID);
        const gross = pricing.model === 'subscription' ? pricing.periodPrice : pricing.model === 'bundle' ? pricing.blockPrice : o.basePrice;
        if (handler) {
            const { trackingCode } = await handler.collect({ config, storage }, {
                buyerGhii: ref, amount: gross, currency: o.currency ?? 'EUR', reference: n.agreementId, fee: 0, instrument: undefined,
                seller: { ghii: o.providerGhii, owner, psp: null },
            });
            await bookSessionlessSale(storage, config, {
                gross, currency: o.currency ?? 'EUR', sellerGhii: o.providerGhii, buyerRef: ref, ext: o.ext, action: o.action,
                trackingCode, handler: INVOICE_HANDLER_ID, reference: n.agreementId,
            });
        }
    }

    const granted = await grantConsent({ storage, config }, { ownerGaii: n.ownerGhii, roles: ['owner'], scopes: [], collectionMethod: 'dataspace-agreement' }, {
        recipient: ref, dataPattern: sharePatternOf(n.packageName),
        purpose: n.terms?.purpose || `Dataspace agreement ${n.agreementId} with ${n.participantId}.`,
        ...(n.terms?.expires ? { expires: n.terms.expires } : {}),
        metadata: { terms_required: false },
    });
    if (!granted.ok) {
        if (entitlementId && contract) await revokeEntitlement(storage, ref, `datapkg:${owner}/${n.packageName}`, 'read');
        return { ok: false, code: granted.code, message: granted.message };
    }
    const share = await setShareMeta(storage, granted.value, {
        dspAgreement: n.agreementId, termsAcceptedAt: new Date().toISOString(), ...(contract ? { contract } : {}),
    }) ?? granted.value;
    emitChange('consent', n.ownerGhii);
    return { ok: true, value: { partyName: party.name, partyUid: party.uid, shareId: share.id, ...(entitlementId ? { entitlementId } : {}) } };
}

/** End what an agreement made: its share, its contract, and every transfer key of the share. */
export async function endAgreement(deps: Deps, n: NegotiationRecord, reason: string): Promise<number> {
    const { storage, config } = deps;
    const m = n.materialised;
    if (!m) return 0;
    const ended = await endShares(storage, n.ownerGhii, c => c.id === m.shareId, reason);
    const owner = localAccountName(n.ownerGhii);
    const ref = partyRefOf(owner, m.partyName, config.nodeId);
    if (m.entitlementId && n.packageName) await revokeEntitlement(storage, ref, `datapkg:${owner}/${n.packageName}`, 'read');
    await changeParty(storage, n.ownerGhii, m.partyName, p => {
        const keys = p.keys.filter(k => k.share !== m.shareId);
        return keys.length === p.keys.length ? UNCHANGED : { ...p, keys };
    });
    emitChange('consent', n.ownerGhii);
    return ended;
}
