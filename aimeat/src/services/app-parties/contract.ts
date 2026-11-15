/**
 * @file src/services/app-parties/contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's own users as outside parties (plan doc-mvwxcas3dom3, D4): a person registers
 *   to one app with an e-mail address, signs in with an e-mail link, and is a party of the app's owner,
 *   never an account of this node. This file is the pure half: the record, the names, the limits.
 *
 *   THE IDENTITY is a party's (lead decision L1): `party:<owner>/<name>@<node>`, where the owner is the
 *   app's owner. The name is made by the node, `ap-<12 hex>`, and the prefix `ap-` is reserved for app
 *   parties (services/parties/contract.ts validatePartyName), so it never names a party of the owner's
 *   own `parties` record.
 *
 *   THE PARTIES are rows of their own (storage/types/app-parties.ts, since 2026-11-15): one row per
 *   person per app, read by its index and written on its own version, and an app holds at most the
 *   node's consent.app_party_max of them (DEFAULT_APP_PARTY_MAX). The service-owned memory record per
 *   app, `app-parties.<app key>`, under the owner's GHII, keeps the app's registration setting only.
 *   Until 2026-11-15 it held the parties too (a 1 MB value, so 1000 people at most); the boot step in
 *   ./move-to-tables.ts moved them, and parseLegacyParties reads that older shape for it.
 *
 *   NEVER A SESSION (lead decision L2). A party signs in with a link mailed to it and gets a purpose
 *   token (`typ: 'party'`, services/parties/token.ts) that names this app; it is read only by the app
 *   party endpoints (PARTY_TOKEN_ROUTES) and is refused everywhere else, the data package reads included.
 *   `epoch` ends every token at a sign-out or a removal.
 * @structure APP_PARTIES_PREFIX · appPartiesKey · AppPartyRecord · AppPartyRegistration · AppPartiesValue ·
 *   parseAppPartiesValue · parseLegacyParties · APP_PARTY_PREFIX · DEFAULT_APP_PARTY_MAX · appPartyMaxOf ·
 *   LINK_TTL_MS · APP_PARTY_SESSION_SECONDS · stalePending · pendingSinceOf · liveRuleOf · toPartyRow ·
 *   fromPartyRow · emailHashOf · appPartyView · PARTY_DATA_PREFIX · partyDataKey · sharedDataKey · DATA_KEY_RE
 * @usage const v = parseAppPartiesValue(rec?.value);
 * @version-history
 *   v1.2.0 — 2026-11-15 — The parties leave the memory record for the AppParty table; the cap is the
 *     node setting consent.app_party_max (10 000 by default) in place of MAX_APP_PARTIES = 1000.
 *     pendingSinceOf, liveRuleOf, toPartyRow and fromPartyRow carry stalePending's rule to the rows.
 *   v1.1.0 — 2026-11-02 — stalePending: a signup nobody confirmed stops holding a place in the app
 *     after consent.app_party_pending_hours (secaudit2026nov02d round 13).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4; lead decisions L1 to L3).
 */
import { createHash } from 'node:crypto';
import { appKeySegment } from '../app/record-keys.js';
import type { PartyRecord } from '../parties/contract.js';
import type { AppPartyRow, AppPartyLiveRule } from '../../storage/interface.js';

/** The service-owned record of one app's parties (utils/reserved-keys.ts). */
export const APP_PARTIES_PREFIX = 'app-parties.';
export const appPartiesKey = (appId: string): string => `${APP_PARTIES_PREFIX}${appKeySegment(appId)}`;

/** The prefix of an app party's name. Reserved: no party of the owner's own record has it. */
export const APP_PARTY_PREFIX = 'ap-';

/** The most parties one app holds when the node sets nothing (consent.app_party_max). */
export const DEFAULT_APP_PARTY_MAX = 10_000;
/** The node's cap per app, from its setting. */
export const appPartyMaxOf = (config: { appPartyMax?: number }): number =>
    Number.isInteger(config.appPartyMax) && (config.appPartyMax as number) > 0 ? config.appPartyMax as number : DEFAULT_APP_PARTY_MAX;
/** How long a mailed link is good for. */
export const LINK_TTL_MS = 30 * 60 * 1000;
/** How long a signed-in party's token lives; every request re-reads the party anyway. */
export const APP_PARTY_SESSION_SECONDS = 7 * 86_400;

/** A party of an app: an outside party with the app it registered to and its sign-in state. */
export interface AppPartyRecord extends Omit<PartyRecord, 'status'> {
    /** `owner/filename` of the app. */
    app: string;
    /** pending until the mailed link is opened; stopped by the owner or the operator. */
    status: 'pending' | 'active' | 'stopped';
    /** SHA-256 of the lowercased address, to find the party by it. */
    emailHash: string;
    verifiedAt: string | null;
    /** The one open link: its SHA-256, what it does and until when. */
    link: { hash: string; purpose: 'verify' | 'signin'; expiresAt: string } | null;
    /** A token carries this; a sign-out or a removal raises it, and every older token ends. */
    epoch: number;
}

/** The app's own registration setting (D4.3), beside its parties. */
export interface AppPartyRegistration {
    /** closed: no signup. requested: the owner asked and the operator decides (apps-ask). open. refused. */
    state: 'closed' | 'requested' | 'open' | 'refused';
    /** The roster role a registered party is given (services/app/members.ts). */
    role: string;
    requestedAt?: string;
    decidedAt?: string;
    decidedBy?: string;
    reason?: string;
    updatedAt: string;
}

/** The memory record of one app: its registration setting. The parties are rows (see the file header). */
export interface AppPartiesValue {
    /** `owner/filename`, written with every change, so a reader of all apps' records knows whose this is. */
    appId?: string;
    registration: AppPartyRegistration;
}

const CLOSED = (): AppPartyRegistration => ({ state: 'closed', role: 'member', updatedAt: new Date(0).toISOString() });

/** The stored value, read defensively: a missing or malformed record is a closed app. */
export function parseAppPartiesValue(v: unknown): AppPartiesValue {
    const o = (v && typeof v === 'object' ? v : {}) as Partial<AppPartiesValue>;
    const reg = o.registration && typeof o.registration === 'object' && typeof o.registration.state === 'string' ? o.registration : CLOSED();
    return { ...(typeof o.appId === 'string' ? { appId: o.appId } : {}), registration: reg };
}

/** The parties a record written before 2026-11-15 still holds, for the boot move (./move-to-tables.ts). */
export function parseLegacyParties(v: unknown): AppPartyRecord[] {
    const o = (v && typeof v === 'object' ? v : {}) as { parties?: unknown };
    return Array.isArray(o.parties) ? o.parties.filter((p): p is AppPartyRecord =>
        !!p && typeof p === 'object' && typeof (p as AppPartyRecord).uid === 'string' && typeof (p as AppPartyRecord).name === 'string'
        && typeof (p as AppPartyRecord).emailHash === 'string' && typeof (p as AppPartyRecord).app === 'string') : [];
}

/**
 * A signup nobody confirmed whose place has run out: still pending, no link open, and the last link
 * (or the signup, when no link was stored) more than `hours` ago. 0 hours: never (the setting
 * consent.app_party_pending_hours). Active and stopped parties never are.
 */
export function stalePending(p: AppPartyRecord, hours: number, now: number): boolean {
    if (p.status !== 'pending' || p.verifiedAt || !(hours > 0)) return false;
    const linkEnds = p.link ? Date.parse(p.link.expiresAt) : NaN;
    if (linkEnds > now) return false;
    const last = Math.max(Date.parse(p.createdAt) || 0, Number.isFinite(linkEnds) ? linkEnds - LINK_TTL_MS : 0);
    return now - last > hours * 3_600_000;
}

/** The instant a pending party's place counts from, as stalePending reads it: the signup or the last link sent. */
export function pendingSinceOf(p: AppPartyRecord): string {
    const created = Date.parse(p.createdAt) || 0;
    const linkSent = p.link ? (Date.parse(p.link.expiresAt) || 0) - LINK_TTL_MS : 0;
    return new Date(Math.max(created, linkSent)).toISOString();
}

/** stalePending as a rule the table applies (storage/types/app-parties.ts): 0 hours, nothing goes stale. */
export function liveRuleOf(hours: number, now: number): AppPartyLiveRule {
    return { now: new Date(now).toISOString(), staleBefore: hours > 0 ? new Date(now - hours * 3_600_000).toISOString() : null };
}

/** The row of a party: the record as JSON, and the columns copied from it. */
export function toPartyRow(p: AppPartyRecord, ownerGhii: string, version = 1): AppPartyRow {
    return {
        uid: p.uid, ownerGhii, appId: p.app, name: p.name, emailHash: p.emailHash, status: p.status,
        linkHash: p.link?.hash ?? null, linkExpiresAt: p.link?.expiresAt ?? null, verifiedAt: p.verifiedAt ?? null,
        pendingSince: pendingSinceOf(p), epoch: p.epoch ?? 0,
        record: p as unknown as Record<string, unknown>, createdAt: p.createdAt,
        updatedAt: new Date().toISOString(), version,
    };
}

/** The party a row holds. The columns the service keys on win over a record that disagrees with them. */
export function fromPartyRow(row: AppPartyRow): AppPartyRecord {
    const r = row.record as Partial<AppPartyRecord>;
    return {
        ...(r as AppPartyRecord), uid: row.uid, name: row.name, app: row.appId, emailHash: row.emailHash,
        status: row.status as AppPartyRecord['status'], epoch: row.epoch,
        keys: Array.isArray(r.keys) ? r.keys : [], link: r.link ?? null, verifiedAt: r.verifiedAt ?? null,
    };
}

/** The lookup hash of an e-mail address. */
export function emailHashOf(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
}

/** A party as its owner and the party itself read it: no link hash, no e-mail hash. */
export function appPartyView(p: AppPartyRecord, ref: string): Record<string, unknown> {
    return {
        uid: p.uid, name: p.name, party_ref: ref, app: p.app, display_name: p.displayName, kind: p.kind,
        ...(p.contact ? { email: p.contact } : {}), status: p.status,
        created_at: p.createdAt, verified_at: p.verifiedAt, last_seen_at: p.lastSeenAt ?? null,
    };
}

/**
 * Party data: one row per party per collection in the AppPartyData table, and the collections the app
 * shares to every party of it under the party uid `_shared` (APP_PARTY_SHARED). A party reads and
 * writes its own and reads the shared.
 *
 * Until 2026-11-15 each collection was a memory key under the app owner's GHII,
 * `app-party-data.<app key>.<party uid>.<key>` (`_shared` for the shared ones). The keys below name
 * that older place for the boot move; the prefix stays service-owned (utils/reserved-keys.ts), so
 * nothing else writes there.
 */
export const PARTY_DATA_PREFIX = 'app-party-data.';
export const DATA_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const partyDataKey = (appId: string, uid: string, key: string): string => `${PARTY_DATA_PREFIX}${appKeySegment(appId)}.${uid}.${key}`;
export const sharedDataKey = (appId: string, key: string): string => `${PARTY_DATA_PREFIX}${appKeySegment(appId)}._shared.${key}`;
/** The collections one party may keep, and the size of one. */
export const MAX_PARTY_COLLECTIONS = 20;
export const MAX_PARTY_VALUE_BYTES = 64 * 1024;
