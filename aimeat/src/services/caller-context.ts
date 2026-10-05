/**
 * @file src/services/caller-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is calling, built once (secaudit 2026-10, C9). The questions every route, service
 *   and MCP tool asks about its caller had one answer each by October 2026 (isOwnerInPerson,
 *   isForeignPrincipal, resolveIdentity, scopeIsCovered, isOperatorCaller), and still each call site
 *   assembled its own object to pass them: about sixty caller shapes, and forty-nine MCP handlers that
 *   wrote `roles: ['agent']` and the session's scopes by hand, some forgetting the scopes. This is the
 *   one object, with the answers on it:
 *
 *   - `principal`: resolveIdentity(); the identity a record is stored and read under.
 *   - `owner` / `ownerGhii`: the account the caller acts in.
 *   - `kind`: anonymous, visitor (another node's session), ecosystem, app, agent or owner.
 *   - `inPerson`: isOwnerInPerson(), the rule requireScope bypasses scopes on.
 *   - `has(word)`: requireScope's answer for one word: the owner in person, or the word covered.
 *   - `operator(word)`: isOperatorCaller(), asked once per word and kept.
 *   - `auth` and `principalView`: the two shapes services take, from the same facts.
 *
 *   REST builds it through callerOf(req) (middleware/caller.ts), once per request. An MCP session
 *   defines it once in register-all.ts (agentSessionCaller) and hands the tool groups a getter that
 *   builds it per call, because the session's scopes are the current request's and can narrow.
 * @structure CallerContext · callerFromAuth(auth, nodeId, storage) · agentSessionCaller(gaii, owner, scopes, nodeId, storage)
 * @usage const caller = callerFromAuth(req.auth!, config.nodeId, storage); if (!caller.has('memory:write')) …
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C9).
 */
import type { Storage } from '../storage/interface.js';
import { isForeignPrincipal, isOwnerInPerson, resolveIdentity, localAccountName } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { isOperatorCaller } from './operator-override.js';

/** What a caller is, by the token it holds. */
export type CallerKind = 'anonymous' | 'visitor' | 'ecosystem' | 'app' | 'agent' | 'owner';

/** The token facts a caller is built from: a verified token, or an MCP session's own. */
export interface CallerAuth {
    sub: string;
    owner: string;
    roles: readonly string[];
    scopes: readonly string[];
    anonymous?: boolean;
    federated?: boolean;
    /** A visitor's home node: resolveIdentity names the visitor by it. */
    homeNode?: string;
}

export interface CallerContext {
    /** resolveIdentity(): the GHII, GAII or GEAI a record is stored and read under. */
    readonly principal: string;
    /** The account name the caller acts in (the token's owner). */
    readonly owner: string;
    /** That account as a GHII on this node. */
    readonly ownerGhii: string;
    readonly kind: CallerKind;
    /** The account holder in person: requireScope's bypass (isOwnerInPerson). */
    readonly inPerson: boolean;
    /** A session from another node (isForeignPrincipal). */
    readonly visitor: boolean;
    readonly roles: readonly string[];
    readonly scopes: readonly string[];
    /** requireScope's answer for one word: the owner in person, or a held word that covers it. */
    has(word: string): boolean;
    /** isOperatorCaller() for this caller: an operator account in person, or its agent holding the word. Kept per word. */
    operator(word?: string): Promise<boolean>;
    /** The shape services take as `auth` or `caller`: { sub, owner, roles, scopes, federated? }. */
    readonly auth: { sub: string; owner: string; roles: string[]; scopes: string[]; federated?: boolean };
    /** The shape services take as a principal-led caller: { principal, owner, roles, scopes }. */
    readonly principalView: { principal: string; owner: string; roles: string[]; scopes: string[] };
}

function kindOf(auth: CallerAuth): CallerKind {
    if (auth.anonymous) return 'anonymous';
    if (isForeignPrincipal(auth)) return 'visitor';
    if (auth.roles.includes('ecosystem')) return 'ecosystem';
    if (auth.roles.includes('app')) return 'app';
    if (auth.roles.includes('agent')) return 'agent';
    return 'owner';
}

/** The caller of a verified token (REST) or of a session's own facts (MCP). */
export function callerFromAuth(auth: CallerAuth, nodeId: string, storage: Storage): CallerContext {
    const roles = [...auth.roles];
    const scopes = [...auth.scopes];
    const inPerson = isOwnerInPerson(auth);
    const principal = resolveIdentity({
        sub: auth.sub, owner: auth.owner, roles,
        ...(auth.federated !== undefined ? { federated: auth.federated } : {}),
        ...(auth.homeNode !== undefined ? { homeNode: auth.homeNode } : {}),
    }, nodeId);
    const owner = auth.owner;
    const ownerGhii = owner.includes('@') ? owner : `${owner}@${nodeId}`;
    const asked = new Map<string, Promise<boolean>>();
    const authView = {
        sub: auth.sub, owner, roles, scopes,
        ...(auth.federated !== undefined ? { federated: auth.federated } : {}),
    };
    return {
        principal, owner, ownerGhii, kind: kindOf(auth), inPerson, visitor: isForeignPrincipal(auth), roles, scopes,
        has: (word) => inPerson || scopeIsCovered(scopes, word),
        operator: (word) => {
            const key = word ?? '';
            if (!asked.has(key)) asked.set(key, isOperatorCaller(storage, { ...authView, ...(auth.anonymous ? { anonymous: true } : {}) }, ...(word ? [word] : [])));
            return asked.get(key)!;
        },
        auth: authView,
        principalView: { principal, owner, roles, scopes },
    };
}

/**
 * An MCP session's caller: the connected agent, acting in its owner's account with the session's
 * scopes. Built per tool call, after the handshake has named the agent.
 */
export function agentSessionCaller(agentGaii: string, owner: string, scopes: readonly string[], nodeId: string, storage: Storage): CallerContext {
    return callerFromAuth({ sub: agentGaii, owner: owner || localAccountName(agentGaii), roles: ['agent'], scopes }, nodeId, storage);
}
