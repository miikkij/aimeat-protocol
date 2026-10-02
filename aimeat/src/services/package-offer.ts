/**
 * @file src/services/package-offer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package offer: the terms on which a package's author lets seller nodes sell a package
 *   group (docs/specs/package-sale-design.md, section 2).
 *
 *   ONE RECORD PER GROUP, `offer.<groupId>`, in the system namespace of the entitlements
 *   (`package-entitlements`), beside `entitlements.<groupId>` and `sellers.<author>`. No principal can
 *   address it, so it is written only here, by the package's author or an operator.
 *
 *   TERMS ARE APPENDED, NEVER REWRITTEN. A price change is a new terms entry; the last one is current.
 *   A seller and a buyer who accepted terms keep them (the entitlement and the selling node's order
 *   record the terms id and its amounts), so a new price reaches only new sales. A new package version
 *   changes nothing here: a version carries no price.
 *
 *   WHAT THE TERMS SAY. How access is granted (`payment`, `approval` or `automatic`), a one-time price
 *   (required for payment, null otherwise; money only, EUR or USD micro-units: a morsel buys nothing),
 *   how many days of updates come with it and the renewal price and period, the release channel, the
 *   licence (one subject per purchase; `node` is the only subject today), how tax is to be read (the
 *   platform does not decide tax), and a support and a security contact, both required for a paid
 *   offer. Nothing about content or permissions: those come from the package.
 *
 *   STATE. `on_sale` sells; `paused` stops new sales and keeps renewals; `ended` stops both, and every
 *   entitlement runs to its own date.
 *
 *   ONLY A PRIVATE PACKAGE has an offer: a public one is served to anyone, so there is nothing to sell.
 * @structure OfferTerms · PackageOffer · readOffer() · currentTerms() · setOffer()
 * @usage
 *   const offer = await readOffer(storage, groupId);
 *   const out = await setOffer(storage, { owner, isOperator }, groupId, { terms, state });
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 3).
 */
import type { Storage } from '../storage/interface.js';
import { NS_PACKAGE_ENTITLEMENTS } from './package-entitlements.js';
import { MONEY_CURRENCIES, integerMicros } from '../commerce/money.js';

export type OfferGrant = 'payment' | 'approval' | 'automatic';
export type OfferState = 'on_sale' | 'paused' | 'ended';

export interface Money { amount: number; currency: string }

export interface OfferTerms {
    id: string;
    createdAt: string;
    grant: OfferGrant;
    /** One-time price in micro-units; required for `payment`, null otherwise. */
    price: Money | null;
    updates: { included_days: number; renewal: (Money & { period_days: number }) | null };
    channel: 'stable' | 'beta';
    licence: { subject: 'node'; per: 'purchase'; spdx?: string; terms_url?: string; text_sha256?: string };
    tax: { prices_include_tax: boolean; category?: string };
    support: { email?: string; security_email?: string };
}

export interface PackageOffer {
    groupId: string;
    author: string;
    state: OfferState;
    terms: OfferTerms[];
    updatedAt: string;
}

type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

const key = (groupId: string): string => `offer.${groupId}`;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

export async function readOffer(storage: Storage, groupId: string): Promise<PackageOffer | null> {
    const rec = await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, key(groupId));
    const v = rec?.value as PackageOffer | undefined;
    return v && Array.isArray(v.terms) ? v : null;
}

/** The terms a new sale is made on, or null when there are none. */
export function currentTerms(offer: PackageOffer | null): OfferTerms | null {
    return offer && offer.terms.length ? offer.terms[offer.terms.length - 1]! : null;
}

/** Terms by id, for a renewal on what was accepted. */
export function termsById(offer: PackageOffer | null, id: string): OfferTerms | null {
    return offer?.terms.find(t => t.id === id) ?? null;
}

function money(raw: unknown, field: string): Money | Fail {
    const o = raw as { amount?: unknown; currency?: unknown } | null;
    if (!o || typeof o !== 'object') return fail(400, 'INVALID_INPUT', `${field} is { amount, currency }.`);
    const currency = typeof o.currency === 'string' ? o.currency.toUpperCase() : '';
    if (!(MONEY_CURRENCIES as readonly string[]).includes(currency)) {
        return fail(400, 'INVALID_INPUT', `${field}.currency is one of ${MONEY_CURRENCIES.join(', ')}: an offer is priced in money; a morsel paces use and buys nothing.`);
    }
    if (typeof o.amount !== 'number' || !Number.isFinite(o.amount) || o.amount <= 0) {
        return fail(400, 'INVALID_INPUT', `${field}.amount is a positive number of micro-units (1 EUR = 1000000).`);
    }
    return { amount: integerMicros(o.amount), currency };
}

/** Check new terms as the author gave them. */
export function validateTerms(raw: unknown, now: string, id: string): OfferTerms | Fail {
    const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const grant = t.grant ?? 'payment';
    if (grant !== 'payment' && grant !== 'approval' && grant !== 'automatic') {
        return fail(400, 'INVALID_INPUT', 'grant is "payment", "approval" or "automatic".');
    }
    let price: Money | null = null;
    if (grant === 'payment') {
        const p = money(t.price, 'price');
        if ('ok' in p) return p;
        price = p;
    } else if (t.price !== undefined && t.price !== null) {
        return fail(400, 'INVALID_INPUT', `An offer granted on ${grant === 'approval' ? 'approval' : 'request'} carries no price; leave price out or null.`);
    }
    const u = (t.updates && typeof t.updates === 'object' ? t.updates : {}) as Record<string, unknown>;
    const included = u.included_days ?? 30;
    if (typeof included !== 'number' || !Number.isInteger(included) || included < 0 || included > 3650) {
        return fail(400, 'INVALID_INPUT', 'updates.included_days is a whole number of days from 0 to 3650.');
    }
    let renewal: OfferTerms['updates']['renewal'] = null;
    if (u.renewal !== undefined && u.renewal !== null) {
        const r = u.renewal as Record<string, unknown>;
        const m = money(r, 'updates.renewal');
        if ('ok' in m) return m;
        const period = r.period_days;
        if (typeof period !== 'number' || !Number.isInteger(period) || period < 1 || period > 3650) {
            return fail(400, 'INVALID_INPUT', 'updates.renewal.period_days is a whole number of days from 1 to 3650.');
        }
        renewal = { ...m, period_days: period };
    }
    const channel = t.channel ?? 'stable';
    if (channel !== 'stable' && channel !== 'beta') return fail(400, 'INVALID_INPUT', 'channel is "stable" or "beta".');
    const l = (t.licence && typeof t.licence === 'object' ? t.licence : {}) as Record<string, unknown>;
    const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    const licence: OfferTerms['licence'] = {
        subject: 'node', per: 'purchase',
        ...(str(l.spdx, 64) ? { spdx: str(l.spdx, 64)! } : {}),
        ...(str(l.terms_url, 500) ? { terms_url: str(l.terms_url, 500)! } : {}),
        ...(str(l.text_sha256, 64) && /^[0-9a-f]{64}$/.test(String(l.text_sha256)) ? { text_sha256: String(l.text_sha256) } : {}),
    };
    const x = (t.tax && typeof t.tax === 'object' ? t.tax : {}) as Record<string, unknown>;
    const tax: OfferTerms['tax'] = { prices_include_tax: x.prices_include_tax === true, ...(str(x.category, 64) ? { category: str(x.category, 64)! } : {}) };
    const s = (t.support && typeof t.support === 'object' ? t.support : {}) as Record<string, unknown>;
    const support: OfferTerms['support'] = {};
    for (const f of ['email', 'security_email'] as const) {
        const v = str(s[f], 254);
        if (v && !EMAIL_RE.test(v)) return fail(400, 'INVALID_INPUT', `support.${f} is an email address.`);
        if (v) support[f] = v;
    }
    // The one field a buyer who finds a problem needs, and it costs the author nothing.
    if (grant === 'payment' && !support.security_email) {
        return fail(400, 'INVALID_INPUT', 'A paid offer names support.security_email: where a buyer reports a security problem.');
    }
    return { id, createdAt: now, grant, price, updates: { included_days: included, renewal }, channel, licence, tax, support };
}

/**
 * Set the offer of a package group: append new terms, change the state, or both. Only the package's
 * author or an operator; only for a private package.
 */
export async function setOffer(
    storage: Storage, caller: { owner: string; isOperator: boolean }, groupId: string,
    input: { terms?: unknown; state?: unknown },
): Promise<{ ok: true; offer: PackageOffer } | Fail> {
    const latest = (await storage.listVersions(groupId, 1, 0)).versions[0];
    if (!latest) return fail(404, 'NOT_FOUND', `Package not found: ${groupId}`);
    if (latest.author !== caller.owner && !caller.isOperator) {
        return fail(403, 'FORBIDDEN', 'Only the package\'s author or an operator sets the terms it is sold on.');
    }
    if (latest.visibility !== 'private') {
        return fail(409, 'OFFER_NEEDS_PRIVATE', 'A public package is served to anyone, so there is nothing to sell. Make it private first.');
    }
    if (input.state !== undefined && input.state !== 'on_sale' && input.state !== 'paused' && input.state !== 'ended') {
        return fail(400, 'INVALID_INPUT', 'state is "on_sale", "paused" or "ended".');
    }
    const prev = await readOffer(storage, groupId);
    if (input.terms === undefined && !prev) return fail(400, 'INVALID_INPUT', 'A new offer needs its terms.');
    const now = new Date().toISOString();
    const terms = [...(prev?.terms ?? [])];
    if (input.terms !== undefined) {
        const t = validateTerms(input.terms, now, `t${terms.length + 1}`);
        if ('ok' in t) return t;
        terms.push(t);
    }
    const offer: PackageOffer = {
        groupId, author: latest.author, terms, updatedAt: now,
        state: (input.state as OfferState | undefined) ?? prev?.state ?? 'on_sale',
    };
    const rec = await storage.getMemory(NS_PACKAGE_ENTITLEMENTS, key(groupId));
    await storage.setMemory({
        key: key(groupId), ownerGaii: NS_PACKAGE_ENTITLEMENTS, value: offer,
        visibility: 'private', tags: ['package-offer'], ttlHours: null,
        version: rec ? rec.version + 1 : 1, createdAt: rec?.createdAt ?? now, updatedAt: now,
    });
    return { ok: true, offer };
}

/** The offer as anyone may read it: the state and the current terms, with the earlier ones' ids. */
export function publicOffer(offer: PackageOffer): Record<string, unknown> {
    return { group_id: offer.groupId, author: offer.author, state: offer.state, terms: currentTerms(offer), earlier_terms: offer.terms.slice(0, -1).map(t => t.id), updated_at: offer.updatedAt };
}
