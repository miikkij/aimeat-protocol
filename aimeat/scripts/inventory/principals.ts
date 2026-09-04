/**
 * @file scripts/inventory/principals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which classes of caller a guard chain admits.
 *
 *   A door is not open or shut. It is open to a SET, and the set is what a leak is a member of —
 *   which is why the inventory computes it rather than recording "has a guard: yes". The reachable
 *   set is derived from the middleware chain, and two things about this codebase make the derivation
 *   non-obvious enough to be worth stating rather than assumed:
 *
 *   1. `optionalAuth()` IS MOUNTED GLOBALLY (server.ts:152). Every route runs it. So a route with no
 *      guard of its own is not merely "unauthenticated": in anonymous mode it is reached with
 *      `req.auth` SET, carrying the node's anonymous owner name. That is security invariant 6, and
 *      it is the reason `anonymous-identity` is its own class here rather than folded into
 *      `unauthenticated`. A gate written as `if (!req.auth)` admits it.
 *   2. `req.auth.owner` CARRIES THE HUMAN'S NAME for an agent JWT, an app-grant token and an
 *      ecosystem token alike (invariant 11). So `requireRole('owner')` does not mean "a person":
 *      only `requireOwnerPrincipal()` does. The two are different rows in the table below and the
 *      difference is the whole of invariant 11.
 *
 *   Unknown guard names are recorded rather than ignored. A guard this file has never heard of makes
 *   the row's principal set UNKNOWN, which is a question in the report — not a pass. A table that
 *   silently treats what it does not recognise as harmless is how the thing it was built to find
 *   gets past it.
 * @structure PRINCIPALS · GUARD_EFFECTS · principalsFor(guards) · scopesFrom(guards)
 * @usage const { principals, unknown } = principalsFor(['requireAuth()', "requireScope('memory:write')"]);
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-invarianttiauditointi, phase 1).
 */

/** Every class of caller that can arrive at a door. Order is widest-reach first. */
export const PRINCIPALS = [
    /** No credential at all. */
    'unauthenticated',
    /**
     * No credential, but the node runs in anonymous mode, so optionalAuth injected an identity:
     * req.auth is SET and carries the node's anonymous owner. Invariant 6.
     */
    'anonymous-identity',
    /** A person's own session (GHII). */
    'owner',
    /** A person's own session that also holds the operator role. */
    'operator',
    /** An agent token (GAII), limited to the scopes its owner granted. */
    'agent',
    /** An app grant: role 'app', fenced to scopes and data areas, wearing the owner's name. */
    'app',
    /** An ecosystem app (GEAI), writing into its own eco: namespace. */
    'ecosystem',
] as const;

export type Principal = typeof PRINCIPALS[number];

/** Everything that is not a person sitting at a screen — the set invariant 11 is about. */
const NON_HUMAN: Principal[] = ['agent', 'app', 'ecosystem'];
/** Everything that presented a real credential. */
const AUTHENTICATED: Principal[] = ['owner', 'operator', ...NON_HUMAN];

/**
 * The middleware that constitutes an explicit authorization decision — the one answer to "does this
 * door decide who may act", read by every gate that needs it.
 *
 * WHY IT LIVES HERE. Until 2026-09-04 there were two answers. `check-route-scopes.ts` carried seven
 * names in a local const; this module's GUARD_EFFECTS below knew those and four more, because it was
 * written later against the whole tree. Two gates in one repo disagreeing about what counts as
 * authorization is the same defect class they exist to catch, and the disagreement cost exactly one
 * door — small, and worth removing anyway, because the next reader would have had to work out which
 * list was right.
 *
 * `requireAuth` is deliberately NOT here: it answers "is anyone there", never "may this principal do
 * this". Nor is `requireLocalSession`, which cuts on federated versus local rather than on what the
 * caller may do. The four that joined the original seven:
 *   requireOperatorPrincipal   the operator in person, plus a scope word
 *   requireExternalPrincipal   owner/operator/agent/ecosystem — the class filter that stops an app grant
 *   requireOwnerSession        the owner's own browser session, not a token acting for them
 *   workspaceAccess(Middleware) per-row organism membership, which is authorization by another name
 */
export const AUTHORIZATION_GATES = [
    'requireScope', 'requireAnyScope', 'requireRole', 'requireRoleOrScope', 'requireOperator',
    'requireOwnerPrincipal', 'requireScimConnection', 'requireOperatorPrincipal',
    'requireExternalPrincipal', 'requireOwnerSession', 'workspaceAccess', 'workspaceAccessMiddleware',
];

/**
 * What each guard does to the reachable set: it narrows it to `admits`, and may demand scopes.
 *
 * `rateLimit` and friends narrow nothing — they are listed so an unrecognised name stays meaningful.
 * A guard absent from this table makes the row unknown rather than open.
 */
export const GUARD_EFFECTS: Record<string, { admits: Principal[] | null; note?: string }> = {
    // ── Narrowing gates ──
    requireAuth: { admits: AUTHENTICATED, note: 'a real credential; the anonymous identity is refused here' },
    requireOwnerPrincipal: { admits: ['owner', 'operator'], note: 'a person, not something acting in their name (invariant 11)' },
    requireOperatorPrincipal: { admits: ['operator'], note: 'the operator in person, plus the named scope' },
    requireRole: { admits: null, note: 'depends on the role argument; resolved by roleArgument()' },
    requireRoleOrScope: { admits: null, note: 'role OR any of the scopes; resolved by roleArgument()' },
    requireScope: { admits: AUTHENTICATED, note: 'narrows by scope word, not by principal class' },
    requireAnyScope: { admits: AUTHENTICATED, note: 'any ONE of the named scopes; two principals reach the same route by different trust' },
    /**
     * A scoped external principal: agent OR ecosystem app, with owner and operator also passing
     * because they act for their own. A deliberate superset of requireRole('agent').
     */
    requireExternalPrincipal: { admits: ['owner', 'operator', 'agent', 'ecosystem'] },
    /** The owner's own browser session on the welcome mat, not a token acting in their name. */
    requireOwnerSession: { admits: ['owner', 'operator'] },
    /**
     * Refuses a FEDERATED session and nothing else, so it narrows no class in this table — the
     * axis it cuts on is where the session came from, not what the caller is. Recorded so it is
     * not mistaken for unknown, and named here because "does not narrow" is a claim worth writing
     * down rather than leaving to whoever reads the row next.
     */
    requireLocalSession: { admits: null, note: 'cuts on federated vs local, not on principal class' },

    // ── Not gates. Present so they are not mistaken for unknown. ──
    /** Serves only on the apex host; a host check, not a caller check. */
    apexOnly: { admits: null, note: 'host, not caller' },
    /** Refuses while the node is still starting. */
    requireReadiness: { admits: null, note: 'node lifecycle, not caller' },
    requireNotLb: { admits: null, note: 'load-balancer probe filter, not caller' },
    /** Membership of the addressed workspace — an ownership check inside the row, not a class. */
    workspaceAccess: { admits: null, note: 'per-row membership, not principal class' },
    workspaceAccessMiddleware: { admits: null, note: 'per-row membership, not principal class' },
    loginTarpit: { admits: null },
    aiRateLimit: { admits: null },
    registrationLimit: { admits: null },
    webhookLimit: { admits: null },
    sendLimit: { admits: null },
    createLimit: { admits: null },
    checkLimit: { admits: null },
    orRateLimit: { admits: null },
    hashLookupRateLimit: { admits: null },
    resolveRateLimit: { admits: null },
    declareRateLimit: { admits: null },
    limitPersonSaves: { admits: null },
    /** Body parsers. */
    raw: { admits: null },
    zipBody: { admits: null },
    optionalAuth: { admits: null, note: 'resolves an identity, refuses nobody — never a gate (invariant 6)' },
    rateLimit: { admits: null },
    adminAuthLimit: { admits: null },
    validateBody: { admits: null },
    express: { admits: null },
};

/** `requireRole('operator')` → the classes that role names. */
function fromRole(role: string): Principal[] {
    if (role === 'operator') return ['operator'];
    if (role === 'owner') return ['owner', 'operator'];
    if (role === 'agent') return ['agent'];
    if (role === 'app') return ['app'];
    if (role === 'ecosystem') return ['ecosystem'];
    return AUTHENTICATED;
}

export interface GuardCall {
    /** The middleware's name, e.g. `requireScope`. */
    name: string;
    /** Its string-literal arguments, e.g. ['memory:write']. */
    args: string[];
}

export interface PrincipalResult {
    principals: Principal[];
    /** Guards this file does not recognise. A non-empty list makes the row a question. */
    unknown: string[];
    /** Scope words the chain demands. */
    scopes: string[];
}

/**
 * The set a chain admits.
 *
 * Starts from EVERYTHING, including the two unauthenticated classes, because that is what a route
 * with no guard of its own actually gets — optionalAuth having already run for the whole app. Each
 * recognised gate intersects the set down.
 */
export function principalsFor(guards: GuardCall[]): PrincipalResult {
    let set: Principal[] = [...PRINCIPALS];
    const unknown: string[] = [];
    const scopes: string[] = [];

    for (const guard of guards) {
        const effect = GUARD_EFFECTS[guard.name];
        if (effect === undefined) {
            unknown.push(guard.name);
            continue;
        }
        if (guard.name === 'requireScope' || guard.name === 'requireRoleOrScope') scopes.push(...guard.args);
        if (guard.name === 'requireOperatorPrincipal') scopes.push(...guard.args.filter(a => a.includes(':')));

        let admits = effect.admits;
        if (guard.name === 'requireRole' && guard.args[0]) admits = fromRole(guard.args[0]);
        if (guard.name === 'requireRoleOrScope' && guard.args[0]) {
            // role OR scope, so the set is the role's classes UNION everyone who could hold a scope.
            admits = [...new Set([...fromRole(guard.args[0]), ...AUTHENTICATED])];
        }
        if (admits === null) continue;
        set = set.filter(p => admits.includes(p));
    }

    return { principals: set, unknown: [...new Set(unknown)], scopes: [...new Set(scopes)] };
}

/** True when a door is reachable without any credential — the row a leak is usually on. */
export function isPublic(principals: Principal[]): boolean {
    return principals.includes('unauthenticated') || principals.includes('anonymous-identity');
}
