/**
 * @file src/mcp/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The four MCP tools for workspace ROW spaces. Extracted from mcp/workspaces.ts at the
 *   max-file-lines boundary; a move, not a rewrite.
 *
 *   THESE HOLD NO LOGIC OF THEIR OWN. services/workspace-rows/row-service.ts is what the REST routes
 *   call too, so the manifest gate, the access rule, the quota ceilings and the retention sweep
 *   cannot answer differently on one door than on the other. That is not tidiness: the same defect
 *   was fixed three separate times inside one MCP tool because a rule lived in one door and not the
 *   other.
 * @structure registerWorkspaceRowTools(mcp, deps)
 * @usage registerWorkspaceRowTools(mcp, { storage, config, agentGaii, writerGaii, ownerName });
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial: extracted from mcp/workspaces.ts.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import {
    appendRows, readRows, spaceStats, deleteRow, deleteRowsBefore,
    WorkspaceRowError, type RowCaller,
} from '../services/workspace-rows/row-service.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export interface WorkspaceRowToolDeps {
    storage: Storage;
    config: AimeatConfig;
    /** The session subject, which is what the shared access rule decides on. */
    agentGaii: string;
    /** The identity that AUTHORS: an agent's own GAII when an agent is calling, else the owner GHII. */
    writerGaii: string;
    ownerName: string;
}

export function registerWorkspaceRowTools(mcp: McpServer, deps: WorkspaceRowToolDeps): void {
    const { storage, config, agentGaii, writerGaii, ownerName } = deps;
    const rowDeps = { storage, config };

    const ok = (obj: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
    const fail = (msg: string): TextResult => ({ content: [{ type: 'text', text: msg }], isError: true });

    // `principal` is what the shared access rule decides on (it matches an organism agent by GAII);
    // `identity` is what gets STORED in createdBy, and it is the AGENT's own GAII when an agent is
    // calling, so a row's author is the agent rather than the owner it acts for.
    const rowCaller = (): RowCaller =>
        ({ principal: agentGaii, identity: writerGaii, owner: ownerName, roles: ['agent'] });

    /** One place that renders a service refusal, so every row tool fails with the same sentence. */
    const rowFail = (err: unknown): TextResult => {
        if (err instanceof WorkspaceRowError) return fail(`${err.code}: ${err.message}`);
        throw err;
    };

    mcp.tool('aimeat_workspace_rows_append', descriptionFor('aimeat_workspace_rows_append'),
        {
            organism_id: z.string(), ws: z.string(), space: z.string(),
            body: z.record(z.string(), z.unknown()).optional(),
            row_id: z.string().optional(),
            occurred_at: z.string().optional(),
            rows: z.array(z.record(z.string(), z.unknown())).optional(),
        },
        annotationsFor('aimeat_workspace_rows_append'),
        async ({ organism_id, ws, space, body, row_id, occurred_at, rows }): Promise<TextResult> => {
            try {
                const list = Array.isArray(rows) && rows.length
                    ? rows.map(r => ({ rowId: r.row_id ?? r.rowId, occurredAt: r.occurred_at ?? r.occurredAt, body: r.body }))
                    : (body ? [{ rowId: row_id, occurredAt: occurred_at, body }] : []);
                const res = await appendRows(rowDeps, rowCaller(), {
                    organismId: organism_id, wsId: ws, space, rows: list,
                });
                return ok({ written: res.written, row_ids: res.rowIds, pruned: res.pruned });
            } catch (err) { return rowFail(err); }
        });

    mcp.tool('aimeat_workspace_rows_read', descriptionFor('aimeat_workspace_rows_read'),
        {
            organism_id: z.string(), ws: z.string(), space: z.string(),
            where: z.record(z.string(), z.unknown()).optional(),
            since: z.string().optional(), until: z.string().optional(),
            changed_since: z.string().optional(),
            limit: z.number().optional(), cursor: z.string().optional(),
            order: z.enum(['asc', 'desc']).optional(),
        },
        annotationsFor('aimeat_workspace_rows_read'),
        async ({ organism_id, ws, space, where, since, until, changed_since, limit, cursor, order }): Promise<TextResult> => {
            try {
                const page = await readRows(rowDeps, rowCaller(), {
                    organismId: organism_id, wsId: ws, space,
                    ...(where ? { where } : {}),
                    ...(since ? { since } : {}), ...(until ? { until } : {}),
                    ...(changed_since ? { changedSince: changed_since } : {}),
                    ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}),
                    ...(order ? { order } : {}),
                });
                return ok(page);
            } catch (err) { return rowFail(err); }
        });

    mcp.tool('aimeat_workspace_rows_stats', descriptionFor('aimeat_workspace_rows_stats'),
        { organism_id: z.string(), ws: z.string(), space: z.string() },
        annotationsFor('aimeat_workspace_rows_stats'),
        async ({ organism_id, ws, space }): Promise<TextResult> => {
            try {
                return ok({ stats: await spaceStats(rowDeps, rowCaller(), organism_id, ws, space) });
            } catch (err) { return rowFail(err); }
        });

    mcp.tool('aimeat_workspace_rows_delete', descriptionFor('aimeat_workspace_rows_delete'),
        {
            organism_id: z.string(), ws: z.string(), space: z.string(),
            row_id: z.string().optional(), before: z.string().optional(),
        },
        annotationsFor('aimeat_workspace_rows_delete'),
        async ({ organism_id, ws, space, row_id, before }): Promise<TextResult> => {
            // Exactly one, and neither defaults. A delete that quietly meant "everything" because a
            // parameter was forgotten is the shape this refusal exists to prevent.
            if (!!row_id === !!before) {
                return fail('Pass exactly one of `row_id` (remove that row) or `before` (remove everything created before that ISO timestamp).');
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
}
