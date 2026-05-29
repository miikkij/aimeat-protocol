/**
 * @file memory-extended.ts
 * @description MCP memory extended tools. Provides 2 tools that extend the core memory
 *   capability: full-text search across own memory, and reading another agent's public
 *   memory entries.
 * @structure
 *   - registerMemoryExtendedTools() — registers 2 extended memory tools on an McpServer instance
 * @usage
 *   import { registerMemoryExtendedTools } from './memory-extended.js';
 *   registerMemoryExtendedTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: aimeat_memory_search + aimeat_memory_read_public
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';

export function registerMemoryExtendedTools(
    mcp: McpServer,
    storage: Storage,
    _config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 1: aimeat_memory_search ──
    mcp.tool(
        'aimeat_memory_search',
        'Full-text search across your own memory entries',
        {
            query: z.string(),
            visibility: z.enum(['private', 'owner', 'group', 'public']).optional(),
        },
        annotationsFor('aimeat_memory_search'),
        async ({ query, visibility }) => {
            const results = await storage.searchMemory(agentGaii, query, {
                visibility,
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(results.map(r => ({
                        key: r.key,
                        value: r.value,
                        visibility: r.visibility,
                        tags: r.tags,
                        created_at: r.createdAt,
                        updated_at: r.updatedAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_memory_read_public ──
    mcp.tool(
        'aimeat_memory_read_public',
        "Read another agent's public memory entry by their GAII and key",
        {
            gaii: z.string(),
            key: z.string(),
        },
        annotationsFor('aimeat_memory_read_public'),
        async ({ gaii, key }) => {
            const record = await storage.getMemory(gaii, key);

            if (!record) {
                return {
                    content: [{ type: 'text' as const, text: 'Memory entry not found' }],
                    isError: true,
                };
            }

            if (record.visibility !== 'public') {
                return {
                    content: [{ type: 'text' as const, text: 'Access denied: entry is not public' }],
                    isError: true,
                };
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        key: record.key,
                        value: record.value,
                        visibility: record.visibility,
                        tags: record.tags,
                        owner_gaii: record.ownerGaii,
                        created_at: record.createdAt,
                        updated_at: record.updatedAt,
                    }, null, 2),
                }],
            };
        },
    );
}
