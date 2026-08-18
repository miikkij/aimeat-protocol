/**
 * @file memory-extended.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-07-07 -- memory_search is size-bounded: returns a SNIPPET (~200 chars around the match)
 *     + key/meta instead of every matching entry's FULL value (which grew unbounded — workspace
 *     `.version.N` snapshots are owned by the agent GAII, so a broad query pulled the whole history).
 *     Adds a `limit` (default 50) and skips `.version.N` history by default (include_versions to keep it).
 *     Read a hit's full value with aimeat_memory_read on its exact key.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

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
    // Returns a SNIPPET per hit, not the full value — memory values can be large (a workspace document,
    // a whole record set), and a broad query used to pull every match in full, including the agent's own
    // `.version.N` workspace snapshots (owned by the agent GAII), blowing past a sane MCP payload. So:
    // cap the count (`limit`, default 50), skip version history unless asked, and hand back a short
    // window around the match. The agent reads a specific hit's full value via aimeat_memory_read(key).
    const SNIPPET_RADIUS = 90;   // chars of context on each side of the match (≈200-char window)
    const isVersionKey = (key: string): boolean => /\.version\.\d+$/.test(key);
    const snippetOf = (text: string, needle: string): string => {
        const i = text.toLowerCase().indexOf(needle.toLowerCase());
        if (i < 0) return text.slice(0, SNIPPET_RADIUS * 2).trim() + (text.length > SNIPPET_RADIUS * 2 ? '…' : '');
        const s = Math.max(0, i - SNIPPET_RADIUS), e = i + needle.length + SNIPPET_RADIUS;
        return (s > 0 ? '…' : '') + text.slice(s, e).trim() + (e < text.length ? '…' : '');
    };

    mcp.tool(
        'aimeat_memory_search',
        descriptionFor('aimeat_memory_search'),
        {
            query: z.string(),
            visibility: z.enum(['private', 'owner', 'group', 'members', 'public']).optional(),
            limit: z.number().optional().describe('Max hits to return (default 50).'),
            include_versions: z.boolean().optional().describe('Include `.version.N` history snapshots (skipped by default — they are immutable history and the main source of bloat).'),
        },
        annotationsFor('aimeat_memory_search'),
        async ({ query, visibility, limit, include_versions }) => {
            const cap = Math.max(1, Math.min(limit ?? 50, 200));
            // Pull a bounded candidate set from storage (safety net over a pathological store), then drop
            // version history in-tool and cap to `cap` non-version hits.
            const candidates = await storage.searchMemory(agentGaii, query, { visibility, limit: cap * 4 });
            const hits = (include_versions ? candidates : candidates.filter(r => !isVersionKey(r.key))).slice(0, cap);
            const q = query.trim();
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        query: q,
                        total: hits.length,
                        truncated: (include_versions ? candidates.length : candidates.filter(r => !isVersionKey(r.key)).length) > hits.length,
                        hits: hits.map(r => {
                            const valStr = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
                            return {
                                key: r.key,
                                snippet: snippetOf(valStr, q),
                                bytes: valStr.length,
                                visibility: r.visibility,
                                tags: r.tags,
                                updated_at: r.updatedAt,
                            };
                        }),
                        hint: 'Snippets only. Read a full value with aimeat_memory_read(key).',
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_memory_read_public ──
    mcp.tool(
        'aimeat_memory_read_public',
        descriptionFor('aimeat_memory_read_public'),
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
