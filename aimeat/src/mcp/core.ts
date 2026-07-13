/**
 * @file core.ts
 * @description Core MCP tool and resource registrations. Contains all 18 tools and 3 resources
 *   that are registered on each MCP server session. Extracted from the monolithic mcp.ts to
 *   allow modular expansion of the tool set.
 * @structure
 *   - registerCoreTools() — registers all tools and resources on an McpServer instance
 * @usage
 *   import { registerCoreTools } from './core.js';
 *   registerCoreTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
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
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { generateTrackingCode } from '../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow, settlePayment } from '../services/morsel.js';
import { generateUploadToken } from '../services/upload-token.js';
import { generateDownloadToken } from '../services/download-token.js';
import { pubEmbedUrl, pubEmbedMarkdown } from '../services/doc-images.js';
import type { ResourceChangeEvent } from './index.js';
import { resourceEvents } from './index.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, shapeResponse, jsonContent, responseFormatSchema, structuredResult } from './catalog/shape.js';
import { validateMemoryWrite } from '../services/schema-validator.js';
import { buildDiscoveryRegistry, runDiscovery, computeFacets, type DiscoveryType } from '../services/discovery/index.js';
import { getAgentSkillLinks } from '../services/skills.js';
import { walletBalanceOutput, memoryEntryOutput, memoryListOutput, genericListOutput, agentsListOutput, agentProfileOutput } from './catalog/output-schemas.js';
import { registerCoreAdminTools } from './core-admin.js';

// F3: bound aimeat_memory_list so a default (and especially owner_scope) call cannot return an
// unbounded payload. jsonContent() is the universal char-budget backstop; these caps stop the
// aggregation earlier and give the agent an actionable "narrow your query" signal.
const MEMORY_LIST_DEFAULT_LIMIT = 200;
const MEMORY_LIST_MAX_LIMIT = 1000;

// F11: storage holds binaries (images, video, large blobs). aimeat_storage_download returns a
// handle (resource_link + presigned download_url) instead of base64 so bytes never enter the
// model context. Only small text files may be returned inline.
const STORAGE_INLINE_MAX_BYTES = 32 * 1024;
function isInlineableMime(mime: string): boolean {
    return mime.startsWith('text/') || /(json|xml|csv|javascript|yaml|markdown)/i.test(mime);
}

export function registerCoreTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
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
            mcp.server.sendResourceUpdated({ uri: evt.uri }).catch(() => { });
        }
    };
    const onResourceListChanged = (evt: { agentGaii: string }) => {
        if (evt.agentGaii === agentGaii) {
            mcp.server.sendResourceListChanged().catch(() => { });
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
        { description: descriptionFor('aimeat_memory_read'), inputSchema: { key: z.string(), response_format: responseFormatSchema }, outputSchema: memoryEntryOutput, annotations: annotationsFor('aimeat_memory_read') },
        async ({ key, response_format }) => {
            const record = await storage.getMemory(agentGaii, key);
            if (!record) return { content: [{ type: 'text' as const, text: 'Memory not found' }], isError: true };
            return structuredResult('aimeat_memory_read', response_format, {
                key: record.key,
                value: record.value,
                visibility: record.visibility,
                tags: record.tags,
                version: record.version,
                updated_at: record.updatedAt,
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
        },
        annotationsFor('aimeat_memory_write'),
        async ({ key, value, visibility, group_id, tags, ttl_hours }) => {
            // Schema locks apply on EVERY write surface. This tool used to call setMemory directly,
            // making MCP a bypass around strict record schemas + the manifest-format schema (REST
            // returned 422 while the same write sailed through here). Mirror the REST behaviour.
            const validation = await validateMemoryWrite(key, value, storage);
            if (!validation.valid) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            error: 'SCHEMA_VALIDATION_FAILED',
                            message: 'Value does not match the schema for this key',
                            key,
                            violations: validation.errors,
                            schema_url: `/v1/memory/${encodeURIComponent(validation.schemaKey!)}/schema`,
                        }, null, 2),
                    }],
                    isError: true,
                };
            }
            const existing = await storage.getMemory(agentGaii, key);
            const record = await storage.setMemory({
                key,
                ownerGaii: agentGaii,
                value,
                visibility,
                groupId: visibility === 'group' ? group_id : undefined,
                tags,
                ttlHours: ttl_hours ?? null,
                version: existing ? existing.version + 1 : 1,
                createdAt: existing?.createdAt ?? new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            emitResourceUpdated(agentGaii, `aimeat://memory/${encodeURIComponent(key)}`);
            if (!existing) emitResourceListChanged(agentGaii);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ key: record.key, version: record.version, visibility: record.visibility, tags: record.tags, written: true }, null, 2),
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
            owner_scope: z.boolean().optional().describe('When true, list same-owner GHII and agent memory'),
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
            const payload = truncated
                ? { items, truncated: true, shown: items.length, hint: `Showing first ${cap}. Narrow with prefix/tags or raise limit (max ${MEMORY_LIST_MAX_LIMIT}).` }
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
            const ttl = ttl_hours ?? 24;
            const trackingCode = generateTrackingCode();
            const actions = await storage.listActions();
            const action = actions.find(a => a.id === action_id && a.providerGaii === provider_gaii);
            const baseMorsels = action?.pricing.baseMorsels ?? 0;
            const cost = calculateWorkCost(baseMorsels, config.burnRate);

            const held = await holdEscrow(storage, agentGaii, provider_gaii, trackingCode, cost.total);
            if (!held) {
                const requesterAgent = await storage.getAgent(agentGaii);
                const requesterGhii = requesterAgent ? await storage.getGHIIByOwner(requesterAgent.owner) : null;
                const requesterBalance = requesterGhii?.morselBalance ?? 0;
                return {
                    content: [{ type: 'text' as const, text: `Insufficient morsels. Need ${cost.total}, have ${requesterBalance}` }],
                    isError: true,
                };
            }

            const work = await storage.createWork({
                trackingCode,
                status: 'pending',
                actionId: action_id,
                providerGaii: provider_gaii,
                requesterGaii: agentGaii,
                input,
                cost,
                ttlExpiresAt: new Date(Date.now() + ttl * 3600_000).toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        tracking_code: work.trackingCode,
                        status: work.status,
                        cost: { base_price: cost.basePrice, network_fee: cost.networkFee, total: cost.total },
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
            const work = await storage.getWork(tracking_code);
            if (!work) return { content: [{ type: 'text' as const, text: 'Work not found' }], isError: true };
            if (work.providerGaii !== agentGaii) return { content: [{ type: 'text' as const, text: 'Not your work item' }], isError: true };
            if (work.status !== 'pending') return { content: [{ type: 'text' as const, text: `Cannot accept: status is ${work.status}` }], isError: true };
            await storage.updateWork(tracking_code, { status: 'accepted', updatedAt: new Date().toISOString() });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ tracking_code, status: 'accepted' }, null, 2) }] };
        },
    );

    // ── Tool 9: aimeat_work_deliver ──
    mcp.tool(
        'aimeat_work_deliver',
        descriptionFor('aimeat_work_deliver'),
        { tracking_code: z.string(), output: z.record(z.string(), z.any()), metadata: z.unknown().optional() },
        annotationsFor('aimeat_work_deliver'),
        async ({ tracking_code, output }) => {
            const work = await storage.getWork(tracking_code);
            if (!work) return { content: [{ type: 'text' as const, text: 'Work not found' }], isError: true };
            if (work.providerGaii !== agentGaii) return { content: [{ type: 'text' as const, text: 'Not your work item' }], isError: true };
            if (!['accepted', 'in_progress'].includes(work.status)) return { content: [{ type: 'text' as const, text: `Cannot deliver: status is ${work.status}` }], isError: true };
            await settlePayment(storage, config, work);
            await storage.updateWork(tracking_code, { status: 'delivered', output, updatedAt: new Date().toISOString() });
            // Wallet balance changed for both parties
            emitResourceUpdated(agentGaii, `aimeat://wallet/${encodeURIComponent(agentGaii)}`);
            emitResourceUpdated(work.requesterGaii, `aimeat://wallet/${encodeURIComponent(work.requesterGaii)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ tracking_code, status: 'delivered' }, null, 2) }] };
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
            const posts = await storage.listPosts(board_id, { category, limit: limit ?? 20 });
            return jsonContent(shapeResponse('aimeat_board_read', response_format, posts.map(p => ({
                id: p.id,
                author_gaii: p.authorGaii,
                title: p.title,
                body: p.body,
                category: p.category,
                reactions: p.reactions,
                created_at: p.createdAt,
            }))));
        },
    );

    // ── Tool 12: aimeat_board_post ──
    mcp.tool(
        'aimeat_board_post',
        descriptionFor('aimeat_board_post'),
        { board_id: z.string(), title: z.string(), body: z.string(), category: z.string().optional() },
        annotationsFor('aimeat_board_post'),
        async ({ board_id, title, body, category }) => {
            const { randomBytes } = await import('node:crypto');
            const postId = `post-${randomBytes(8).toString('hex')}`;
            const post = await storage.createPost({
                id: postId,
                boardId: board_id,
                authorGaii: agentGaii,
                title,
                body,
                category,
                tags: [],
                reactions: {},
                createdAt: new Date().toISOString(),
            });
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({ id: post.id, board_id, title, posted: true }, null, 2) }],
            };
        },
    );

    // ── Tool 13: aimeat_storage_upload ──
    mcp.tool(
        'aimeat_storage_upload',
        descriptionFor('aimeat_storage_upload'),
        {
            key: z.string().describe('Storage key (path-like identifier)'),
            data_base64: z.string().optional().describe('Base64-encoded file data. Omit to get an upload URL instead (recommended for files > 1KB).'),
            mime_type: z.string().optional().describe('MIME type (default: application/octet-stream)'),
            visibility: z.enum(['private', 'owner', 'group', 'public']).optional().describe('Access control (default: private)'),
            group_id: z.string().optional().describe('ID of sharing group for group visibility'),
        },
        annotationsFor('aimeat_storage_upload'),
        async ({ key, data_base64, mime_type, visibility, group_id }) => {
            // --- UPLOAD MODE ---
            if (!data_base64) {
                const maxBytes = 10 * 1024 * 1024;
                const contentType = mime_type ?? 'application/octet-stream';
                const token = await generateUploadToken({
                    sub: agentGaii,
                    utype: 'storage',
                    meta: { key, mime_type: contentType, visibility: visibility ?? 'private' },
                    maxBytes,
                    contentType,
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: contentType,
                            max_size_bytes: maxBytes,
                            expires_in_seconds: 3600,
                            note: 'PUT the raw file to upload_url. The response contains the result as JSON.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE ---
            const fileData = Buffer.from(data_base64, 'base64');
            if (fileData.length > 10 * 1024 * 1024) {
                return { content: [{ type: 'text' as const, text: 'File exceeds 10MB limit' }], isError: true };
            }
            const file = await storage.createStorageFile({
                key,
                ownerGaii: agentGaii,
                visibility: visibility ?? 'private',
                groupId: visibility === 'group' ? group_id : undefined,
                mimeType: mime_type ?? 'application/octet-stream',
                size: fileData.length,
                data: fileData,
                createdAt: new Date().toISOString(),
            });
            emitResourceUpdated(agentGaii, `aimeat://storage/${encodeURIComponent(key)}`);
            emitResourceListChanged(agentGaii);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                    mode: 'inline', key: file.key, owner_gaii: file.ownerGaii, size: file.size, uploaded: true,
                    // To embed this image in a workspace document, use embed_markdown / embed_url — NOT the raw
                    // /v1/storage/<key> path. Saving it into a document scopes the file to that workspace's
                    // members (visibility:'workspace'); it is never exposed to the public internet.
                    embed_url: pubEmbedUrl(file.ownerGaii, file.key),
                    embed_markdown: pubEmbedMarkdown(file.ownerGaii, file.key),
                }, null, 2) }],
            };
        },
    );

    // ── Tool 14: aimeat_storage_download ──
    mcp.tool(
        'aimeat_storage_download',
        descriptionFor('aimeat_storage_download'),
        {
            key: z.string(),
            inline: z.boolean().optional().describe('Only for small text files (<= 32 KB): return content inline. Binaries always return a download handle, never base64 in context.'),
        },
        annotationsFor('aimeat_storage_download'),
        async ({ key, inline }) => {
            const file = await storage.getStorageFile(agentGaii, key);
            if (!file) return { content: [{ type: 'text' as const, text: 'File not found' }], isError: true };
            const resourceUri = `aimeat://storage/${encodeURIComponent(key)}`;

            // Inline only for small text files — keeps binaries (images/video/large blobs) out of context.
            if (inline && file.size <= STORAGE_INLINE_MAX_BYTES && isInlineableMime(file.mimeType)) {
                return jsonContent({
                    key: file.key, mime_type: file.mimeType, size: file.size,
                    mode: 'inline', content_text: file.data.toString('utf8'), resource_uri: resourceUri,
                });
            }

            // Default: return a handle. resource_link lets MCP clients read bytes out-of-band via
            // resources/read; download_url is a presigned, TTL-limited HTTP fetch for everything else.
            const token = await generateDownloadToken({ sub: file.ownerGaii, key, mimeType: file.mimeType, size: file.size });
            return {
                content: [
                    {
                        type: 'resource_link' as const,
                        uri: resourceUri,
                        name: file.key,
                        mimeType: file.mimeType,
                        description: `${file.size} bytes — fetch via download_url; do not read the bytes into context`,
                    },
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            key: file.key, mime_type: file.mimeType, size: file.size, mode: 'handle',
                            download_url: `${config.baseUrl}/v1/download/${token}`,
                            download_method: 'GET', expires_in_seconds: 3600, resource_uri: resourceUri,
                            note: inline
                                ? 'inline refused (file too large or not text) — returning a handle instead'
                                : 'Binary content is not inlined. GET download_url to fetch the bytes out-of-band.',
                        }, null, 2),
                    },
                ],
            };
        },
    );

    // ── Admin Tools (operator-only) — extracted to ./core-admin.ts ──
    registerCoreAdminTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
}
