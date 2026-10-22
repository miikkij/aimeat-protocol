/**
 * @file src/mcp/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools for workspace ROW spaces: append, read, stats, delete, and a row's kept
 *   revisions with their restore. Extracted from mcp/workspaces.ts at the max-file-lines boundary.
 *
 *   THESE HOLD NO LOGIC OF THEIR OWN. services/workspace-rows/row-service.ts is what the REST routes
 *   call too, so the manifest gate, the access rule, the quota ceilings and the retention sweep
 *   cannot answer differently on one door than on the other. That is not tidiness: the same defect
 *   was fixed three separate times inside one MCP tool because a rule lived in one door and not the
 *   other.
 * @structure registerWorkspaceRowTools(mcp, deps, caller)
 * @usage registerWorkspaceRowTools(mcp, { storage, config, agentGaii, writerGaii, scopes }, caller);
 * @version-history
 *   2026-10-22 — aimeat_workspace_rows_revisions and aimeat_workspace_rows_restore, on the delete's two
 *     words, and `revisions_kept` in the append answer (secaudit 2026-10, v80; developer ruling 2026-10-22).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9). The deps no longer carry ownerName.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-08-26 — Initial: extracted from mcp/workspaces.ts.
 *   v1.1.0 — 2026-09-29 — aimeat_workspace_rows_read passes the agent's classification reader (TARGET-082).
 *   v1.2.0 — 2026-10-02 — aimeat_workspace_rows_delete needs memory:purge (its catalog gate) and
 *     organism:write, the two words the REST DELETE routes ask (Jouni, 2026-10-02).
 *   v1.3.0 — 2026-10-13 — The row caller carries the session's scopes, which the fenced-space rule
 *     reads through the access rule (services/fenced-space.ts, ruled 2026-10-13).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { readerForAgent } from '../services/classification/reader.js';
import { annotationsFor } from './annotations.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import {
    appendRows, readRows, spaceStats, deleteRow, deleteRowsBefore, listRowRevisions, restoreRowRevision,
    WorkspaceRowError, type RowCaller,
} from '../services/workspace-rows/row-service.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceRowToolDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The session subject, which is what the shared access rule decides on. */
    agentGaii: string;
    /** The identity that AUTHORS: an agent's own GAII when an agent is calling, else the owner GHII. */
    writerGaii: string;
    /** The session's scopes. Removing rows needs organism:write beside the tool's memory:purge. */
    scopes: string[];
}

export function registerWorkspaceRowTools(
    mcp: McpServer, deps: WorkspaceRowToolDeps,
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
): void {
    const { storage, config, agentGaii, writerGaii, scopes } = deps;
    const rowDeps = { storage, config };

    const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
    const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });

    // `principal` is what the shared access rule decides on (it matches an organism agent by GAII);
    // `identity` is what gets STORED in createdBy, and it is the AGENT's own GAII when an agent is
    // calling, so a row's author is the agent rather than the owner it acts for. The principal, the
    // owner and the roles are the session caller's.
    const rowCaller = (): RowCaller => {
        const session = caller();
        // The scopes are the session's: the fenced-space rule reads them (services/fenced-space.ts).
        return { principal: session.principal, identity: writerGaii, owner: session.owner, roles: [...session.roles], scopes: session.scopes };
    };

    /** One place that renders a service refusal, so every row tool fails with the same sentence. */
    const rowFail = (err: unknown): TextResult => {
        if (err instanceof WorkspaceRowError) return fail(`${err.code}: ${err.message}`);
        throw err;
    };

    mcp.registerTool('aimeat_workspace_rows_append', { description: descriptionFor('aimeat_workspace_rows_append'),
        inputSchema: zodShapeFor('aimeat_workspace_rows_append'),
        annotations: annotationsFor('aimeat_workspace_rows_append') },
        async ({ organism_id, ws, space, body, row_id, occurred_at, rows }): Promise<TextResult> => {
            try {
                const list = Array.isArray(rows) && rows.length
                    ? rows.map(r => ({ rowId: r.row_id ?? r.rowId, occurredAt: r.occurred_at ?? r.occurredAt, body: r.body }))
                    : (body ? [{ rowId: row_id, occurredAt: occurred_at, body }] : []);
                const res = await appendRows(rowDeps, rowCaller(), {
                    organismId: organism_id, wsId: ws, space, rows: list,
                });
                return ok({ written: res.written, row_ids: res.rowIds, pruned: res.pruned, revisions_kept: res.revisionsKept });
            } catch (err) { return rowFail(err); }
        });

    mcp.registerTool('aimeat_workspace_rows_read', { description: descriptionFor('aimeat_workspace_rows_read'),
        inputSchema: zodShapeFor('aimeat_workspace_rows_read'),
        annotations: annotationsFor('aimeat_workspace_rows_read') },
        async ({ organism_id, ws, space, where, since, until, changed_since, limit, cursor, order }): Promise<TextResult> => {
            try {
                const page = await readRows(rowDeps, rowCaller(), {
                    organismId: organism_id, wsId: ws, space,
                    ...(where ? { where } : {}),
                    ...(since ? { since } : {}), ...(until ? { until } : {}),
                    ...(changed_since ? { changedSince: changed_since } : {}),
                    ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}),
                    ...(order ? { order } : {}),
                    reader: readerForAgent({ storage, config }, agentGaii),
                });
                return ok(page);
            } catch (err) { return rowFail(err); }
        });

    mcp.registerTool('aimeat_workspace_rows_stats', { description: descriptionFor('aimeat_workspace_rows_stats'),
        inputSchema: zodShapeFor('aimeat_workspace_rows_stats'),
        annotations: annotationsFor('aimeat_workspace_rows_stats') },
        async ({ organism_id, ws, space }): Promise<TextResult> => {
            try {
                return ok({ stats: await spaceStats(rowDeps, rowCaller(), organism_id, ws, space) });
            } catch (err) { return rowFail(err); }
        });

    mcp.registerTool('aimeat_workspace_rows_delete', { description: descriptionFor('aimeat_workspace_rows_delete'),
        inputSchema: zodShapeFor('aimeat_workspace_rows_delete'),
        annotations: annotationsFor('aimeat_workspace_rows_delete') },
        async ({ organism_id, ws, space, row_id, before }): Promise<TextResult> => {
            // Exactly one, and neither defaults. A delete that quietly meant "everything" because a
            // parameter was forgotten is the shape this refusal exists to prevent.
            if (!!row_id === !!before) {
                return fail('Pass exactly one of `row_id` (remove that row) or `before` (remove everything created before that ISO timestamp).');
            }
            // TWO WORDS, AS ON REST. The tool's own gate is memory:purge (catalog/scopes.ts), because
            // a removed row cannot come back; organism:write is what the DELETE routes asked before
            // that, and an app grant holds purge without it (routes/organisms/workspace-rows.ts).
            if (!scopeIsCovered(scopes, 'organism:write')) {
                return fail('SCOPE_DENIED: removing rows changes a workspace, which needs the organism:write permission beside memory:purge. Ask the owner for it.');
            }
            try {
                if (row_id) {
                    await deleteRow(rowDeps, rowCaller(), organism_id, ws, space, row_id);
                    return ok({ deleted: row_id });
                }
                const removed = await deleteRowsBefore(rowDeps, rowCaller(), organism_id, ws, space, before!);
                return ok({ removed });
            } catch (err) { return rowFail(err); }
        });

    // A row's kept revisions (services/workspace-rows/row-revisions.ts): the same two words as the
    // delete, memory:purge as the catalog gate and organism:write asked here, as REST asks both.
    const purgeWordsHeld = (): TextResult | null => scopeIsCovered(scopes, 'organism:write') ? null
        : fail('SCOPE_DENIED: a row\'s kept revisions are for whoever may remove rows, which needs the organism:write permission beside memory:purge. Ask the owner for it.');

    mcp.registerTool('aimeat_workspace_rows_revisions', { description: descriptionFor('aimeat_workspace_rows_revisions'),
        inputSchema: zodShapeFor('aimeat_workspace_rows_revisions'),
        annotations: annotationsFor('aimeat_workspace_rows_revisions') },
        async ({ organism_id, ws, space, row_id }): Promise<TextResult> => {
            const refused = purgeWordsHeld();
            if (refused) return refused;
            try {
                const out = await listRowRevisions(rowDeps, rowCaller(), organism_id, ws, space, row_id,
                    readerForAgent({ storage, config }, agentGaii));
                return ok({ space: out.space, row_id: out.rowId, revisions: out.revisions });
            } catch (err) { return rowFail(err); }
        });

    mcp.registerTool('aimeat_workspace_rows_restore', { description: descriptionFor('aimeat_workspace_rows_restore'),
        inputSchema: zodShapeFor('aimeat_workspace_rows_restore'),
        annotations: annotationsFor('aimeat_workspace_rows_restore') },
        async ({ organism_id, ws, space, row_id, revision_id }): Promise<TextResult> => {
            const refused = purgeWordsHeld();
            if (refused) return refused;
            try {
                const out = await restoreRowRevision(rowDeps, rowCaller(), organism_id, ws, space, row_id, revision_id,
                    readerForAgent({ storage, config }, agentGaii));
                return ok({ row_id: out.rowId, restored: out.restored, revision_kept: out.revisionKept });
            } catch (err) { return rowFail(err); }
        });
}
