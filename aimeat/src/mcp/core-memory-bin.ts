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
 * @structure registerMemoryBinTools(mcp, deps)
 * @usage registerMemoryBinTools(mcp, { storage, config, agentGaii });
 * @version-history
 *   v1.0.0 — 2026-09-03 — Extracted from core.ts (max-file-lines), with the tools it holds.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { descriptionFor } from './catalog/shape.js';
import { annotationsFor } from './annotations.js';
import { flexibleBoolean } from './schema-flags.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../services/memory-bin.js';

export function registerMemoryBinTools(
  mcp: McpServer,
  { storage, config, agentGaii }: { storage: Storage; config: AimeatConfig; agentGaii: string },
): void {
// ── The bin: delete, and take it back ──
//
// These call services/memory-bin.ts, the same one behind DELETE /v1/memory/:key, because who may
// remove what is a rule and not a parameter. The other two surfaces are HTTP proxies onto that
// route; this one runs inside the node and reaches the service directly. Three doors, one answer.
mcp.tool(
    'aimeat_memory_delete',
    descriptionFor('aimeat_memory_delete'),
    {
        key: z.string().describe('Memory entry key to delete'),
        owner_scope: flexibleBoolean.optional().describe("Also reach the OWNER's namespace and your sibling agents', not only your own."),
    },
    annotationsFor('aimeat_memory_delete'),
    async ({ key, owner_scope }) => {
        const parsed = parseGAII(agentGaii);
        const out = await deleteMemoryRecord({ storage, config }, {
            caller: agentGaii, ownerName: parsed?.owner ?? agentGaii, key,
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

mcp.tool(
    'aimeat_memory_restore',
    descriptionFor('aimeat_memory_restore'),
    {
        key: z.string().describe('Memory entry key to put back'),
        owner_scope: flexibleBoolean.optional().describe("Also reach the OWNER's namespace and your sibling agents'."),
    },
    annotationsFor('aimeat_memory_restore'),
    async ({ key, owner_scope }) => {
        const parsed = parseGAII(agentGaii);
        const out = await restoreMemoryRecord({ storage, config }, {
            caller: agentGaii, ownerName: parsed?.owner ?? agentGaii, key,
            ownerScope: owner_scope === true,
        });
        if (!out.ok) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ error: out.code, message: out.message }, null, 2) }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify({ restored: true, key: out.key }, null, 2) }] };
    },
);
}
