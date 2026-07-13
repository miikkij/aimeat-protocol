/**
 * @file src/mcp/workspace-members.ts
 * @description MCP workspace member-role tools (member_grant, member_revoke, members) — proactively
 *   add/remove an existing GHII/GAII member on one or many workspaces as viewer|contributor, and list
 *   a workspace's members with role + grant provenance. Extracted from workspaces.ts to satisfy
 *   max-file-lines. The shared helpers (denyReason, wsManager, setWsRole, revokeWsRole) are passed in
 *   from the parent registrar so behaviour is identical.
 * @version-history
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
    ok: (obj: unknown) => TextResult;
    fail: (msg: string) => TextResult;
    denyReason: (orgId: string) => Promise<string | null>;
    wsManager: (orgId: string, ws: string) => Promise<{ createdBy: string } | null>;
    setWsRole: (creatorGhii: string, orgId: string, ws: string, grantee: string, role: WsRole, source: 'grant' | 'request', grantedBy: string) => Promise<unknown>;
    revokeWsRole: (creatorGhii: string, orgId: string, ws: string, grantee: string) => Promise<number>;
}

export function registerWorkspaceMemberTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    ctx: WorkspaceMemberToolsCtx,
): void {
    const { ownerName, ok, fail, denyReason, wsManager, setWsRole, revokeWsRole } = ctx;

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
