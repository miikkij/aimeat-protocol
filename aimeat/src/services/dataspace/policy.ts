/**
 * @file src/services/dataspace/policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ODRL policies of a data package in the Dataspace Protocol (plan doc-mvwxcas3dom3,
 *   D8.2): the Offers a Dataset carries in the catalog and the Agreement a negotiation ends in. Pure.
 *
 *   WITHIN THE DSP ODRL PROFILE. The profile context (odrl-profile.jsonld) names `use` as the one action
 *   and `odrl:` as the prefix; every other action and left operand is written as a compact IRI of the
 *   ODRL 2.2 Common Vocabulary, so a JSON-LD expansion with the DSP contexts alone resolves it:
 *     permission   `use`, constrained by the share's purpose (`odrl:purpose` eq) and its end
 *                  (`odrl:dateTime` lteq) when the offer stands on a named share;
 *     prohibition  `odrl:distribute` when the usage terms forbid resale or redistribution, and
 *                  `odrl:derive` when they forbid derivative works;
 *     obligation   `odrl:attribute` when they require attribution, and for an EXCHANGE listing with a
 *                  money price `odrl:compensate` constrained by `odrl:payAmount` (a decimal string),
 *                  `odrl:unit` (the currency) and either `odrl:elapsedTime` P30D (a month of reads) or
 *                  `odrl:count` (a block of reads).
 *   An Offer in a Dataset has an `@id` and no `target` (the schema forbids it there); the Offer a
 *   ContractOfferMessage carries has its `target`. The Agreement repeats the Offer's rules and names
 *   the target, the assigner (this node), the assignee (the participant) and the timestamp.
 * @structure PolicyTerms · PricedTerms · rulesOf · offerOf · agreementOf · PER_READ_BLOCK · decimalOf
 * @usage const offer = offerOf(offerIdOf(owner, name, 'open'), { usage });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.2).
 */

/** How many reads one per-read purchase over DSP buys: the block the compensate duty prices. */
export const PER_READ_BLOCK = 1000;

export interface PricedTerms {
    /** Micro-units (6 decimals) of one period or one read, as the listing prices it. */
    amount: number;
    currency: string;
    model: 'per_month' | 'per_read';
    offeringId: string;
}

export interface PolicyTerms {
    usage?: { derivatives?: boolean; resale?: boolean; attribution?: boolean } | null;
    purpose?: string;
    expires?: string | null;
    priced?: PricedTerms;
}

/** Micro-units as the decimal string ODRL's payAmount takes: 12500000 → "12.50". */
export function decimalOf(micros: number): string {
    const abs = Math.abs(Math.round(micros));
    const whole = Math.floor(abs / 1_000_000);
    const frac = String(abs % 1_000_000).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
    return `${micros < 0 ? '-' : ''}${whole}.${frac}`;
}

type Rule = Record<string, unknown>;

/** The permission, prohibition and obligation arrays of a policy with these terms. */
export function rulesOf(t: PolicyTerms): { permission: Rule[]; prohibition?: Rule[]; obligation?: Rule[] } {
    const constraint: Rule[] = [];
    if (t.purpose) constraint.push({ leftOperand: 'odrl:purpose', operator: 'eq', rightOperand: t.purpose });
    if (t.expires) constraint.push({ leftOperand: 'odrl:dateTime', operator: 'lteq', rightOperand: t.expires });
    const prohibition: Rule[] = [];
    if (t.usage?.resale === false) prohibition.push({ action: 'odrl:distribute' });
    if (t.usage?.derivatives === false) prohibition.push({ action: 'odrl:derive' });
    const obligation: Rule[] = [];
    if (t.usage?.attribution === true) obligation.push({ action: 'odrl:attribute' });
    if (t.priced) {
        const amount = t.priced.model === 'per_read' ? t.priced.amount * PER_READ_BLOCK : t.priced.amount;
        obligation.push({
            action: 'odrl:compensate',
            constraint: [
                { leftOperand: 'odrl:payAmount', operator: 'eq', rightOperand: decimalOf(amount) },
                { leftOperand: 'odrl:unit', operator: 'eq', rightOperand: t.priced.currency },
                t.priced.model === 'per_month'
                    ? { leftOperand: 'odrl:elapsedTime', operator: 'eq', rightOperand: 'P30D' }
                    : { leftOperand: 'odrl:count', operator: 'eq', rightOperand: String(PER_READ_BLOCK) },
            ],
        });
    }
    return {
        permission: [{ action: 'use', ...(constraint.length ? { constraint } : {}) }],
        ...(prohibition.length ? { prohibition } : {}),
        ...(obligation.length ? { obligation } : {}),
    };
}

/** An Offer: in a Dataset with no target, in a ContractOfferMessage with one. */
export function offerOf(id: string, t: PolicyTerms, target?: string): Record<string, unknown> {
    return { '@id': id, '@type': 'Offer', ...(target ? { target } : {}), ...rulesOf(t) };
}

/** The Agreement of an offer: the offer's rules, the target, both parties and the time. */
export function agreementOf(
    id: string, offer: Record<string, unknown>, a: { target: string; assigner: string; assignee: string; at?: Date },
): Record<string, unknown> {
    const pick = (k: string) => (Array.isArray(offer[k]) && (offer[k] as unknown[]).length ? { [k]: offer[k] } : {});
    return {
        '@id': id, '@type': 'Agreement', target: a.target, assigner: a.assigner, assignee: a.assignee,
        timestamp: (a.at ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        ...pick('permission'), ...pick('prohibition'), ...pick('obligation'),
        ...(Array.isArray(offer.permission) || Array.isArray(offer.prohibition) ? {} : { permission: [{ action: 'use' }] }),
    };
}
