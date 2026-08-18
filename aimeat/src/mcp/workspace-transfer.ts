/**
 * @file src/mcp/workspace-transfer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat_workspace_transfer` MCP tool — export one workspace to a base64 ZIP, or
 *   import such a ZIP as a NEW workspace. Extracted from mcp/workspaces.ts to satisfy max-file-lines;
 *   the shared helpers (denyReason, findWsEntry, roleOf, ok, fail) are passed in from the parent
 *   registrar, so behaviour is identical to the inline version.
 *
 *   Why it is a sensible seam: transfer is the only tool in that file that moves BYTES rather than
 *   records, and it is the only one that has to defend against a hostile archive — the ZIP safety
 *   checks and the quarantine path below have nothing to do with the rest of the workspace surface.
 * @structure registerWorkspaceTransferTool(mcp, storage, config, ctx)
 * @usage
 *   import { registerWorkspaceTransferTool } from './workspace-transfer.js';
 *   registerWorkspaceTransferTool(mcp, storage, config, { ownerName, ownerGhii, ok, fail, denyReason, findWsEntry, roleOf });
 * @version-history
 *   v1.0.0 — 2026-08-01 — Extracted from mcp/workspaces.ts (max-file-lines, pure extraction).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import { exportWorkspace } from '../services/workspace-export.js';
import { importWorkspace } from '../services/workspace-import.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceTransferToolCtx {
    ownerName: string;
    ownerGhii: string;
    ok: (obj: unknown) => TextResult;
    fail: (msg: string) => TextResult;
    denyReason: (orgId: string) => Promise<string | null>;
    findWsEntry: (orgId: string, ws: string) => Promise<{ createdBy: string; ownerGaii: string } | null>;
    roleOf: (orgId: string) => Promise<string | null>;
}

/** The largest ZIP this tool will hand back inline. MCP carries the bytes as base64 in the result. */
const MAX_INLINE_EXPORT_BYTES = 1_500_000;

export function registerWorkspaceTransferTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    ctx: WorkspaceTransferToolCtx,
): void {
    const { ownerName, ownerGhii, ok, fail, denyReason, findWsEntry, roleOf } = ctx;

    mcp.tool('aimeat_workspace_transfer', descriptionFor('aimeat_workspace_transfer'),
        {
            organism_id: z.string(),
            direction: z.enum(['export', 'import']).describe("'export' a workspace to a base64 ZIP, or 'import' a base64 ZIP as a NEW workspace"),
            ws: z.string().optional().describe("direction='export': the workspace id to export"),
            zip_base64: z.string().optional().describe("direction='import': the base64 ZIP from a prior export"),
        },
        annotationsFor('aimeat_workspace_transfer'),
        async ({ organism_id, direction, ws, zip_base64 }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            if (direction === 'export') {
                if (!ws) return fail("direction='export' needs a ws.");
                const entry = await findWsEntry(organism_id, ws);
                if (!entry) return fail('Workspace not found');
                const role = await roleOf(organism_id);
                if (entry.createdBy !== ownerName && role !== 'creator' && role !== 'admin') return fail('Only the workspace creator or an org admin can export.');
                const { buffer, filename } = await exportWorkspace(storage, config, {
                    orgId: organism_id, ws, exporterGaii: ownerGhii, exportedAt: new Date().toISOString(),
                    isOrgManager: role === 'creator' || role === 'admin',
                });
                if (buffer.length > MAX_INLINE_EXPORT_BYTES) return fail(`Workspace too large for inline export (${buffer.length} bytes) — download it from the UI/REST instead.`);
                return ok({ filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64') });
            }
            if (direction === 'import') {
                if (!zip_base64) return fail("direction='import' needs zip_base64.");
                const buf = Buffer.from(zip_base64, 'base64');
                if (!buf.length) return fail('zip_base64 is empty or invalid.');
                try {
                    const result = await importWorkspace(storage, config, { orgId: organism_id, importerGaii: ownerGhii, importerOwner: ownerName, zip: buf });
                    emitChange('organisms');
                    return ok(result);
                } catch (e: unknown) {
                    if (e instanceof ZipSecurityError) {
                        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: ownerGhii, actorName: ownerName, detail: e.message, source: 'workspace_transfer_mcp', blob: buf });
                        return fail(`Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`);
                    }
                    return fail((e as Error).message || 'Import failed');
                }
            }
            return fail("direction must be 'export' or 'import'.");
        });
}
