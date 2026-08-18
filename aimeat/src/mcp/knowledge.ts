/**
 * @file knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.5.0 — 2026-08-01 — TARGET-058 Phase 4. aimeat_knowledge_contribute accepts `ai_provenance` +
 *     `ai_provenance_id` and stamps the entry through provenanceForWrite(); the pre-existing `model`
 *     parameter is folded in as a fallback declaration rather than asked for twice. aimeat_knowledge_get
 *     returns each entry's record, batched. Knowledge is the material an agent later quotes back as
 *     established fact, which is why per-entry origin has to survive the hop.
 *   v1.6.0 — 2026-08-11 — August 2026 audit step 8. aimeat_knowledge_contribute declares its
 *     parameters and renders its answer; the work moved to services/knowledge-package-entry.ts,
 *     where the manifest's index line goes through services/memory-write.ts like the entry already
 *     did instead of straight to storage.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listOwnerScopeMemory as kbListOwnerScopeMemory } from '../services/appdev-kb.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenanceMany } from './ai-provenance-result.js';
import {
    addKnowledgePackageEntry, type KnowledgeManifestValue,
} from '../services/knowledge-package-entry.js';

export function registerKnowledgeTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The session's own scopes, for the gate inside the shared memory write. */
    sessionScopes: string[] = [],
): void {
    const agentGaii = getAgentGaii();

    // Owner-scope memory aggregation is services/appdev-kb.ts — packages may sit under the owner's
    // GHII (web UI import) or any of their agents, and which duplicate key wins is a priority order
    // that has to be the same answer on both surfaces.
    const listOwnerScopeMemory = (opts: { prefix?: string; tags?: string[]; visibility?: string }) =>
        kbListOwnerScopeMemory(storage, config, agentGaii, opts);

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
            // TARGET-058: how each entry was made, in ONE query for the whole package. A knowledge
            // package is exactly the material an agent later quotes back to a person as if it were
            // established fact, so per-entry origin is the difference between citing a source and
            // laundering a model's output through a package name.
            const provFor = await readProvenanceMany(storage, config, entries.map(e => e.aiProvenanceId));
            const entryDetails = entries
                .filter(e => !e.key.endsWith('/manifest'))
                .map(e => ({
                    key: e.key,
                    visibility: e.visibility,
                    value: e.value ?? null,
                    tags: e.tags,
                    ...provFor(e.aiProvenanceId),
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
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_knowledge_contribute'),
        async ({ package_id, entry_key, content, model, ai_provenance, ai_provenance_id }) => {
            // ONE implementation (services/knowledge-package-entry.ts). The tool declares its
            // parameters because the protocol requires that, maps `ai_provenance` from the wire
            // shape, and renders the answer as text; the entry record, the reserved-package guard
            // and the manifest's index line belong to the capability, not to this door.
            const out = await addKnowledgePackageEntry({ storage, config }, {
                principal: agentGaii,
                targetGaii: agentGaii,
                scopes: sessionScopes,
                roles: ['agent'],
            }, {
                packageId: package_id,
                entryKey: entry_key,
                content,
                model,
                declaredProvenance: toDeclaredProvenance(ai_provenance),
                declaredProvenanceId: ai_provenance_id,
                pipeline: 'mcp.knowledge_contribute',
            });
            if (!out.ok) {
                return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            }

            emitResourceUpdated(agentGaii, `aimeat://knowledge/${encodeURIComponent(package_id)}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        package_id, entry_key: out.entryKey, updated: true,
                        ...(out.manifestWarning ? { manifest_warning: out.manifestWarning } : {}),
                        ...(await writeProvenanceEcho(storage, config, out.record.aiProvenanceId)),
                    }, null, 2),
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
