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
 *   registerWorkspaceTransferTool(mcp, storage, config, { ownerName, ownerGhii, agentGaii, caller, ok, fail, denyReason, findWsEntry, roleOf });
 * @version-history
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-20 — The export carries the session principal (`callerSub`), so an ecosystem session is
 *     held to its owner-granted read data-areas, and the import carries the session's own facts
 *     (`caller`), so the restore applies the write rules the archive's keys and levels would
 *     otherwise skip (secaudit 2026-10).
 *   2026-10-16 — A catch-all failure carries the caught error (withCaughtError, mcp/tool-fault.ts): an internal exception is logged, reported and answered with a sentence instead of its text (QA audit E5-01, D2-01).
 *   2026-10-15 — The export answers `truncated` when it reached a limit (feature-list audit #68).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-08-01 — Extracted from mcp/workspaces.ts (max-file-lines, pure extraction).
 *   v1.1.0 — 2026-09-29 — The export passes the agent's classification reader (TARGET-082).
 *   v1.2.0 — 2026-09-29 — The export answers `left_out`, what the classification kept out (TARGET-082 review).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withCaughtError } from './tool-fault.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import { exportWorkspace } from '../services/workspace-export.js';
import { readerForAgent } from '../services/classification/reader.js';
import { importWorkspace } from '../services/workspace-import.js';
import { ZipSecurityError } from '../services/safe-zip.js';
import { recordSecurityIncident } from '../services/security-incident.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';
import type { ImportCaller } from '../services/workspace-import-gates.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceTransferToolCtx {
    ownerName: string;
    ownerGhii: string;
    /** The session's agent, whose classification reader an export passes (TARGET-082). */
    agentGaii: string;
    /** The session's caller (services/caller-context.ts), built per call: its scopes are this request's. */
    caller: () => CallerContext;
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
    const { ownerName, ownerGhii, agentGaii, caller, ok, fail, denyReason, findWsEntry, roleOf } = ctx;

    /** The session's own facts for the restore's write rules. The record namespace stays the owner's. */
    const importCaller = (): ImportCaller => {
        const session = caller();
        return {
            principal: session.principal, targetGaii: ownerGhii, owner: session.owner,
            roles: [...session.roles], scopes: [...session.scopes],
        };
    };

    mcp.registerTool('aimeat_workspace_transfer', { description: descriptionFor('aimeat_workspace_transfer'),
        inputSchema: zodShapeFor('aimeat_workspace_transfer'),
        annotations: annotationsFor('aimeat_workspace_transfer') },
        async ({ organism_id, direction, ws, zip_base64 }): Promise<TextResult> => {
            const deny = await denyReason(organism_id); if (deny) return fail(deny);
            if (direction === 'export') {
                if (!ws) return fail("direction='export' needs a ws.");
                const entry = await findWsEntry(organism_id, ws);
                if (!entry) return fail('Workspace not found');
                const role = await roleOf(organism_id);
                if (entry.createdBy !== ownerName && role !== 'creator' && role !== 'admin') return fail('Only the workspace creator or an org admin can export.');
                const { buffer, filename, leftOut, truncated } = await exportWorkspace(storage, config, {
                    orgId: organism_id, ws, exporterGaii: ownerGhii, callerSub: caller().principal,
                    exportedAt: new Date().toISOString(),
                    isOrgManager: role === 'creator' || role === 'admin',
                    reader: readerForAgent({ storage, config }, agentGaii),
                });
                if (buffer.length > MAX_INLINE_EXPORT_BYTES) return fail(`Workspace too large for inline export (${buffer.length} bytes) — download it from the UI/REST instead.`);
                return ok({
                    filename, size_bytes: buffer.length, zip_base64: buffer.toString('base64'),
                    ...(leftOut.length ? { left_out: leftOut } : {}),
                    // A limit the export reached: the backup is smaller than the workspace (feature-list audit #68).
                    ...(truncated.length ? { truncated } : {}),
                });
            }
            if (direction === 'import') {
                if (!zip_base64) return fail("direction='import' needs zip_base64.");
                const buf = Buffer.from(zip_base64, 'base64');
                if (!buf.length) return fail('zip_base64 is empty or invalid.');
                try {
                    const result = await importWorkspace(storage, config, { orgId: organism_id, importerGaii: ownerGhii, importerOwner: ownerName, caller: importCaller(), zip: buf });
                    emitChange('organisms');
                    return ok(result);
                } catch (e: unknown) {
                    if (e instanceof ZipSecurityError) {
                        const inc = await recordSecurityIncident(storage, config, { type: 'zip_import', code: e.code, actorGhii: ownerGhii, actorName: ownerName, detail: e.message, source: 'workspace_transfer_mcp', blob: buf });
                        return fail(`Upload rejected by safety checks (${e.code}) and quarantined for review (incident ${inc.id}).`);
                    }
                    return withCaughtError(fail((e as Error).message || 'Import failed'), e);
                }
            }
            return fail("direction must be 'export' or 'import'.");
        });
}
