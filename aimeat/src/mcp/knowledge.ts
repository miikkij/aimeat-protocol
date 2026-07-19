/**
 * @file knowledge.ts
 * @description MCP knowledge tools and resource registrations. Provides 4 tools for knowledge
 *   package management (list, get, contribute, links) and 1 resource template for reading
 *   knowledge packages via the MCP resource protocol.
 * @structure
 *   - registerKnowledgeTools() — registers all knowledge tools and resources on an McpServer instance
 * @usage
 *   import { registerKnowledgeTools } from './knowledge.js';
 *   registerKnowledgeTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
 *   v1.0.0 — 2026-03-21 — Initial creation: 4 tools + 1 resource for knowledge management via MCP
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 — 2026-07-16 — listOwnerScopeMemory aggregates GHII+agents in one listMemoryForOwners (was N+1)
 *   v1.4.0 — 2026-07-16 — aimeat_knowledge_get uses the values listMemory already returns (SELECT *) instead
 *     of a redundant getMemory per package entry (Phase 3)
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

/** An entry reference stored in a knowledge-package manifest's `entries` list. */
interface KnowledgeEntryRef {
    key: string;
    title?: string;
    visibility?: string;
}

/** Shape of a stored knowledge-package manifest value (memory record `value`). */
interface KnowledgeManifestValue {
    name?: string;
    content_type?: string;
    tags?: string[];
    sharing?: { catalog_listed?: boolean };
    entries?: KnowledgeEntryRef[];
    created?: string;
    updated?: string;
}

export function registerKnowledgeTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // Aggregate owner-scope memory (GHII + all agents) — packages may be
    // stored under the owner's GHII (web UI import) or any agent's GAII.
    async function listOwnerScopeMemory(opts: { prefix?: string; tags?: string[]; visibility?: string }): Promise<MemoryRecord[]> {
        const parsed = parseGAII(agentGaii);
        const owner = parsed?.owner;
        if (!owner) return storage.listMemory(agentGaii, opts);

        const ownerGhii = `${owner}@${config.nodeId}`;
        const agents = await storage.getAgentsByOwner(owner);
        // GHII + every agent in ONE IN query (was listMemory per identity). Dedup by key keeping the
        // highest-priority source (GHII first, then agents in order) — same as the old sequential scan.
        const owners = [ownerGhii, ...agents.map(a => a.gaii)];
        const priority = new Map(owners.map((g, i) => [g, i]));
        const rows = await storage.listMemoryForOwners(owners, opts);
        rows.sort((x, y) => (priority.get(x.ownerGaii) ?? 0) - (priority.get(y.ownerGaii) ?? 0));

        const seen = new Set<string>();
        const results: MemoryRecord[] = [];
        for (const rec of rows) {
            if (!seen.has(rec.key)) {
                seen.add(rec.key);
                results.push(rec);
            }
        }
        return results;
    }

    // ── Resource: knowledge package ──
    mcp.registerResource(
        'knowledge-package',
        new ResourceTemplate('aimeat://knowledge/{packageId}', {
            list: async () => {
                const entries = await listOwnerScopeMemory({ prefix: 'packages/', tags: ['knowledge-package'] });
                const manifests = entries.filter(e => e.key.endsWith('/manifest'));
                return {
                    resources: manifests.map(m => {
                        const pkg = m.value as KnowledgeManifestValue;
                        const packageId = m.key.replace('packages/', '').replace('/manifest', '');
                        return {
                            uri: `aimeat://knowledge/${encodeURIComponent(packageId)}`,
                            name: pkg?.name ?? packageId,
                            mimeType: 'application/json',
                            description: `Knowledge package: ${pkg?.name ?? packageId} (${pkg?.content_type ?? 'unknown'})`,
                        };
                    }),
                };
            },
        }),
        { mimeType: 'application/json', description: 'Knowledge package manifest and entries' },
        async (uri, variables) => {
            const packageId = decodeURIComponent(variables.packageId as string);
            const manifestKey = `packages/${packageId}/manifest`;
            const manifest = await storage.getMemory(agentGaii, manifestKey);
            if (!manifest) {
                return { contents: [{ uri: uri.toString(), text: 'Package not found' }] };
            }
            const entries = await storage.listMemory(agentGaii, { prefix: `packages/${packageId}/` });
            const entryList = entries.filter(e => !e.key.endsWith('/manifest')).map(e => ({
                key: e.key,
                visibility: e.visibility,
                tags: e.tags,
            }));
            return {
                contents: [{
                    uri: uri.toString(),
                    text: JSON.stringify({
                        package_id: packageId,
                        manifest: manifest.value,
                        entry_count: entryList.length,
                        entries: entryList,
                    }, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    // ── Tool 1: aimeat_knowledge_list ──
    mcp.tool(
        'aimeat_knowledge_list',
        descriptionFor('aimeat_knowledge_list'),
        {},
        annotationsFor('aimeat_knowledge_list'),
        async () => {
            const entries = await listOwnerScopeMemory({ prefix: 'packages/', tags: ['knowledge-package'] });
            const manifests = entries.filter(e => e.key.endsWith('/manifest'));
            const packages = manifests.map(m => {
                const pkg = m.value as KnowledgeManifestValue;
                const packageId = m.key.replace('packages/', '').replace('/manifest', '');
                return {
                    package_id: packageId,
                    name: pkg?.name ?? null,
                    content_type: pkg?.content_type ?? null,
                    tags: pkg?.tags ?? [],
                    catalog_listed: pkg?.sharing?.catalog_listed ?? false,
                    entry_count: (pkg?.entries ?? []).length,
                    created: pkg?.created ?? m.createdAt,
                    updated: pkg?.updated ?? m.updatedAt,
                };
            });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(packages, null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_knowledge_get ──
    mcp.tool(
        'aimeat_knowledge_get',
        descriptionFor('aimeat_knowledge_get'),
        {
            package_id: z.string().describe('The knowledge package ID'),
        },
        annotationsFor('aimeat_knowledge_get'),
        async ({ package_id }) => {
            const manifestKey = `packages/${package_id}/manifest`;
            const manifest = await storage.getMemory(agentGaii, manifestKey);
            if (!manifest) {
                return {
                    content: [{ type: 'text' as const, text: `Package not found: ${package_id}` }],
                    isError: true,
                };
            }
            // listMemory returns FULL records (SELECT *), so each entry already carries its value —
            // no getMemory per entry needed (was a redundant re-fetch of data already in hand).
            const entries = await storage.listMemory(agentGaii, { prefix: `packages/${package_id}/` });
            const entryDetails = entries
                .filter(e => !e.key.endsWith('/manifest'))
                .map(e => ({
                    key: e.key,
                    visibility: e.visibility,
                    value: e.value ?? null,
                    tags: e.tags,
                }));
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        package_id,
                        manifest: manifest.value,
                        entries: entryDetails,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_knowledge_contribute ──
    mcp.tool(
        'aimeat_knowledge_contribute',
        descriptionFor('aimeat_knowledge_contribute'),
        {
            package_id: z.string().describe('The knowledge package ID'),
            entry_key: z.string().describe('Entry key (short name, e.g. "summary" or "chapter-1")'),
            content: z.string().describe('Entry content as a string (plain text or JSON)'),
            model: z.string().max(64).optional().describe('Optional: the LLM model this knowledge came from (stored as a model: tag; indicative attribution)'),
        },
        annotationsFor('aimeat_knowledge_contribute'),
        async ({ package_id, entry_key, content, model }) => {
            // The appdev-pitfalls package is schema-reserved — its entries need model/category/
            // severity structure, so raw contributions are redirected to the dedicated tool.
            if (package_id === 'appdev-pitfalls') {
                return {
                    content: [{ type: 'text' as const, text: 'The appdev-pitfalls package is reserved — report pitfalls with aimeat_appdev_pitfall_report (model attribution is required there).' }],
                    isError: true,
                };
            }
            const manifestKey = `packages/${package_id}/manifest`;
            const manifest = await storage.getMemory(agentGaii, manifestKey);
            if (!manifest) {
                return {
                    content: [{ type: 'text' as const, text: `Package not found: ${package_id}` }],
                    isError: true,
                };
            }

            // Normalize entry key to full path
            const fullEntryKey = entry_key.startsWith(`packages/${package_id}/`)
                ? entry_key
                : `packages/${package_id}/${entry_key}`;

            const now = new Date().toISOString();

            // Parse content if JSON, otherwise store as plain string
            let value: unknown = content;
            try { value = JSON.parse(content); } catch { /* store as string */ }

            // Check if entry exists to preserve version
            const existing = await storage.getMemory(agentGaii, fullEntryKey);

            const normModel = model?.trim().toLowerCase();
            const baseTags = existing?.tags ?? ['knowledge-entry'];
            const tags = normModel
                ? [...baseTags.filter(t => !t.startsWith('model:')), `model:${normModel}`]
                : baseTags;

            await storage.setMemory({
                key: fullEntryKey,
                ownerGaii: agentGaii,
                value,
                visibility: existing?.visibility ?? 'owner',
                tags,
                ttlHours: null,
                version: (existing?.version ?? 0) + 1,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });

            // Update manifest's entries list if entry is new
            const manifestValue = manifest.value as KnowledgeManifestValue;
            const manifestEntries: KnowledgeEntryRef[] = manifestValue?.entries ?? [];
            const entryExists = manifestEntries.some(
                (e) => e.key === fullEntryKey || e.key === entry_key,
            );
            if (!entryExists) {
                manifestEntries.push({
                    key: fullEntryKey,
                    title: entry_key,
                    visibility: 'owner',
                });
                manifestValue.entries = manifestEntries;
                manifestValue.updated = now;
                await storage.setMemory({
                    ...manifest,
                    value: manifestValue,
                    updatedAt: now,
                    version: (manifest.version ?? 0) + 1,
                });
            }

            emitResourceUpdated(agentGaii, `aimeat://knowledge/${encodeURIComponent(package_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ package_id, entry_key: fullEntryKey, updated: true }, null, 2),
                }],
            };
        },
    );

    // ── Tool 4: aimeat_knowledge_links ──
    mcp.tool(
        'aimeat_knowledge_links',
        descriptionFor('aimeat_knowledge_links'),
        {
            package_id: z.string().describe('The knowledge package ID'),
            direction: z.enum(['outgoing', 'incoming', 'both']).optional().describe('Link direction (default: both)'),
        },
        annotationsFor('aimeat_knowledge_links'),
        async ({ package_id, direction }) => {
            const manifestKey = `packages/${package_id}/manifest`;
            const links = await storage.listLinks(manifestKey, {
                direction: direction ?? 'both',
            });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        package_id,
                        links: links.map(l => ({
                            source: l.source,
                            target: l.target,
                            relation: l.relation,
                            description: l.description,
                            linked_at: l.linked_at,
                        })),
                        count: links.length,
                    }, null, 2),
                }],
            };
        },
    );
}
