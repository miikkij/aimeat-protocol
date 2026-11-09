/**
 * @file mcp/core-memory-history.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP's two tools for keeping a context trustworthy. aimeat_memory_history: a
 *   memory entry's kept earlier versions and what each write changed, or one version's value, through
 *   services/memory-versions/history.ts, the service behind GET /v1/memory/history/:key. aimeat_context_check:
 *   a machine check of one context, through services/context/check.ts, the service behind
 *   GET /v1/memory/context-check/:slug. Each rule is decided once, in its service.
 * @structure registerMemoryHistoryTool(mcp, deps, caller, agentGaii) -> aimeat_memory_history, aimeat_context_check
 * @usage registerMemoryHistoryTool(mcp, { storage, config }, caller, agentGaii);
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { annotationsFor } from './annotations.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import type { CallerContext } from '../services/caller-context.js';
import { readMemoryHistory } from '../services/memory-versions/history.js';
import { checkContext } from '../services/context/check.js';
import { readerForAgent } from '../services/classification/reader.js';
import { toolError } from './tool-error.js';

export function registerMemoryHistoryTool(
    mcp: McpServer,
    deps: { storage: Storage; config: AimeatConfig },
    /** The session's caller (services/caller-context.ts). */
    caller: () => CallerContext,
    agentGaii: string,
): void {
    mcp.registerTool(
        'aimeat_memory_history',
        {
            description: descriptionFor('aimeat_memory_history'),
            inputSchema: zodShapeFor('aimeat_memory_history'),
            annotations: annotationsFor('aimeat_memory_history'),
        },
        async ({ key, owner_scope, version, limit }) => {
            const out = await readMemoryHistory(deps, caller(), readerForAgent(deps, agentGaii), {
                key, ownerScope: owner_scope === true,
                ...(version !== undefined ? { version } : {}),
                ...(limit !== undefined ? { limit } : {}),
            });
            if (!out.ok) return { ...toolError(out.code, out.message) };
            return { content: [{ type: 'text' as const, text: JSON.stringify(out.data, null, 2) }] };
        },
    );

    mcp.registerTool(
        'aimeat_context_check',
        {
            description: descriptionFor('aimeat_context_check'),
            inputSchema: zodShapeFor('aimeat_context_check'),
            annotations: annotationsFor('aimeat_context_check'),
        },
        async ({ context }) => {
            const out = await checkContext(deps, caller(), readerForAgent(deps, agentGaii), context);
            if (!out.ok) return { ...toolError(out.code, out.message) };
            return { content: [{ type: 'text' as const, text: JSON.stringify(out.data, null, 2) }] };
        },
    );
}
