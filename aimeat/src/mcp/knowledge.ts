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
 *   v1.0.0 — 2026-03-21 — Initial creation: 4 tools + 1 resource for knowledge management via MCP
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

export function registerKnowledgeTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Resource: knowledge package ──
    mcp.registerResource(
        'knowledge-package',
        new ResourceTemplate('aimeat://knowledge/{packageId}', {
            list: async () => {
                const entries = await storage.listMemory(agentGaii, { prefix: 'packages/', tags: ['knowledge-package'] });
                const manifests = entries.filter(e => e.key.endsWith('/manifest'));
                return {
                    resources: manifests.map(m => {
                        const pkg = m.value as any;
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
        'List knowledge packages owned by this agent',
        {},
        async () => {
            const entries = await storage.listMemory(agentGaii, { prefix: 'packages/', tags: ['knowledge-package'] });
            const manifests = entries.filter(e => e.key.endsWith('/manifest'));
            const packages = manifests.map(m => {
                const pkg = m.value as any;
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
        'Read a knowledge package manifest and its entries',
        {
            package_id: z.string().describe('The knowledge package ID'),
        },
        async ({ package_id }) => {
            const manifestKey = `packages/${package_id}/manifest`;
            const manifest = await storage.getMemory(agentGaii, manifestKey);
            if (!manifest) {
                return {
                    content: [{ type: 'text' as const, text: `Package not found: ${package_id}` }],
                    isError: true,
                };
            }
            const entries = await storage.listMemory(agentGaii, { prefix: `packages/${package_id}/` });
            const entryDetails = await Promise.all(
                entries
                    .filter(e => !e.key.endsWith('/manifest'))
                    .map(async e => {
                        const data = await storage.getMemory(agentGaii, e.key);
                        return {
                            key: e.key,
                            visibility: e.visibility,
                            value: data?.value ?? null,
                            tags: e.tags,
                        };
                    }),
            );
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
        'Add or update an entry in an existing knowledge package',
        {
            package_id: z.string().describe('The knowledge package ID'),
            entry_key: z.string().describe('Entry key (short name, e.g. "summary" or "chapter-1")'),
            content: z.string().describe('Entry content as a string (plain text or JSON)'),
        },
        async ({ package_id, entry_key, content }) => {
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

            await storage.setMemory({
                key: fullEntryKey,
                ownerGaii: agentGaii,
                value,
                visibility: existing?.visibility ?? 'owner',
                tags: existing?.tags ?? ['knowledge-entry'],
                ttlHours: null,
                version: (existing?.version ?? 0) + 1,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });

            // Update manifest's entries list if entry is new
            const manifestValue = manifest.value as any;
            const manifestEntries: any[] = manifestValue?.entries ?? [];
            const entryExists = manifestEntries.some(
                (e: any) => e.key === fullEntryKey || e.key === entry_key,
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
        'Get links for a knowledge package (related packages, references)',
        {
            package_id: z.string().describe('The knowledge package ID'),
            direction: z.enum(['outgoing', 'incoming', 'both']).optional().describe('Link direction (default: both)'),
        },
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
