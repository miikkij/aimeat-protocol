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
 *   - `inPerson` and `isPerson`: isOwnerInPerson(), the rule requireScope bypasses scopes on. Two
 *     names for one answer: `inPerson` is the name its readers had before 2026-11-04.
 *   - `via`: how the credential arrived (session, pat, agent-token, app-grant, ecosystem, unattended,
 *     federated, anonymous).
 *   - `reader`: the reader kind classification asks (human, ai, anonymous).
 *   - `payer` and `asker`: who pays for an AI call this caller asks for, and the identity the call
 *     names (the one answer aiPayerOf and aiAskerOf gave).
 *   - `has(word)`: requireScope's answer for one word: the owner in person, or the word covered.
 *   - `operator(word)`: isOperatorCaller(), asked once per word and kept.
 *   - `auth` and `principalView`: the two shapes services take, from the same facts.
 *
 *   Each answer comes from services/caller-facts.ts, the one function per question (codebase
 *   analysis 2026-11-03, item B1). A path that holds only an identity string (a job, a schedule, an
 *   MCP tool group without the session's caller) asks principalCaller(principal) there for the same
 *   payer and asker.
 *
 *   REST builds it through callerOf(req) (middleware/caller.ts), once per request. An MCP session
 *   defines it once in register-all.ts (agentSessionCaller) and hands the tool groups a getter that
 *   builds it per call, because the session's scopes are the current request's and can narrow.
 * @structure CallerContext · callerFromAuth(auth, nodeId, storage) · agentSessionCaller(gaii, owner, scopes, nodeId, storage) ·
 *   principalCaller(principal) (re-exported from caller-facts.ts)
 * @usage const caller = callerFromAuth(req.auth!, config.nodeId, storage); if (!caller.has('memory:write')) …
 * @version-history
 *   v1.1.0 — 2026-11-04 — `via`, `isPerson`, `reader`, `payer` and `asker`, answered by
 *     services/caller-facts.ts; an auth object built by hand without roles, scopes or owner is read
 *     as empty lists rather than thrown on, as the AI doors that now read `payer` took it
 *     (codebase analysis 2026-11-03, item B1).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C9).
 */
import type { Storage } from '../storage/interface.js';
import { isForeignPrincipal, isOwnerInPerson, resolveIdentity, localAccountName } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { isOperatorCaller } from './operator-override.js';
import {
    credentialKind, credentialVia, readerOf, principalCaller,
    type AiPayer, type CallerKind, type CallerVia, type ReaderKind,
} from './caller-facts.js';

export type { AiPayer, CallerKind, CallerVia, ReaderKind, PrincipalCaller, PrincipalKind } from './caller-facts.js';
export { principalCaller } from './caller-facts.js';

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
    /** 'pat' on a credential made from a personal access token (auth/jwt.ts); read only for `via`. */
    via?: string;
}

export interface CallerContext {
    /** resolveIdentity(): the GHII, GAII or GEAI a record is stored and read under. */
    readonly principal: string;
    /** The account name the caller acts in (the token's owner). */
    readonly owner: string;
    /** That account as a GHII on this node. */
    readonly ownerGhii: string;
    readonly kind: CallerKind;
    /** The account holder in person: requireScope's bypass (isOwnerInPerson). The same answer as `isPerson`. */
    readonly inPerson: boolean;
    /** The owner or operator in person, an owner-level PAT included (isOwnerInPerson; Jouni, 2026-11-04). */
    readonly isPerson: boolean;
    /** How the credential arrived (caller-facts.ts credentialVia). Decides nothing by itself. */
    readonly via: CallerVia;
    /** Who reads, as classification asks it (caller-facts.ts readerOf; readerKindOf answers the same). */
    readonly reader: ReaderKind;
    /** Who pays for an AI call this caller asks for (caller-facts.ts payerOfPrincipal of `principal`; aiPayerOf answers the same). */
    readonly payer: AiPayer;
    /** The identity an AI call of this caller names: the agent's GAII, the ecosystem app's GEAI, or the payer. */
    readonly asker: string;
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

/** The caller of a verified token (REST) or of a session's own facts (MCP). */
export function callerFromAuth(auth: CallerAuth, nodeId: string, storage: Storage): CallerContext {
    // A verified token always carries both lists (auth/jwt.ts defaults scopes to []); an auth object
    // built by hand may leave one out, and the doors that read only the payer took it until 2026-11-04.
    const roles = [...(auth.roles ?? [])];
    const scopes = [...(auth.scopes ?? [])];
    const inPerson = isOwnerInPerson(auth);
    const principal = resolveIdentity({
        sub: auth.sub, owner: auth.owner, roles,
        ...(auth.federated !== undefined ? { federated: auth.federated } : {}),
        ...(auth.homeNode !== undefined ? { homeNode: auth.homeNode } : {}),
    }, nodeId);
    const owner = auth.owner;
    const ownerGhii = owner?.includes('@') ? owner : `${owner}@${nodeId}`;
    const asked = new Map<string, Promise<boolean>>();
    const authView = {
        sub: auth.sub, owner, roles, scopes,
        ...(auth.federated !== undefined ? { federated: auth.federated } : {}),
    };
    const { payer, asker } = principalCaller(principal);
    return {
        principal, owner, ownerGhii, kind: credentialKind(auth), inPerson, isPerson: inPerson,
        via: credentialVia(auth), reader: readerOf(auth), payer, asker,
        visitor: isForeignPrincipal(auth), roles, scopes,
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
