/**
 * @file src/services/packages/sale/package-sale-catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The selling node's own records of a package sale (https://aimeat-pages.apps.aimeat.io/#org=fbb51de5-56d5-4143-9871-b998a1187655&ws=ws-mq664uyfz21&doc=doc-mv44ppuzmw8e,
 *   section 3): what it sells at which price, the subscriptions its buyers hold, and the requests
 *   that wait for the seller's approval.
 *
 *   THE CATALOGUE. One record, `catalogue`, in the system namespace `package-sales`: per repository
 *   and package group, the seller's own price to the buyer, its renewal price, the seller of record
 *   (the account whose payment account takes the money; the selling node's operator by default) and a
 *   state. The author's terms are what the seller pays its supplier; how the seller's price relates to
 *   them is the seller's business, and the platform does not compute it. A server-trusted record (the
 *   checkout reads the price from it), so it lives where no principal can address it and is written
 *   only through the operator's endpoint.
 *
 *   THE SUBSCRIPTIONS. One record per buyer account, `subscriptions.<buyer>`, keyed by repository,
 *   group and node: the terms the buyer accepted (the seller's renewal price and the author's terms
 *   id), the update date, and whether it renews by itself. A renewal charges what was accepted.
 *
 *   THE REQUESTS. One record, `requests`, of the sales an offer grants on approval: each waits 30 days
 *   for the seller of record.
 * @structure NS_PACKAGE_SALES · CatalogueEntry · readCatalogue() · catalogueEntry() · setCatalogueEntry()
 *   · Subscription · subscriptionsOf() · subscriptionFor() · putSubscription() · setAutoRenew() ·
 *   allSubscriptions() · nodeHolder() · claimNodeHolder() · releaseNodeHolder() · SaleRequest ·
 *   readRequests() · putRequest() · claimRequest()
 * @version-history
 *   v1.4.0 — 2026-10-18 — The holders and requests records are written on their version
 *     (services/record-cas.ts). claimNodeHolder replaces putNodeHolder and is taken before the grant,
 *     so two sales naming one node at the same moment grant it once; claimRequest decides a waiting
 *     request once, so two approvals at the same moment grant once (wish-rahapolkujen-kilpatilanteet).
 *   v1.3.0 — 2026-10-06 — A subscription names the agent that turned automatic renewal on
 *     (`auto_renew_by`), so each renewal is held to that agent's daily purchase limit (secaudit
 *     2026-10 follow-up, A6). The owner turning it on in person removes the name.
 *   v1.2.0 — 2026-10-05 — nodeHolder and putNodeHolder: which buyer holds a node's grant, so a sale
 *     naming another buyer's node is refused (secaudit 2026-10, PKG-2).
 *   v1.1.0 — 2026-10-02 — A catalogue entry keeps the operator's review (`reviewed`, recordReview());
 *     a price change keeps it (package sale design, phase 5).
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 3).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../../storage/interface.js';
import { MONEY_CURRENCIES, integerMicros } from '../../../commerce/money.js';
import { updateRecord, UNCHANGED } from '../../record-cas.js';

export const NS_PACKAGE_SALES = 'package-sales';

export interface Money { amount: number; currency: string }

export interface CatalogueEntry {
    repository: string;
    group_id: string;
    /** The account on this node whose payment account takes the money and whose terms the buyer accepts. */
    seller_of_record: string;
    /** The seller's one-time price; null when the author's offer grants without money. */
    price: Money | null;
    renewal: (Money & { period_days: number }) | null;
    title?: string;
    state: 'on_sale' | 'paused' | 'ended';
    /**
     * The operator's review of what the version on sale can do (package-offer.ts offerCapabilities):
     * a new sale opens only while the repository's capability hash is the one reviewed.
     */
    reviewed?: { version: string; capabilities_hash: string; at: string; by: string };
    updatedAt: string;
}

type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

const entryKey = (repository: string, groupId: string): string => `${repository}|${groupId}`;

async function getRecord<T>(storage: Storage, key: string): Promise<{ value: T | null; prev: Awaited<ReturnType<Storage['getMemory']>> }> {
    const prev = await storage.getMemory(NS_PACKAGE_SALES, key);
    return { value: (prev?.value as T | undefined) ?? null, prev };
}

async function putRecord(storage: Storage, key: string, value: unknown, prev: Awaited<ReturnType<Storage['getMemory']>>, tag: string): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({
        key, ownerGaii: NS_PACKAGE_SALES, value: value as Record<string, unknown>,
        visibility: 'private', tags: [tag], ttlHours: null,
        version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
}

export async function readCatalogue(storage: Storage): Promise<CatalogueEntry[]> {
    const { value } = await getRecord<{ entries: Record<string, CatalogueEntry> }>(storage, 'catalogue');
    return Object.values(value?.entries ?? {});
}

export async function catalogueEntry(storage: Storage, repository: string, groupId: string): Promise<CatalogueEntry | null> {
    const { value } = await getRecord<{ entries: Record<string, CatalogueEntry> }>(storage, 'catalogue');
    return value?.entries?.[entryKey(repository, groupId)] ?? null;
}

function money(raw: unknown, field: string): Money | Fail {
    const o = raw as { amount?: unknown; currency?: unknown } | null;
    const currency = typeof o?.currency === 'string' ? o.currency.toUpperCase() : '';
    if (!o || !(MONEY_CURRENCIES as readonly string[]).includes(currency)) return fail(400, 'INVALID_INPUT', `${field} is { amount, currency } with currency ${MONEY_CURRENCIES.join(' or ')}.`);
    if (typeof o.amount !== 'number' || !Number.isFinite(o.amount) || o.amount <= 0) return fail(400, 'INVALID_INPUT', `${field}.amount is a positive number of micro-units.`);
    return { amount: integerMicros(o.amount), currency };
}

/** Put a package on this node's catalogue, or change its price or state. The operator's act. */
export async function setCatalogueEntry(
    storage: Storage, caller: { owner: string },
    input: { repository?: unknown; group_id?: unknown; price?: unknown; renewal?: unknown; title?: unknown; state?: unknown; seller_of_record?: unknown },
): Promise<{ ok: true; entry: CatalogueEntry } | Fail> {
    const repository = typeof input.repository === 'string' ? input.repository : '';
    const groupId = typeof input.group_id === 'string' ? input.group_id : '';
    if (!repository || !groupId.includes('::')) return fail(400, 'INVALID_INPUT', 'repository (a node id) and group_id ("name::author") are required.');
    if (input.state !== undefined && input.state !== 'on_sale' && input.state !== 'paused' && input.state !== 'ended') {
        return fail(400, 'INVALID_INPUT', 'state is "on_sale", "paused" or "ended".');
    }
    const { value, prev } = await getRecord<{ entries: Record<string, CatalogueEntry> }>(storage, 'catalogue');
    const entries = { ...(value?.entries ?? {}) };
    const before = entries[entryKey(repository, groupId)];
    let price: Money | null = before?.price ?? null;
    if (input.price !== undefined) {
        if (input.price === null) price = null;
        else { const p = money(input.price, 'price'); if ('ok' in p) return p; price = p; }
    }
    let renewal: CatalogueEntry['renewal'] = before?.renewal ?? null;
    if (input.renewal !== undefined) {
        if (input.renewal === null) renewal = null;
        else {
            const m = money(input.renewal, 'renewal');
            if ('ok' in m) return m;
            const period = (input.renewal as { period_days?: unknown }).period_days;
            if (typeof period !== 'number' || !Number.isInteger(period) || period < 1 || period > 3650) return fail(400, 'INVALID_INPUT', 'renewal.period_days is a whole number of days from 1 to 3650.');
            renewal = { ...m, period_days: period };
        }
    }
    const entry: CatalogueEntry = {
        repository, group_id: groupId,
        seller_of_record: typeof input.seller_of_record === 'string' && input.seller_of_record ? input.seller_of_record : before?.seller_of_record ?? caller.owner,
        price, renewal,
        ...(typeof input.title === 'string' && input.title ? { title: input.title.slice(0, 200) } : before?.title ? { title: before.title } : {}),
        state: (input.state as CatalogueEntry['state'] | undefined) ?? before?.state ?? 'on_sale',
        ...(before?.reviewed ? { reviewed: before.reviewed } : {}),
        updatedAt: new Date().toISOString(),
    };
    entries[entryKey(repository, groupId)] = entry;
    await putRecord(storage, 'catalogue', { entries }, prev, 'package-sales-catalogue');
    return { ok: true, entry };
}

/** Record the operator's review of the version on sale. The entry must exist: price it first. */
export async function recordReview(
    storage: Storage, repository: string, groupId: string, reviewed: NonNullable<CatalogueEntry['reviewed']>,
): Promise<{ ok: true; entry: CatalogueEntry } | Fail> {
    const { value, prev } = await getRecord<{ entries: Record<string, CatalogueEntry> }>(storage, 'catalogue');
    const entries = { ...(value?.entries ?? {}) };
    const before = entries[entryKey(repository, groupId)];
    if (!before) return fail(404, 'NOT_FOR_SALE', `This node has not priced ${groupId}. Price it first (action price), then review it.`);
    const entry: CatalogueEntry = { ...before, reviewed, updatedAt: new Date().toISOString() };
    entries[entryKey(repository, groupId)] = entry;
    await putRecord(storage, 'catalogue', { entries }, prev, 'package-sales-catalogue');
    return { ok: true, entry };
}

// ── Subscriptions ────────────────────────────────────────────────────────────────────────────

export interface Subscription {
    repository: string;
    group_id: string;
    node_id: string;
    buyer: string;
    /** The author's terms the sale was made on, and the seller's renewal price the buyer accepted. */
    terms_id: string | null;
    renewal: (Money & { period_days: number }) | null;
    updates_until: string | null;
    auto_renew: boolean;
    /** The agent (GAII) that turned automatic renewal on. Each renewal is then that agent's purchase
     *  and is held to its daily purchase limit (package-renewals.ts). Absent when the owner turned it on. */
    auto_renew_by?: string;
    /** Stripe's reference ids for a saved card, never the card: the seller of record's own account. */
    payment?: { handler: string; customer?: string; payment_method?: string };
    last_order: string;
    /** Set when an automatic charge failed: the owner is told, and it is tried again each day. */
    last_failure?: { at: string; reason: string };
    createdAt: string;
    updatedAt: string;
}

const subKey = (buyer: string): string => `subscriptions.${buyer}`;
const subId = (s: { repository: string; group_id: string; node_id: string }): string => `${s.repository}|${s.group_id}|${s.node_id}`;

export async function subscriptionsOf(storage: Storage, buyer: string): Promise<Subscription[]> {
    const { value } = await getRecord<{ subs: Record<string, Subscription> }>(storage, subKey(buyer));
    return Object.values(value?.subs ?? {});
}

export async function subscriptionFor(storage: Storage, buyer: string, repository: string, groupId: string, nodeId: string): Promise<Subscription | null> {
    return (await subscriptionsOf(storage, buyer)).find(s => s.repository === repository && s.group_id === groupId && s.node_id === nodeId) ?? null;
}

export async function putSubscription(storage: Storage, sub: Subscription): Promise<void> {
    const { value, prev } = await getRecord<{ subs: Record<string, Subscription> }>(storage, subKey(sub.buyer));
    await putRecord(storage, subKey(sub.buyer), { subs: { ...(value?.subs ?? {}), [subId(sub)]: sub } }, prev, 'package-sales-subscriptions');
}

/**
 * A buyer turns automatic renewal on or off. On needs a card kept at an earlier payment; off applies
 * from the next period, because the date already paid for stays. `agent` is the agent's GAII when an
 * agent of the buyer turns it on: every renewal is then held to that agent's daily purchase limit.
 */
export async function setAutoRenew(
    storage: Storage, buyer: string, input: { repository?: unknown; group_id?: unknown; node_id?: unknown; auto_renew?: unknown },
    agent: string | null = null,
): Promise<{ ok: true; auto_renew: boolean; updates_until: string | null } | Fail> {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    const sub = await subscriptionFor(storage, buyer, str(input.repository), str(input.group_id), str(input.node_id));
    if (!sub) return fail(404, 'NOT_FOUND', 'No subscription of yours names that package and node.');
    if (typeof input.auto_renew !== 'boolean') return fail(400, 'INVALID_INPUT', 'auto_renew is true or false.');
    if (input.auto_renew && !sub.payment?.payment_method) {
        return fail(409, 'NO_SAVED_PAYMENT', 'No card is kept for this subscription. Renew by hand once with automatic renewal turned on, and the card is kept then.');
    }
    const next: Subscription = { ...sub, auto_renew: input.auto_renew, updatedAt: new Date().toISOString() };
    if (input.auto_renew && agent) next.auto_renew_by = agent; else delete next.auto_renew_by;
    await putSubscription(storage, next);
    return { ok: true, auto_renew: input.auto_renew, updates_until: sub.updates_until };
}

// ── Node holders ─────────────────────────────────────────────────────────────────────────────

/**
 * Which buyer on this node holds a node's grant of a package, one record for every sale that named a
 * node. A sale naming a node another buyer holds is refused (secaudit 2026-10, PKG-2): the repository
 * cannot tell this node's buyers apart, so the selling node is the one that can. A subscription
 * exists only for a sale with a renewal, which is why the holder is a record of its own.
 */
const holderId = (repository: string, groupId: string, nodeId: string): string => `${repository}|${groupId}|${nodeId}`;

export async function nodeHolder(storage: Storage, repository: string, groupId: string, nodeId: string): Promise<string | null> {
    const { value } = await getRecord<{ nodes: Record<string, string> }>(storage, 'holders');
    return value?.nodes?.[holderId(repository, groupId, nodeId)] ?? null;
}

type Holders = { nodes: Record<string, string> };
const parseHolders = (v: unknown): Holders => ({ nodes: { ...((v as Partial<Holders> | null | undefined)?.nodes ?? {}) } });

/**
 * Claim a node's grant for `buyer` before the sale asks the repository for it, on the record's
 * version (services/record-cas.ts): of two sales naming one node at the same moment, one holds it,
 * and the other reads the holder it lost to. A claim of a node held by nobody keeps every other
 * node's holder, which a whole-record write from a stale copy used to lose. Answers who holds the
 * node now, and whether this call made the claim (so a refused grant can take it back).
 */
export async function claimNodeHolder(storage: Storage, repository: string, groupId: string, nodeId: string, buyer: string): Promise<{ holder: string; claimed: boolean }> {
    const id = holderId(repository, groupId, nodeId);
    const out = { holder: buyer, claimed: false };
    await updateRecord(storage, NS_PACKAGE_SALES, 'holders', parseHolders, cur => {
        out.holder = cur.nodes[id] ?? buyer;
        out.claimed = !cur.nodes[id];
        return out.claimed ? { nodes: { ...cur.nodes, [id]: buyer } } : UNCHANGED;
    }, { tag: 'package-sales-holders' });
    return out;
}

/** Take back a claim this sale made, when the repository refused the grant it was for. */
export async function releaseNodeHolder(storage: Storage, repository: string, groupId: string, nodeId: string, buyer: string): Promise<void> {
    const id = holderId(repository, groupId, nodeId);
    await updateRecord(storage, NS_PACKAGE_SALES, 'holders', parseHolders, cur => {
        if (cur.nodes[id] !== buyer) return UNCHANGED;
        const nodes = { ...cur.nodes };
        delete nodes[id];
        return { nodes };
    }, { tag: 'package-sales-holders' });
}

/** Every buyer's subscriptions, for the daily renewal job. */
export async function allSubscriptions(storage: Storage): Promise<Subscription[]> {
    const rows = await storage.listMemory(NS_PACKAGE_SALES, { prefix: 'subscriptions.' });
    return rows.flatMap(r => Object.values(((r.value as { subs?: Record<string, Subscription> } | undefined)?.subs) ?? {}));
}

// ── Requests (offers granted on approval) ───────────────────────────────────────────────────

export interface SaleRequest {
    id: string;
    buyer: string;
    repository: string;
    group_id: string;
    node?: { node_id: string; url: string; public_key: string };
    order: string;
    state: 'waiting' | 'approved' | 'refused';
    outcome?: Record<string, unknown>;
    createdAt: string;
    expiresAt: string;
}

export async function readRequests(storage: Storage): Promise<SaleRequest[]> {
    const { value } = await getRecord<{ requests: Record<string, SaleRequest> }>(storage, 'requests');
    const now = Date.now();
    return Object.values(value?.requests ?? {}).filter(r => r.state !== 'waiting' || Date.parse(r.expiresAt) > now);
}

type Requests = { requests: Record<string, SaleRequest> };
const parseRequests = (v: unknown): Requests => ({ requests: { ...((v as Partial<Requests> | null | undefined)?.requests ?? {}) } });

export async function putRequest(storage: Storage, req: Omit<SaleRequest, 'id' | 'createdAt' | 'expiresAt'> & Partial<Pick<SaleRequest, 'id' | 'createdAt' | 'expiresAt'>>): Promise<SaleRequest> {
    const now = Date.now();
    const full: SaleRequest = {
        ...req, id: req.id ?? `psr_${randomUUID()}`,
        createdAt: req.createdAt ?? new Date(now).toISOString(),
        expiresAt: req.expiresAt ?? new Date(now + 30 * 86_400_000).toISOString(),
    };
    // Settled and expired requests older than 90 days leave the record, so it does not grow forever.
    // Written on the record's version, so a request filed while another is decided is kept.
    await updateRecord(storage, NS_PACKAGE_SALES, 'requests', parseRequests, cur => {
        const keep = Object.fromEntries(Object.entries(cur.requests).filter(([, r]) => Date.parse(r.createdAt) > now - 90 * 86_400_000));
        return { requests: { ...keep, [full.id]: full } };
    }, { tag: 'package-sales-requests' });
    return full;
}

/**
 * Decide a waiting request on the record's version: of two decisions at the same moment, one moves
 * it from `waiting` to `state` and gets it back, the other gets null (ALREADY_DECIDED), before
 * anything is granted. An approval that then fails puts the request back with putRequest.
 */
export async function claimRequest(storage: Storage, id: string, state: 'approved' | 'refused'): Promise<SaleRequest | null> {
    const out: { claimed: SaleRequest | null } = { claimed: null };
    await updateRecord(storage, NS_PACKAGE_SALES, 'requests', parseRequests, cur => {
        const r = cur.requests[id];
        out.claimed = r && r.state === 'waiting' && Date.parse(r.expiresAt) > Date.now() ? { ...r, state } : null;
        return out.claimed ? { requests: { ...cur.requests, [id]: out.claimed } } : UNCHANGED;
    }, { tag: 'package-sales-requests' });
    return out.claimed;
}
