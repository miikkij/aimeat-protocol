/**
 * @file mcp/core-memory-bin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP's two bin tools: delete a memory entry, and take it back.
 *
 *   PURE EXTRACTION from core.ts, which passed the 800-line cap when they were added. They are a
 *   coherent pair — one capability read two ways — and separating them from the read/write tools
 *   keeps the delete's grace window explainable in one place.
 *
 *   THEY CALL services/memory-bin.ts, the same one behind DELETE /v1/memory/:key. The connector MCP
 *   and the CLI dispatch are HTTP proxies onto that route; this surface runs inside the node and
 *   reaches the service directly. Three doors, one answer to who may remove what.
 * @structure registerMemoryBinTools(mcp, deps, caller)
 * @usage registerMemoryBinTools(mcp, { storage, config }, caller);
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-12 — Both tools hand the service the session's scopes, which decide whether owner_scope
 *     reaches a record under the owner's own identity (memory:write-as-owner).
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.2 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.0.1 — 2026-09-24 — aimeat_memory_restore hands the service the agent role, as the delete
 *     does, now that restore asks the organism namespace rule too (A6-12).
 *   v1.0.0 — 2026-09-03 — Extracted from core.ts (max-file-lines), with the tools it holds.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { annotationsFor } from './annotations.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../services/memory-bin.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';

export function registerMemoryBinTools(
  mcp: McpServer,
  { storage, config }: { storage: Storage; config: AimeatConfig },
  /** The session's caller (services/caller-context.ts): the agent that deletes or restores. */
  caller: () => CallerContext,
): void {
/** The service's caller fields, from the session caller. */
const binCaller = () => {
    const session = caller();
    return { caller: session.principal, ownerName: session.owner, roles: [...session.roles], scopes: [...session.scopes] };
};
// ── The bin: delete, and take it back ──
//
// These call services/memory-bin.ts, the same one behind DELETE /v1/memory/:key, because who may
// remove what is a rule and not a parameter. The other two surfaces are HTTP proxies onto that
// route; this one runs inside the node and reaches the service directly. Three doors, one answer.
mcp.registerTool(
    'aimeat_memory_delete',
    {
        description: descriptionFor('aimeat_memory_delete'),
        inputSchema: zodShapeFor('aimeat_memory_delete'),
        annotations: annotationsFor('aimeat_memory_delete'),
    },
    async ({ key, owner_scope }) => {
        const out = await deleteMemoryRecord({ storage, config }, {
            // An agent session, never an operator one: this surface is minted per agent, so the
            // organism namespace check and the append-only guard inside the service both apply.
            ...binCaller(), key,
            ownerScope: owner_scope === true,
        });
        if (!out.ok) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: out.code, message: out.message }, null, 2) }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify({
            deleted: true, key: out.key,
            restorable_until: out.restorableUntil, grace_days: out.graceDays,
        }, null, 2) }] };
    },
);

mcp.registerTool(
    'aimeat_memory_restore',
    {
        description: descriptionFor('aimeat_memory_restore'),
        inputSchema: zodShapeFor('aimeat_memory_restore'),
        annotations: annotationsFor('aimeat_memory_restore'),
    },
    async ({ key, owner_scope }) => {
        const out = await restoreMemoryRecord({ storage, config }, {
            // As the delete above: an agent session, so the organism namespace check and the
            // append-only guard inside the service both apply to putting a record back too.
            ...binCaller(), key,
            ownerScope: owner_scope === true,
        });
        if (!out.ok) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: out.code, message: out.message }, null, 2) }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify({ restored: true, key: out.key }, null, 2) }] };
    },
);
}
