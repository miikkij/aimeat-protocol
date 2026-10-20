/**
 * @file src/services/consent-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Granting and revoking a consent, once, for every surface that can do it.
 *
 *   WHY THIS FILE EXISTS. `POST /v1/consent` and `aimeat_consent_grant` are the same capability, and
 *   they had drifted in three ways that all matter for a record whose whole job is to say who may
 *   read somebody's data:
 *
 *     - REST validates the recipient against seven accepted shapes; the MCP tool accepted any
 *       string, so an agent could store a consent naming a recipient no access check will ever
 *       match — a grant that reads as permission in the list and grants nothing, or worse, matches
 *       more than the owner meant.
 *     - REST writes an audit entry for every grant and revoke; the MCP tool wrote none, so a
 *       consent changed through an agent left no trace in the trail that exists to answer "who was
 *       given access to what, and when".
 *     - REST refreshes the federation directory when a `federation`-scoped consent changes; the MCP
 *       tool did not, so a grant made by an agent stayed invisible to peers until something else
 *       happened to trigger a refresh.
 *
 *   One capability, one implementation, whatever the interface — CLAUDE.md, Backend.
 * @structure
 *   - VALID_RECIPIENT_PATTERNS — the seven shapes a recipient may take
 *   - CONSENT_PUBLISH_KIND — the publish-request kind a consent to everyone is filed as
 *   - grantConsent() / revokeConsent() — the whole sequence, gate first
 * @usage
 *   const out = await grantConsent({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   2026-10-20 — A consent whose recipient is `*` asks the publish gate (services/publish-gate.ts),
 *     the same question a raise to public asks: a scoped agent without publish:public files a
 *     request for the owner and nothing is opened. The only gate was consent:manage, which every
 *     wildcard scope carries, so the same world-readable state had two doors with two permission
 *     words (secaudit 2026-10, grantConsent:wildcard-recipient-skips-publish-gate).
 *   2026-10-20 — The member-directory refresh is notifyDirectoryChange() (services/directory.ts),
 *     not the optional onDirectoryChange only the REST route passed: a federation consent revoked
 *     through aimeat_consent_revoke left the person listed (secaudit 2026-10,
 *     consent-write:revoke-directory-refresh-optional).
 *   2026-10-15 — A grant stamps metadata.collection_method from ConsentCaller.collectionMethod, which
 *     the consent receipt reads (feature-list audit #161).
 *   2026-10-15 — The consent_granted and consent_revoked account events go to the owner's GHII (ownerGhiiOf) on both REST and MCP; the consent record keeps the identity it was filed under (feature-list audit #44).
 *   v1.3.0 — 2026-10-15 — accountHoldsConsent and listAccountConsents: a consent is the account's on both
 *     doors, and revokeConsent admits the account for a consent filed under one of its agents
 *     (feature-list audit 40).
 *   v1.2.0 — 2026-10-12 — The reach is decided here for both surfaces (Core 2026-11 AUTHZ-18): `local`,
 *     `federation` or `auth`; `private` and `dmz` are stored as `local`, counted and named on the
 *     response; an absent reach is `federation` before 4.0.0 and `local` from it (utils/consent-reach.ts).
 *   v1.1.1 — 2026-10-05 — hasScope is scopeIsCovered (secaudit 2026-10, C3).
 *   v1.1.0 — 2026-08-11 — Security audit H-2: the owner/operator bypass in gate() now excludes agent
 *     and ecosystem sessions, matching requireScope. Agent tokens carried the owner's roles until
 *     today, so the bypass applied to principals whose consent:manage the owner had withheld.
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit step 3, option B: shared service, gate inside).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ConsentRecord } from '../storage/interface.js';
import { auditDataAccess } from './consent.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';
import { recordAccountEvent } from './account-events.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { isSameOwner, localAccountName, localAccountOf, ownerGhiiOf } from '../utils/gaii.js';
import {
    CONSENT_REACH_ALIAS_REMOVED_IN, CONSENT_REACH_INPUTS, consentReachOf, defaultConsentReach, isConsentReachAlias,
} from '../utils/consent-reach.js';
import { noteDeprecatedUse, removedFrom } from './deprecation.js';
import { COLLECTION_METHOD_KEY } from './mydata-receipt.js';
import { notifyDirectoryChange } from './directory.js';
import { callerFromAuth } from './caller-context.js';
import { fileAsk, publishAskOf, publishRequestedBody } from './publish-requests/ask.js';

/** Max consent records per owner. Shared so the two doors cannot disagree about the ceiling. */
export const CONSENT_QUOTA = 100;

/**
 * The shapes a recipient may take. Anything else is a grant that no access check will match, which
 * is worse than a refusal: it sits in the owner's list looking like permission.
 */
export const VALID_RECIPIENT_PATTERNS = [
    /^\*$/,                      // everyone
    /^organism\.\S+$/,           // an organism
    /^ghii:\S+@\S+$/,            // one person
    /^domain:\S+$/,              // a domain glob
    /^node:\S+$/,                // one node
    /^[^*][^:]*#[^@]+@.+$/,      // one agent  (agent#owner@node)
    /^[^#@*:]+@[^@]+$/,          // one owner  (owner@node)
];

/**
 * Whether the account `account` (a person's GHII) holds the consent filed under `consentOwner`: it is
 * filed under the account itself, or under one of the account's agents. A consent is the account's
 * whichever door filed it; REST filed an agent's under the agent's GAII until 2026-10-15, and those
 * rows stay the account's to see and revoke (feature-list audit 40).
 */
export function accountHoldsConsent(account: string, consentOwner: string): boolean {
    return consentOwner === account || (!account.includes('#') && isSameOwner(consentOwner, account));
}

/** The account's consents: those filed under it and under any of its agents, oldest rows included. */
export async function listAccountConsents(
    storage: Storage, account: string, opts: { status?: 'active' | 'revoked' | 'expired'; recipient?: string } = {},
): Promise<ConsentRecord[]> {
    const own = await storage.listConsents(account, opts);
    const name = localAccountName(account);
    const agents = name && !account.includes('#') ? await storage.getAgentsByOwner(name) : [];
    const theirs = (await Promise.all(agents.map(a => storage.listConsents(a.gaii, opts)))).flat();
    return [...own, ...theirs];
}

export interface ConsentCaller {
    /** The GHII the consent belongs to, already resolved from the session. */
    ownerGaii: string;
    scopes: string[];
    roles: string[];
    /**
     * How the consent is being given, in the receipt's words (consentCollectionMethod in
     * services/mydata-receipt.ts). Stamped as metadata.collection_method on a grant; a caller's own
     * metadata cannot set that key (feature-list audit #161).
     */
    collectionMethod?: string;
}

export interface ConsentGrantInput {
    recipient: string;
    dataPattern: string;
    purpose: string;
    /**
     * The reach as the caller sent it: `local`, `federation`, `auth`, or the deprecated `private` and
     * `dmz`, which are stored as `local`. Absent: defaultConsentReach() for the running version.
     */
    scope?: string;
    /** Absolute ISO expiry, or null for indefinite. */
    expires?: string | null;
    metadata?: Record<string, unknown>;
}

export type ConsentResult<T> =
    | { ok: true; value: T }
    | {
        ok: false; status: number; code: string; message: string;
        /**
         * Set with code PUBLISH_REQUESTED: nothing was granted, and the owner has been asked. A door
         * that wants to show more than the message reads the request id and the approve address here.
         */
        publishRequest?: ReturnType<typeof publishRequestedBody>;
    };

/** What a consent to everyone is filed as while it waits for the owner (publish-requests/). */
export const CONSENT_PUBLISH_KIND = 'consent' as const;

/** The recipient that means everyone, the anonymous reader included. */
const EVERYONE = '*';

/** The deps every write here takes. */
export interface ConsentWriteDeps {
    storage: Storage;
    config: AimeatConfig;
    /**
     * No longer read. The member-directory refresh is notifyDirectoryChange() (services/directory.ts),
     * which runs whoever made the change: the REST route passed this callback and the MCP tool and the
     * expiry job did not, so a person who withdrew through their AI stayed listed. Still accepted so
     * the callers that pass it compile; remove the argument when each of them is next touched.
     */
    onDirectoryChange?: () => void;
}

/** Does this session carry the scope? scopeIsCovered, the rule requireScope applies (C3). */
const hasScope = (scopes: string[], needed: string): boolean => scopeIsCovered(scopes, needed);

type ConsentRefusal = Extract<ConsentResult<never>, { ok: false }>;

function gate(caller: ConsentCaller): ConsentRefusal | null {
    // The owner/operator bypass, and the exclusion requireScope carries with it: an agent or
    // ecosystem session is a SCOPED principal and never rides its owner's role, whatever else its
    // role list says. The exclusion was missing (audit H-2), and POST /v1/auth/token was copying the
    // owner's owner/operator roles onto agent tokens, so an agent without consent:manage could
    // still rewrite who may read the owner's data, which is the one record whose whole job is to
    // answer that question.
    const scopedPrincipal = caller.roles.includes('agent') || caller.roles.includes('ecosystem');
    const privileged = !scopedPrincipal
        && (caller.roles.includes('owner') || caller.roles.includes('operator'));
    if (privileged || hasScope(caller.scopes, 'consent:manage')) return null;
    return {
        ok: false, status: 403, code: 'SCOPE_DENIED',
        message: 'Changing who may read your data needs the "consent:manage" permission, which this session does not carry.',
    };
}

/**
 * Everyone-readable is everyone-readable whichever door opens it, so a consent whose recipient is
 * `*` asks the publish gate that a raise to public asks (services/publish-gate.ts). The owner in
 * person passes, an agent or app holding publish:public passes, and anything else files a request
 * for the owner and grants nothing. Null when the consent may go ahead.
 *
 * `consent:manage` alone is not that permission: it is inside every wildcard scope, and
 * `publish:public` is deliberately outside all of them (utils/scope-coverage.ts).
 */
async function wildcardPublishRefusal(
    deps: ConsentWriteDeps, caller: ConsentCaller, input: ConsentGrantInput, reach: string,
): Promise<Extract<ConsentResult<never>, { ok: false }> | null> {
    if (input.recipient !== EVERYONE) return null;
    const ctx = { storage: deps.storage, config: deps.config };
    // An identity of another node names no account here (localAccountOf), and the gate has nobody
    // on this node to ask for it, so it is told so rather than asked about.
    const foreign = localAccountOf(caller.ownerGaii) === null;
    const gateCaller = callerFromAuth({
        sub: caller.ownerGaii, owner: localAccountName(ownerGhiiOf(caller.ownerGaii)),
        roles: [...caller.roles], scopes: [...caller.scopes], federated: foreign,
    }, deps.config.nodeId, deps.storage);
    const ask = publishAskOf(ctx, gateCaller);
    if (ask.kind === 'allowed') return null;
    if (ask.kind === 'refused') return { ok: false, status: ask.status, code: ask.code, message: ask.message };

    const filed = await fileAsk(ctx, gateCaller.owner, ask.requester, {
        kind: CONSENT_PUBLISH_KIND,
        target: {
            namespace: caller.ownerGaii, pattern: input.dataPattern, purpose: input.purpose, reach,
            ...(input.expires ? { expires: input.expires } : {}),
        },
        title: `the records matching ${input.dataPattern}, to anyone`,
        name: input.dataPattern,
        change: { field: 'recipient', from: null, to: EVERYONE },
    });
    if (!filed.ok) {
        return {
            ok: false, status: 403, code: 'PUBLISH_NOT_ASKED',
            message: `Nothing was opened, and the owner could not be asked: ${filed.message}`,
        };
    }
    const body = publishRequestedBody(ctx, filed);
    return { ok: false, status: 403, code: 'PUBLISH_REQUESTED', message: body.next_step, publishRequest: body };
}

/** Grant one consent. The order is REST's order, which is the one with the audit entry in it. */
export async function grantConsent(
    deps: ConsentWriteDeps,
    caller: ConsentCaller,
    input: ConsentGrantInput,
): Promise<ConsentResult<ConsentRecord>> {
    const { storage } = deps;

    const denied = gate(caller);
    if (denied) return denied;

    if (!input.dataPattern || !input.recipient || !input.purpose) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'data_pattern, recipient, and purpose are required' };
    }
    if (!VALID_RECIPIENT_PATTERNS.some(p => p.test(input.recipient))) {
        return {
            ok: false, status: 400, code: 'INVALID_RECIPIENT',
            message: 'recipient must be "*", a GAII, or prefixed with "organism.", "ghii:", "domain:", or "node:"',
        };
    }
    // The reach (Core 2026-11 AUTHZ-18): one of three, the two older names stored as `local`, and the
    // default decided by the running version, so a consent made without a reach never makes a record
    // replicable from 4.0.0.
    if (input.scope !== undefined && !(CONSENT_REACH_INPUTS as readonly string[]).includes(input.scope)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'scope (the reach) is "local", "federation" or "auth".' };
    }
    if (isConsentReachAlias(input.scope) && removedFrom(CONSENT_REACH_ALIAS_REMOVED_IN)) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: `The reach "${input.scope}" was removed in ${CONSENT_REACH_ALIAS_REMOVED_IN}; send "local".` };
    }
    if (isConsentReachAlias(input.scope)) {
        noteDeprecatedUse({
            kind: 'consent_reach_alias', removedIn: CONSENT_REACH_ALIAS_REMOVED_IN, successor: 'local',
            notice: `A consent was granted with the reach "${input.scope}", an older name for "local"; it is stored as "local".`,
        });
    }
    const reach = input.scope === undefined ? defaultConsentReach() : consentReachOf(input.scope);

    // Recipient `*` is the anonymous reader too, so it meets the publish gate before anything is
    // stored. Asked here and not at each door, because both doors reach this one function.
    const notOurs = await wildcardPublishRefusal(deps, caller, input, reach);
    if (notOurs) return notOurs;

    const existing = await storage.listConsents(caller.ownerGaii);
    if (existing.length >= CONSENT_QUOTA) {
        return {
            ok: false, status: 413, code: 'QUOTA_EXCEEDED',
            message: `Maximum ${CONSENT_QUOTA} consent records per owner`,
        };
    }

    const now = new Date().toISOString();
    // The node's stamp of how the consent was given wins over anything the caller sent under the
    // same key: the receipt reads it as fact (feature-list audit #161).
    const metadata = caller.collectionMethod
        ? { ...(input.metadata ?? {}), [COLLECTION_METHOD_KEY]: caller.collectionMethod }
        : input.metadata;
    const consent = await storage.createConsent({
        id: randomUUID(),
        ownerGaii: caller.ownerGaii,
        dataPattern: input.dataPattern,
        recipient: input.recipient,
        purpose: input.purpose,
        scope: reach,
        expires: input.expires ?? null,
        status: 'active',
        grantedAt: now,
        revokedAt: null,
        ...(metadata ? { metadata } : {}),
    });

    // The trail that answers "who was given access to what, and when". The MCP door wrote nothing
    // here, so a consent granted by an agent was invisible to it.
    await auditDataAccess(storage, consent.id, caller.ownerGaii, consent.recipient, consent.dataPattern, 'grant', true);

    // A federation consent decides who is in the member directory, so the index hears it from the
    // change itself. It depended on the caller passing onDirectoryChange, which only the REST route did.
    if (consent.scope === 'federation') notifyDirectoryChange();
    emitChange('consent');

    // Giving someone access to your data is exactly the kind of thing you want a durable record of,
    // and the audit trail above is the operator's copy rather than the person's. The feed belongs to
    // the PERSON: REST resolves an agent session to the agent's GAII and the MCP tool to the owner's
    // GHII, so the event is filed under ownerGhiiOf() on both, whichever identity the consent itself
    // is filed under (feature-list audit #44).
    void recordAccountEvent(storage, {
        ownerGhii: ownerGhiiOf(caller.ownerGaii),
        kind: 'consent_granted',
        actorGaii: caller.ownerGaii,
        subject: consent.id,
        link: '/v1/profile?tab=datawallet',
        data: { who: consent.recipient, what: consent.dataPattern },
    }, deps.config);

    return { ok: true, value: consent };
}

/** Revoke one consent. Ownership is checked here rather than by the caller, for the same reason. */
export async function revokeConsent(
    deps: ConsentWriteDeps,
    caller: ConsentCaller,
    consentId: string,
): Promise<ConsentResult<{ id: string; revokedAt: string }>> {
    const { storage } = deps;

    const denied = gate(caller);
    if (denied) return denied;

    const consent = await storage.getConsent(consentId);
    if (!consent) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Consent not found: ${consentId}` };
    }
    if (!accountHoldsConsent(caller.ownerGaii, consent.ownerGaii)) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the consent owner can revoke' };
    }

    const now = new Date().toISOString();
    await storage.updateConsent(consentId, { status: 'revoked', revokedAt: now });
    await auditDataAccess(storage, consentId, consent.ownerGaii, consent.recipient, consent.dataPattern, 'revoke', true);

    // Withdrawing is the half that must not be missed: the person is in the directory with their
    // display name, bio, city and coordinates until the index hears about it.
    if (consent.scope === 'federation') notifyDirectoryChange();
    emitChange('consent');
    void recordAccountEvent(storage, {
        ownerGhii: ownerGhiiOf(consent.ownerGaii),
        kind: 'consent_revoked',
        actorGaii: caller.ownerGaii,
        subject: consent.id,
        link: '/v1/profile?tab=datawallet',
        data: { who: consent.recipient, what: consent.dataPattern },
    }, deps.config);

    logger.debug('consent revoked', { consentId, owner: consent.ownerGaii });
    return { ok: true, value: { id: consentId, revokedAt: now } };
}
