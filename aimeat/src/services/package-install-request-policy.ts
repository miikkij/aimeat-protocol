/**
 * @file src/services/package-install-request-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may decide a package install request, and when a request stops being decidable.
 *   Pure: no storage, no clock of its own, so the rule is one function a unit test can hold.
 *
 *   THE RULE IS DEVICE AUTHORIZATION'S. routes/agents/device-auth.ts lets an agent of the same owner
 *   settle an agent's registration only when the approver holds the word for making agents and every
 *   scope it would pass on: an approver cannot grant beyond its own scopes. Here the same: the owner
 *   in person decides anything; an agent of the owner may approve only when it is NOT the one that
 *   asked and holds packages:write (approving an install is installing it) and every word the install
 *   needs of an agent writing the owner's memory. It may decline anything it did not ask for, because
 *   declining grants nothing. An app grant, an ecosystem app and a visitor from another node decide
 *   nothing: an app grant is consent to use the account, not to answer for it.
 *
 *   WHY THE AGENT'S OWN NEED, NOT ONLY THE REQUESTER'S `missing`. An app grant lacking memory:write
 *   records `missing: ['memory:write']`, because its own namespace is the owner's. An agent approving
 *   it is enabling a write into the owner's namespace from outside it, which is memory:write AND
 *   memory:write-as-owner at the memory door. Checking the requester's words alone would let an agent
 *   approve a write it could not make itself.
 *
 *   A REQUEST IS DECIDABLE FOR SEVEN DAYS, AND FAILS CLOSED. An expiry that is missing or cannot be
 *   read counts as passed, so a damaged record can only be declined by time, never approved.
 * @structure INSTALL_REQUEST_DAYS · InstallRequestDecider · decisionRefusal(decider, request,
 *   decision) · requestExpired(request, now)
 * @usage
 *   const refusal = decisionRefusal(decider, request, 'approve');
 *   if (refusal) return refusal;
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial: package installs by agents become requests.
 */
import { ownerBypassesScopes, uncoveredScopes, WRITE_AS_OWNER_SCOPE } from '../utils/scope-coverage.js';
import { isForeignPrincipal } from '../utils/gaii.js';

/** How long a request waits for a decision. */
export const INSTALL_REQUEST_DAYS = 7;

/** The word every install door asks, and so the one an approver needs to be installing at all. */
export const INSTALL_WORD = 'packages:write';

/** Who is deciding: the session's own identity, in the terms every door can supply. */
export interface InstallRequestDecider {
    /** The principal: an agent's GAII, the owner's name for an owner session, the owner's GHII for an app grant. */
    sub: string;
    /** The bare account name the principal acts for. */
    owner: string;
    roles: string[];
    scopes: string[];
    federated?: boolean;
}

/** What the policy reads of a request. */
export interface DecidableRequest {
    requested_by: { principal: string; kind: 'agent' | 'app'; sub: string };
    missing: string[];
}

export type DecisionRefusal = { status: 403; code: 'ACCESS_DENIED' | 'OWN_REQUEST' | 'SCOPE_DENIED'; message: string };

/** Where the owner answers a request, in the words an agent can pass on to them. */
export const OWNER_APPROVES_ON_THE_PAGE =
    'The owner can approve it on their Notifications page, or from the notification itself.';

/**
 * Why this decider may not make this decision, or null when it may. The owner in person is never
 * refused here; whether the request is still decidable at all (settled, expired, changed underneath)
 * is the caller's to ask after this.
 */
export function decisionRefusal(
    decider: InstallRequestDecider,
    request: DecidableRequest,
    decision: 'approve' | 'decline',
): DecisionRefusal | null {
    if (ownerBypassesScopes(decider)) return null;
    const roles = decider.roles ?? [];
    const isAgent = roles.includes('agent') && !roles.includes('ecosystem') && !roles.includes('app') && !isForeignPrincipal(decider);
    if (!isAgent) {
        return {
            status: 403, code: 'ACCESS_DENIED',
            message: 'An install request is decided by the account holder or by one of their own agents. An app or a visitor may ask, not answer.',
        };
    }
    if (decider.sub === request.requested_by.principal || decider.sub === request.requested_by.sub) {
        return {
            status: 403, code: 'OWN_REQUEST',
            message: `You asked for this install, so you cannot ${decision} it yourself. ${OWNER_APPROVES_ON_THE_PAGE}`,
        };
    }
    if (decision === 'decline') return null;

    // Approving is installing, into the owner's memory, from outside the owner's namespace.
    const needed = [...new Set([INSTALL_WORD, ...request.missing, 'memory:write', WRITE_AS_OWNER_SCOPE])];
    const beyond = uncoveredScopes(decider.scopes ?? [], needed);
    if (beyond.length === 0) return null;
    return {
        status: 403, code: 'SCOPE_DENIED',
        message: `Approving this install writes into the owner's memory, which takes ${beyond.map(s => `"${s}"`).join(' and ')}, `
            + `and you do not hold ${beyond.length === 1 ? 'it' : 'them'}. An agent cannot pass on more than it holds. ${OWNER_APPROVES_ON_THE_PAGE}`,
    };
}

/** True when the request can no longer be decided. A missing or unreadable expiry counts as passed. */
export function requestExpired(request: { expires_at?: unknown }, now: number): boolean {
    const at = typeof request.expires_at === 'string' ? Date.parse(request.expires_at) : NaN;
    return !(Number.isFinite(at) && now < at);
}
