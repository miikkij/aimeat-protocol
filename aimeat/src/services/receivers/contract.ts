/**
 * @file src/services/receivers/contract.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The receiver (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht,
 *   ruled 2026-11-07): an address and a key of an owner through which an outside program (a Lambda, a
 *   home sensor, a CRM export) writes into exactly ONE place of the owner's data over plain REST, with
 *   no agent, no MCP and no session. This file is the pure half: the record shape, the identity
 *   string, the names, the limits and the input checks. The calls that read and write receivers are
 *   ./store.ts, ./manage.ts and ./receive.ts.
 *
 *   THE IDENTITY STRING is `receiver:<owner>/<name>@<node>`, the form of the outside party
 *   (services/parties/contract.ts) and for the same reason: every parser of this node reads
 *   `x#alice@node` as one of alice's OWN principals (ownerGhiiOf, isSameOwner, the consent and
 *   members checks), so a receiver written that way would pass as alice's agent. With the prefix and
 *   the slash no parser reads it as a local principal, and provenance names the program, not the owner.
 *
 *   THE ADDRESS is `/v1/receive/<owner>/<name>[/<sub>]`. The owner is in the path so the node finds the
 *   receiver with one read and keeps no node-wide index; the key alone is not enough to find it.
 *
 *   THE KEY is `aimeat_rcv_` and 32 random bytes in base64url, shown once and stored as its SHA-256
 *   (the party key code in services/parties/keys.ts, reused). The prefix lets the global auth
 *   middleware recognise it without verifying it, so a receiver key is never read as a session and is
 *   answered 401 on every route that does not take one (auth/middleware.ts).
 *
 *   EXACTLY ONE TARGET, decided when the receiver is made and never taken from a request: one memory
 *   key of the owner, one key prefix (the program names the last segment in the address), or one row
 *   space of an organism workspace the owner belongs to.
 * @structure RECEIVER_RECORD_PREFIX · RECEIVER_LOG_PREFIX · RECEIVER_KEY_PREFIX · RECEIVERS_READ_SCOPE ·
 *   RECEIVERS_MANAGE_SCOPE · RECEIVER_NAME_RE · RECEIVER_SUB_RE · MAX_RECEIVERS · RECEIVER_DEFAULTS ·
 *   RECEIVER_MAXIMA · RECEIVER_VERBS · ReceiverTarget · ReceiverSchema · ReceiverRecord · ReceiverState ·
 *   receiverPrincipalOf · parseReceiverPrincipal · isReceiverPrincipal · validateReceiverName ·
 *   validateReceiverSub · normalizeReceiverInput · effectiveState · keyHoldersOf · receiverView ·
 *   takesReceiverKey · verbOfMethod · parseReceiver
 * @usage const ref = receiverPrincipalOf('alice', 'ruuvi', config.nodeId);   // receiver:alice/ruuvi@node
 * @version-history
 *   v1.2.1 — 2026-11-08 — The validation messages say incoming webhook where they said receiver
 *     (secaudit2026nov08b round 15b).
 *   v1.2.0 — 2026-11-08 — ReceiverRecord.keyAnsweredTo and previousKey.answeredTo: who was answered a
 *     key that still works; keyHoldersOf, and the view's `key_holders` (secaudit2026nov08b round 15,
 *     rotated-key-holder-not-surfaced).
 *   v1.1.0 — 2026-11-08 — ReceiverRecord.stoppedFrom: the state an operator's stop replaced
 *     (secaudit2026nov08 round 14, start-drops-owner-pause).
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */

/** One record per receiver in the owner's service namespace (services/service-records.ts): `receivers.<name>`. */
export const RECEIVER_RECORD_PREFIX = 'receivers.';

/**
 * The delivery log and counters of one receiver: `receiver-log.<name>`, a separate record so the
 * batched counter writes (./deliveries.ts) never write over a key rotation or a stop made meanwhile.
 */
export const RECEIVER_LOG_PREFIX = 'receiver-log.';

/** The prefix of a receiver key. */
export const RECEIVER_KEY_PREFIX = 'aimeat_rcv_';

/** Read the owner's receivers, their deliveries, and propose a new one. Inside the wildcard family. */
export const RECEIVERS_READ_SCOPE = 'receivers:read';

/**
 * Create, change, pause, rotate and delete a receiver. OUTSIDE every wildcard, as party:manage and
 * secrets:manage are: handing a program a key that writes into the person's data is not something
 * "Full access" decides. Defined in utils/scope-coverage.ts, the one list of such words.
 */
export { RECEIVERS_MANAGE_SCOPE } from '../../utils/scope-coverage.js';

/** A receiver name: a slug, unique per owner. */
export const RECEIVER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * The last segment a program names for a prefix target. No dot, so the program cannot name a key
 * outside the prefix ("ruuvit" + "x.y" would be a sibling family), and no slash or percent sign.
 */
export const RECEIVER_SUB_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Names the receiver routes use as path segments under /v1/receivers. */
export const RESERVED_RECEIVER_NAMES: readonly string[] = ['proposals'];

/** The most receivers one owner holds. */
export const MAX_RECEIVERS = 50;

/** What a receiver gets when its maker names no limit. */
export const RECEIVER_DEFAULTS = Object.freeze({
    perMinute: 60,
    perDay: 5000,
    maxBytes: 64 * 1024,
    prefixMaxKeys: 50,
    expiresDays: 365,
    rotateOverlapMinutes: 15,
});

/** The most a receiver may be given. maxBytes stays under the 1024 kB value ceiling of a memory record. */
export const RECEIVER_MAXIMA = Object.freeze({
    perMinute: 600,
    perDay: 100_000,
    maxBytes: 1000 * 1024,
    prefixMaxKeys: 500,
    expiresDays: 730,
    rotateOverlapMinutes: 24 * 60,
});

/**
 * What a program may do through a receiver. `write` is POST and PUT and is always on; the others
 * are chosen by the owner, and each reaches only the receiver's own target.
 */
export const RECEIVER_VERBS = ['write', 'merge', 'read', 'delete'] as const;
export type ReceiverVerb = typeof RECEIVER_VERBS[number];

/** The HTTP method's verb, or null for a method a receiver does not take. */
export function verbOfMethod(method: string): ReceiverVerb | null {
    switch (method.toUpperCase()) {
        case 'POST': case 'PUT': return 'write';
        case 'PATCH': return 'merge';
        case 'GET': case 'HEAD': return 'read';
        case 'DELETE': return 'delete';
        default: return null;
    }
}

/** The visibility a receiver gives the memory records it writes. Never public: that is the owner's own act. */
export type ReceiverWriteVisibility = 'private' | 'owner' | `organism:${string}`;

export type ReceiverTarget =
    | { kind: 'key'; key: string }
    | { kind: 'prefix'; prefix: string; maxKeys: number }
    | { kind: 'space'; organismId: string; ws: string; space: string };

/**
 * The shape the receiver checks every message against: the CSM it was made with, the version, the
 * compiled JSON schema as it was then, and the schema's hash. Kept as a copy, so a later change to the
 * CSM does not change what the receiver accepts until the owner moves it to the new version.
 */
export interface ReceiverSchema {
    csm: string;
    version: number;
    hash: string;
    jsonSchema: Record<string, unknown>;
}

export type ReceiverState = 'proposed' | 'awaiting_operator' | 'active' | 'paused' | 'stopped';

/** One receiver, as its record holds it. */
export interface ReceiverRecord {
    /** Made at creation and never reused. */
    uid: string;
    name: string;
    displayName: string;
    description?: string;
    target: ReceiverTarget;
    /** Null: the receiver takes any JSON (the base checks of the write path still apply). */
    schema: ReceiverSchema | null;
    verbs: ReceiverVerb[];
    limits: { perMinute: number; perDay: number; maxBytes: number };
    /** The visibility of the memory records it writes (not used for a row space). */
    visibility: ReceiverWriteVisibility;
    state: ReceiverState;
    /** SHA-256 of the key; null while proposed (no key exists before the owner approves). */
    keyHash: string | null;
    keyId: string | null;
    /** The key a rotation replaced, accepted until `until`, and the principal it had been answered to. */
    previousKey?: { hash: string; id: string; until: string; answeredTo?: string | null } | null;
    createdAt: string;
    /** The principal that made or proposed it. */
    createdBy: string;
    /**
     * The principal the current key was answered to in plain text: whoever made the receiver, the owner
     * who approved a proposal, or whoever rotated the key. Absent on a key made before 2026-11-08
     * (secaudit2026nov08b round 15, rotated-key-holder-not-surfaced).
     */
    keyAnsweredTo?: string | null;
    approvedAt?: string | null;
    expiresAt: string;
    keyRotatedAt?: string | null;
    pausedAt?: string | null;
    stoppedAt?: string | null;
    stopReason?: string | null;
    /**
     * The state the operator's stop replaced, so the operator's start returns to it: the owner's pause
     * stays until the owner lifts it. Absent on a receiver stopped before 2026-11-08, which starts as
     * it did then (active when it has a key).
     */
    stoppedFrom?: ReceiverState | null;
    /** The operator's decision when the node asks one (receivers.mode = operator). */
    operatorDecision?: { decision: 'approve' | 'refuse'; at: string; by: string; reason?: string } | null;
}

/** `receiver:<owner>/<name>@<node>`, the principal a receiver writes as. */
export function receiverPrincipalOf(owner: string, name: string, nodeId: string): string {
    return `receiver:${owner}/${name}@${nodeId}`;
}

const OWNER_PART_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const NODE_PART_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/;

/** The parts of a receiver principal, or null when the string is not one. */
export function parseReceiverPrincipal(ref: string): { owner: string; name: string; node: string } | null {
    if (typeof ref !== 'string' || !ref.startsWith('receiver:')) return null;
    const rest = ref.slice('receiver:'.length);
    const at = rest.lastIndexOf('@');
    if (at <= 0) return null;
    const node = rest.slice(at + 1);
    const ownerName = rest.slice(0, at);
    const slash = ownerName.indexOf('/');
    if (slash <= 0 || ownerName.indexOf('/', slash + 1) !== -1) return null;
    const owner = ownerName.slice(0, slash);
    const name = ownerName.slice(slash + 1);
    if (!OWNER_PART_RE.test(owner) || !RECEIVER_NAME_RE.test(name) || !NODE_PART_RE.test(node)) return null;
    return { owner, name, node };
}

/** Is this string a receiver principal? */
export function isReceiverPrincipal(value: unknown): value is string {
    return typeof value === 'string' && parseReceiverPrincipal(value) !== null;
}

/** Null when `name` is a receiver name, else the reason it is not. */
export function validateReceiverName(name: unknown): string | null {
    if (typeof name !== 'string' || !RECEIVER_NAME_RE.test(name)) {
        return 'An incoming webhook\'s name is 1 to 40 characters: lowercase letters, digits and dashes, starting with a letter or a digit.';
    }
    if (RESERVED_RECEIVER_NAMES.includes(name)) return `"${name}" is a word the incoming webhook routes use. Choose another name.`;
    return null;
}

/** Null when `sub` may name a key under a prefix target, else the reason it may not. */
export function validateReceiverSub(sub: unknown): string | null {
    if (typeof sub !== 'string' || !RECEIVER_SUB_RE.test(sub)) {
        return 'The last part of the address is 1 to 64 characters: lowercase letters, digits, dashes and underscores, starting with a letter or a digit. It names one memory key under the incoming webhook\'s prefix.';
    }
    return null;
}

/** A memory key prefix or key as a receiver may target it: dotted lowercase segments. */
const TARGET_KEY_RE = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*){0,7}$/;
const ORGANISM_VIS_RE = /^organism:[A-Za-z0-9-]{1,64}$/;

/** The input that makes or proposes a receiver, before the schema is resolved (./manage.ts does that). */
export interface ReceiverCreateInput {
    name: string;
    displayName?: string;
    description?: string;
    target: ReceiverTarget;
    /** The CSM's name, or null for a receiver that takes any JSON. */
    csm: string | null;
    csmVersion?: number;
    verbs: ReceiverVerb[];
    limits: { perMinute: number; perDay: number; maxBytes: number };
    visibility: ReceiverWriteVisibility;
    expiresDays: number;
}

function intIn(v: unknown, dflt: number, max: number, label: string): number | string {
    if (v === undefined || v === null || v === '') return dflt;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > max) return `${label} is a whole number from 1 to ${max}.`;
    return n;
}

/**
 * Turn a request body (the REST body and the MCP tool's input take the same snake_case fields, and no
 * other spelling, so the two cannot drift) into a ReceiverCreateInput, or the reason it is not one.
 * Exactly one of `target.key`, `target.prefix` or `target.space` (with organism_id and ws) must be given.
 */
export function normalizeReceiverInput(body: Record<string, unknown>): ReceiverCreateInput | string {
    const nameErr = validateReceiverName(body.name);
    if (nameErr) return nameErr;
    const t = (body.target && typeof body.target === 'object' ? body.target : {}) as Record<string, unknown>;
    const given = ['key', 'prefix', 'space'].filter(k => t[k] !== undefined && t[k] !== null && t[k] !== '');
    if (given.length !== 1) {
        return 'target names exactly one place: { key }, { prefix } or { organism_id, ws, space }.';
    }
    let target: ReceiverTarget;
    if (given[0] === 'key') {
        if (typeof t.key !== 'string' || !TARGET_KEY_RE.test(t.key)) return 'target.key is a memory key of dotted lowercase parts, such as "ruuvit.olohuone".';
        target = { kind: 'key', key: t.key };
    } else if (given[0] === 'prefix') {
        const prefix = typeof t.prefix === 'string' ? t.prefix.replace(/\.\*?$/, '') : '';
        if (!TARGET_KEY_RE.test(prefix)) return 'target.prefix is a key prefix of dotted lowercase parts, such as "ruuvit"; the program names the last part.';
        const maxKeys = intIn(t.max_keys, RECEIVER_DEFAULTS.prefixMaxKeys, RECEIVER_MAXIMA.prefixMaxKeys, 'target.max_keys');
        if (typeof maxKeys === 'string') return maxKeys;
        target = { kind: 'prefix', prefix, maxKeys };
    } else {
        const organismId = t.organism_id;
        const ws = t.ws;
        const space = t.space;
        if (typeof organismId !== 'string' || !organismId || typeof ws !== 'string' || !ws || typeof space !== 'string' || !space) {
            return 'A row space target names organism_id, ws and space.';
        }
        target = { kind: 'space', organismId, ws, space };
    }
    const csm = body.csm;
    if (csm !== undefined && csm !== null && (typeof csm !== 'string' || !csm || csm.length > 200)) return 'csm is the name of a CSM, or leave it out to take any JSON.';
    const csmVersion = body.csm_version;
    if (csmVersion !== undefined && csmVersion !== null && !(Number.isInteger(csmVersion) && (csmVersion as number) > 0)) return 'csm_version is a version number of the CSM.';
    const rawVerbs = Array.isArray(body.verbs) ? body.verbs : ['write'];
    if (!rawVerbs.every(v => (RECEIVER_VERBS as readonly unknown[]).includes(v))) return `verbs are some of ${RECEIVER_VERBS.join(', ')}.`;
    const verbs = Array.from(new Set(['write', ...rawVerbs])) as ReceiverVerb[];
    const l = (body.limits && typeof body.limits === 'object' ? body.limits : {}) as Record<string, unknown>;
    const perMinute = intIn(l.per_minute, RECEIVER_DEFAULTS.perMinute, RECEIVER_MAXIMA.perMinute, 'limits.per_minute');
    if (typeof perMinute === 'string') return perMinute;
    const perDay = intIn(l.per_day, RECEIVER_DEFAULTS.perDay, RECEIVER_MAXIMA.perDay, 'limits.per_day');
    if (typeof perDay === 'string') return perDay;
    const maxBytes = intIn(l.max_bytes, RECEIVER_DEFAULTS.maxBytes, RECEIVER_MAXIMA.maxBytes, 'limits.max_bytes');
    if (typeof maxBytes === 'string') return maxBytes;
    const expiresDays = intIn(body.expires_days, RECEIVER_DEFAULTS.expiresDays, RECEIVER_MAXIMA.expiresDays, 'expires_days');
    if (typeof expiresDays === 'string') return expiresDays;
    const vis = body.visibility ?? 'private';
    if (vis !== 'private' && vis !== 'owner' && !(typeof vis === 'string' && ORGANISM_VIS_RE.test(vis))) {
        return 'visibility is "private", "owner" or "organism:<id>". An incoming webhook never writes public records: making data public is the owner\'s own act.';
    }
    const displayName = typeof body.display_name === 'string' ? body.display_name : undefined;
    if (displayName !== undefined && displayName.length > 120) return 'display_name is at most 120 characters.';
    const description = typeof body.description === 'string' ? body.description : undefined;
    if (description !== undefined && description.length > 500) return 'description is at most 500 characters.';
    return {
        name: body.name as string,
        ...(displayName ? { displayName } : {}),
        ...(description ? { description } : {}),
        target, csm: (csm as string | undefined) ?? null,
        ...(csmVersion ? { csmVersion: csmVersion as number } : {}),
        verbs, limits: { perMinute, perDay, maxBytes },
        visibility: vis as ReceiverWriteVisibility, expiresDays,
    };
}

/** The state as a program meets it now: an active receiver past its end reads as expired. */
export function effectiveState(r: ReceiverRecord, now = Date.now()): ReceiverState | 'expired' {
    if ((r.state === 'active' || r.state === 'paused') && Date.parse(r.expiresAt) <= now) return 'expired';
    return r.state;
}

/** The stored value, read defensively: null for anything that is not a receiver record. */
export function parseReceiver(v: unknown): ReceiverRecord | null {
    if (!v || typeof v !== 'object') return null;
    const r = v as ReceiverRecord;
    if (typeof r.uid !== 'string' || typeof r.name !== 'string' || !r.target || typeof r.target !== 'object') return null;
    if (!Array.isArray(r.verbs) || !r.limits || typeof r.state !== 'string' || typeof r.expiresAt !== 'string') return null;
    return r;
}

/** The address a program calls. */
export function receiverAddress(baseUrl: string, owner: string, name: string): string {
    return `${baseUrl.replace(/\/$/, '')}/v1/receive/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/**
 * The principals that were answered a key of this receiver that still works: the current key's, and
 * the replaced key's while its overlap lasts. A key made before 2026-11-08 names no one here; its
 * maker is `createdBy`.
 */
export function keyHoldersOf(r: Pick<ReceiverRecord, 'keyHash' | 'keyAnsweredTo' | 'previousKey'>, now = Date.now()): string[] {
    const holders = new Set<string>();
    if (r.keyHash && r.keyAnsweredTo) holders.add(r.keyAnsweredTo);
    const prev = r.previousKey;
    if (prev?.answeredTo && Date.parse(prev.until) > now) holders.add(prev.answeredTo);
    return [...holders];
}

/** What a receiver looks like to its owner and the owner's agents: no key hash. */
export function receiverView(r: ReceiverRecord, owner: string, nodeId: string, baseUrl: string, log?: {
    lastDeliveryAt: string | null; lastRefusalAt: string | null; failedAttempts: number; today: number; refusedToday: number;
} | null): Record<string, unknown> {
    const t = r.target;
    return {
        name: r.name,
        uid: r.uid,
        principal: receiverPrincipalOf(owner, r.name, nodeId),
        display_name: r.displayName,
        ...(r.description ? { description: r.description } : {}),
        address: receiverAddress(baseUrl, owner, r.name),
        target: t.kind === 'key' ? { kind: 'key', key: t.key }
            : t.kind === 'prefix' ? { kind: 'prefix', prefix: t.prefix, max_keys: t.maxKeys }
                : { kind: 'space', organism_id: t.organismId, ws: t.ws, space: t.space },
        schema: r.schema ? { csm: r.schema.csm, version: r.schema.version, hash: r.schema.hash } : null,
        verbs: r.verbs,
        limits: { per_minute: r.limits.perMinute, per_day: r.limits.perDay, max_bytes: r.limits.maxBytes },
        visibility: r.visibility,
        state: effectiveState(r),
        has_key: !!r.keyHash,
        key_id: r.keyId,
        ...(r.previousKey ? { previous_key_until: r.previousKey.until } : {}),
        created_at: r.createdAt,
        created_by: r.createdBy,
        key_holders: keyHoldersOf(r),
        approved_at: r.approvedAt ?? null,
        expires_at: r.expiresAt,
        key_rotated_at: r.keyRotatedAt ?? null,
        ...(r.state === 'stopped' ? { stopped_at: r.stoppedAt ?? null, stop_reason: r.stopReason ?? null } : {}),
        ...(r.operatorDecision ? { operator_decision: r.operatorDecision } : {}),
        ...(log ? {
            last_delivery_at: log.lastDeliveryAt, last_refusal_at: log.lastRefusalAt,
            failed_attempts: log.failedAttempts, delivered_today: log.today, refused_today: log.refusedToday,
        } : {}),
    };
}

/** The routes that take a receiver key. Everything else answers a receiver key 401. */
const RECEIVE_PATH_RE = /^\/v1\/receive\/[^/]+\/[^/]+(?:\/[^/]+)?\/?$/;

/** Does this endpoint take a receiver key? */
export function takesReceiverKey(method: string, path: string): boolean {
    return verbOfMethod(method) !== null && RECEIVE_PATH_RE.test(path);
}
