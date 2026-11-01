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
 *   THE RECORD is a sibling of the owner's `parties` record (lead decision L3): one service-owned
 *   memory record per app, `app-parties.<app key>`, under the owner's GHII, holding the app's
 *   registration setting and its parties as one collection, written on its version. An app holds at
 *   most MAX_APP_PARTIES, so a busy app does not grow the owner's 100-party record.
 *
 *   NEVER A SESSION (lead decision L2). A party signs in with a link mailed to it and gets a purpose
 *   token (`typ: 'party'`, services/parties/token.ts) that names this app; it is read only by the app
 *   party endpoints (PARTY_TOKEN_ROUTES) and is refused everywhere else, the data package reads included.
 *   `epoch` ends every token at a sign-out or a removal.
 * @structure APP_PARTIES_PREFIX · appPartiesKey · AppPartyRecord · AppPartyRegistration · AppPartiesValue ·
 *   parseAppPartiesValue · APP_PARTY_PREFIX · MAX_APP_PARTIES · LINK_TTL_MS · APP_PARTY_SESSION_SECONDS ·
 *   emailHashOf · appPartyView · PARTY_DATA_PREFIX · partyDataKey · sharedDataKey · DATA_KEY_RE
 * @usage const v = parseAppPartiesValue(rec?.value);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4; lead decisions L1 to L3).
 */
import { createHash } from 'node:crypto';
import { appKeySegment } from '../app-record-keys.js';
import type { PartyRecord } from '../parties/contract.js';

/** The service-owned record of one app's parties (utils/reserved-keys.ts). */
export const APP_PARTIES_PREFIX = 'app-parties.';
export const appPartiesKey = (appId: string): string => `${APP_PARTIES_PREFIX}${appKeySegment(appId)}`;

/** The prefix of an app party's name. Reserved: no party of the owner's own record has it. */
export const APP_PARTY_PREFIX = 'ap-';

/** The most parties one app holds. */
export const MAX_APP_PARTIES = 1000;
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
    /** The roster role a registered party is given (services/app-members.ts). */
    role: string;
    requestedAt?: string;
    decidedAt?: string;
    decidedBy?: string;
    reason?: string;
    updatedAt: string;
}

export interface AppPartiesValue {
    /** `owner/filename`, written with every change, so a reader of all apps' records knows whose this is. */
    appId?: string;
    registration: AppPartyRegistration;
    parties: AppPartyRecord[];
}

const CLOSED = (): AppPartyRegistration => ({ state: 'closed', role: 'member', updatedAt: new Date(0).toISOString() });

/** The stored value, read defensively: a missing or malformed record is a closed app with no parties. */
export function parseAppPartiesValue(v: unknown): AppPartiesValue {
    const o = (v && typeof v === 'object' ? v : {}) as Partial<AppPartiesValue>;
    const reg = o.registration && typeof o.registration === 'object' && typeof o.registration.state === 'string' ? o.registration : CLOSED();
    const parties = Array.isArray(o.parties) ? o.parties.filter((p): p is AppPartyRecord =>
        !!p && typeof p === 'object' && typeof p.uid === 'string' && typeof p.name === 'string' && typeof p.emailHash === 'string') : [];
    return { ...(typeof o.appId === 'string' ? { appId: o.appId } : {}), registration: reg, parties };
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
 * Party data: one record per party per collection, `app-party-data.<app key>.<party uid>.<key>`, and
 * the collections the app shares to every party of it, `app-party-data.<app key>._shared.<key>`, all
 * under the app owner's GHII and service-owned. A party reads and writes its own and reads the shared.
 */
export const PARTY_DATA_PREFIX = 'app-party-data.';
export const DATA_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const partyDataKey = (appId: string, uid: string, key: string): string => `${PARTY_DATA_PREFIX}${appKeySegment(appId)}.${uid}.${key}`;
export const sharedDataKey = (appId: string, key: string): string => `${PARTY_DATA_PREFIX}${appKeySegment(appId)}._shared.${key}`;
/** The collections one party may keep, and the size of one. */
export const MAX_PARTY_COLLECTIONS = 20;
export const MAX_PARTY_VALUE_BYTES = 64 * 1024;
