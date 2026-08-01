/**
 * @file src/mcp/workspace-members.ts
 * @description MCP workspace membership tools — `aimeat_workspace_access` (request access, list
 *   requests + members, decide one) and the role tools (member_grant, member_revoke, members) that
 *   proactively add/remove an existing GHII/GAII member on one or many workspaces as
 *   viewer|contributor. Extracted from workspaces.ts to satisfy max-file-lines. The shared helpers
 *   are passed in from the parent registrar so behaviour is identical.
 *
 *   Access and grant live together because they are the two halves of ONE membership decision —
 *   someone asks, someone decides — and both were already reaching for the same role helpers.
 * @version-history
 *   v1.1.0 — 2026-08-01 — aimeat_workspace_access moved here from workspaces.ts (pure extraction,
 *     registration order preserved: it registers before the grant tools, exactly as before).
 *   v1.0.0 — 2026-07-13 — Extracted from mcp/workspaces.ts (max-file-lines)
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import { granteeOwner, listWorkspaceMemberRoles, type WsRole } from '../services/workspace-roles.js';
import type { Storage } from '../storage/interface.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceMemberToolsCtx {
    ownerName: string;
    /** The caller's own GHII — the identity an access REQUEST is filed under. */
    ownerGhii: string;
    ok: (obj: unknown) => TextResult;
    fail: (msg: string) => TextResult;
    denyReason: (orgId: string) => Promise<string | null>;
    wsManager: (orgId: string, ws: string) => Promise<{ createdBy: string } | null>;
    setWsRole: (creatorGhii: string, orgId: string, ws: string, grantee: string, role: WsRole, source: 'grant' | 'request', grantedBy: string) => Promise<unknown>;
    revokeWsRole: (creatorGhii: string, orgId: string, ws: string, grantee: string) => Promise<number>;
    /** Find a workspace's registry entry across every member's registry. */
    findWsEntry: (orgId: string, ws: string) => Promise<{ createdBy: string; ownerGaii: string } | null>;
    /** The caller's role in the organism ('creator' | 'admin' | …), or null. */
    roleOf: (orgId: string) => Promise<string | null>;
    writeRecord: (key: string, value: unknown, prev: null, owner?: string) => Promise<void>;
    ensureConsent: (granteeGhii: string, keyPattern: string, scope: string, purpose: string) => Promise<unknown>;
    /** The bare owner name inside a GHII/GAII. */
    bareOwner: (gaii: string) => string;
}

export function registerWorkspaceMemberTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    ctx: WorkspaceMemberToolsCtx,
): void {
    const { ownerName, ownerGhii, ok, fail, denyReason, wsManager, setWsRole, revokeWsRole,
        findWsEntry, roleOf, writeRecord, ensureConsent, bareOwner } = ctx;

    // ── aimeat_workspace_access ── (request access · list requests+members · decide one)
    // Registered FIRST, before the grant tools, to preserve the tool order this surface had while it
    // lived in workspaces.ts. It belongs here rather than there: a request and a grant are the two
    // halves of one membership decision, and they were reaching for the same role helpers already.
    mcp.tool('aimeat_workspace_access', descriptionFor('aimeat_workspace_access'),
        {
            organism_id: z.string(), ws: z.string(),
            action: z.enum(['request', 'list', 'decide']).describe("'request' = ask the creator for access · 'list' = (creator/admin) see pending requests + members · 'decide' = (creator/admin) approve/deny one"),
            message: z.string().optional().describe("action='request': a note to the creator"),
            requester: z.string().optional().describe("action='decide': the requester's owner name"),
            decision: z.string().optional().describe("action='decide': 'approve' (default) or 'deny'"),
            role: z.enum(['viewer', 'contributor']).optional().describe("action='decide' approve: the role to grant — 'viewer' (read) or 'contributor' (read+write). Omit to keep the current default (contributor, unless decision='viewer')."),
        },
        annotationsFor('aimeat_workspace_access'),
        async ({ organism_id, ws, action, message, requester, decision, role }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const entry = await findWsEntry(organism_id, ws);
            if (!entry) return fail('Workspace not found');
            const isManager = async () => { const r = await roleOf(organism_id); return entry.createdBy === ownerName || r === 'creator' || r === 'admin'; };

            if (action === 'request') {
                if (entry.createdBy === ownerName) return fail('You created this workspace.');
                await writeRecord(`organism.${organism_id}.w.${ws}.access.request.${ownerName}`, { ws, requester: ownerName, requester_gaii: ownerGhii, message: message ?? '', status: 'pending', createdAt: new Date().toISOString() }, null, ownerGhii);
                await ensureConsent(ownerGhii, `organism.${organism_id}.w.${ws}.**`, `organism.${organism_id}`, 'workspace-contribution');
                emitChange('organisms');
                return ok({ status: 'requested', ws, workspace_creator: entry.createdBy });
            }
            if (action === 'list') {
                if (!(await isManager())) return fail('Only the workspace creator or an org admin can see access requests.');
                const creatorGhii = `${entry.createdBy}@${config.nodeId}`;
                const roles = await listWorkspaceMemberRoles(storage, config, { creatorGhii, orgId: organism_id, ws });
                const { items } = await storage.listAllMemory({ prefix: `organism.${organism_id}.w.${ws}.access.request.`, limit: 1000 });
                const requests = items.map(r => {
                    const v = r.value as { requester?: string; message?: string; createdAt?: string };
                    const req = v.requester ?? bareOwner(r.ownerGaii);
                    return { requester: req, message: v.message ?? '', created_at: v.createdAt, status: roles.has(req) ? 'approved' : 'pending', role: roles.get(req)?.role ?? null };
                });
                const members = [...roles.values()].map(m => ({ owner: m.owner, role: m.role, source: m.source ?? null, granted_by: m.grantedBy ?? null }));
                return ok({ ws, requests, members });
            }
            if (action === 'decide') {
                if (!requester) return fail("action='decide' needs a requester.");
                if (!(await isManager())) return fail('Only the workspace creator or an org admin can decide access.');
                // Grants are owned by the workspace CREATOR (so reads resolve via the content owner).
                const creatorGhii = `${entry.createdBy}@${config.nodeId}`;
                if (decision === 'deny') {
                    await revokeWsRole(creatorGhii, organism_id, ws, requester);
                    emitChange('organisms');
                    return ok({ status: 'denied', ws, requester });
                }
                // Explicit `role` wins; else preserve the historical default (contributor unless decision='viewer').
                const granted: WsRole = role ?? (decision === 'viewer' ? 'viewer' : 'contributor');
                await setWsRole(creatorGhii, organism_id, ws, requester, granted, 'request', ownerName);
                emitChange('organisms');
                return ok({ status: 'approved', ws, requester, role: granted });
            }
            return fail("action must be 'request', 'list' or 'decide'.");
        });

    /** Normalize a single `ws` and/or a `workspaces` array into a de-duplicated list (order preserved). */
    const wsList = (ws?: string, workspaces?: string[]): string[] => {
        const out: string[] = [];
        for (const w of [...(ws ? [ws] : []), ...(Array.isArray(workspaces) ? workspaces : [])]) {
            const t = String(w ?? '').trim();
            if (t && !out.includes(t)) out.push(t);
        }
        return out;
    };

    // ── aimeat_workspace_member_grant ── (proactively add an existing member; no prior request needed)
    mcp.tool('aimeat_workspace_member_grant', descriptionFor('aimeat_workspace_member_grant'),
        {
            organism_id: z.string(),
            ws: z.string().optional().describe('A single workspace id. Use this OR `workspaces` (or both).'),
            workspaces: z.array(z.string()).optional().describe('MANY workspace ids to grant in one call — e.g. every workspace in the organism (from aimeat_workspace_list).'),
            grantee: z.string().describe('The member to grant: an owner name, GHII (owner@node), or GAII (agent#owner@node). The grant applies to the OWNER, so all their agents inherit it.'),
            role: z.enum(['viewer', 'contributor']).describe("'viewer' = read only · 'contributor' = read + write."),
        },
        annotationsFor('aimeat_workspace_member_grant'),
        async ({ organism_id, ws, workspaces, grantee, role }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const targets = wsList(ws, workspaces);
            if (!targets.length) return fail('Provide `ws` and/or `workspaces` — at least one workspace id.');
            const owner = granteeOwner(grantee);
            const results: Array<{ ws: string; status: string; role?: WsRole }> = [];
            for (const w of targets) {
                const mgr = await wsManager(organism_id, w);
                if (!mgr) { results.push({ ws: w, status: 'forbidden_or_not_found' }); continue; }
                if (owner === mgr.createdBy) { results.push({ ws: w, status: 'skipped_creator' }); continue; }
                await setWsRole(`${mgr.createdBy}@${config.nodeId}`, organism_id, w, grantee, role, 'grant', ownerName);
                results.push({ ws: w, status: 'granted', role });
            }
            emitChange('organisms');
            const granted = results.filter(r => r.status === 'granted').length;
            return ok({ grantee: owner, role, granted, total: targets.length, results });
        });

    // ── aimeat_workspace_member_revoke ── (remove a member's role on one or many workspaces)
    mcp.tool('aimeat_workspace_member_revoke', descriptionFor('aimeat_workspace_member_revoke'),
        {
            organism_id: z.string(),
            ws: z.string().optional().describe('A single workspace id. Use this OR `workspaces` (or both).'),
            workspaces: z.array(z.string()).optional().describe('MANY workspace ids to revoke in one call.'),
            grantee: z.string().describe('The member to revoke: owner name, GHII, or GAII (resolved to the owner). To DOWNGRADE instead of removing, call aimeat_workspace_member_grant with the lower role.'),
        },
        annotationsFor('aimeat_workspace_member_revoke'),
        async ({ organism_id, ws, workspaces, grantee }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const targets = wsList(ws, workspaces);
            if (!targets.length) return fail('Provide `ws` and/or `workspaces` — at least one workspace id.');
            const owner = granteeOwner(grantee);
            const results: Array<{ ws: string; status: string; revoked?: number }> = [];
            for (const w of targets) {
                const mgr = await wsManager(organism_id, w);
                if (!mgr) { results.push({ ws: w, status: 'forbidden_or_not_found' }); continue; }
                const revoked = await revokeWsRole(`${mgr.createdBy}@${config.nodeId}`, organism_id, w, grantee);
                results.push({ ws: w, status: revoked > 0 ? 'revoked' : 'not_a_member', revoked });
            }
            emitChange('organisms');
            const revoked = results.filter(r => r.status === 'revoked').length;
            return ok({ grantee: owner, revoked, total: targets.length, results });
        });

    // ── aimeat_workspace_members ── (list a workspace's members with roles + grant provenance)
    mcp.tool('aimeat_workspace_members', descriptionFor('aimeat_workspace_members'),
        { organism_id: z.string(), ws: z.string().describe('Workspace id (from aimeat_workspace_list).') },
        annotationsFor('aimeat_workspace_members'),
        async ({ organism_id, ws }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            const mgr = await wsManager(organism_id, ws);
            if (!mgr) return fail('Workspace not found, or only the workspace creator or an org admin can list its members.');
            const creatorGhii = `${mgr.createdBy}@${config.nodeId}`;
            const roles = await listWorkspaceMemberRoles(storage, config, { creatorGhii, orgId: organism_id, ws });
            const members = [...roles.values()].map(m => ({
                owner: m.owner, role: m.role, source: m.source ?? null, granted_by: m.grantedBy ?? null, granted_at: m.grantedAt ?? null,
            }));
            return ok({ ws, creator: mgr.createdBy, members });
        });
}
