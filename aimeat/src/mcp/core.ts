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
import type { ResourceChangeEvent } from './index.js';
import { resourceEvents } from './index.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor, shapeResponse, jsonContent, responseFormatSchema } from './catalog/shape.js';

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

    // ── Tool 2: aimeat_agent_profile ──
    mcp.tool(
        'aimeat_agent_profile',
        descriptionFor('aimeat_agent_profile'),
        { gaii: z.string() },
        annotationsFor('aimeat_agent_profile'),
        async ({ gaii }) => {
            const agent = await storage.getAgent(gaii);
            if (!agent) return { content: [{ type: 'text' as const, text: 'Agent not found' }] };
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        gaii: agent.gaii,
                        display_name: agent.displayName,
                        description: agent.description,
                        capabilities: agent.capabilities,
                        trust_score: agent.trustScore,
                        created_at: agent.createdAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 2b: aimeat_agents_list ──
    // Lists the calling owner's agents. Used by Claude Desktop and other
    // owner-scoped MCP clients to discover who they can delegate to via
    // aimeat_task_create. Mirrors the REST endpoint GET /v1/agents.
    mcp.tool(
        'aimeat_agents_list',
        descriptionFor('aimeat_agents_list'),
        {},
        annotationsFor('aimeat_agents_list'),
        async () => {
            const parsed = parseGAII(agentGaii);
            if (!parsed) {
                return { content: [{ type: 'text' as const, text: 'Could not resolve caller identity' }], isError: true };
            }
            const agents = await storage.getAgentsByOwner(parsed.owner);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
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
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_memory_read ──
    mcp.tool(
        'aimeat_memory_read',
        descriptionFor('aimeat_memory_read'),
        { key: z.string(), response_format: responseFormatSchema },
        annotationsFor('aimeat_memory_read'),
        async ({ key, response_format }) => {
            const record = await storage.getMemory(agentGaii, key);
            if (!record) return { content: [{ type: 'text' as const, text: 'Memory not found' }] };
            return jsonContent(shapeResponse('aimeat_memory_read', response_format, {
                key: record.key,
                value: record.value,
                visibility: record.visibility,
                tags: record.tags,
                version: record.version,
                updated_at: record.updatedAt,
            }));
        },
    );

    // ── Tool 4: aimeat_memory_write ──
    mcp.tool(
        'aimeat_memory_write',
        descriptionFor('aimeat_memory_write'),
        {
            key: z.string().describe('Memory key (hierarchical, slash-separated)'),
            value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).describe('The value to store — any JSON type'),
            visibility: z.enum(['private', 'owner', 'group', 'public']).default('private').describe('private = only you, owner = all your agents, group = sharing group members, public = anyone'),
            group_id: z.string().optional().describe('ID of sharing group for group visibility'),
            tags: z.array(z.string()).default([]).describe('Optional tags for filtering'),
        },
        annotationsFor('aimeat_memory_write'),
        async ({ key, value, visibility, group_id, tags }) => {
            const existing = await storage.getMemory(agentGaii, key);
            const record = await storage.setMemory({
                key,
                ownerGaii: agentGaii,
                value,
                visibility,
                groupId: visibility === 'group' ? group_id : undefined,
                tags,
                ttlHours: null,
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
    mcp.tool(
        'aimeat_memory_list',
        descriptionFor('aimeat_memory_list'),
        {
            prefix: z.string().optional(),
            visibility: z.string().optional(),
            tags: z.array(z.string()).optional().describe('Optional tag filters'),
            owner_scope: z.boolean().optional().describe('When true, list same-owner GHII and agent memory'),
            limit: z.number().int().positive().max(MEMORY_LIST_MAX_LIMIT).optional().describe(`Max entries to return (default ${MEMORY_LIST_DEFAULT_LIMIT}, hard cap ${MEMORY_LIST_MAX_LIMIT})`),
            response_format: responseFormatSchema,
        },
        annotationsFor('aimeat_memory_list'),
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
            return jsonContent(shapeResponse('aimeat_memory_list', response_format, payload));
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
    mcp.tool(
        'aimeat_work_inbox',
        descriptionFor('aimeat_work_inbox'),
        { response_format: responseFormatSchema },
        annotationsFor('aimeat_work_inbox'),
        async ({ response_format }) => {
            const items = await storage.listWorkByProvider(agentGaii);
            const pending = items.filter(w => ['pending', 'accepted', 'in_progress'].includes(w.status));
            return jsonContent(shapeResponse('aimeat_work_inbox', response_format, pending.map(w => ({
                tracking_code: w.trackingCode,
                status: w.status,
                action_id: w.actionId,
                requester_gaii: w.requesterGaii,
                cost: w.cost,
                created_at: w.createdAt,
            }))));
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
        { tracking_code: z.string(), output: z.record(z.string(), z.any()) },
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
    mcp.tool(
        'aimeat_wallet_balance',
        descriptionFor('aimeat_wallet_balance'),
        {},
        annotationsFor('aimeat_wallet_balance'),
        async () => {
            const agent = await storage.getAgent(agentGaii);
            if (!agent) return { content: [{ type: 'text' as const, text: 'Agent not found' }], isError: true };
            const ghii = await storage.getGHIIByOwner(agent.owner);
            const balance = ghii?.morselBalance ?? 0;
            const { calculateEscrow } = await import('../services/morsel.js');
            const inEscrow = await calculateEscrow(storage, agentGaii);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        balance,
                        in_escrow: inEscrow,
                        available: balance - inEscrow,
                    }, null, 2),
                }],
            };
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
                content: [{ type: 'text' as const, text: JSON.stringify({ mode: 'inline', key: file.key, size: file.size, uploaded: true }, null, 2) }],
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

    // ── Admin Tools (operator-only) ──
    // These tools are registered for all sessions but check operator role at runtime.
    // This avoids needing to know roles at session creation time.

    async function isOperator(): Promise<boolean> {
        const parsed = parseGAII(agentGaii);
        if (!parsed) return false;
        const owner = await storage.getOwner(parsed.owner);
        return !!owner && owner.roles.includes('operator');
    }

    // ── Tool 15: aimeat_admin_stats ──
    mcp.tool(
        'aimeat_admin_stats',
        descriptionFor('aimeat_admin_stats'),
        {},
        annotationsFor('aimeat_admin_stats'),
        async () => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            const agents = await storage.listAgents();
            const actions = await storage.listActions();
            const boards = await storage.listBoards();
            const allWork = await storage.listAllWork();
            let totalMorsels = 0;
            let activeAgents = 0;
            const now = Date.now();
            const seenOwners = new Set<string>();
            for (const a of agents) {
                if (!seenOwners.has(a.owner)) {
                    seenOwners.add(a.owner);
                    const ghii = await storage.getGHIIByOwner(a.owner);
                    totalMorsels += ghii?.morselBalance ?? 0;
                }
                if (a.lastSeen && now - new Date(a.lastSeen).getTime() < 86_400_000) activeAgents++;
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        node_id: config.nodeId,
                        uptime_seconds: Math.floor(process.uptime()),
                        counts: { agents: agents.length, active_agents_24h: activeAgents, actions: actions.length, boards: boards.length, work_items: allWork.length },
                        economy: { total_morsels_in_circulation: totalMorsels },
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 16: aimeat_admin_agents ──
    mcp.tool(
        'aimeat_admin_agents',
        descriptionFor('aimeat_admin_agents'),
        { limit: z.number().optional() },
        annotationsFor('aimeat_admin_agents'),
        async ({ limit }) => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            const agents = await storage.listAgents();
            const subset = limit ? agents.slice(0, limit) : agents;
            const ownerBalances = new Map<string, number>();
            for (const a of subset) {
                if (!ownerBalances.has(a.owner)) {
                    const ghii = await storage.getGHIIByOwner(a.owner);
                    ownerBalances.set(a.owner, ghii?.morselBalance ?? 0);
                }
            }
            const result = subset.map(a => ({
                gaii: a.gaii, owner: a.owner, display_name: a.displayName,
                trust_score: a.trustScore, morsel_balance: ownerBalances.get(a.owner) ?? 0,
                last_seen: a.lastSeen, created_at: a.createdAt,
            }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    // ── Tool 17: aimeat_admin_config ──
    mcp.tool(
        'aimeat_admin_config',
        descriptionFor('aimeat_admin_config'),
        {},
        annotationsFor('aimeat_admin_config'),
        async () => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        node_id: config.nodeId, port: config.port,
                        storage_type: config.dbUrl ? 'mongodb' : 'in-memory',
                        jwt_ttl_seconds: config.jwtTtlSeconds,
                        welcome_bonus: config.welcomeBonus, daily_allowance: config.dailyAllowance,
                        burn_rate: config.burnRate, max_operator_mint_per_day: config.maxOperatorMintPerDay,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 18: aimeat_admin_mint ──
    mcp.tool(
        'aimeat_admin_mint',
        descriptionFor('aimeat_admin_mint'),
        { gaii: z.string(), amount: z.number().int().positive() },
        annotationsFor('aimeat_admin_mint'),
        async ({ gaii, amount }) => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            const agent = await storage.getAgent(gaii);
            if (!agent) return { content: [{ type: 'text' as const, text: `Agent not found: ${gaii}` }], isError: true };

            const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
            const allTx = await storage.listAllTransactions();
            const mintedToday = allTx
                .filter(tx => tx.type === 'mint' && new Date(tx.timestamp) >= dayStart)
                .reduce((sum, tx) => sum + tx.amount, 0);
            if (mintedToday + amount > config.maxOperatorMintPerDay) {
                return { content: [{ type: 'text' as const, text: `Daily mint cap (${config.maxOperatorMintPerDay}) would be exceeded. Already minted ${mintedToday} today.` }], isError: true };
            }

            await storage.creditBalance(gaii, amount);
            const { randomBytes: rb } = await import('node:crypto');
            await storage.addTransaction({
                id: `tx-${Date.now()}-${rb(4).toString('hex')}`,
                gaii, type: 'mint', amount,
                counterpartyGaii: agentGaii,
                timestamp: new Date().toISOString(),
            });
            emitResourceUpdated(gaii, `aimeat://wallet/${encodeURIComponent(gaii)}`);
            const mintedAgentRecord = await storage.getAgent(gaii);
            const mintedGhii = mintedAgentRecord ? await storage.getGHIIByOwner(mintedAgentRecord.owner) : null;
            return { content: [{ type: 'text' as const, text: JSON.stringify({ gaii, minted: amount, new_balance: mintedGhii?.morselBalance ?? 0 }, null, 2) }] };
        },
    );
}
