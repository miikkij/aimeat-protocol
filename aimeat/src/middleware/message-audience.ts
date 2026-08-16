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

/**
 * FAMILIES, for the long tail. 232 of the codes in this node appear once or twice, and naming each
 * one by hand would produce a map nobody can read and everybody stops updating. A suffix carries
 * real meaning here — `*_NOT_FOUND` is always the caller pointing at something that is not there,
 * `*_FAILED` is always something breaking rather than refusing — so the pattern answers for the tail
 * and an exact entry always wins over it.
 */
const AUDIENCE_PATTERNS: ReadonlyArray<readonly [RegExp, MessageAudience]> = [
    // The caller named something that is not there, or sent something the parser cannot use.
    [/_NOT_FOUND$|^NOT_FOUND_|_MISMATCH$|^MISSING_|_MALFORMED$|^MALFORMED_/, 'machine'],
    [/^INVALID_/, 'machine'],
    // Something broke rather than refused.
    [/_FAILED$|_ERROR$|_TIMEOUT$|^NO_ENCRYPTION|_UNAVAILABLE$/, 'ours'],
];

/** Who hears this. Unknown codes are assumed to reach a person — see the note in the file header. */
export function audienceOf(code: string): MessageAudience {
    const exact = AUDIENCE_BY_CODE[code];
    if (exact) return exact;
    for (const [re, audience] of AUDIENCE_PATTERNS) if (re.test(code)) return audience;
    return 'person';
}

/**
 * WHERE SOMEBODY GOES NEXT, when the message itself does not say.
 *
 * THE NUMBER THAT MADE THIS. Of 855 messages a person hears and does not yet read well, 696 fail on
 * ONE thing: they never say what to do. The English is fine — "Action \"x\" already exists for this
 * agent" is a perfectly good sentence — it just stops. Fixing that as 696 separate edits would take
 * weeks and drift immediately; almost all of them share a code, and a code almost always has the
 * same answer. So the answer lives once, here, and error() reaches for it when a route has not
 * supplied something better.
 *
 * A route that knows more SHOULD still pass its own: the specific fix comes first, this is the
 * floor. And the floor is deliberately generic — a wrong specific instruction is worse than an
 * honest general one, so nothing here claims to know which name is free or how much you need.
 */
export const NEXT_STEP_BY_CODE: Readonly<Record<string, string>> = Object.freeze({
    // Someone else's, or not yours yet
    FORBIDDEN: 'If you need this, ask the person who owns it to share it with you.',
    ACCESS_DENIED: 'If you need this, ask the person who owns it to share it with you.',
    NOT_MEMBER: 'Ask to be let into this space, and whoever runs it can add you.',
    // Permission the owner has not granted this assistant
    SCOPE_DENIED: 'You can turn this on for your assistant in Profile → Agents.',
    INVALID_SCOPES: 'You can choose what your assistant may do in Profile → Agents.',
    INSUFFICIENT_ROLE: 'You can turn this on for your assistant in Profile → Agents.',
    DATA_AREA_DENIED: 'You can widen what this app may reach in Profile → Apps.',
    POLICY_DENIED: 'You can change this in your settings, or ask whoever runs this node.',
    RESERVED_KEY: 'This one is managed in your own settings rather than by an assistant.',
    // Nobody is signed in
    AUTH_REQUIRED: 'Sign in and try again.',
    UNAUTHORIZED: 'Sign in and try again.',
    // Money and size
    QUOTA_EXCEEDED: 'Remove something you no longer need, or ask for more room.',
    PAYMENT_REQUIRED: 'Top up your balance and this will go through.',
    INSUFFICIENT_MORSELS: 'Top up your balance, or try a smaller version of this.',
    TOO_LARGE: 'Try a smaller file, or split it into parts.',
    SIZE_EXCEEDED: 'Try a smaller file, or split it into parts.',
    COMPONENT_LIMIT_EXCEEDED: 'Remove one you are not using, and this will fit.',
    // Already there
    CONFLICT: 'Open the existing one, or choose a different name.',
    ALREADY_EXISTS: 'Open the existing one, or choose a different name.',
    NAME_TAKEN: 'Choose a different name and try again.',
    EMAIL_TAKEN: 'Sign in with this address instead, or use another one.',
    ALREADY_RESOLVED: 'This one is finished. Start a new one if you need to.',
    // Someone changed it underneath
    VERSION_CONFLICT: 'Open it again to see the newer version, then make your change.',
    WRITE_CONFLICT: 'Open it again to see the newer version, then make your change.',
    // The moment has passed, or has not come
    INVALID_STATE: 'Check where this is now — what you can do next depends on it.',
    ARCHIVED: 'This one is closed. Start a new one if you still need it.',
    DISPUTE_CLOSED: 'This one is closed. Start a new one if you still need it.',
    EXPIRED: 'Start again and you will get a fresh one.',
    STATE_EXPIRED: 'Start again and you will get a fresh one.',
    INVALID_CHECKOUT: 'Start the purchase again.',
    // Sign-in security
    WEAK_PASSWORD: 'Choose a longer one and try again.',
    INVALID_TOTP: 'Check the code in your app and try again.',
    INVALID_CODE: 'Ask for a new code and try again.',
    TOO_MANY_ATTEMPTS: 'Wait a few minutes and try again.',
    // Switched off here
    FEATURE_DISABLED: 'Ask whoever runs this node whether it can be turned on.',
    EXTENSION_INACTIVE: 'Turn it on in Profile → Extensions, then try again.',
    USAGE_TERMS_REQUIRED: 'Read the terms and accept them, then this will go through.',
    NOT_FEDERATED: 'This node does not talk to that one yet.',
    // Ours, and somebody else's
    INTERNAL_ERROR: 'This one is on us. It is already reported, and trying again often works.',
    INTERNAL: 'This one is on us. It is already reported, and trying again often works.',
    UPDATE_FAILED: 'This one is on us. It is already reported — try again in a moment.',
    IMPORT_FAILED: 'This one is on us. It is already reported — try again in a moment.',
    ZIP_ERROR: 'This one is on us. It is already reported — try again in a moment.',
    ENCRYPTION_NOT_CONFIGURED: 'This one is on us, and whoever runs this node has been told.',
    FEDERATION_ERROR: 'The other node did not answer. Not your doing — try again shortly.',
    FEDERATION_PROXY_ERROR: 'The other node did not answer. Not your doing — try again shortly.',
    FEDERATION_UNREACHABLE: 'The other node is not reachable right now. Try again shortly.',
    FEDERATION_AUTH_FAILED: 'The two nodes could not agree on who you are. Whoever runs them can fix it.',
    PROVIDER_ERROR: 'The service behind this did not answer. Not your doing — try again shortly.',
    OPENROUTER_ERROR: 'The AI service did not answer. Not your doing — try again shortly.',
});

/**
 * The same families, for where somebody goes next.
 *
 * These are the most general sentences in the file and that is on purpose: a family answer cannot
 * know the particulars, and a confidently wrong instruction wastes somebody's afternoon in a way a
 * vague true one never does. Each still beats the alternative, which is "View API documentation".
 */
const NEXT_STEP_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/_DISABLED$|^NO_[A-Z_]+_CONFIGURED$|_NOT_CONFIGURED$|_NOT_ENABLED$|_NOT_SETUP$/,
        'This is not switched on here. Whoever runs this node can turn it on.'],
    [/_EXPIRED$|^SESSION_/, 'Start again and you will get a fresh one.'],
    [/^ALREADY_|_ALREADY_/, 'This one is already done. Start a new one if you need to.'],
    [/_TOO_LARGE$|_TOO_LOW$|_LIMIT_EXCEEDED$|^CONTENT_TOO_|_EXCEEDED$/,
        'Try a smaller one, or ask for more room.'],
    [/_REQUIRED$/, 'Do that part first and then come back to this.'],
    [/^RATE_LIMITED$|^TOO_MANY_/, 'Wait a moment and try again.'],
    [/^INSUFFICIENT_|^BUDGET_|^PURCHASE_|^PAYMENT_/, 'Top up your balance, or try a smaller version of this.'],
    [/_FAILED$|_ERROR$|_TIMEOUT$/, 'This one is on us. It is already reported — try again in a moment.'],
    [/^NOT_|_GONE$|_REVOKED$|_CLOSED$/, 'This one is not available. Whoever owns it can tell you more.'],
];

/** The floor a person is given when the message itself does not say where to go. */
export function nextStepFor(code: string): string | undefined {
    const exact = NEXT_STEP_BY_CODE[code];
    if (exact) return exact;
    for (const [re, step] of NEXT_STEP_PATTERNS) if (re.test(code)) return step;
    return undefined;
}
