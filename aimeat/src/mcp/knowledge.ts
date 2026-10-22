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
 *   registerKnowledgeTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged, scopes, caller);
 * @version-history
 *   2026-10-22 — SECURITY: aimeat_knowledge_links lists the outgoing rows of the namespace that holds
 *     the package it read, so another account's record at the same key no longer brings that
 *     account's rows into the answer (secaudit 2026-10, v78).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-21 — When the visibility rule left records out, the list, get, links and resource say so
 *     with READ_AS_OWNER_NOTE (and `omitted` in a JSON answer), as the librarian search does: an agent
 *     got a shorter list or "Package not found" with no reason, and could not ask the owner for
 *     memory:read-as-owner (capability-loss review).
 *   2026-10-20 — SECURITY: the knowledge list, get, links and resource read the owner's and sibling
 *     agents' records through ownerScopeView (memory:read-as-owner, services/owner-scope-read.ts), and
 *     the three read tools declare memory:read in the catalog. Any agent, with any scope, read their
 *     private package manifests and entry values (secaudit 2026-10, v56).
 *   2026-10-17 — SECURITY: aimeat_knowledge_links asks the package read first (readPackage), as the
 *     REST route does; it answered any package's links to any agent.
 *   2026-10-13 — aimeat_knowledge_get and the knowledge-package resource answer a manifest's pacing
 *     amount as sharing.toll_morsels, also for one stored with sharing.morsel_price
 *     (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   2026-10-05 — The caller is the session's CallerContext (services/caller-context.ts) instead of an object built here (secaudit 2026-10, C9).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   2026-10-06 — aimeat_knowledge_contribute takes the catalog's schema too.
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
 *   v1.7.0 — 2026-09-29 — TARGET-082 V4: every manifest and entry this surface returns passes the
 *     session's classification reader (readerForAgent) through presentMemories: the resource list and
 *     read, aimeat_knowledge_list (appdev-kb.ts listOwnerScopeShown) and aimeat_knowledge_get. A
 *     manifest the agent may not see reads as not found; an entry it may not see is left out; a
 *     warning-labelled one carries `classificationWarning`.
 *   v1.8.0 — 2026-10-12 — aimeat_knowledge_get and the knowledge resource read one package across
 *     the owner's identities (readPackage, over listOwnerScopeShown), as aimeat_knowledge_list does.
 *     Both read the agent's own namespace only, so a package the owner imported in person was
 *     listed and then answered "Package not found".
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { listOwnerScopeShown } from '../services/appdev-kb.js';
import { readerForAgent } from '../services/classification/reader.js';
import { classificationWarningOf } from '../services/classification/present-memory.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenanceMany } from './ai-provenance-result.js';
import {
    addKnowledgePackageEntry, type KnowledgeManifestValue,
} from '../services/knowledge-package-entry.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { agentSessionCaller, type CallerContext } from '../services/caller-context.js';
import { presentKnowledgeManifest } from '../services/toll-morsels-names.js';
import { readsAsOwner, READ_AS_OWNER_NOTE } from '../services/owner-scope-read.js';

export function registerKnowledgeTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** The session's own scopes, for the classification reader. */
    sessionScopes: string[] = [],
    /** The session's caller (services/caller-context.ts), for the gate inside the shared memory write.
     *  register-all.ts passes it; a caller that does not (test/unit/classification-knowledge.test.ts)
     *  gets the same agent built from the arguments above. */
    caller: () => CallerContext = () => agentSessionCaller(getAgentGaii(), '', sessionScopes, config.nodeId, storage),
): void {
    const agentGaii = getAgentGaii();

    // Every manifest and entry this surface returns is user content, so what the agent is shown is
    // the classification reader's decision (TARGET-082). One reader per call: it caches the owner's
    // memberships, which must not outlive the call.
    const reader = () => readerForAgent({ storage, config }, agentGaii, sessionScopes);
    // Owner-scope memory aggregation is services/appdev-kb.ts — packages may sit under the owner's
    // GHII (web UI import) or any of their agents, and which duplicate key wins is a priority order
    // that has to be the same answer on both surfaces.
    // An agent reads the owner's and its siblings' records only as the visibility rule admits, unless
    // it reads as the owner (memory:read-as-owner; services/owner-scope-read.ts). Applied before the
    // GHII-first dedupe (appdev-kb.ts), as GET /v1/memory/:key?owner_scope=true applies it.
    // `omitted` counts what the visibility rule left out, so an answer that is shorter, or "not
    // found", says why and names the permission that shows it (READ_AS_OWNER_NOTE), as the librarian
    // search does. Without it an agent cannot tell a missing package from one it may not read.
    const view = (omitted: { count: number }) => {
        const c = caller();
        return { principal: c.principal, readsAll: readsAsOwner(c), onOmitted: (n: number) => { omitted.count += n; } };
    };
    const listOwnerScopePackages = async () => {
        const omitted = { count: 0 };
        const records = await listOwnerScopeShown(storage, config, reader(), { prefix: 'packages/', tags: ['knowledge-package'] }, view(omitted));
        return { records, omitted: omitted.count };
    };
    /** What an answer adds when the visibility rule left records out. */
    const omittedNote = (omitted: number) => (omitted > 0 ? { omitted, note: READ_AS_OWNER_NOTE } : {});
    const warningOf = (record: object) => {
        const w = classificationWarningOf(record);
        return w ? { classificationWarning: w } : {};
    };
    // ONE PACKAGE, FOUND THE WAY THE LIST FINDS IT. aimeat_knowledge_list reads the owner's identities
    // and the read of one package read the agent's own namespace only, so the list named a package
    // the owner had imported in person and the get answered "Package not found" for that id (found
    // 2026-10-12 on production). Same listing, same classification reader, narrowed to one package:
    // null when this reader may see no manifest, which is also the answer for a package that does
    // not exist.
    const readPackage = async (packageId: string) => {
        const manifestKey = `packages/${packageId}/manifest`;
        const omitted = { count: 0 };
        const records = await listOwnerScopeShown(storage, config, reader(), { prefix: `packages/${packageId}/` }, view(omitted));
        const manifest = records.find(e => e.key === manifestKey);
        return { found: manifest ? { manifest, entries: records.filter(e => e.key !== manifestKey) } : null, omitted: omitted.count };
    };
    /** The "not found" answer, with the reason when the visibility rule left the package out. */
    const notFoundText = (packageId: string, omitted: number) =>
        `Package not found: ${packageId}${omitted > 0 ? `. ${READ_AS_OWNER_NOTE}` : ''}`;

    // ── Resource: knowledge package ──
    mcp.registerResource(
        'knowledge-package',
        new ResourceTemplate('aimeat://knowledge/{packageId}', {
            list: async () => {
                const { records: entries } = await listOwnerScopePackages();
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
            const { found, omitted } = await readPackage(packageId);
            if (!found) {
                return { contents: [{ uri: uri.toString(), text: omitted > 0 ? `Package not found. ${READ_AS_OWNER_NOTE}` : 'Package not found' }] };
            }
            const { manifest, entries } = found;
            const entryList = entries.map(e => ({
                key: e.key,
                visibility: e.visibility,
                tags: e.tags,
                ...warningOf(e),
            }));
            return {
                contents: [{
                    uri: uri.toString(),
                    text: JSON.stringify({
                        package_id: packageId,
                        manifest: presentKnowledgeManifest(manifest.value),
                        ...warningOf(manifest),
                        entry_count: entryList.length,
                        entries: entryList,
                        ...omittedNote(omitted),
                    }, null, 2),
                    mimeType: 'application/json',
                }],
            };
        },
    );

    // ── Tool 1: aimeat_knowledge_list ──
    mcp.registerTool(
        'aimeat_knowledge_list',
        {
            description: descriptionFor('aimeat_knowledge_list'),
            inputSchema: zodShapeFor('aimeat_knowledge_list'),
            annotations: annotationsFor('aimeat_knowledge_list'),
        },
        async () => {
            const { records: entries, omitted } = await listOwnerScopePackages();
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
                    ...warningOf(m),
                };
            });
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(packages, null, 2),
                    },
                    // A second text part, so the list keeps its shape (a JSON array) for every
                    // client that parses it, and an agent reads why the list is shorter.
                    ...(omitted > 0 ? [{ type: 'text' as const, text: `${omitted} package(s) left out. ${READ_AS_OWNER_NOTE}` }] : []),
                ],
            };
        },
    );

    // ── Tool 2: aimeat_knowledge_get ──
    mcp.registerTool(
        'aimeat_knowledge_get',
        {
            description: descriptionFor('aimeat_knowledge_get'),
            inputSchema: zodShapeFor('aimeat_knowledge_get'),
            annotations: annotationsFor('aimeat_knowledge_get'),
        },
        async ({ package_id }) => {
            // A manifest the agent may not see answers the same as one that does not exist.
            const { found, omitted } = await readPackage(package_id);
            if (!found) {
                return {
                    content: [{ type: 'text' as const, text: notFoundText(package_id, omitted) }],
                    isError: true,
                };
            }
            // The listing returns FULL records (SELECT *), so each entry already carries its value —
            // no getMemory per entry needed (was a redundant re-fetch of data already in hand). Each
            // entry passes the reader on its own label: a package can hold entries of mixed labels.
            const { manifest, entries } = found;
            // TARGET-058: how each entry was made, in ONE query for the whole package. A knowledge
            // package is exactly the material an agent later quotes back to a person as if it were
            // established fact, so per-entry origin is the difference between citing a source and
            // laundering a model's output through a package name.
            const provFor = await readProvenanceMany(storage, config, entries.map(e => e.aiProvenanceId));
            const entryDetails = entries
                .map(e => ({
                    key: e.key,
                    visibility: e.visibility,
                    value: e.value ?? null,
                    tags: e.tags,
                    ...provFor(e.aiProvenanceId),
                    ...warningOf(e),
                }));
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        package_id,
                        manifest: presentKnowledgeManifest(manifest.value),
                        ...warningOf(manifest),
                        entries: entryDetails,
                        ...omittedNote(omitted),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_knowledge_contribute ──
    mcp.registerTool(
        'aimeat_knowledge_contribute',
        {
            description: descriptionFor('aimeat_knowledge_contribute'),
            inputSchema: zodShapeFor('aimeat_knowledge_contribute'),
            annotations: annotationsFor('aimeat_knowledge_contribute'),
        },
        async ({ package_id, entry_key, content, model, ai_provenance, ai_provenance_id }) => {
            // ONE implementation (services/knowledge-package-entry.ts). The tool declares its
            // parameters because the protocol requires that, maps `ai_provenance` from the wire
            // shape, and renders the answer as text; the entry record, the reserved-package guard
            // and the manifest's index line belong to the capability, not to this door.
            const session = caller();
            const out = await addKnowledgePackageEntry({ storage, config }, {
                ...session.principalView,
                targetGaii: session.principal,
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
    mcp.registerTool(
        'aimeat_knowledge_links',
        {
            description: descriptionFor('aimeat_knowledge_links'),
            inputSchema: zodShapeFor('aimeat_knowledge_links'),
            annotations: annotationsFor('aimeat_knowledge_links'),
        },
        async ({ package_id, direction }) => {
            // The package read first, as GET /v1/knowledge/:id/links asks it: links of a package the
            // agent may not read answer the same as a package that does not exist.
            const read = await readPackage(package_id);
            if (!read.found) {
                return { content: [{ type: 'text' as const, text: notFoundText(package_id, read.omitted) }], isError: true };
            }
            const manifestKey = `packages/${package_id}/manifest`;
            // The outgoing rows of the namespace that holds the manifest read above, as GET
            // /v1/knowledge/:id/links lists them: never another account's rows at the same key
            // (secaudit 2026-10, v78).
            const links = await storage.listLinks(manifestKey, {
                direction: direction ?? 'both',
                sourceOwner: read.found.manifest.ownerGaii,
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
