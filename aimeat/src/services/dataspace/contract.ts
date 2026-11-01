/**
 * @file src/services/dataspace/contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of the Eclipse Dataspace Protocol 2025-1 provider (plan doc-mvwxcas3dom3,
 *   D8): the wire constants, the identifiers this node mints, the two state machines, the records a
 *   negotiation and a transfer are kept in, and the message bodies. Nothing here reads storage.
 *
 *   JSON-LD. Every body this node sends is compacted JSON-LD with `@context` an ARRAY holding the DSP
 *   context only, and a single-string `@type` (the TCK validates each body with the JSON Schema of its
 *   type and expands it with a loader that knows the DSP and ODRL profile contexts only). Terms outside
 *   those contexts are written as compact IRIs under the prefixes they define (`odrl:`, `dct:`).
 *
 *   IDENTIFIERS. A process id names the owner it is filed under, so a request finds its record with
 *   one read and no index: `urn:aimeat:dsp:cn:<owner b64url>:<32 hex>` for a negotiation,
 *   `urn:aimeat:dsp:tp:…` for a transfer, `urn:aimeat:dsp:agreement:<owner b64url>:<negotiation hex>`
 *   for an agreement. A dataset is `urn:aimeat:dataset:<owner>:<package>`, and an offer of it
 *   `urn:aimeat:offer:<owner>:<package>:<kind>[:<ref>]`, kind `open` (a public package), `share` (a
 *   named share to this participant, ref the share id) or `exchange` (an EXCHANGE listing, ref the
 *   offering id).
 *
 *   THE RECORDS. One memory record per process, under the owner whose package it is:
 *   `dsp.negotiations.<hex>` and `dsp.transfers.<hex>` (the hex part of the process id; a key is not
 *   an IRI). Finished ones older than ARCHIVE_AFTER_DAYS move into `dsp.archive.<yyyy-mm>` (./store.ts),
 *   so `keys_per_day × 365` stays bounded by what is live. Service-owned (utils/reserved-keys.ts).
 * @structure DSP_VERSION · DSP_PATH · DSP_CONTEXT · ODRL_PROFILE_CONTEXT · PULL_FORMAT · HTTP_ENDPOINT_TYPE ·
 *   NegotiationState · TransferState · NEGOTIATION_TERMINAL · TRANSFER_TERMINAL · OfferKind · NegotiationRecord ·
 *   TransferRecord · newProcessHex · negotiationPid · transferPid · agreementIdOf · locatePid · locateAgreement ·
 *   datasetIdOf · parseDatasetId · offerIdOf · parseOfferId · negotiationKey · transferKey · archiveKey ·
 *   NEGOTIATIONS_PREFIX · TRANSFERS_PREFIX · ARCHIVE_PREFIX · SETTINGS_KEY · dspBody · negotiationAck ·
 *   negotiationError · transferAck · transferError · catalogError · takesDataspaceCredential · callbackUrl ·
 *   withHistory · MAX_HISTORY · ARCHIVE_AFTER_DAYS · MAX_LIVE_PROCESSES · negotiationNext · transferNext
 * @usage const pid = negotiationPid('alice', newProcessHex()); const at = locatePid(pid);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import { randomBytes } from 'node:crypto';

/** The protocol version on the wire, and the base path every DSP endpoint of this node is under. */
export const DSP_VERSION = '2025-1';
export const DSP_PATH = '/dsp/2025-1';

/** The only remote contexts a body of this node names (the TCK's loader knows these two only). */
export const DSP_CONTEXT = 'https://w3id.org/dspace/2025/1/context.jsonld';
export const ODRL_PROFILE_CONTEXT = 'https://w3id.org/dspace/2025/1/odrl-profile.jsonld';

/** The one distribution format this node serves: an HTTP pull of the OData feed or the CSV. */
export const PULL_FORMAT = 'HttpData-PULL';
/** The endpointType of the data address, the value the DSP spec's own example uses. */
export const HTTP_ENDPOINT_TYPE = 'https://w3id.org/idsa/v4.1/HTTP';

export type NegotiationState = 'REQUESTED' | 'OFFERED' | 'ACCEPTED' | 'AGREED' | 'VERIFIED' | 'FINALIZED' | 'TERMINATED';
export type TransferState = 'REQUESTED' | 'STARTED' | 'COMPLETED' | 'SUSPENDED' | 'TERMINATED';
export const NEGOTIATION_TERMINAL: readonly NegotiationState[] = ['FINALIZED', 'TERMINATED'];
export const TRANSFER_TERMINAL: readonly TransferState[] = ['COMPLETED', 'TERMINATED'];

/** What an offer of a dataset stands on: a public package, a named share, an EXCHANGE listing, or a TCK seed. */
export type OfferKind = 'open' | 'share' | 'exchange' | 'tck';

/** One entry of a process's history: what moved it, from which state to which. */
export interface HistoryEntry { at: string; event: string; from: string; to: string; by: 'consumer' | 'provider' | 'owner' }
/** The most history entries a record keeps; the oldest drop first. */
export const MAX_HISTORY = 40;

/** A negotiation as this node keeps it, under the owner of the package. */
export interface NegotiationRecord {
    providerPid: string;
    consumerPid: string;
    state: NegotiationState;
    ownerGhii: string;
    /** The counterparty: a DID under dcp, the configured participant id under static. */
    participantId: string;
    authMethod: 'dcp' | 'static';
    /** The data space whose trusted issuers admitted the participant, when issuers are configured. */
    dataspace?: string;
    callbackAddress: string;
    datasetId: string;
    /** The package the dataset is; absent for a TCK seed. */
    packageName?: string;
    offerId: string;
    offerKind: OfferKind;
    /** The offer as this node published it when the request came; the agreement copies its rules. */
    offer: Record<string, unknown>;
    /** For a share offer: the share the offer stood on. For an exchange offer: the offering. */
    offerRef?: string;
    /** The purpose and end the agreement's share takes over from a share offer. */
    terms?: { purpose?: string; expires?: string | null };
    /** A priced offer: what the compensate duty prices. Such a request always waits for the owner. */
    priced?: { amount: number; currency: string; model: 'per_month' | 'per_read'; offeringId: string };
    /** Who sent the offer now on the table: the consumer's request, or the provider's offer. */
    lastOfferFrom: 'consumer' | 'provider';
    /** Set while the request waits for the owner's approval. */
    waitingForOwner?: boolean;
    decidedBy?: string;
    decidedAt?: string;
    agreementId?: string;
    agreement?: Record<string, unknown>;
    /** What the agreement made: the party and its share, and the contract of a priced offer. */
    materialised?: { partyName: string; partyUid: string; shareId: string; entitlementId?: string };
    /** When the agreement ended after it was finalised (the owner ended it, or a termination). */
    agreementEndedAt?: string;
    endedReason?: string;
    /** The last callback that did not reach the consumer, for the owner to read. */
    callbackError?: string;
    /** The TCK scenario this negotiation acts out (TCK mode only). */
    tck?: string;
    history: HistoryEntry[];
    createdAt: string;
    updatedAt: string;
}

/** A transfer as this node keeps it, under the owner of the agreement. */
export interface TransferRecord {
    providerPid: string;
    consumerPid: string;
    state: TransferState;
    ownerGhii: string;
    participantId: string;
    authMethod: 'dcp' | 'static';
    agreementId: string;
    /** The negotiation that made the agreement; absent for a TCK seed agreement. */
    negotiationPid?: string;
    /** The distribution format the consumer asked for (HttpData-PULL). */
    wireFormat: string;
    callbackAddress: string;
    /** The party key whose token the data address carries (./transfer-token.ts), while the transfer has one. */
    keyId?: string;
    partyName?: string;
    tokenExpiresAt?: string;
    callbackError?: string;
    tck?: string;
    history: HistoryEntry[];
    createdAt: string;
    updatedAt: string;
}

export const NEGOTIATIONS_PREFIX = 'dsp.negotiations.';
export const TRANSFERS_PREFIX = 'dsp.transfers.';
export const ARCHIVE_PREFIX = 'dsp.archive.';
/** The owner's DSP settings: which packages agree on their own (./settings.ts). */
export const SETTINGS_KEY = 'dsp.settings';
/** A finished process older than this moves to the monthly archive. */
export const ARCHIVE_AFTER_DAYS = 90;
/** The most live processes (negotiations plus transfers) one owner holds; past it a new request is 400. */
export const MAX_LIVE_PROCESSES = 400;

const b64u = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');
const OWNER_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/** 32 random hex characters: the part of a process id this node keys its record on. */
export function newProcessHex(): string {
    return randomBytes(16).toString('hex');
}

export const negotiationPid = (owner: string, hex: string): string => `urn:aimeat:dsp:cn:${b64u(owner)}:${hex}`;
export const transferPid = (owner: string, hex: string): string => `urn:aimeat:dsp:tp:${b64u(owner)}:${hex}`;
export const agreementIdOf = (owner: string, negotiationHex: string): string => `urn:aimeat:dsp:agreement:${b64u(owner)}:${negotiationHex}`;

/** The owner and the record a process id of this node names, or null for any other id. */
export function locatePid(pid: string, kind: 'cn' | 'tp'): { owner: string; hex: string } | null {
    const m = new RegExp(`^urn:aimeat:dsp:${kind}:([A-Za-z0-9_-]{1,100}):([0-9a-f]{32})$`).exec(typeof pid === 'string' ? pid : '');
    if (!m) return null;
    const owner = unb64u(m[1]!);
    return OWNER_RE.test(owner) ? { owner, hex: m[2]! } : null;
}

/** The owner and negotiation an agreement id of this node names, or null. */
export function locateAgreement(id: string): { owner: string; hex: string } | null {
    const m = /^urn:aimeat:dsp:agreement:([A-Za-z0-9_-]{1,100}):([0-9a-f]{32})$/.exec(typeof id === 'string' ? id : '');
    if (!m) return null;
    const owner = unb64u(m[1]!);
    return OWNER_RE.test(owner) ? { owner, hex: m[2]! } : null;
}

export const datasetIdOf = (owner: string, name: string): string => `urn:aimeat:dataset:${owner}:${name}`;

/** The owner and package a dataset id of this node names, or null. */
export function parseDatasetId(id: string): { owner: string; name: string } | null {
    const m = /^urn:aimeat:dataset:([^:]+):([^:]+)$/.exec(typeof id === 'string' ? id : '');
    return m && OWNER_RE.test(m[1]!) && NAME_RE.test(m[2]!) ? { owner: m[1]!, name: m[2]! } : null;
}

export function offerIdOf(owner: string, name: string, kind: Exclude<OfferKind, 'tck'>, ref?: string): string {
    return `urn:aimeat:offer:${owner}:${name}:${kind}${ref ? `:${ref}` : ''}`;
}

/** The parts an offer id of this node names, or null. */
export function parseOfferId(id: string): { owner: string; name: string; kind: Exclude<OfferKind, 'tck'>; ref?: string } | null {
    const m = /^urn:aimeat:offer:([^:]+):([^:]+):(open|share|exchange)(?::([A-Za-z0-9_.-]{1,120}))?$/.exec(typeof id === 'string' ? id : '');
    if (!m || !OWNER_RE.test(m[1]!) || !NAME_RE.test(m[2]!)) return null;
    const kind = m[3] as 'open' | 'share' | 'exchange';
    if ((kind === 'open') !== !m[4]) return null;
    return { owner: m[1]!, name: m[2]!, kind, ...(m[4] ? { ref: m[4] } : {}) };
}

export const negotiationKey = (hex: string): string => `${NEGOTIATIONS_PREFIX}${hex}`;
export const transferKey = (hex: string): string => `${TRANSFERS_PREFIX}${hex}`;
export const archiveKey = (month: string): string => `${ARCHIVE_PREFIX}${month}`;

/** A DSP body: the context array, the type, then the fields. */
export function dspBody(type: string, fields: Record<string, unknown>): Record<string, unknown> {
    return { '@context': [DSP_CONTEXT], '@type': type, ...fields };
}

export const negotiationAck = (n: Pick<NegotiationRecord, 'providerPid' | 'consumerPid' | 'state'>) =>
    dspBody('ContractNegotiation', { providerPid: n.providerPid, consumerPid: n.consumerPid, state: n.state });

export const transferAck = (t: Pick<TransferRecord, 'providerPid' | 'consumerPid' | 'state'>) =>
    dspBody('TransferProcess', { providerPid: t.providerPid, consumerPid: t.consumerPid, state: t.state });

/** A ContractNegotiationError. Both pids are required by its schema, so an unknown one is sent as given. */
export function negotiationError(providerPid: string, consumerPid: string, code: string, reason: string): Record<string, unknown> {
    return dspBody('ContractNegotiationError', { providerPid: providerPid || 'unknown', consumerPid: consumerPid || 'unknown', code, reason: [reason] });
}

export function transferError(providerPid: string, consumerPid: string, code: string, reason: string): Record<string, unknown> {
    return dspBody('TransferError', { providerPid: providerPid || 'unknown', consumerPid: consumerPid || 'unknown', code, reason: [reason] });
}

export function catalogError(code: string, reason: string): Record<string, unknown> {
    return dspBody('CatalogError', { code, reason: [reason] });
}

/**
 * Does this path take a dataspace credential instead of a node session? The global auth middleware
 * (auth/middleware.ts) leaves the Authorization header of these paths to the DSP verifier
 * (./verifier.ts): a DCP token is a JWT this node did not sign, which it would otherwise answer 401.
 */
export function takesDataspaceCredential(path: string): boolean {
    return path === DSP_PATH || path.startsWith(`${DSP_PATH}/`);
}

/** A consumer callback address with a process path after it: `<callback>/<what>/<pid>/<action>`. */
export function callbackUrl(callbackAddress: string, what: 'negotiations' | 'transfers', pid: string, action: string): string {
    let base = callbackAddress;
    while (base.endsWith('/')) base = base.slice(0, -1);
    // A pid is an IRI: its colons stay as they are (the TCK and EDC send them raw); anything a path
    // segment cannot hold is escaped.
    const seg = pid.replace(/[^A-Za-z0-9:._~-]/g, c => encodeURIComponent(c));
    return `${base}/${what}/${seg}/${action}`;
}

/** The record with one more history entry, the oldest dropped past MAX_HISTORY. */
export function withHistory<T extends { history: HistoryEntry[]; updatedAt: string }>(rec: T, entry: Omit<HistoryEntry, 'at'>): T {
    const at = new Date().toISOString();
    return { ...rec, updatedAt: at, history: [...rec.history, { at, ...entry }].slice(-MAX_HISTORY) };
}

/** Negotiation transitions a message makes, by the state it is in. Null: the transition is not allowed. */
export function negotiationNext(state: NegotiationState, msg: 'counter' | 'accepted' | 'verification' | 'termination'): NegotiationState | null {
    if (NEGOTIATION_TERMINAL.includes(state)) return null;
    switch (msg) {
        case 'counter': return state === 'OFFERED' ? 'REQUESTED' : null;
        case 'accepted': return state === 'OFFERED' ? 'ACCEPTED' : null;
        case 'verification': return state === 'AGREED' ? 'VERIFIED' : null;
        case 'termination': return 'TERMINATED';
    }
}

/** Transfer transitions a consumer message makes. Null: not allowed. */
export function transferNext(state: TransferState, msg: 'start' | 'completion' | 'suspension' | 'termination'): TransferState | null {
    if (TRANSFER_TERMINAL.includes(state)) return null;
    switch (msg) {
        // A consumer starts only to resume a suspended transfer; the first start is the provider's.
        case 'start': return state === 'SUSPENDED' ? 'STARTED' : null;
        case 'completion': return state === 'STARTED' ? 'COMPLETED' : null;
        case 'suspension': return state === 'STARTED' ? 'SUSPENDED' : null;
        case 'termination': return 'TERMINATED';
    }
}
