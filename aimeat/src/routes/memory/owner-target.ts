/**
 * @file src/routes/memory/owner-target.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "Write this into the OWNER's namespace, not mine" — the one place that decides
 *   whether an agent's write is redirected, so POST and PUT cannot drift apart.
 *
 *   Memory is keyed by whoever wrote it: an agent token writes under its own GAII, and no scope
 *   changed that, because scopes decide whether a call is ALLOWED, never where it LANDS. This is the
 *   single deliberate exception, and it is built to the shape the product already uses for the same
 *   idea elsewhere — `messages:send-as-owner`, which lets an agent reply as the human.
 *
 *   Two conditions, both required, neither sufficient:
 *
 *   1. **The caller asks for it**, per request (`owner_scope: true`). Without this every existing
 *      agent keeps writing exactly where it always did. A scope that silently redirected writes
 *      would move an agent's own records out from under its own reads — a data migration disguised
 *      as a permission.
 *   2. **The owner granted `memory:write-as-owner`** on that agent. Granular agents opt in; a `*`
 *      agent already has it, matching how `messages:send-as-owner` is bundled
 *      (src/mcp/catalog/scopes.ts).
 *
 *   What this does NOT touch: `visibility`. Where a record lands and who may read it are different
 *   axes. A record written into the owner's namespace with `visibility:'public'` is exactly as
 *   public as it was before.
 * @structure resolveWriteTarget(req, config, ownerScopeRequested) → { gaii, delegatedOwnerWrite, reservedAllowed } | denial
 * @usage
 *   const t = resolveWriteTarget(req, config, body.owner_scope === true);
 *   if ('deny' in t) { res.status(403).json(error(...t.deny)); return; }
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial.
 */
import type { Request } from 'express';
import type { AimeatConfig } from '../../config.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { appMayWriteKey } from '../../utils/reserved-keys.js';

/**
 * The two scopes this module gates on. They are defined in utils/scope-coverage.ts — the one place
 * that knows `memory:write-reserved` is **deliberately NOT satisfied by `*`**, unlike every other
 * scope here. `*` is the one-click "Full access" template, and somebody choosing it is deciding
 * "this agent may act for me", not "this agent may point my decrypted AI key at a URL of its
 * choosing". The consequence of getting that wrong is credential exfiltration, so it costs one more
 * explicit tick in the detailed editor.
 *
 * Do not "fix" it into the wildcard family, and do not hand-roll a `*` test in a new surface that
 * grants or approves scopes — ask utils/scope-coverage.ts. Two surfaces hand-rolled it and both
 * became a way for an agent to grant itself this scope with no owner involved.
 */
export { WRITE_AS_OWNER_SCOPE, WRITE_RESERVED_SCOPE } from '../../utils/scope-coverage.js';
import { WRITE_AS_OWNER_SCOPE, WRITE_RESERVED_SCOPE } from '../../utils/scope-coverage.js';

export interface WriteTarget {
    /** The namespace the record will be written under. */
    gaii: string;
    /**
     * True only when a NON-owner principal was redirected into the owner's namespace. The
     * reserved-key guard keys off this, and it must stay false for an owner session: the account
     * holder writing their own keys is not a delegation.
     */
    delegatedOwnerWrite: boolean;
    /** True when this caller may also write the reserved, server-trusted owner keys. */
    reservedAllowed: boolean;
}

export interface WriteTargetDenied {
    deny: { code: string; message: string };
}

/**
 * Whether these scopes carry `memory:write-as-owner`, using the same rules as requireScope: the
 * global wildcard, the domain wildcard, or the exact string.
 */
export function hasWriteAsOwner(scopes: string[] | undefined): boolean {
    const s = scopes ?? [];
    return s.includes('*') || s.includes('memory:*') || s.includes(WRITE_AS_OWNER_SCOPE);
}

/**
 * Whether these scopes carry the reserved-key grant. EXACT STRING ONLY — see WRITE_RESERVED_SCOPE.
 */
export function hasWriteReserved(scopes: string[] | undefined): boolean {
    return (scopes ?? []).includes(WRITE_RESERVED_SCOPE);
}

/**
 * Decide where a memory write lands.
 *
 * Returns the caller's own namespace unless they explicitly asked to write as the owner AND hold the
 * scope. An owner session is already the owner, so the request is a no-op for it rather than an
 * error — asking for what you are is not a mistake worth a 403.
 */
export function resolveWriteTarget(
    req: Request, config: AimeatConfig, ownerScopeRequested: boolean,
): WriteTarget | WriteTargetDenied {
    const own = resolveIdentity(req.auth!, config.nodeId);
    const roles = req.auth!.roles ?? [];
    const isOwnerSession = roles.includes('owner') && !roles.includes('agent') && !roles.includes('ecosystem');

    if (!ownerScopeRequested) {
        return { gaii: own, delegatedOwnerWrite: false, reservedAllowed: false };
    }

    // An owner session already writes to the owner namespace; the flag adds nothing.
    if (isOwnerSession) return { gaii: own, delegatedOwnerWrite: false, reservedAllowed: true };

    // An ecosystem app writes into its own `eco:` namespace and never the owner's. That boundary is
    // stated in utils/gaii.ts and this flag must not become the way around it.
    if (roles.includes('ecosystem')) {
        return { deny: {
            code: 'FORBIDDEN',
            message: 'An ecosystem app writes into its own namespace. Owner-area access is granted through data areas, not this flag.',
        } };
    }

    if (!hasWriteAsOwner(req.auth!.scopes)) {
        return { deny: {
            code: 'SCOPE_DENIED',
            message: `Scope "${WRITE_AS_OWNER_SCOPE}" required to write into the owner's namespace. Your owner grants it per agent in Profile → Agents → the agent → permissions.`,
        } };
    }

    return {
        gaii: `${req.auth!.owner}@${config.nodeId}`,
        delegatedOwnerWrite: true,
        reservedAllowed: hasWriteReserved(req.auth!.scopes),
    };
}

/**
 * The same decision for the MCP write tool, so the two surfaces cannot drift apart.
 *
 * Returns the namespace to write under, or a denial the tool renders as an error. The denials name
 * the tick the owner has to make, because "SCOPE_DENIED" alone sends an agent looking for a
 * platform limitation that does not exist.
 */
export function resolveMcpWriteTarget(args: {
    agentGaii: string; ownerName: string | null; nodeId: string;
    scopes: string[]; key: string; ownerScope: boolean;
}): { gaii: string } | { deny: { error: string; message: string; how_to_fix: string; your_scopes?: string[] } } {
    if (!args.ownerScope) return { gaii: args.agentGaii };

    if (!hasWriteAsOwner(args.scopes)) {
        return { deny: {
            error: 'SCOPE_DENIED',
            message: `Scope "${WRITE_AS_OWNER_SCOPE}" is required to write into the owner's namespace.`,
            your_scopes: args.scopes,
            how_to_fix: 'The owner grants it in Profile -> Agents -> this agent -> permissions -> Memory.',
        } };
    }
    if (!args.ownerName) {
        return { deny: {
            error: 'NO_OWNER',
            message: 'Cannot resolve your owner from this session.',
            how_to_fix: 'Reconnect the agent so the session carries its owner.',
        } };
    }
    // The same reserved-key guard the app-grant path has: this write lands where the server reads
    // openrouter.* / ai-usage.* / profile.* and trusts what it finds.
    if (!appMayWriteKey(['agent'], args.key, true, hasWriteReserved(args.scopes))) {
        return { deny: {
            error: 'RESERVED_KEY',
            message: `"${args.key}" is one of the keys the server itself trusts (the AI-provider URL, the spend cap, the public profile). Writing it on the owner's behalf needs the separate "${WRITE_RESERVED_SCOPE}" grant, which is not part of full access.`,
            how_to_fix: 'The owner ticks it in Profile -> Agents -> this agent -> permissions -> Memory.',
        } };
    }
    return { gaii: `${args.ownerName}@${args.nodeId}` };
}
