/**
 * @file src/services/parties/contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The outside party (plan doc-mvwxcas3dom3, D2): a person or a program that is not an
 *   account of this node and reads only what the owner shared with it by name. This file is the pure
 *   half: the record shape, the identity string, the names and the limits.
 *
 *   THE IDENTITY STRING is `party:<owner>/<name>@<node>` (lead decision L1, 2026-11-01). NOT the
 *   `<x>#<owner>@<node>` form of an agent: parseGaiiLoose, localAccountName, isSameOwner, ownerGhiiOf,
 *   matchesRecipient (`ghii:` form), checkConsentForRead and the access-guard members tier all read
 *   `x#alice@node` as one of alice's OWN principals, so a party written that way would pass as alice's
 *   agent at every one of them. With a slash and the `party:` prefix no parser of this node reads it
 *   as a local principal.
 *
 *   THE RECORD. One memory record per owner, key `parties` (a collection read as a unit,
 *   .claude/rules/namespaces-memory.md), written on its version (services/record-cas.ts). Every party
 *   carries a `uid` made at creation, and its shares (consent records) and its tokens name the uid, so
 *   a party deleted and created again under the same name inherits no share and no token (invariant 19).
 *   A key is 32 random bytes, shown once, and stored as its SHA-256 (./keys.ts).
 * @structure PARTIES_KEY · PARTY_READS_PREFIX · PARTY_MANAGE_SCOPE · PARTY_KINDS · PartyKind · PartyKey ·
 *   PartyRecord · PartiesValue · PARTY_NAME_RE · validatePartyName · partyRefOf · parsePartyRef ·
 *   parsePartyUser · parsePartiesValue · partyView · PARTY_TOKEN_PREFIX · PARTY_TOKEN_TTL_SECONDS ·
 *   MAX_PARTIES · MAX_KEYS_PER_PARTY · isPartyRef · PARTY_TOKEN_ROUTES · takesPartyToken
 * @usage const ref = partyRefOf('alice', 'matti', config.nodeId);   // party:alice/matti@node
 * @version-history
 *   v1.3.0 — 2026-11-01 — A data space participant (kind `dataspace`) carries its `did` and credential
 *     type `did`; a key a DSP transfer minted names its `share` and `transfer` (plan D8.4, D8.5). The DSP
 *     data address token is this party token, read on the OData and CSV routes already listed here.
 *   v1.2.0 — 2026-11-01 — PARTY_TOKEN_ROUTES takes an app party's own endpoints (me, signout, party-data;
 *     plan D4.2), and a name starting with "ap-" is kept for the parties of an app.
 *   v1.1.0 — 2026-11-01 — PARTY_TOKEN_ROUTES takes POST /v1/exchange/offerings/{id}/buy: a party buying a
 *     data package again presents its own credential (plan D5.4).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2; lead decisions L1 and L3).
 */

/** The owner's memory record that holds every party of the owner. Service-owned (utils/reserved-keys.ts). */
export const PARTIES_KEY = 'parties';

/** The per-month read log: `party-reads.<yyyy-mm>`, one record per owner per month. Service-owned. */
export const PARTY_READS_PREFIX = 'party-reads.';

/**
 * The permission word an agent, app grant or ecosystem app of the owner needs to make, change, stop or
 * delete a party, and to share a data package with one. Outside every wildcard and ticked on its own
 * (utils/scope-coverage.ts), because giving a stranger a key is not something "Full access" decides.
 */
export const PARTY_MANAGE_SCOPE = 'party:manage';

/** What a party is: a program (Power BI, an ETL job), a person, or a participant of a data space. */
export const PARTY_KINDS = ['program', 'person', 'dataspace'] as const;
export type PartyKind = typeof PARTY_KINDS[number];

/** One key of a party. The key itself is never stored: `hash` is its SHA-256 in hex. */
export interface PartyKey {
    id: string;
    hash: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt?: string | null;
    /**
     * Set on the key a DSP transfer minted (services/dataspace/transfer-token.ts): the one share its
     * token reads, and the transfer it belongs to. No secret of it ever leaves the node; its token does.
     */
    share?: string;
    transfer?: string;
}

/** One party, as the `parties` record holds it. */
export interface PartyRecord {
    /** Made at creation and never reused: shares and tokens are bound to it, not to the name. */
    uid: string;
    name: string;
    displayName: string;
    kind: PartyKind;
    /** How the owner reaches the party. For a person this is personal data the owner holds. */
    contact?: string;
    status: 'active' | 'stopped';
    /** Who stopped it: the owner, or the operator for abuse (D2.9). */
    stoppedBy?: 'owner' | 'operator';
    stoppedAt?: string;
    stopReason?: string;
    createdAt: string;
    /** The principal that made it (the owner's GHII, or the agent's GAII). */
    createdBy: string;
    keys: PartyKey[];
    /**
     * A data space participant's id (kind `dataspace`, plan D8.5): its DID under DCP, or the id the
     * operator gave it under the static method. Set with `credential: 'did'`; such a party holds no key
     * the owner hands out, only the keys its DSP transfers mint.
     */
    did?: string;
    credential?: 'key' | 'did';
    /** Wrong keys presented for this party, counted for the owner and the operator (D2.9). */
    failedAttempts: number;
    lastSeenAt: string | null;
}

export interface PartiesValue {
    parties: PartyRecord[];
}

/** A party name: a slug, unique per owner. */
export const PARTY_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The most parties one owner holds, and the most keys one party holds at once. */
export const MAX_PARTIES = 100;
export const MAX_KEYS_PER_PARTY = 5;

/**
 * The prefix of a party access token. A party token is a signed purpose token (`typ: 'party'`), and
 * the prefix lets the global auth middleware recognise it without verifying it, so it never reads one
 * as a session (auth/middleware.ts) and answers 401 for it on every endpoint that does not take a party.
 */
export const PARTY_TOKEN_PREFIX = 'aimeat_party_';

/** How long a party access token lives. Short, because every read re-checks the party and its share anyway. */
export const PARTY_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * The endpoints that take a party credential, by method and path (lead decision L2). The global auth
 * middleware reads this so a party token there is left to the endpoint's own verifier
 * (./verify.ts); on any other endpoint the token is answered 401 like any credential the node refuses.
 * A later endpoint that takes a party (app party routes, D4; DSP transfer, D8) joins here.
 */
export const PARTY_TOKEN_ROUTES: ReadonlyArray<{ methods: readonly string[]; path: RegExp }> = [
    { methods: ['GET', 'HEAD'], path: /^\/v1\/datapackages\/[^/]+\/[^/]+(?:\/(?:versions|odps|rows\/[^/]+))?\/?$/ },
    { methods: ['GET', 'HEAD'], path: /^\/v1\/odata\/[^/]+\/[^/]+(?:\/[^/]+)?\/?$/ },
    { methods: ['GET', 'HEAD'], path: /^\/v1\/pub\/[^/]+\/datapkg\// },
    { methods: ['GET', 'POST'], path: /^\/v1\/parties\/me(?:\/.*)?$/ },
    // A party buying a data package again tops up its contract (services/exchange-party-buy.ts, D5.4).
    { methods: ['POST'], path: /^\/v1\/exchange\/offerings\/[^/]+\/buy\/?$/ },
    // An app's registered party: its own standing, its sign-out and its data in the app (D4.2).
    { methods: ['GET', 'POST'], path: /^\/v1\/apps\/[^/]+\/[^/]+\/parties\/(?:me|signout)\/?$/ },
    { methods: ['GET', 'PUT', 'DELETE'], path: /^\/v1\/apps\/[^/]+\/[^/]+\/party-data\/[^/]+\/?$/ },
];

/** Does this endpoint take a party token? */
export function takesPartyToken(method: string, path: string): boolean {
    return PARTY_TOKEN_ROUTES.some(r => r.methods.includes(method.toUpperCase()) && r.path.test(path));
}

/** An account name as it may appear in a party identity: what the node's account names are made of. */
const OWNER_PART_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
/** A node id or domain as it may appear in a party identity. */
const NODE_PART_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/;

/** Names the party endpoints use as path segments under /v1/parties, so no party is called one of them. */
export const RESERVED_PARTY_NAMES: readonly string[] = ['me', 'token', 'share'];

/** Null when `name` is a party name, else the reason it is not. */
export function validatePartyName(name: unknown): string | null {
    if (typeof name !== 'string' || !PARTY_NAME_RE.test(name)) {
        return 'A party name is 1 to 40 characters: lowercase letters, digits and dashes, starting with a letter or a digit.';
    }
    if (RESERVED_PARTY_NAMES.includes(name)) return `"${name}" is a word the party endpoints use. Choose another name.`;
    // `ap-` names the parties people make by registering to an app (services/app-parties/contract.ts).
    if (name.startsWith('ap-')) return 'A name starting with "ap-" is kept for the people who register to your apps. Choose another name.';
    return null;
}

/** `party:<owner>/<name>@<node>`, the identity a share names as its recipient. */
export function partyRefOf(owner: string, name: string, nodeId: string): string {
    return `party:${owner}/${name}@${nodeId}`;
}

/** Is this string shaped as a party identity? */
export function isPartyRef(value: unknown): value is string {
    return typeof value === 'string' && parsePartyRef(value) !== null;
}

/** The parts of a party identity, or null when the string is not one. */
export function parsePartyRef(ref: string): { owner: string; name: string; node: string } | null {
    if (typeof ref !== 'string' || !ref.startsWith('party:')) return null;
    const rest = ref.slice('party:'.length);
    const at = rest.lastIndexOf('@');
    if (at <= 0) return null;
    const node = rest.slice(at + 1);
    const ownerName = rest.slice(0, at);
    const slash = ownerName.indexOf('/');
    if (slash <= 0 || ownerName.indexOf('/', slash + 1) !== -1) return null;
    const owner = ownerName.slice(0, slash);
    const name = ownerName.slice(slash + 1);
    if (!OWNER_PART_RE.test(owner) || !PARTY_NAME_RE.test(name) || !NODE_PART_RE.test(node)) return null;
    return { owner, name, node };
}

/**
 * The user-id of HTTP Basic and the `client_id` of the token request: `<owner>/<name>`. RFC 7617 does
 * not allow ':' in a user-id, so the separator is a slash. Null for anything else.
 */
export function parsePartyUser(user: string): { owner: string; name: string } | null {
    if (typeof user !== 'string') return null;
    const slash = user.indexOf('/');
    if (slash <= 0 || user.indexOf('/', slash + 1) !== -1) return null;
    const owner = user.slice(0, slash);
    const name = user.slice(slash + 1);
    if (!OWNER_PART_RE.test(owner) || !PARTY_NAME_RE.test(name)) return null;
    return { owner, name };
}

/** The stored `parties` value, read defensively: a missing or malformed record is an empty one. */
export function parsePartiesValue(v: unknown): PartiesValue {
    const list = v && typeof v === 'object' && Array.isArray((v as PartiesValue).parties) ? (v as PartiesValue).parties : [];
    return {
        parties: list.filter((p): p is PartyRecord => !!p && typeof p === 'object'
            && typeof p.uid === 'string' && typeof p.name === 'string' && Array.isArray(p.keys)),
    };
}

/** What a party looks like to the owner: no key hashes. */
export function partyView(p: PartyRecord, ref: string): Record<string, unknown> {
    return {
        uid: p.uid, name: p.name, party_ref: ref, display_name: p.displayName, kind: p.kind,
        ...(p.contact ? { contact: p.contact } : {}),
        ...(p.did ? { did: p.did, credential: p.credential ?? 'did' } : {}),
        status: p.status,
        ...(p.stoppedBy ? { stopped_by: p.stoppedBy, stopped_at: p.stoppedAt ?? null } : {}),
        ...(p.stopReason ? { stop_reason: p.stopReason } : {}),
        created_at: p.createdAt, created_by: p.createdBy,
        keys: p.keys.map(k => ({ id: k.id, created_at: k.createdAt, last_used_at: k.lastUsedAt, expires_at: k.expiresAt ?? null, ...(k.transfer ? { dsp_transfer: k.transfer } : {}) })),
        failed_attempts: p.failedAttempts ?? 0,
        last_seen_at: p.lastSeenAt ?? null,
    };
}
