/**
 * @file src/services/consent-write.ts
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
 *   - grantConsent() / revokeConsent() — the whole sequence, gate first
 * @usage
 *   const out = await grantConsent({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
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

export interface ConsentCaller {
    /** The GHII the consent belongs to, already resolved from the session. */
    ownerGaii: string;
    scopes: string[];
    roles: string[];
}

export interface ConsentGrantInput {
    recipient: string;
    dataPattern: string;
    purpose: string;
    scope: ConsentRecord['scope'];
    /** Absolute ISO expiry, or null for indefinite. */
    expires?: string | null;
    metadata?: Record<string, unknown>;
}

export type ConsentResult<T> =
    | { ok: true; value: T }
    | { ok: false; status: number; code: string; message: string };

/** Does this session carry the scope, allowing for the wildcard forms the middleware accepts? */
function hasScope(scopes: string[], needed: string): boolean {
    if (scopes.includes('*') || scopes.includes(needed)) return true;
    return scopes.includes(`${needed.split(':')[0]}:*`);
}

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

/** Grant one consent. The order is REST's order, which is the one with the audit entry in it. */
export async function grantConsent(
    deps: { storage: Storage; config: AimeatConfig; onDirectoryChange?: () => void },
    caller: ConsentCaller,
    input: ConsentGrantInput,
): Promise<ConsentResult<ConsentRecord>> {
    const { storage, onDirectoryChange } = deps;

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

    const existing = await storage.listConsents(caller.ownerGaii);
    if (existing.length >= CONSENT_QUOTA) {
        return {
            ok: false, status: 413, code: 'QUOTA_EXCEEDED',
            message: `Maximum ${CONSENT_QUOTA} consent records per owner`,
        };
    }

    const now = new Date().toISOString();
    const consent = await storage.createConsent({
        id: randomUUID(),
        ownerGaii: caller.ownerGaii,
        dataPattern: input.dataPattern,
        recipient: input.recipient,
        purpose: input.purpose,
        scope: input.scope,
        expires: input.expires ?? null,
        status: 'active',
        grantedAt: now,
        revokedAt: null,
        ...(input.metadata ? { metadata: input.metadata } : {}),
    });

    // The trail that answers "who was given access to what, and when". The MCP door wrote nothing
    // here, so a consent granted by an agent was invisible to it.
    await auditDataAccess(storage, consent.id, caller.ownerGaii, consent.recipient, consent.dataPattern, 'grant', true);

    if (consent.scope === 'federation' && onDirectoryChange) onDirectoryChange();
    emitChange('consent');

    // Giving someone access to your data is exactly the kind of thing you want a durable record of,
    // and the audit trail above is the operator's copy rather than the person's.
    void recordAccountEvent(storage, {
        ownerGhii: caller.ownerGaii,
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
    deps: { storage: Storage; config: AimeatConfig; onDirectoryChange?: () => void },
    caller: ConsentCaller,
    consentId: string,
): Promise<ConsentResult<{ id: string; revokedAt: string }>> {
    const { storage, onDirectoryChange } = deps;

    const denied = gate(caller);
    if (denied) return denied;

    const consent = await storage.getConsent(consentId);
    if (!consent) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Consent not found: ${consentId}` };
    }
    if (consent.ownerGaii !== caller.ownerGaii) {
        return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Only the consent owner can revoke' };
    }

    const now = new Date().toISOString();
    await storage.updateConsent(consentId, { status: 'revoked', revokedAt: now });
    await auditDataAccess(storage, consentId, consent.ownerGaii, consent.recipient, consent.dataPattern, 'revoke', true);

    if (consent.scope === 'federation' && onDirectoryChange) onDirectoryChange();
    emitChange('consent');
    void recordAccountEvent(storage, {
        ownerGhii: consent.ownerGaii,
        kind: 'consent_revoked',
        actorGaii: caller.ownerGaii,
        subject: consent.id,
        link: '/v1/profile?tab=datawallet',
        data: { who: consent.recipient, what: consent.dataPattern },
    }, deps.config);

    logger.debug('consent revoked', { consentId, owner: consent.ownerGaii });
    return { ok: true, value: { id: consentId, revokedAt: now } };
}
