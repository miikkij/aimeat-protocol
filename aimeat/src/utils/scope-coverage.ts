/**
 * @file src/utils/scope-coverage.ts
 * @description "Does this principal already hold that scope?" — the one place that answers it,
 *   including the scopes a wildcard deliberately does NOT carry.
 *
 *   `requireScope` treats `*` and `{domain}:*` as covering everything beneath them, and for almost
 *   every scope that is right. `memory:write-reserved` is the exception: it hands over the keys the
 *   server itself trusts (the AI-provider URL a decrypted key is sent to, the spend cap, the public
 *   profile), so `hasWriteReserved` tests the EXACT string — "Full access" is one click and nobody
 *   clicking it is deciding that.
 *
 *   That exception only holds if every gate agrees about it. Two did not, and both were reachable
 *   by an agent with no owner involved at all:
 *
 *   - `aimeat_operator_agent_configure` skipped its narrow-only check entirely when the TARGET held
 *     `*` (`added.length > 0 && !granted.has('*')`), on the reasoning that a `*` agent cannot gain
 *     anything. That reasoning was true until exactly one scope stopped being covered by `*`. An
 *     agent proposed `['*','memory:write-reserved']` for itself, minted the confirm token and
 *     consumed it in the next call — the token binds to the caller, so the "show this to the owner"
 *     step is instruction text, not a gate.
 *   - the device-auth same-owner auto-approve skipped its escalation filter for a `*` approver, and
 *     its coverage test read `memory:*` as covering `memory:write-reserved`.
 *
 *   Neither was an escalation before this scope existed. Both were, the moment it did.
 * @structure SCOPES_OUTSIDE_WILDCARD · scopeIsCovered(held, scope) · uncoveredScopes(held, wanted)
 * @usage
 *   import { uncoveredScopes } from '../utils/scope-coverage.js';
 *   const added = uncoveredScopes(agent.defaultScopes ?? [], proposed.scopes);
 *   if (added.length > 0) return err(`…${added.join(', ')}`);
 * @version-history
 *   v1.1.0 — 2026-08-11 — ACCOUNT_SECURITY_SCOPE. Out of the wildcard from the day it exists,
 *     because the narrow-only check on the agent-configure surface asks THIS file whether a scope
 *     is already covered: a '*' agent would have been told yes and could have written the word
 *     onto itself, which is the exact path the two cases above describe.
 *   v1.0.0 — 2026-08-08 — Initial, closing the two paths that let an agent grant itself
 *     memory:write-reserved without the owner's tick.
 */

/** The scope an owner grants an agent to write into the owner's own namespace. */
export const WRITE_AS_OWNER_SCOPE = 'memory:write-as-owner';

/**
 * The stronger grant on top of it: also the RESERVED, server-trusted keys — `openrouter.*` (the URL
 * a decrypted AI key is sent to), `ai-usage.*` (the spend cap) and `profile.*` (the public
 * directory). For an agent that administers the account on the owner's behalf.
 */
export const WRITE_RESERVED_SCOPE = 'memory:write-reserved';

/**
 * The doors that decide who can get back INTO the account: the password, the recovery address, the
 * second factor, the identity proof, and deleting or exporting everything. Enforced by
 * requireOwnerPrincipal() in auth/middleware.ts, which admits an owner principal outright and any
 * other principal only on this exact word.
 *
 * It is out of every wildcard for the same reason the reserved-write scope is, only sharper: an
 * agent that can set the password can become the person. Nobody was grandfathered onto it either
 * (services/scope-vocabulary-migration.ts), so an agent holding it was ticked by hand.
 */
export const ACCOUNT_SECURITY_SCOPE = 'account:security';

/**
 * Scopes no wildcard carries — neither `*` nor `{domain}:*`. Only the exact string counts, anywhere
 * a scope is checked, proposed, or approved.
 *
 * The frontend mirror is NOT_IN_WILDCARD in public/views/profile/agents/scope-model.js; the two are
 * asserted to agree in test/unit/agent-scope-model.test.ts. Adding an entry here without adding it
 * there produces a checkbox that lies about what it granted.
 */
/**
 * Eight tool calls the HTTP door reserves to an owner session and the tool surface let an agent
 * make on an ordinary permission. Each is either the owner's money or who else sees the owner's
 * data: the seller's Stripe credentials, the AI budget and the models it routes to, rewriting an
 * agent's own permissions, the sharing groups that decide who reads memory, the roster of a shared
 * board, and recording a beneficiary as payable.
 *
 * The answer is not to shut the agent out — an agent should be able to do what a person can. It is
 * that each of these costs its own tick, and no wildcard carries it. "Full access" is one click,
 * and nobody clicking it is deciding that an agent may repoint their payouts.
 *
 * Every agent that could already reach one of these tools was handed the new word at boot, once, by
 * services/scope-vocabulary-migration.ts, so nothing lost a capability it had.
 */
const OWN_TICK_SCOPES = [
    'commerce:psp',            // write or destroy the seller's payment credentials
    'commerce:beneficiary-verify', // record a beneficiary as verified, i.e. as payable
    'agent:permissions',       // rewrite an agent's granted permissions
    'consent:groups',          // create a sharing group, add or remove who is in it
    'share:manage',            // hand another account a standing right to read part of the owner's memory
    'social:members',          // change who may read a shared board
] as const;

export const SCOPES_OUTSIDE_WILDCARD: readonly string[] =
    [WRITE_RESERVED_SCOPE, ACCOUNT_SECURITY_SCOPE, ...OWN_TICK_SCOPES];

/** True when `scope` is one of the scopes only an exact grant can confer. */
export function isOutsideWildcard(scope: string): boolean {
    return SCOPES_OUTSIDE_WILDCARD.includes(scope);
}

/**
 * Does a principal holding `held` already have `scope`?
 *
 * Same rules as requireScope — the global wildcard, the domain wildcard, or the exact string — with
 * the one deliberate exception above, where only the exact string counts.
 */
export function scopeIsCovered(held: readonly string[], scope: string): boolean {
    if (held.includes(scope)) return true;
    if (isOutsideWildcard(scope)) return false;
    if (held.includes('*')) return true;
    const domain = scope.split(':')[0];
    return !!domain && held.includes(`${domain}:*`);
}

/**
 * Which of `wanted` this principal does NOT already hold. Empty means the request grants nothing
 * new, which is what a narrow-only surface requires before it applies anything.
 */
export function uncoveredScopes(held: readonly string[], wanted: readonly string[]): string[] {
    return wanted.filter(s => !scopeIsCovered(held, s));
}
