/**
 * @file src/middleware/message-audience.ts
 * @description Who hears this error — and therefore what language it has to be in.
 *
 *   THE MEASUREMENT THIS COMES FROM. 2107 messages a caller can see, 297 distinct codes. Treating
 *   them as one problem is why they never got fixed: more than half are never heard by a person at
 *   all, and demanding plain English of those would be busywork that buries the ones that matter.
 *
 *     machine   ~55%  the caller got the call wrong. The AGENT fixes it and retries. Technical
 *                     language is CORRECT here — the reader is a machine, and "field `owner` is
 *                     required" is more useful to it than any sentence a person would prefer.
 *     person    ~28%  only they can decide: a permission, a sign-in, a balance, a name in use.
 *                     This is the group the voice rules are for, and the moment somebody decides
 *                     whether the system is worth the trouble.
 *     ours       ~6%  the node failed. Say so, apologise, and report it ourselves — nobody should
 *                     be asked to describe our bug. See services/system-fault-report.ts.
 *     upstream   ~2%  somebody else's system did not answer. Not the person's doing and not really
 *                     ours either; they hear "not you, we will try again".
 *
 *   A code not listed here is treated as `person`, deliberately. The safe default when we have not
 *   thought about a message is to assume a human reads it, because the cost of being wrong that way
 *   is a sentence that is too kind, and the cost the other way is somebody staring at INVALID_STATE.
 * @structure
 *   - MessageAudience — the four groups
 *   - AUDIENCE_BY_CODE — the classification, by error code
 *   - audienceOf() — the lookup, defaulting to `person`
 * @usage
 *   import { audienceOf } from '../middleware/message-audience.js';
 *   if (audienceOf(code) === 'person') { ...it must read like a sentence... }
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial, from the classification of all 297 codes.
 */

export type MessageAudience = 'machine' | 'person' | 'ours' | 'upstream';

/**
 * THE CALLER GOT THE CALL WRONG. A missing field, an id that does not exist, a body that will not
 * parse. The agent reads this, corrects itself and tries again; the person never needs to know it
 * happened. Precision beats warmth here and the words may be as technical as they need to be.
 */
const MACHINE = [
    'NOT_FOUND', 'INVALID_INPUT', 'VALIDATION_ERROR', 'BAD_REQUEST', 'INVALID_BODY',
    'INVALID_URL', 'SCHEMA_VALIDATION_FAILED', 'PARSE_ERROR', 'INVALID_FILENAME',
    'INVALID_STATUS', 'IMPORT_INVALID', 'MISSING_FIELDS', 'SCHEMA_REQUIRED', 'INVALID_TARGET',
    'AGENT_NOT_FOUND', 'APP_NOT_FOUND', 'ACTION_NOT_FOUND', 'UNKNOWN_TOOL', 'UNKNOWN_PARAMETER',
    'INVALID_SIGNATURE', 'INVALID_ATTESTATION', 'INVALID_TOKEN', 'TOKEN_INVALID',
];

/**
 * ONLY THEY CAN DECIDE. Permission, sign-in, membership, money, a name already taken, a moment that
 * has passed. Every one of these is a QUESTION, and the answer is not ours to give.
 */
const PERSON = [
    'FORBIDDEN', 'ACCESS_DENIED', 'UNAUTHORIZED', 'AUTH_REQUIRED', 'INSUFFICIENT_ROLE',
    'INVALID_SCOPES', 'SCOPE_DENIED', 'DATA_AREA_DENIED', 'POLICY_DENIED', 'NOT_MEMBER',
    'RESERVED_KEY', 'QUOTA_EXCEEDED', 'PAYMENT_REQUIRED', 'INSUFFICIENT_MORSELS',
    'TOO_LARGE', 'SIZE_EXCEEDED', 'COMPONENT_LIMIT_EXCEEDED', 'USAGE_TERMS_REQUIRED',
    'FEATURE_DISABLED', 'EXTENSION_INACTIVE', 'NAME_TAKEN', 'EMAIL_TAKEN', 'ALREADY_EXISTS',
    'CONFLICT', 'VERSION_CONFLICT', 'WRITE_CONFLICT', 'INVALID_STATE', 'ARCHIVED',
    'DISPUTE_CLOSED', 'ALREADY_RESOLVED', 'INVALID_CHECKOUT', 'EXPIRED', 'STATE_EXPIRED',
    'WEAK_PASSWORD', 'INVALID_TOTP', 'INVALID_CODE', 'TOO_MANY_ATTEMPTS', 'NOT_FEDERATED',
];

/** WE BROKE. Kept in step with FAULT_CODES in services/system-fault-report.ts, which reports them. */
const OURS = ['INTERNAL_ERROR', 'INTERNAL', 'UPDATE_FAILED', 'IMPORT_FAILED', 'ZIP_ERROR', 'ENCRYPTION_NOT_CONFIGURED'];

/** SOMEBODY ELSE DID NOT ANSWER. Another node, a payment handler, a model provider. */
const UPSTREAM = [
    'FEDERATION_ERROR', 'FEDERATION_PROXY_ERROR', 'FEDERATION_UNREACHABLE', 'FEDERATION_AUTH_FAILED',
    'PROVIDER_ERROR', 'OPENROUTER_ERROR',
];

export const AUDIENCE_BY_CODE: Readonly<Record<string, MessageAudience>> = Object.freeze({
    ...Object.fromEntries(MACHINE.map(c => [c, 'machine' as const])),
    ...Object.fromEntries(PERSON.map(c => [c, 'person' as const])),
    ...Object.fromEntries(OURS.map(c => [c, 'ours' as const])),
    ...Object.fromEntries(UPSTREAM.map(c => [c, 'upstream' as const])),
});

/** Who hears this. Unknown codes are assumed to reach a person — see the note in the file header. */
export function audienceOf(code: string): MessageAudience {
    return AUDIENCE_BY_CODE[code] ?? 'person';
}
