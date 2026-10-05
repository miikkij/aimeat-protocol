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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-03-21 — Initial creation: aimeat_memory_search + aimeat_memory_read_public
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-07-07 -- memory_search is size-bounded: returns a SNIPPET (~200 chars around the match)
 *     + key/meta instead of every matching entry's FULL value (which grew unbounded — workspace
 *     `.version.N` snapshots are owned by the agent GAII, so a broad query pulled the whole history).
 *     Adds a `limit` (default 50) and skips `.version.N` history by default (include_versions to keep it).
 *     Read a hit's full value with aimeat_memory_read on its exact key.
 *   v1.4.0 -- 2026-09-18 -- An empty search says what it covered and what an empty answer means. It
 *     carried the snippet hint regardless, so an agent asked for a record that did not exist kept
 *     looking in other places: eleven and twelve calls in the cold-agent baseline.
 *   v1.5.0 -- 2026-09-26 -- aimeat_memory_read_public answers a Design Book part with DESIGN_BOOK_PART,
 *     naming aimeat_designbook_get and GET /v1/designbook/:id, the one door that reads a part
 *     (utils/own-door-keys.ts), as GET /v1/memory/:gaii/:key does.
 *   v1.6.0 -- 2026-09-29 -- Both tools present values through the classification reader and the
 *     credential mask (presentMemories, TARGET-082). read_public had shown a raw value.
 *   v1.7.0 -- 2026-09-30 -- aimeat_memory_read_public answers CLASSIFIED for an organism's record whose
 *     label keeps it inside the organism, when the agent's owner is not a member (TARGET-082 review,
 *     item 1, services/group-shares-classification.ts).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { isVersionKey, searchHitShape, matchesType } from '../services/memory-search-shape.js';
import { ownDoorRefusal } from '../utils/own-door-keys.js';
import { presentMemories, presentMemory } from '../services/classification/present-memory.js';
import { readerForAgent } from '../services/classification/reader.js';
import { shareCarriesKey } from '../services/group-shares-classification.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

export function registerMemoryExtendedTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
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
    // The snippet window and the version-key test moved to services/memory-search-shape.ts on
    // 2026-09-06. They were closures here, which is why GET /v1/memory/search could not answer this
    // way and both connector doors returned whole records instead — the same tool name meaning two
    // different searches (review item 6.4). One shape, one place, every door.

    mcp.tool(
        'aimeat_memory_search',
        descriptionFor('aimeat_memory_search'),
        zodShapeFor('aimeat_memory_search'),
        annotationsFor('aimeat_memory_search'),
        async ({ query, type, visibility, limit, include_versions }) => {
            const cap = Math.max(1, Math.min(limit ?? 50, 200));
            const wantedTypes = type ? type.split(',').map(t => t.trim()).filter(Boolean) : [];
            // `query` is optional when a type is given: "every Person record I have" is a real
            // question with no text in it. The type string becomes the query, because `@type` is
            // indexed like any other scalar in the value; matchesType then makes the answer exact.
            const effectiveQuery = (query ?? '').trim() || (wantedTypes.length === 1 ? wantedTypes[0] : '');
            if (!effectiveQuery) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            error: wantedTypes.length > 1
                                ? 'Give a query as well: searching several types at once needs something to search for.'
                                : 'Give a query, or a single type to list.',
                        }, null, 2),
                    }],
                };
            }
            // Pull a bounded candidate set from storage (safety net over a pathological store), then drop
            // version history in-tool and cap to `cap` non-version hits.
            const candidates = await storage.searchMemory(agentGaii, effectiveQuery, { visibility, limit: cap * 4 });
            // Typed against the stored value, then presented: the classification reader plus the
            // credential mask (TARGET-082). A hit this agent may not see is not in the answer.
            const typed = await presentMemories(readerForAgent({ storage, config }, agentGaii),
                wantedTypes.length ? candidates.filter(r => matchesType(r.value, wantedTypes)) : candidates);
            const hits = (include_versions ? typed : typed.filter(r => !isVersionKey(r.key))).slice(0, cap);
            const q = effectiveQuery;
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        query: q,
                        total: hits.length,
                        truncated: (include_versions ? typed.length : typed.filter(r => !isVersionKey(r.key)).length) > hits.length,
                        hits: hits.map(r => searchHitShape(r, q)),
                        // An empty answer has to say what it covered, or the agent goes looking
                        // for the place it did not search. The cold-agent baseline of 2026-09-18:
                        // asked for a record that did not exist, the agent took eleven and twelve
                        // calls (list, read, capabilities, discover) to dare say so.
                        hint: hits.length > 0
                            ? 'Snippets only. Read a full value with aimeat_memory_read(key).'
                            : `Nothing matches "${q}". This searched the keys and values of every record you hold as this agent. It does not cover what the person or their other agents hold: aimeat_memory_list with owner_scope: true lists those, and its \`prefix\` narrows by key. When that shows nothing either, the record does not exist, and saying so to the person is the answer.`,
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
            // ONE CAPABILITY, ONE DOOR: a Design Book part is read through the Design Book, which
            // benches a component again before it hands one out (utils/own-door-keys.ts).
            const ownDoor = ownDoorRefusal(gaii, key, config.nodeId);
            if (ownDoor) return toolError(ownDoor.code, ownDoor.message);

            // The one presentation of a memory value (classification reader + credential mask,
            // TARGET-082). A record this agent may not see answers as an absent one.
            const stored = await storage.getMemory(gaii, key);
            const record = stored ? await presentMemory(readerForAgent({ storage, config }, agentGaii), stored) : null;

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

            // An organism's record reaches an agent whose owner is not a member of that organism only
            // when its classification lets it leave (TARGET-082 review, item 1), as on
            // GET /v1/memory/:gaii/:key.
            const carried = await shareCarriesKey({ storage, config }, record.ownerGaii, record.key, agentGaii);
            if (!carried.carries) {
                return toolError('CLASSIFIED', `This record belongs to an organism your owner is not a member of, and it is ${carried.reason}, so it is not handed out as a public record (label ${carried.label}).`);
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
