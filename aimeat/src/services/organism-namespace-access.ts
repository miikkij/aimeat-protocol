/**
 * @file organism-namespace-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may read or write an `organism.{id}.*` key. Membership, the namespace role
 *   (meta = admin/creator write, shared = member, member.{owner} = self) and the consent layer,
 *   in one function that takes a caller rather than an Express request.
 *
 *   WHY IT MOVED HERE. This rule lived entirely inside middleware/workspace-access.ts, which is
 *   RequestHandler-shaped, so only a road with a `req` could reach it. services/memory-write.ts —
 *   the shared write the MCP tools call — could therefore carry the FLOOR of the rule and nothing
 *   above it, and the August 2026 re-measurement found what that cost:
 *
 *     - a member holding only a VIEWER grant, or no grant at all, wrote another member's workspace
 *       content over MCP; revoking a contributor role stopped the web door and not the agent door
 *     - any active member rewrote organism.{id}.meta.workspaces — the registry every access decision
 *       reads — and so could add, rename or remove workspaces they do not administer
 *     - one member overwrote another member's private organism namespace
 *
 *   That is the shape the whole audit is about: a guard shaped like one door does not reach the
 *   other. The rule is the same rule for both now, and the middleware is a wrapper over it.
 * @structure
 *   - OrganismAccessCaller — the principal, its owner name and its roles
 *   - checkOrganismNamespaceAccess() — a refusal, or null when the access is allowed
 * @usage
 *   const refusal = await checkOrganismNamespaceAccess({ storage, config }, caller, key, 'write');
 *   if (refusal) return { ok: false, ...refusal };
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Extracted from middleware/workspace-access.ts (security audit, MCP/REST
 *     drift): the consent layer, the meta.* admin rule and the member.* self-write rule reach every
 *     door instead of only the HTTP one.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/** The session asking, in the terms this rule decides on. */
export interface OrganismAccessCaller {
    /** The principal's own id: an agent GAII, a GHII, or an ecosystem id. */
    principal: string;
    /** The bare owner name behind that principal. Memberships are keyed by this, not by the GHII. */
    owner: string;
    /** The session's roles. 'owner' without 'agent' is the human principal. */
    roles: string[];
}

/** What to answer when the access is refused. `status` and `code` match what the HTTP door sent. */
export interface OrganismAccessRefusal {
    status: number;
    code: 'AUTH_REQUIRED' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'CONSENT_REQUIRED';
    message: string;
}

/**
 * May this caller touch this organism key?
 *
 * Returns null when the access is allowed, including for a key outside the `organism.` namespace,
 * which this rule has nothing to say about. `mode` separates reads from writes: the meta and member
 * namespaces are readable by every member and writable by fewer.
 */
export async function checkOrganismNamespaceAccess(
    deps: { storage: Storage; config: AimeatConfig },
    caller: OrganismAccessCaller,
    key: string,
    mode: 'read' | 'write',
): Promise<OrganismAccessRefusal | null> {
    const { storage, config } = deps;

    const match = /^organism\.([^.]+)\./.exec(key);
    if (!match) return null;
    const organismId = match[1];

    if (!caller.owner) {
        return { status: 401, code: 'AUTH_REQUIRED', message: 'Authentication required for workspace access' };
    }

    const organism = await storage.getOrganism(organismId);
    if (!organism) {
        return { status: 404, code: 'NOT_FOUND', message: `Organism not found: ${organismId}` };
    }

    // An organism-level agent is attached to the organism rather than a member of it. It reads and
    // writes the shared namespace, reads meta, and gets nothing else — a workspace key included.
    if (organism.agentGaiis.includes(caller.principal)) {
        if (key.startsWith(`organism.${organismId}.shared.`)) return null;
        if (key.startsWith(`organism.${organismId}.meta.`) && mode === 'read') return null;
        return { status: 403, code: 'ACCESS_DENIED', message: 'Agent not authorized for this workspace namespace' };
    }

    const userGhii = await storage.getGHIIByOwner(caller.owner);
    if (!userGhii) {
        return { status: 403, code: 'ACCESS_DENIED', message: 'Not a member of this organism' };
    }

    // Memberships are keyed by the BARE owner name — organisms.ts (join/leave/admin) and consent.ts
    // (organism resolution) both look membership up with the owner name, not the full GHII.
    const membership = await storage.getMembership(organismId, caller.owner);
    if (!membership || membership.status !== 'active') {
        return { status: 403, code: 'ACCESS_DENIED', message: 'Not an active member of this organism' };
    }

    // An org manager already administers this organism's access, invites, export and archive, so
    // they need no per-workspace contributor consent on top.
    const isOrgManager = membership.role === 'creator' || membership.role === 'admin';

    const ownMemberPrefix = `organism.${organismId}.member.${caller.owner}.`;
    const isOwnMemberNamespace = key.startsWith(ownMemberPrefix);

    // A human owner-role session acting as an active member is the principal — it does not consent
    // to itself. The consent layer governs AGENT access and cross-node sharing.
    const isHumanOwnerSession = caller.roles.includes('owner') && !caller.roles.includes('agent');

    // An AGENT of the workspace's own creator is that creator's tool, and likewise does not consent
    // to itself. A cross-owner member's agent still needs a granted contributor role.
    let isOwnWorkspaceAgent = false;
    let wsCreator: string | null = null;
    const wsMatch = /^organism\.[^.]+\.w\.([^.]+)\./.exec(key);
    const wsId = wsMatch ? wsMatch[1] : null;
    if (wsId && !isHumanOwnerSession) {
        const regKey = `organism.${organismId}.meta.workspaces`;
        const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
        for (const rec of items) {
            if (rec.key !== regKey) continue;
            const list = (rec.value as { workspaces?: Array<{ id: string; createdBy?: string }> } | null)?.workspaces ?? [];
            const entry = list.find(w => w.id === wsId);
            if (entry) {
                wsCreator = entry.createdBy ?? (rec.ownerGaii.includes('#') ? rec.ownerGaii.split('#')[1] : rec.ownerGaii).split('@')[0];
                if (wsCreator === caller.owner) isOwnWorkspaceAgent = true;
                break;
            }
        }
    }

    const needsConsent = !isOwnMemberNamespace && !isHumanOwnerSession && !isOwnWorkspaceAgent && !isOrgManager;

    if (needsConsent) {
        let hasConsent = false;

        if (wsId) {
            // Workspace CONTENT: the creator's 'contributor' ROLE grant, and only that, so the
            // creator can revoke write by removing the grant. A 'viewer' grant is read-only and does
            // not match here. The role is granted to the OWNER, so all their agents inherit it.
            if (wsCreator) {
                const creatorGhii = `${wsCreator}@${config.nodeId}`;
                const recipient = `ghii:${caller.owner}@${config.nodeId}`;
                const pattern = `organism.${organismId}.w.${wsId}.**`;
                const grants = await storage.listConsents(creatorGhii, { status: 'active' });
                hasConsent = grants.some(c => c.purpose === 'workspace-contributor' && c.dataPattern === pattern && c.recipient === recipient);
            }
        } else {
            // Flat organism namespace: the writer's own contribution consent, owned by the member's
            // OWNER GHII or one of their agents, whichever made the grant.
            const ownerGhii = `${caller.owner}@${config.nodeId}`;
            const agents = await storage.getAgentsByOwner(caller.owner);
            const accessorPattern = `organism.${organismId}`;
            for (const accessor of [ownerGhii, ...agents.map(a => a.gaii)]) {
                if ((await storage.findMatchingConsents(accessor, key, accessorPattern)).length > 0) { hasConsent = true; break; }
            }
        }

        if (!hasConsent) {
            return {
                status: 403, code: 'CONSENT_REQUIRED',
                message: `Active consent required for organism workspace access (key: ${key})`,
            };
        }
    }

    // Meta namespace: every member reads it, only an admin or the creator writes it. It holds the
    // workspace registry that every access decision above reads, so a plain member writing here
    // would be deciding who may write everywhere else.
    if (key.startsWith(`organism.${organismId}.meta.`) && mode === 'write') {
        if (membership.role !== 'admin' && membership.role !== 'creator') {
            return { status: 403, code: 'ACCESS_DENIED', message: 'Admin access required for meta namespace' };
        }
    }

    // Member namespace: every member reads it, only its owner writes it.
    const memberMatch = /^organism\.[^.]+\.member\.([^.]+)\./.exec(key);
    if (memberMatch && mode === 'write') {
        if (memberMatch[1] !== caller.owner) {
            return { status: 403, code: 'ACCESS_DENIED', message: 'Cannot write to another member\'s workspace' };
        }
    }

    return null;
}
