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
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { generateTrackingCode } from '../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow, settlePayment } from '../services/morsel.js';
import { generateUploadToken } from '../services/upload-token.js';
import type { ResourceChangeEvent } from './index.js';
import { resourceEvents } from './index.js';

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
        'Search the action catalogue for available services',
        { search: z.string().optional(), category: z.string().optional() },
        async ({ search, category }) => {
            const actions = await storage.listActions({ search, category });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(actions.map(a => ({
                        action_id: a.id,
                        provider_gaii: a.providerGaii,
                        display_name: a.displayName,
                        description: a.description,
                        category: a.category,
                        pricing: a.pricing,
                        tags: a.tags,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_agent_profile ──
    mcp.tool(
        'aimeat_agent_profile',
        'View an agent\'s public profile',
        { gaii: z.string() },
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

    // ── Tool 3: aimeat_memory_read ──
    mcp.tool(
        'aimeat_memory_read',
        'Read a memory entry by key',
        { key: z.string() },
        async ({ key }) => {
            const record = await storage.getMemory(agentGaii, key);
            if (!record) return { content: [{ type: 'text' as const, text: 'Memory not found' }] };
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        key: record.key,
                        value: record.value,
                        visibility: record.visibility,
                        tags: record.tags,
                        version: record.version,
                        updated_at: record.updatedAt,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 4: aimeat_memory_write ──
    mcp.tool(
        'aimeat_memory_write',
        'Write a memory entry (creates or updates). Value can be any JSON: string, number, boolean, object, or array.',
        {
            key: z.string().describe('Memory key (hierarchical, slash-separated)'),
            value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())]).describe('The value to store — any JSON type'),
            visibility: z.enum(['private', 'owner', 'public']).default('private').describe('private = only you, owner = all your agents, public = anyone'),
            tags: z.array(z.string()).default([]).describe('Optional tags for filtering'),
        },
        async ({ key, value, visibility, tags }) => {
            const existing = await storage.getMemory(agentGaii, key);
            const record = await storage.setMemory({
                key,
                ownerGaii: agentGaii,
                value,
                visibility,
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
        'List memory entries for the current agent',
        { prefix: z.string().optional(), visibility: z.string().optional() },
        async ({ prefix, visibility }) => {
            const entries = await storage.listMemory(agentGaii, { prefix, visibility });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(entries.map(e => ({
                        key: e.key,
                        visibility: e.visibility,
                        tags: e.tags,
                        version: e.version,
                        updated_at: e.updatedAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 6: aimeat_action_execute ──
    mcp.tool(
        'aimeat_action_execute',
        'Request execution of an action (creates a work item)',
        {
            action_id: z.string(),
            provider_gaii: z.string(),
            input: z.record(z.string(), z.any()),
            ttl_hours: z.number().optional(),
        },
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
        'Check the work inbox for pending items',
        {},
        async () => {
            const items = await storage.listWorkByProvider(agentGaii);
            const pending = items.filter(w => ['pending', 'accepted', 'in_progress'].includes(w.status));
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(pending.map(w => ({
                        tracking_code: w.trackingCode,
                        status: w.status,
                        action_id: w.actionId,
                        requester_gaii: w.requesterGaii,
                        cost: w.cost,
                        created_at: w.createdAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 8: aimeat_work_accept ──
    mcp.tool(
        'aimeat_work_accept',
        'Accept a pending work item',
        { tracking_code: z.string() },
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
        'Deliver the result of a work item',
        { tracking_code: z.string(), output: z.record(z.string(), z.any()) },
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
        'Check morsel wallet balance',
        {},
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
        'Read posts from a notification board',
        { board_id: z.string(), category: z.string().optional(), limit: z.number().optional() },
        async ({ board_id, category, limit }) => {
            const posts = await storage.listPosts(board_id, { category, limit: limit ?? 20 });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(posts.map(p => ({
                        id: p.id,
                        author_gaii: p.authorGaii,
                        title: p.title,
                        body: p.body,
                        category: p.category,
                        reactions: p.reactions,
                        created_at: p.createdAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 12: aimeat_board_post ──
    mcp.tool(
        'aimeat_board_post',
        'Post a message to a notification board',
        { board_id: z.string(), title: z.string(), body: z.string(), category: z.string().optional() },
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
        `Upload a file to binary storage. Two modes:
UPLOAD MODE (recommended for files > 1 KB): Call with key only (omit data_base64). Returns an upload_url. PUT the raw file to that URL. The PUT response contains the result as JSON.
INLINE MODE (for tiny files < 1 KB): Include data_base64 with base64-encoded data. Result returned directly.`,
        {
            key: z.string().describe('Storage key (path-like identifier)'),
            data_base64: z.string().optional().describe('Base64-encoded file data. Omit to get an upload URL instead (recommended for files > 1KB).'),
            mime_type: z.string().optional().describe('MIME type (default: application/octet-stream)'),
            visibility: z.enum(['private', 'owner', 'public']).optional().describe('Access control (default: private)'),
        },
        async ({ key, data_base64, mime_type, visibility }) => {
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
        'Download a file from binary storage (returns base64)',
        { key: z.string() },
        async ({ key }) => {
            const file = await storage.getStorageFile(agentGaii, key);
            if (!file) return { content: [{ type: 'text' as const, text: 'File not found' }], isError: true };
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        key: file.key,
                        mime_type: file.mimeType,
                        size: file.size,
                        data_base64: file.data.toString('base64'),
                    }, null, 2),
                }],
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
        'Get node statistics and health metrics (operator only)',
        {},
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
        'List all agents with details (operator only)',
        { limit: z.number().optional() },
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
        'View current node configuration (operator only)',
        {},
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
        'Mint morsels for an agent (operator only, daily cap enforced)',
        { gaii: z.string(), amount: z.number().int().positive() },
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
