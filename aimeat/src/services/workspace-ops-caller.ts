/**
 * @file src/services/workspace-ops-caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is asking a workspace operation, and the answer shape every operation gives:
 *   the caller, the verdict types, the membership check and the member role that the operations
 *   in services/workspace-tool-ops.ts (read, draft write, publish, batch publish, batch delete)
 *   decide on. Its own module since 2026-10-13, when that file reached the 800-line limit.
 * @structure
 *   - WorkspaceOpsDeps / WorkspaceOpsCaller / workspaceCallerOf() — who is asking
 *   - WorkspaceOpRefusal / WorkspaceOpResult / refuse() — the verdict
 *   - denyReason() / memberRoleOf() — membership and the role for the meta.* rule
 *   - fencedOpRefusal() — the fenced-space rule (services/fenced-space.ts) as an operation's refusal
 * @usage
 *   const caller = workspaceCallerOf({ principal: agentGaii, ownerName, roles: ['agent'] }, config);
 *   const deny = await denyReason(storage, caller, organismId); if (deny) return deny;
 * @version-history
 *   v1.1.0 — 2026-10-13 — The caller carries `extension` (`installer/name`), which only the workspace
 *     capability of an extension action sets, and fencedOpRefusal asks the fenced-space rule with it:
 *     a record space that names extensions takes an agent's write only through one of them (ruled by
 *     the developer on 2026-10-13, after an agent wrote records into an app's spaces past the app's
 *     own tool).
 *   v1.0.0 — 2026-10-13 — Extracted from services/workspace-tool-ops.ts (max-file-lines), a pure
 *     move: the caller, the verdict types, refuse, workspaceCallerOf, denyReason and memberRoleOf.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { fencedSpaceRefusal, type FenceTarget } from './fenced-space.js';

export interface WorkspaceOpsDeps { storage: Storage; config: AimeatConfig }

/** Who is asking, in the terms every rule below decides on. */
export interface WorkspaceOpsCaller {
    /** The session principal: an agent GAII, an owner GHII, or an app or ecosystem id. */
    principal: string;
    /** The bare account name. Memberships are keyed by it. */
    ownerName: string;
    /** `${ownerName}@${nodeId}`: where current state and meta live. */
    ownerGhii: string;
    /** Who AUTHORS content: an agent's own GAII when an agent calls, else the owner GHII. */
    writerGaii: string;
    /** The session's roles, for the organism namespace rule. */
    roles: string[];
    /** The session's own scope words, when the door has them: a provenance declaration needs
     *  provenance:write there as well as on the grant. Absent for the extension sandbox. */
    scopes?: readonly string[];
    /**
     * `installer/name` of the extension whose action makes the call, lower-cased. Set only by
     * services/extension-workspace.ts: it is what lets a caller that is not a person write a
     * record space that names the extension (services/fenced-space.ts).
     */
    extension?: string;
}

/** A refusal, with the status and code the HTTP doors send for the same thing. */
export interface WorkspaceOpRefusal { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }
export type WorkspaceOpResult<T> = { ok: true; data: T } | WorkspaceOpRefusal;

export const refuse = (status: number, code: string, message: string, details?: Record<string, unknown>): WorkspaceOpRefusal =>
    ({ ok: false, status, code, message, ...(details ? { details } : {}) });

/**
 * Build the caller from a principal. The owner name is the door's to give: the session knows it (an
 * owner GHII carries no `#`, so parsing cannot recover it from an agent-shaped id), and every door
 * names it with localAccountName, which keeps a visitor from another node whole. This function used
 * to cut one itself when none was given, and no door relied on that.
 */
export function workspaceCallerOf(
    args: { principal: string; ownerName: string; roles: string[]; scopes?: readonly string[]; extension?: string },
    config: AimeatConfig,
): WorkspaceOpsCaller {
    const parsed = parseGAII(args.principal);
    const ownerName = args.ownerName;
    const ownerGhii = `${ownerName}@${config.nodeId}`;
    return {
        principal: args.principal, ownerName, ownerGhii,
        writerGaii: parsed ? args.principal : ownerGhii,
        roles: args.roles,
        ...(args.scopes ? { scopes: args.scopes } : {}),
        ...(args.extension ? { extension: args.extension } : {}),
    };
}

/** Membership gate — an organism agent, or the owner is an active member. Null when allowed. */
export async function denyReason(storage: Storage, caller: WorkspaceOpsCaller, orgId: string): Promise<WorkspaceOpRefusal | null> {
    const org = await storage.getOrganism(orgId);
    if (!org) return refuse(404, 'NOT_FOUND', 'Organism not found');
    if (org.agentGaiis?.includes(caller.principal)) return null;
    const m = await storage.getMembership(orgId, caller.ownerName);
    return m && m.status === 'active' ? null : refuse(403, 'ACCESS_DENIED', 'Not an active member of this organism');
}

/** The caller's role for the meta.* rule; an organism agent is a member and nothing more. */
export async function memberRoleOf(storage: Storage, caller: WorkspaceOpsCaller, orgId: string): Promise<'creator' | 'admin' | 'member' | null> {
    const m = await storage.getMembership(orgId, caller.ownerName);
    if (m && m.status === 'active') return m.role;
    const org = await storage.getOrganism(orgId);
    return org?.agentGaiis?.includes(caller.principal) ? 'member' : null;
}

/**
 * The fenced-space rule (services/fenced-space.ts) as an operation's refusal, or null. The
 * operations here ask it themselves because none of them hands the record's real key to the
 * organism namespace rule: the draft write asks that rule with a stand-in key, and a publish, a
 * reopen and a delete do not ask it at all.
 */
export async function fencedOpRefusal(
    deps: WorkspaceOpsDeps, caller: WorkspaceOpsCaller, organismId: string, ws: string, target: FenceTarget,
): Promise<WorkspaceOpRefusal | null> {
    const fenced = await fencedSpaceRefusal(deps,
        { principal: caller.principal, roles: caller.roles, extension: caller.extension }, organismId, ws, target);
    return fenced ? refuse(fenced.status, fenced.code, fenced.message, fenced.details) : null;
}
