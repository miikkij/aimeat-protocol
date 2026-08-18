/**
 * @file core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Core MCP tool and resource registrations. Contains all 18 tools and 3 resources
 *   that are registered on each MCP server session. Extracted from the monolithic mcp.ts to
 *   allow modular expansion of the tool set.
 * @structure
 *   - registerCoreTools() — registers all tools and resources on an McpServer instance
 * @usage
 *   import { registerCoreTools } from './core.js';
 *   registerCoreTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.17.0 — 2026-08-11 — aimeat_work_accept and aimeat_work_deliver call services/work-lifecycle.ts,
 *     the same functions POST /v1/work/:tc/accept and /deliver call. Accepting over MCP skipped the
 *     work→task bridge, so the agent had no task to work from; delivering over MCP skipped the
 *     requester's callback webhook and both extension hooks, so the requester was told about an HTTP
 *     delivery and not about this one.
 *   v1.16.0 — 2026-08-11 — aimeat_action_execute calls routes/work.ts createWorkItem, the same
 *     function POST /v1/work/request calls. It was a second, thinner implementation: no provider
 *     resolution (so cross-node work held escrow here while the provider's node heard nothing),
 *     no visiting-tier peer policy, no pending-queue ceiling.
 *   v1.13.0 — 2026-08-10 — aimeat_memory_write calls services/memory-write.ts. It had the same
 *     defect fixed inside it three separate times — schema locks, the write target, the provenance
 *     stamp — because it reimplemented what POST /v1/memory does instead of calling it.
 *   v1.0.0 — 2026-03-20 — Extracted from src/routes/mcp.ts (pure refactor, no logic changes)
 *   v1.1.0 -- 2026-05-28 -- Add memory tags and owner-scope listing support
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.3.0 -- 2026-05-30 -- MCP audit Phase 1: descriptions read from canonical catalog via
 *     descriptionFor(); read-heavy tools accept response_format ('concise'|'detailed') shaped by
 *     shapeResponse(). Returns standardised via jsonContent().
 *   v1.4.0 -- 2026-05-30 -- MCP audit Phase 2 (F3): aimeat_memory_list gains a limit param with a
 *     default + hard cap, and owner_scope aggregation stops at the cap (was unbounded).
 *   v1.5.0 -- 2026-05-30 -- MCP audit Phase 2 (F11): aimeat_storage_download returns a handle
 *     (resource_link + presigned download_url) instead of base64; inline=true only for small text.
 *   v1.6.0 -- 2026-05-30 -- MCP audit Phase 4 (F4): migrate core read tools (memory_read/list,
 *     wallet_balance, work_inbox, agents_list, agent_profile) to registerTool() with outputSchema +
 *     structuredContent (via structuredResult), keeping text content for back-compat.
 *   v1.7.0 -- 2026-05-30 -- F10 drift reconciliation: aimeat_memory_write gains ttl_hours (was hardcoded
 *     null) so both surfaces support group_id + ttl_hours.
 *   v1.8.0 -- 2026-06-10 -- aimeat_memory_write enforces schema locks (validateMemoryWrite) like the
 *     REST POST /v1/memory path — the MCP tool was a validation bypass: any agent could write past
 *     strict record schemas and the manifest-format schema (found while verifying the workspace
 *     backing gate: a knowledge-backed manifest sailed through MCP while REST returned 422).
 *   v1.9.0 -- 2026-07-11 -- aimeat_storage_upload inline result carries owner_gaii + embed_url/
 *     embed_markdown so an agent embeds images with the /v1/pub form, not a raw /v1/storage path.
 *   v1.9.1 -- 2026-07-13 -- Extracted the operator-only admin tools (15-18) to ./core-admin.ts
 *     (max-file-lines); registration order preserved (called last). No behavior change.
 *   v1.10.0 -- 2026-07-26 -- Namespace legibility. Memory is keyed by the WRITER, and the tools hid
 *     that: memory_read answered a bare "Memory not found" for a key an APP had saved under the
 *     owner's GHII, memory_list dropped every value without saying so, and memory_write silently
 *     accepted a write that owner-scope reads would then shadow. All three read as "the platform
 *     cannot share this data" and cost real redesign time. Now: memory_read looks once across the
 *     owner scope ON THE MISS PATH ONLY and returns NOT_IN_YOUR_NAMESPACE naming the holder, the
 *     owner_scope read path and the app-grant route for writes; memory_list discloses
 *     values_omitted + how to read one; memory_write returns SHADOWED_BY_OWNER_COPY when the
 *     owner already holds the key. Covered by test/e2e-memory-namespaces.ts.
 *   v1.11.0 -- 2026-07-26 -- Storage tools moved to ./core-storage.ts, where aimeat_storage_download
 *     now reads by REFERENCE (new `owner` param, or an
 *     "owner@node/key" key) through services/file-refs.ts, so an agent can open a file its OWNER
 *     uploaded or one that arrived as a DM/task attachment. It previously looked only in the caller's
 *     own namespace and answered a bare "File not found" — the file was reachable by policy the whole
 *     time (visibility:'owner' / a consent grant), only the lookup was namespaced. Denials now name
 *     the fix. Covered by test/e2e-agent-file-handoff.ts.
 *   v1.12.0 -- 2026-07-29 -- aimeat_memory_write emits the SSE `memory` domain. It was the one write
 *     surface that did not: the 24 REST paths in routes/memory/ emit, and so does every other MCP
 *     surface here (agents, scheduler, organisms, commerce, operator-config), but a write made over
 *     MCP reached storage and no live consumer heard about it. Measured on production against one
 *     open, healthy SSE stream: five writes through POST /v1/memory produced five
 *     {"domains":["memory"]} frames; three through this tool produced none. That is the difference
 *     between an app that fills in while an agent works and one that needs the human to reload.
 *   v1.13.0 -- 2026-08-01 -- TARGET-058 Phase 4. aimeat_memory_write and aimeat_board_post accept an
 *     `ai_provenance` declaration (and `ai_provenance_id`) and go through provenanceForWrite(), the
 *     same one decision function the REST paths use; aimeat_memory_read returns the record on the
 *     result. Both write tools reached storage DIRECTLY before this, so an agent writing over MCP
 *     left content with no provenance at all while the identical write over REST /v1/memory was
 *     stamped — the MCP hop was exactly where the information was being lost.
 *   v1.14.0 -- 2026-08-08 -- owner_scope on aimeat_memory_read and aimeat_memory_write, behind
 *     memory:write-as-owner, decided by the same routes/memory/owner-target.ts the REST path uses.
 *     The write result reports the namespace the record LANDED in rather than the caller: verified
 *     against production, a delegated write succeeded into the owner's GHII while answering with the
 *     agent's — for a call whose whole subject is which namespace was written, the one field that
 *     mattered was the one that was wrong.
 *   v1.15.0 -- 2026-08-09 -- expected_version on aimeat_memory_write. The optimistic lock the REST
 *     key route enforces was unreachable from MCP, so an agent's write was last-write-wins against
 *     a person editing the same record. Optional. Reasoning: mcp/memory-version-lock.ts.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import type { ResourceChangeEvent } from './index.js';
import { resourceEvents } from './index.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, shapeResponse, jsonContent, responseFormatSchema, structuredResult } from './catalog/shape.js';
import { buildDiscoveryRegistry, runDiscovery, computeFacets, type DiscoveryType } from '../services/discovery/index.js';
import { getAgentSkillLinks } from '../services/skills.js';
import { getOwnerScopeMemory } from '../services/owner-memory.js';
import { notInYourNamespace, shadowedByOwnerCopy, OWNER_SCOPE_LIST_NOTE } from './memory-namespace-hints.js';
import { walletBalanceOutput, memoryEntryOutput, memoryListOutput, genericListOutput, agentsListOutput, agentProfileOutput } from './catalog/output-schemas.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho, readProvenance, readProvenanceMany } from './ai-provenance-result.js';
import { registerCoreAdminTools } from './core-admin.js';
import { registerCoreStorageTools } from './core-storage.js';
import { registerCoreDataPackageTools } from './core-datapackage.js';
import { logger } from '../utils/logger.js';
import { flexibleBoolean } from './schema-flags.js';
import { resolveMcpWriteTarget } from '../routes/memory/owner-target.js';
import { versionConflict } from './memory-version-lock.js';
import { writeMemoryRecord } from '../services/memory-write.js';
import { createWorkItem } from '../routes/work.js';
import { acceptWork, deliverWork } from '../services/work-lifecycle.js';
import type { PeerInfo } from '../services/federation.js';
import { createBoardPost } from '../services/board-post.js';
import { boardReadRefusal } from '../services/board-read-access.js';


// F3: bound aimeat_memory_list so a default (and especially owner_scope) call cannot return an
// unbounded payload. jsonContent() is the universal char-budget backstop; these caps stop the
// aggregation earlier and give the agent an actionable "narrow your query" signal.
const MEMORY_LIST_DEFAULT_LIMIT = 200;
const MEMORY_LIST_MAX_LIMIT = 1000;

export function registerCoreTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
    /** This session's granted scopes. Needed by the owner_scope write gate; empty = no delegation. */
    sessionScopes: string[] = [],
    /** Known peers, for the provider resolution createWorkItem does on a cross-node commission. */
    peers: Map<string, PeerInfo> = new Map(),
): void {
    const agentGaii = getAgentGaii();

    // ── MCP Resources ──
    // Resource template: memory entries
    mcp.registerResource(
        'agent-memory',
        new ResourceTemplate('aimeat://memory/{key}', {
            list: async () => {
                const entries = await storage.listMemory(agentGaii, {});
                return {
                    resources: entries.map(e => ({
                        uri: `aimeat://memory/${encodeURIComponent(e.key)}`,
                        name: e.key,
                        mimeType: 'application/json',
                        description: `Memory entry: ${e.key}`,
                    })),
                };
            }
        }),
        { mimeType: 'application/json', description: 'Agent memory entries' },
        async (uri, variables) => {
            const key = decodeURIComponent(variables.key as string);
            const record = await storage.getMemory(agentGaii, key);
            if (!record) return { contents: [{ uri: uri.toString(), text: 'Not found' }] };
            return { contents: [{ uri: uri.toString(), text: JSON.stringify(record.value), mimeType: 'application/json' }] };
        },
    );

    // Resource template: storage files
    mcp.registerResource(
        'agent-storage',
        new ResourceTemplate('aimeat://storage/{key}', {
            list: async () => {
                const files = await storage.listStorageFiles(agentGaii);
                return {
                    resources: files.map(f => ({
                        uri: `aimeat://storage/${encodeURIComponent(f.key)}`,
                        name: f.key,
                        mimeType: f.mimeType,
                        description: `Storage file: ${f.key} (${f.size} bytes)`,
                    })),
                };
            }
        }),
        { mimeType: 'application/octet-stream', description: 'Agent binary storage files' },
        async (uri, variables) => {
            const key = decodeURIComponent(variables.key as string);
            const file = await storage.getStorageFile(agentGaii, key);
            if (!file) return { contents: [{ uri: uri.toString(), text: 'Not found' }] };
            return { contents: [{ uri: uri.toString(), blob: file.data.toString('base64'), mimeType: file.mimeType }] };
        },
    );

    // Resource: wallet balance (static URI)
    mcp.registerResource(
        'agent-wallet',
        `aimeat://wallet/${encodeURIComponent(agentGaii)}`,
        { mimeType: 'application/json', description: 'Agent morsel wallet balance' },
        async (uri) => {
            const agent = await storage.getAgent(agentGaii);
            if (!agent) return { contents: [{ uri: uri.toString(), text: '{}' }] };
            const ghii = await storage.getGHIIByOwner(agent.owner);
            const balance = ghii?.morselBalance ?? 0;
            return { contents: [{ uri: uri.toString(), text: JSON.stringify({ balance }), mimeType: 'application/json' }] };
        },
    );

    // ── Resource change listener ──
    // Forward resource:updated events to this session's SSE stream
    const onResourceUpdated = (evt: ResourceChangeEvent) => {
        if (evt.agentGaii === agentGaii) {
            mcp.server.sendResourceUpdated({ uri: evt.uri }).catch(err => { logger.warn('onResourceUpdated: continuing after a suppressed failure', { error: String(err) }); });
        }
    };
    const onResourceListChanged = (evt: { agentGaii: string }) => {
        if (evt.agentGaii === agentGaii) {
            mcp.server.sendResourceListChanged().catch(err => { logger.warn('onResourceListChanged: continuing after a suppressed failure', { error: String(err) }); });
        }
    };
    resourceEvents.on('resource:updated', onResourceUpdated);
    resourceEvents.on('resource:listChanged', onResourceListChanged);

    // Clean up listeners when the MCP server closes
    mcp.server.onclose = () => {
        resourceEvents.off('resource:updated', onResourceUpdated);
        resourceEvents.off('resource:listChanged', onResourceListChanged);
    };

    // ── Tool 1: aimeat_catalogue_search ──
    mcp.tool(
        'aimeat_catalogue_search',
        descriptionFor('aimeat_catalogue_search'),
        { search: z.string().optional(), category: z.string().optional(), response_format: responseFormatSchema },
        annotationsFor('aimeat_catalogue_search'),
        async ({ search, category, response_format }) => {
            const actions = await storage.listActions({ search, category });
            const payload = actions.map(a => ({
                action_id: a.id,
                provider_gaii: a.providerGaii,
                display_name: a.displayName,
                description: a.description,
                category: a.category,
                pricing: a.pricing,
                tags: a.tags,
            }));
            return jsonContent(shapeResponse('aimeat_catalogue_search', response_format, payload));
        },
    );

    // ── Tool 1b: aimeat_discover (master directory) ──
    // Domain-agnostic discovery across every content type via the shared source registry. The agent
    // is the caller; its full-owner-set view is gated by the agent's own read-scopes (design §11.3).
    const discoveryRegistry = buildDiscoveryRegistry(storage, config);
    const VALID_DISCOVER_TYPES = new Set<DiscoveryType>([
        'capability', 'workflow', 'knowledge', 'decision', 'research', 'material',
        'company', 'offering', 'document', 'organism', 'app', 'template', 'skill', 'memory',
    ]);
    const discoverCsv = (v: string | undefined): string[] =>
        typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
    mcp.tool(
        'aimeat_discover',
        descriptionFor('aimeat_discover'),
        {
            mode: z.enum(['map', 'find']).optional(),
            q: z.string().optional(),
            type: z.string().optional(),
            tags: z.string().optional(),
            segment: z.string().optional(),
            scope: z.enum(['own', 'public', 'shared']).optional(),
            limit: z.number().optional(),
            response_format: responseFormatSchema,
        },
        annotationsFor('aimeat_discover'),
        async ({ mode, q, type, tags, segment, scope, limit, response_format }) => {
            const parsed = parseGAII(agentGaii);
            const agent = await storage.getAgent(agentGaii);
            const types = discoverCsv(type).filter((t): t is DiscoveryType => VALID_DISCOVER_TYPES.has(t as DiscoveryType));
            const lim = typeof limit === 'number' && limit > 0 ? Math.min(limit, 100) : 20;
            const ctx = {
                caller: {
                    ownerName: parsed?.owner ?? '',
                    sub: agentGaii,
                    gaii: agentGaii,
                    isOwnerSession: false,
                    scopes: agent?.defaultScopes ?? [],
                },
                scope: (scope ?? 'own') as 'own' | 'public' | 'shared',
                filters: {
                    q: q?.trim() || undefined,
                    types: types.length ? types : undefined,
                    tags: discoverCsv(tags).length ? discoverCsv(tags) : undefined,
                    segments: discoverCsv(segment).length ? discoverCsv(segment) : undefined,
                    limit: lim,
                },
                nodeId: config.nodeId,
            };
            const entries = await runDiscovery(discoveryRegistry, ctx);
            if (mode === 'map') {
                return jsonContent({ scope: ctx.scope, total: entries.length, ...computeFacets(entries) });
            }
            const payload = { entries: entries.slice(0, lim), total: entries.length, scope: ctx.scope, facets: computeFacets(entries) };
            return jsonContent(shapeResponse('aimeat_discover', response_format, payload));
        },
    );

    // ── Tool 2: aimeat_agent_profile ──
    mcp.registerTool(
        'aimeat_agent_profile',
        { description: descriptionFor('aimeat_agent_profile'), inputSchema: { gaii: z.string() }, outputSchema: agentProfileOutput, annotations: annotationsFor('aimeat_agent_profile') },
        async ({ gaii }) => {
            const agent = await storage.getAgent(gaii);
            if (!agent) return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
            // Linked skills (registry refs) — only exposed for same-owner agents.
            let skills: Array<{ ref: string; name: string; description: string }> = [];
            const callerOwner = parseGAII(agentGaii)?.owner;
            if (callerOwner && agent.owner === callerOwner) {
                const links = await getAgentSkillLinks(storage, config, agent.owner, agent.name);
                skills = links.map(l => ({ ref: l.ref, name: l.name, description: l.description }));
            }
            return structuredResult('aimeat_agent_profile', undefined, {
                gaii: agent.gaii,
                display_name: agent.displayName,
                description: agent.description,
                capabilities: agent.capabilities,
                trust_score: agent.trustScore,
                created_at: agent.createdAt,
                skills,
            });
        },
    );

    // ── Tool 2b: aimeat_agents_list ──
    // Lists the calling owner's agents. Used by Claude Desktop and other
    // owner-scoped MCP clients to discover who they can delegate to via
    // aimeat_task_create. Mirrors the REST endpoint GET /v1/agents.
    mcp.registerTool(
        'aimeat_agents_list',
        { description: descriptionFor('aimeat_agents_list'), inputSchema: {}, outputSchema: agentsListOutput, annotations: annotationsFor('aimeat_agents_list') },
        async () => {
            const parsed = parseGAII(agentGaii);
            if (!parsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            const agents = await storage.getAgentsByOwner(parsed.owner);
            return structuredResult('aimeat_agents_list', undefined, {
                agents: agents.map(a => ({
                    gaii: a.gaii,
                    name: a.name,
                    owner: a.owner,
                    display_name: a.displayName,
                    description: a.description,
                    capabilities: a.capabilities,
                    technical_capabilities: a.technicalCapabilities,
                    domain_capabilities: a.domainCapabilities,
                    languages: a.languages ?? [],
                    trust_score: a.trustScore,
                    created_at: a.createdAt,
                    last_seen: a.lastSeen,
                    federate: a.federate ?? false,
                    tags: a.tags ?? [],
                    mode: a.mode ?? 'interactive',
                })),
            });
        },
    );

    // ── Tool 3: aimeat_memory_read ──
    mcp.registerTool(
        'aimeat_memory_read',
        { description: descriptionFor('aimeat_memory_read'), inputSchema: { key: z.string(), owner_scope: flexibleBoolean.optional().describe("Also look in the OWNER's namespace and your sibling agents', not only your own. The same opt-in GET /v1/memory/:key?owner_scope=true has always had — the record was readable by policy the whole time, only this tool's lookup was namespaced."), response_format: responseFormatSchema }, outputSchema: memoryEntryOutput, annotations: annotationsFor('aimeat_memory_read') },
        async ({ key, owner_scope, response_format }) => {
            // Own namespace first, so a caller that holds its own copy is unaffected by the opt-in.
            const parsedRead = parseGAII(agentGaii);
            let record = await storage.getMemory(agentGaii, key);
            if (!record && owner_scope && parsedRead) {
                record = await getOwnerScopeMemory(storage, config.nodeId, parsedRead.owner, key);
            }
            if (!record) {
                // Memory is keyed by the WRITER, so a key an APP saved lives under the owner's GHII
                // and a sibling agent's key lives under its GAII. A bare "Memory not found" here has
                // repeatedly been read as "the platform cannot share this data" and sent callers off
                // to redesign around a limitation that does not exist. Look once across the owner
                // scope and, when the key does exist, say exactly where it lives and how to reach it.
                // The extra query runs ONLY on the miss path, where the answer was an error anyway.
                const parsed = parseGAII(agentGaii);
                const elsewhere = parsed
                    ? await getOwnerScopeMemory(storage, config.nodeId, parsed.owner, key)
                    : null;
                if (elsewhere) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify(notInYourNamespace(key, agentGaii, elsewhere.ownerGaii), null, 2),
                        }],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text' as const, text: 'Memory not found' }], isError: true };
            }
            return structuredResult('aimeat_memory_read', response_format, {
                key: record.key,
                value: record.value,
                visibility: record.visibility,
                tags: record.tags,
                version: record.version,
                updated_at: record.updatedAt,
                // TARGET-058: how this was made, so an agent summarising several records for a person
                // can say which of them a model wrote. Absence means UNSTATED, never "a person wrote
                // it". The caller has already passed the read gate above; provenance travels with the
                // content it describes.
                ...(await readProvenance(storage, config, record.aiProvenanceId)),
            });
        },
    );

    // ── Tool 4: aimeat_memory_write ──
    mcp.tool(
        'aimeat_memory_write',
        descriptionFor('aimeat_memory_write'),
        {
            key: z.string().describe('Memory key (hierarchical, slash-separated)'),
            value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).describe('The value to store — any JSON type'),
            visibility: z.enum(['private', 'owner', 'group', 'members', 'public']).default('private').describe('private = only you, owner = all your agents, group = sharing group members, members = any logged-in user of this node, public = anyone'),
            group_id: z.string().optional().describe('ID of sharing group for group visibility'),
            tags: z.array(z.string()).default([]).describe('Optional tags for filtering'),
            ttl_hours: z.number().optional().describe('Time-to-live in hours (entry expires after this; omit for no expiry)'),
            owner_scope: flexibleBoolean.optional().describe("Write this under the OWNER instead of yourself, so the owner's own tools read it as theirs. Requires the memory:write-as-owner scope, which your owner grants per agent. Without this flag every write lands in your own namespace exactly as before. Does not change `visibility` — where a record lives and who may read it are separate."),
            expected_version: z.number().int().nonnegative().optional().describe("Optimistic lock: the `version` you read from this record. The write is refused with VERSION_CONFLICT if the record has changed since, so you never silently overwrite an edit someone else made in between. Pass 0 to assert the key does not exist yet. Omit it and the write proceeds as before (last write wins) — supply it whenever a human or another agent can be editing the same record."),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_memory_write'),
        async ({ key, value, visibility, group_id, tags, ttl_hours, owner_scope, expected_version, ai_provenance, ai_provenance_id }) => {
            // ONE implementation, and it is not this one. services/memory-write.ts owns the scope
            // gate, the schema lock, the version check, the shadowing warning, the provenance stamp,
            // the record shape and the change event — because every one of those had to be fixed
            // here separately after it was already right on the REST side.
            //
            // What stays: parsing the tool's own parameters, resolving where the write lands, and
            // rendering the answer as text. Those are this door's business and nobody else's.
            const parsedWrite = parseGAII(agentGaii);
            const target = resolveMcpWriteTarget({
                agentGaii, ownerName: parsedWrite?.owner ?? null, nodeId: config.nodeId,
                scopes: sessionScopes, key, ownerScope: owner_scope === true,
            });
            if ('deny' in target) {
                return { content: [{ type: 'text' as const, text: JSON.stringify(target.deny, null, 2) }], isError: true };
            }
            const writeGaii = target.gaii;

            const written = await writeMemoryRecord({ storage, config }, {
                principal: agentGaii,
                targetGaii: writeGaii,
                scopes: sessionScopes,
                roles: ['agent'],
            }, {
                key, value, visibility,
                groupId: visibility === 'group' ? group_id : undefined,
                tags,
                ttlHours: ttl_hours ?? null,
                expectedVersion: expected_version,
                declaredProvenanceId: ai_provenance_id,
                declaredProvenance: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.memory_write',
                ownerScoped: owner_scope === true,
            });

            if (!written.ok) {
                // A version conflict has answered in this exact shape since the lock existed, and an
                // agent parses it. The shared service reports the same facts under its own names, so
                // this door renders them back into the contract it published.
                if (written.code === 'VERSION_CONFLICT') {
                    const d = written.details as { currentVersion: number; expectedVersion: number };
                    return versionConflict(d.expectedVersion, d.currentVersion, key)!;
                }
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ error: written.code, message: written.message, ...(written.details as object ?? {}) }, null, 2),
                    }],
                    isError: true,
                };
            }
            const { record, shadowedBy } = written;
            const aiProvenanceId = record.aiProvenanceId;
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        key: record.key, version: record.version, visibility: record.visibility,
                        // The namespace it ACTUALLY landed in, not the caller. With owner_scope
                        // those differ, and that difference is the entire subject of the call —
                        // reporting the caller here told a successful delegated write it had gone
                        // to the agent's own namespace, which is the one thing it had not done.
                        tags: record.tags, written: true, owner_gaii: record.ownerGaii,
                        ...(writeGaii !== agentGaii ? { wrote_as_owner: true } : {}),
                        // What the node recorded about how this was made — returned so the agent can
                        // see the stamp it got by saying nothing, rather than discovering it later.
                        ...(await writeProvenanceEcho(storage, config, aiProvenanceId)),
                        ...(shadowedBy ? shadowedByOwnerCopy(key, agentGaii, shadowedBy) : {}),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 5: aimeat_memory_list ──
    mcp.registerTool(
        'aimeat_memory_list',
        { description: descriptionFor('aimeat_memory_list'), outputSchema: memoryListOutput, annotations: annotationsFor('aimeat_memory_list'), inputSchema: {
            prefix: z.string().optional(),
            visibility: z.string().optional(),
            tags: z.array(z.string()).optional().describe('Optional tag filters'),
            owner_scope: flexibleBoolean.optional().describe('When true, list same-owner GHII and agent memory'),
            limit: z.number().int().positive().max(MEMORY_LIST_MAX_LIMIT).optional().describe(`Max entries to return (default ${MEMORY_LIST_DEFAULT_LIMIT}, hard cap ${MEMORY_LIST_MAX_LIMIT})`),
            response_format: responseFormatSchema,
        } },
        async ({ prefix, visibility, tags, owner_scope, limit, response_format }) => {
            const cap = Math.min(limit ?? MEMORY_LIST_DEFAULT_LIMIT, MEMORY_LIST_MAX_LIMIT);
            let entries: Awaited<ReturnType<Storage['listMemory']>>;
            let truncated = false;
            if (owner_scope) {
                const parsed = parseGAII(agentGaii);
                if (!parsed) {
                    return {
                        content: [{
                            type: 'text' as const,
                            text: JSON.stringify({ error: 'Invalid agent GAII', gaii: agentGaii }, null, 2),
                        }],
                    };
                }
                const ownerGhii = `${parsed.owner}@${config.nodeId}`;
                const agents = await storage.getAgentsByOwner(parsed.owner);
                entries = [...await storage.listMemory(ownerGhii, { prefix, visibility, tags })];
                // Stop accumulating once we exceed the cap — owner-scope can otherwise aggregate
                // every agent's memory unbounded.
                for (const agent of agents) {
                    if (entries.length > cap) break;
                    entries.push(...await storage.listMemory(agent.gaii, { prefix, visibility, tags }));
                }
            } else {
                entries = await storage.listMemory(agentGaii, { prefix, visibility, tags });
            }
            if (entries.length > cap) { entries = entries.slice(0, cap); truncated = true; }
            const items = entries.map(e => ({
                key: e.key,
                owner_gaii: e.ownerGaii,
                visibility: e.visibility,
                tags: e.tags,
                version: e.version,
                updated_at: e.updatedAt,
            }));
            // This listing is METADATA ONLY — no values, on either path. With owner_scope that is
            // actively misleading: the caller sees a key it cannot then read, because
            // aimeat_memory_read only ever reads its OWN namespace. Say both things in the reply
            // rather than leaving the caller to conclude the data is unreachable.
            const truncHint = `Showing first ${cap}. Narrow with prefix/tags or raise limit (max ${MEMORY_LIST_MAX_LIMIT}).`;
            const scopeNote = owner_scope ? OWNER_SCOPE_LIST_NOTE : null;
            const payload = (truncated || scopeNote)
                ? {
                    items,
                    count: items.length,
                    ...(truncated ? { truncated: true, shown: items.length } : {}),
                    ...(scopeNote ? { values_omitted: true, note: scopeNote } : {}),
                    ...(truncated ? { hint: truncHint } : {}),
                }
                : items;
            return structuredResult('aimeat_memory_list', response_format, payload);
        },
    );

    // ── Tool 6: aimeat_action_execute ──
    mcp.tool(
        'aimeat_action_execute',
        descriptionFor('aimeat_action_execute'),
        {
            action_id: z.string(),
            provider_gaii: z.string(),
            input: z.record(z.string(), z.any()),
            ttl_hours: z.number().optional(),
        },
        annotationsFor('aimeat_action_execute'),
        async ({ action_id, provider_gaii, input, ttl_hours }) => {
            // One implementation, called from both doors. This tool used to re-do the commission by
            // hand and got a thinner version of it: it never resolved the provider, so cross-node
            // work created a LOCAL row and held the requester's morsels in escrow while the
            // provider's node heard nothing and the item sat pending until TTL; it skipped the
            // visiting-tier peer policy, the cap that makes the lightweight join safe; and it
            // skipped the pending-queue ceiling, so one agent could flood another's work inbox past
            // a limit the HTTP door enforces. The self-work, same-owner and pre_work_request checks
            // added on 2026-08-11 live in there too, so this is now one place rather than two.
            const result = await createWorkItem(
                config, storage, agentGaii,
                { action_id, provider_gaii, input, ttl_hours },
                peers,
            );
            if ('error' in result) {
                return { content: [{ type: 'text' as const, text: `${result.code}: ${result.error}` }], isError: true };
            }
            const { work } = result;
            if (!work) {
                // A cross-node commission that was forwarded: the provider's node owns the row, and
                // this node has nothing local to report. The HTTP door answers the same way.
                return { content: [{ type: 'text' as const, text: JSON.stringify({ forwarded: true, note: 'The request was routed to the provider node that holds this agent.' }, null, 2) }] };
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        tracking_code: work.trackingCode,
                        status: work.status,
                        cost: {
                            base_price: work.cost.basePrice,
                            network_fee: work.cost.networkFee,
                            total: work.cost.total,
                        },
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 7: aimeat_work_inbox ──
    mcp.registerTool(
        'aimeat_work_inbox',
        { description: descriptionFor('aimeat_work_inbox'), inputSchema: { response_format: responseFormatSchema }, outputSchema: genericListOutput, annotations: annotationsFor('aimeat_work_inbox') },
        async ({ response_format }) => {
            const items = await storage.listWorkByProvider(agentGaii);
            const pending = items.filter(w => ['pending', 'accepted', 'in_progress'].includes(w.status));
            return structuredResult('aimeat_work_inbox', response_format, pending.map(w => ({
                tracking_code: w.trackingCode,
                status: w.status,
                action_id: w.actionId,
                requester_gaii: w.requesterGaii,
                cost: w.cost,
                created_at: w.createdAt,
            })));
        },
    );

    // ── Tool 8: aimeat_work_accept ──
    mcp.tool(
        'aimeat_work_accept',
        descriptionFor('aimeat_work_accept'),
        { tracking_code: z.string() },
        annotationsFor('aimeat_work_accept'),
        async ({ tracking_code }) => {
            // ONE implementation (services/work-lifecycle.ts). This tool wrote the status itself and
            // skipped the work→task bridge the HTTP door runs, so an agent that accepted its work
            // over MCP, the door an agent actually uses, got no task to drive the job from.
            const accepted = await acceptWork({ storage, config }, agentGaii, tracking_code);
            if (!accepted.ok) {
                return { content: [{ type: 'text' as const, text: `${accepted.code}: ${accepted.message}` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ tracking_code, status: accepted.work.status }, null, 2) }] };
        },
    );

    // ── Tool 9: aimeat_work_deliver ──
    mcp.tool(
        'aimeat_work_deliver',
        descriptionFor('aimeat_work_deliver'),
        { tracking_code: z.string(), output: z.record(z.string(), z.any()), metadata: z.unknown().optional() },
        annotationsFor('aimeat_work_deliver'),
        async ({ tracking_code, output }) => {
            // ONE implementation (services/work-lifecycle.ts). This tool settled and stored the
            // output by hand, and that was all it did: the requester's callback_url was never
            // called, so a delivery made over MCP left a requester who is not sitting on the node
            // waiting, and neither post_settlement nor post_work_delivery ran, so an installed
            // extension saw the HTTP deliveries and none of these.
            const delivered = await deliverWork({ storage, config }, agentGaii, tracking_code, output);
            if (!delivered.ok) {
                return { content: [{ type: 'text' as const, text: `${delivered.code}: ${delivered.message}` }], isError: true };
            }
            // Wallet balance changed for both parties
            emitResourceUpdated(agentGaii, `aimeat://wallet/${encodeURIComponent(agentGaii)}`);
            emitResourceUpdated(delivered.work.requesterGaii, `aimeat://wallet/${encodeURIComponent(delivered.work.requesterGaii)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ tracking_code, status: delivered.work.status }, null, 2) }] };
        },
    );

    // ── Tool 10: aimeat_wallet_balance ──
    mcp.registerTool(
        'aimeat_wallet_balance',
        { description: descriptionFor('aimeat_wallet_balance'), inputSchema: {}, outputSchema: walletBalanceOutput, annotations: annotationsFor('aimeat_wallet_balance') },
        async () => {
            const agent = await storage.getAgent(agentGaii);
            if (!agent) return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
            const ghii = await storage.getGHIIByOwner(agent.owner);
            const balance = ghii?.morselBalance ?? 0;
            const { calculateEscrow } = await import('../services/morsel.js');
            const inEscrow = await calculateEscrow(storage, agentGaii);
            return structuredResult('aimeat_wallet_balance', undefined, {
                balance,
                in_escrow: inEscrow,
                available: balance - inEscrow,
            });
        },
    );

    // ── Tool 11: aimeat_board_read ──
    mcp.tool(
        'aimeat_board_read',
        descriptionFor('aimeat_board_read'),
        { board_id: z.string(), category: z.string().optional(), limit: z.number().optional(), response_format: responseFormatSchema },
        annotationsFor('aimeat_board_read'),
        async ({ board_id, category, limit, response_format }) => {
            // Load the board and rule on it. This tool used to list the posts and nothing else, so
            // it never had a visibility to rule on: any MCP session read another owner's PRIVATE
            // board, and no consent-denial row existed to show it happened. The MCP RESOURCE for the
            // same board filtered on visibility, so the two doors to one board disagreed.
            const board = await storage.getBoard(board_id);
            if (!board) return { content: [{ type: 'text' as const, text: `Board not found: ${board_id}` }], isError: true };
            const refusal = await boardReadRefusal({ storage, config }, agentGaii, board);
            if (refusal) return { content: [{ type: 'text' as const, text: `${refusal.code}: ${refusal.message}` }], isError: true };

            const posts = await storage.listPosts(board_id, { category, limit: limit ?? 20 });
            // TARGET-058: an agent asked to summarise a board has to be able to say which posts a
            // model wrote. One query for the page — see readProvenanceMany's N+1 note.
            const provFor = await readProvenanceMany(storage, config, posts.map(p => p.aiProvenanceId));
            return jsonContent(shapeResponse('aimeat_board_read', response_format, posts.map(p => ({
                id: p.id,
                author_gaii: p.authorGaii,
                title: p.title,
                body: p.body,
                category: p.category,
                reactions: p.reactions,
                created_at: p.createdAt,
                ...provFor(p.aiProvenanceId),
            }))));
        },
    );

    // ── Tool 12: aimeat_board_post ──
    mcp.tool(
        'aimeat_board_post',
        descriptionFor('aimeat_board_post'),
        { board_id: z.string(), title: z.string(), body: z.string(), category: z.string().optional(), ...aiProvenanceInputs },
        annotationsFor('aimeat_board_post'),
        async ({ board_id, title, body, category, ai_provenance, ai_provenance_id }) => {
            // ONE implementation (services/board-post.ts). This tool never loaded the board, so it
            // had no access check, no price on a public board, no pre_board_post hook and no bound
            // on title or body. Any agent holding social:write posted into any board on the node,
            // including another owner's private one, for free.
            const posted = await createBoardPost({ storage, config }, {
                gaii: agentGaii,
                roles: ['agent'],
            }, {
                boardId: board_id, title, body, category,
                declaredProvenanceId: ai_provenance_id,
                declaredProvenance: toDeclaredProvenance(ai_provenance),
                pipeline: 'mcp.board_post',
            });
            if (!posted.ok) {
                return { content: [{ type: 'text' as const, text: `${posted.code}: ${posted.message}` }], isError: true };
            }
            const post = posted.post;
            const provenanceId = post.aiProvenanceId;
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                    id: post.id, board_id, title, posted: true,
                    ...(await writeProvenanceEcho(storage, config, provenanceId)),
                }, null, 2) }],
            };
        },
    );

    // ── Storage Tools (upload/download) — extracted to ./core-storage.ts ──
    registerCoreStorageTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);

    // ── Data Package Tools (publish/export) — extracted to ./core-datapackage.ts ──
    registerCoreDataPackageTools(mcp, storage, config, getAgentGaii);

    // ── Admin Tools (operator-only) — extracted to ./core-admin.ts ──
    registerCoreAdminTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
}
