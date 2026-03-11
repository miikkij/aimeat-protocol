import { Router, type Request, type Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { issueJWT } from '../auth/jwt.js';
import { verify } from '../auth/keypair.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { generateTrackingCode } from '../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow, settlePayment } from '../services/morsel.js';

// ── Resource change event bus ──
// Allows REST routes and MCP tools to emit resource change events
// that get forwarded to subscribed MCP sessions via SSE.
export const resourceEvents = new EventEmitter();

export interface ResourceChangeEvent {
    agentGaii: string;
    uri: string;
}

export function emitResourceUpdated(agentGaii: string, uri: string): void {
    resourceEvents.emit('resource:updated', { agentGaii, uri } satisfies ResourceChangeEvent);
}

export function emitResourceListChanged(agentGaii: string): void {
    resourceEvents.emit('resource:listChanged', { agentGaii } as { agentGaii: string });
}

// OAuth 2.1 state — in-memory (per RFC, clients register dynamically)
interface OAuthClient {
    clientId: string;
    clientSecret: string;
    clientName: string;
    redirectUris: string[];
    createdAt: string;
}

interface AuthorizationCode {
    code: string;
    clientId: string;
    gaii: string;
    owner: string;
    roles: string[];
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    expiresAt: number;
}

interface OAuthToken {
    accessToken: string;
    refreshToken: string;
    clientId: string;
    gaii: string;
    owner: string;
    roles: string[];
    expiresAt: number;
}

export function mcpRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // Per-session transports
    const transports = new Map<string, StreamableHTTPServerTransport>();
    // Map MCP session IDs to ChatInstance IDs for heartbeat tracking
    const sessionChatInstances = new Map<string, string>();

    // OAuth 2.1 stores
    const oauthClients = new Map<string, OAuthClient>();
    const authCodes = new Map<string, AuthorizationCode>();
    const oauthTokens = new Map<string, OAuthToken>();       // keyed by access token
    const refreshTokenIndex = new Map<string, OAuthToken>();  // keyed by refresh token

    function createMcpServer(agentGaii: string): McpServer {
        const mcp = new McpServer(
            { name: `AIMEAT Node ${config.nodeId}`, version: '1.2.0' },
            { capabilities: { tools: {}, resources: { subscribe: true, listChanged: true } } },
        );

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
                return { contents: [{ uri: uri.toString(), text: JSON.stringify({ balance: agent.morselBalance }), mimeType: 'application/json' }] };
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
            'Write a memory entry (creates or updates)',
            {
                key: z.string(),
                value: z.any(),
                visibility: z.enum(['private', 'owner', 'public']).optional(),
                tags: z.array(z.string()).optional(),
            },
            async ({ key, value, visibility, tags }) => {
                const existing = await storage.getMemory(agentGaii, key);
                const record = await storage.setMemory({
                    key,
                    ownerGaii: agentGaii,
                    value,
                    visibility: visibility ?? 'private',
                    tags: tags ?? [],
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
                        text: JSON.stringify({ key: record.key, version: record.version, written: true }, null, 2),
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
                    const requester = await storage.getAgent(agentGaii);
                    return {
                        content: [{ type: 'text' as const, text: `Insufficient morsels. Need ${cost.total}, have ${requester?.morselBalance ?? 0}` }],
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
                const { calculateEscrow } = await import('../services/morsel.js');
                const inEscrow = await calculateEscrow(storage, agentGaii);
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            balance: agent.morselBalance,
                            in_escrow: inEscrow,
                            available: agent.morselBalance - inEscrow,
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
            'Upload a file to binary storage (base64-encoded data)',
            { key: z.string(), data_base64: z.string(), mime_type: z.string().optional(), visibility: z.enum(['private', 'owner', 'public']).optional() },
            async ({ key, data_base64, mime_type, visibility }) => {
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
                    content: [{ type: 'text' as const, text: JSON.stringify({ key: file.key, size: file.size, uploaded: true }, null, 2) }],
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
                for (const a of agents) {
                    totalMorsels += a.morselBalance;
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
                const result = (limit ? agents.slice(0, limit) : agents).map(a => ({
                    gaii: a.gaii, owner: a.owner, display_name: a.displayName,
                    trust_score: a.trustScore, morsel_balance: a.morselBalance,
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
                const updatedAgent = await storage.getAgent(gaii);
                return { content: [{ type: 'text' as const, text: JSON.stringify({ gaii, minted: amount, new_balance: updatedAgent?.morselBalance ?? 0 }, null, 2) }] };
            },
        );

        return mcp;
    }

    // POST /v1/mcp — MCP Streamable HTTP endpoint (handles JSON-RPC requests)
    router.post('/v1/mcp', async (req: Request, res: Response) => {
        // Origin validation (MCP spec: REQUIRED to prevent DNS rebinding)
        const origin = req.headers.origin;
        if (origin) {
            const allowed = config.corsAllowedOrigins;
            if (!allowed.includes('*') && !allowed.includes(origin)) {
                res.status(403).json({
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Origin not allowed' },
                    id: req.body?.id ?? null,
                });
                return;
            }
        }

        // Extract auth: Bearer token only (spec: token MUST NOT be in query string)
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

        // Determine session ID from header
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
            // Existing session — update lastSeen for session tracking
            const ciId = sessionChatInstances.get(sessionId);
            if (ciId) {
                storage.updateChatInstance(ciId, { lastSeen: new Date().toISOString() }).catch(() => {});
            }
            const transport = transports.get(sessionId)!;
            await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
            return;
        }

        // New session: authenticate the agent
        let agentGaii = config.anonymousMode
            ? `shared#anonymous@${config.nodeId}`
            : 'anonymous';
        let sessionOwner: string | undefined;

        if (token) {
            try {
                const { verifyJWT } = await import('../auth/jwt.js');
                const payload = await verifyJWT(token);
                if (payload) {
                    agentGaii = payload.sub as string;
                    sessionOwner = payload.owner as string;
                }
            } catch {
                // Token invalid — fall through to anonymous check
            }
        }

        // If there's a gaii/owner/sig in the body for inline auth
        if (req.body && !Array.isArray(req.body) && req.body.method === 'initialize') {
            const params = req.body.params;
            if (params?.clientInfo?.gaii) {
                agentGaii = params.clientInfo.gaii;
            }
        }

        // Validate agent exists and has a real owner (unless anonymous mode)
        const isAnon = agentGaii === `shared#anonymous@${config.nodeId}` || agentGaii === 'anonymous';
        let chatInstanceId: string | undefined;

        if (!isAnon) {
            const agent = await storage.getAgent(agentGaii);
            if (!agent) {
                res.status(401).json({
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Agent not found. Register via /v1/agents/connect first.' },
                    id: req.body?.id ?? null,
                });
                return;
            }
            const owner = await storage.getOwner(agent.owner);
            if (!owner) {
                res.status(403).json({
                    jsonrpc: '2.0',
                    error: { code: -32003, message: 'Agent has no valid owner profile. Owner approval required.' },
                    id: req.body?.id ?? null,
                });
                return;
            }

            // GHII account is required for MCP access
            const ghiiRecord = await storage.getGHIIByOwner(agent.owner);
            if (!ghiiRecord) {
                res.status(403).json({
                    jsonrpc: '2.0',
                    error: { code: -32004, message: 'GHII account required for MCP access. Create one at /v1/ghii first.' },
                    id: req.body?.id ?? null,
                });
                return;
            }
            sessionOwner = agent.owner;

            // Create ChatInstanceRecord for session tracking
            const ua = (req.headers['user-agent'] || '').toLowerCase();
            let platform = 'unknown';
            if (ua.includes('claude')) platform = 'claude';
            else if (ua.includes('chatgpt') || ua.includes('openai')) platform = 'chatgpt';
            else if (ua.includes('copilot')) platform = 'copilot';
            else if (ua.includes('cursor')) platform = 'cursor';
            else if (ua.includes('gemini')) platform = 'gemini';

            chatInstanceId = `mcp-${platform}-${Date.now()}#${sessionOwner}@${config.nodeId}`;
            try {
                await storage.createChatInstance({
                    id: chatInstanceId,
                    platform,
                    appName: `mcp-${platform}`,
                    ownerName: sessionOwner,
                    ghii: `${sessionOwner}@${config.nodeId}`,
                    nodeId: config.nodeId,
                    isAnonymous: false,
                    agentGaii,
                    createdAt: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                });
            } catch (err) {
                logger.warn('Failed to create ChatInstance for MCP session', { error: (err as Error).message });
                chatInstanceId = undefined;
            }
        }

        // Create transport and MCP server for this session
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => `mcp-${randomBytes(16).toString('hex')}`,
        });

        const mcpServer = createMcpServer(agentGaii);

        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
                sessionChatInstances.delete(transport.sessionId);
            }
        };

        await mcpServer.connect(transport);

        await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);

        // Store transport for session reuse (sessionId is generated during handleRequest)
        if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
            if (chatInstanceId) {
                sessionChatInstances.set(transport.sessionId, chatInstanceId);
            }
        }
    });

    // GET /v1/mcp — SSE endpoint for server-to-client notifications
    router.get('/v1/mcp', async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
            res.status(400).json({ error: 'Missing or invalid mcp-session-id header' });
            return;
        }
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    });

    // DELETE /v1/mcp — Close MCP session
    router.delete('/v1/mcp', async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        const transport = transports.get(sessionId)!;
        await transport.close();
        transports.delete(sessionId);
        res.status(200).json({ closed: true });
    });

    // ── OAuth 2.1 Endpoints ──

    // POST /v1/mcp/register — Dynamic Client Registration (RFC 7591)
    router.post('/v1/mcp/register', (req: Request, res: Response) => {
        const { client_name, redirect_uris } = req.body ?? {};

        if (!client_name) {
            res.status(400).json({ error: 'invalid_request', error_description: 'client_name is required' });
            return;
        }

        const redirectUris = Array.isArray(redirect_uris) ? redirect_uris : [];
        const clientId = `mcp-client-${randomBytes(16).toString('hex')}`;
        const clientSecret = randomBytes(32).toString('hex');

        const client: OAuthClient = {
            clientId,
            clientSecret,
            clientName: client_name,
            redirectUris: redirectUris,
            createdAt: new Date().toISOString(),
        };
        oauthClients.set(clientId, client);

        res.status(201).json({
            client_id: clientId,
            client_secret: clientSecret,
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            token_endpoint_auth_method: 'client_secret_post',
            grant_types: ['authorization_code', 'refresh_token'],
        });
    });

    // GET /v1/mcp/authorize — Authorization endpoint (dual-path: signature or browser consent)
    router.get('/v1/mcp/authorize', async (req: Request, res: Response) => {
        const clientId = req.query.client_id as string;
        const redirectUri = req.query.redirect_uri as string;
        const responseType = req.query.response_type as string;
        const state = req.query.state as string | undefined;
        const scope = req.query.scope as string | undefined;
        const codeChallenge = req.query.code_challenge as string | undefined;
        const codeChallengeMethod = req.query.code_challenge_method as string | undefined;
        const gaii = req.query.gaii as string | undefined;
        const signature = req.query.signature as string | undefined;
        const timestamp = req.query.timestamp as string | undefined;

        if (responseType !== 'code') {
            res.status(400).json({ error: 'unsupported_response_type', error_description: 'Only "code" is supported' });
            return;
        }

        // PKCE validation (OAuth 2.1 requires S256)
        if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
            res.status(400).json({ error: 'invalid_request', error_description: 'Only S256 code_challenge_method is supported' });
            return;
        }

        if (!clientId) {
            res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
            return;
        }

        const client = oauthClients.get(clientId);
        if (!client) {
            res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
            return;
        }

        if (redirectUri && client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
            res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
            return;
        }

        // === PATH A: Direct agent auth (CLI/Code agents with private key) ===
        if (gaii && signature && timestamp) {
            const parsed = parseGAII(gaii);
            if (!parsed) {
                res.status(400).json({ error: 'invalid_request', error_description: 'Invalid GAII format' });
                return;
            }

            const agent = await storage.getAgent(gaii);
            if (!agent) {
                res.status(400).json({ error: 'invalid_request', error_description: 'Agent not found' });
                return;
            }

            const message = gaii + config.nodeId + timestamp;
            const isValid = await verify(agent.publicKey, message, signature);
            if (!isValid) {
                res.status(401).json({ error: 'access_denied', error_description: 'Invalid signature' });
                return;
            }

            // Issue authorization code directly
            const code = randomBytes(32).toString('hex');
            const authCode: AuthorizationCode = {
                code,
                clientId,
                gaii,
                owner: parsed.owner,
                roles: ['agent'],
                redirectUri: redirectUri ?? client.redirectUris[0] ?? '',
                codeChallenge,
                codeChallengeMethod: codeChallenge ? 'S256' : undefined,
                expiresAt: Date.now() + 600_000,
            };
            authCodes.set(code, authCode);

            if (redirectUri) {
                const url = new URL(redirectUri);
                url.searchParams.set('code', code);
                if (state) url.searchParams.set('state', state);
                res.redirect(302, url.toString());
            } else {
                res.json({ code, state });
            }
            return;
        }

        // === PATH B: Browser consent flow (Claude.ai Connectors, ChatGPT, etc.) ===
        // Redirect to consent page where user logs in and selects which agent to authorize
        const consentUrl = new URL('/v1/oauth/consent', `${req.protocol}://${req.get('host')}`);
        consentUrl.searchParams.set('client_id', clientId);
        consentUrl.searchParams.set('client_name', client.clientName);
        if (redirectUri) consentUrl.searchParams.set('redirect_uri', redirectUri);
        if (state) consentUrl.searchParams.set('state', state);
        if (scope) consentUrl.searchParams.set('scope', scope);
        if (codeChallenge) consentUrl.searchParams.set('code_challenge', codeChallenge);
        res.redirect(302, consentUrl.toString());
    });

    // POST /v1/mcp/authorize-consent — Browser consent form submission
    // Called by the consent page after user logs in, selects an agent, and clicks "Approve"
    router.post('/v1/mcp/authorize-consent', async (req: Request, res: Response) => {
        const { client_id, redirect_uri, state, gaii, owner_token, code_challenge } = req.body ?? {};

        if (!client_id || !gaii || !owner_token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'Missing required fields (client_id, gaii, owner_token)' });
            return;
        }

        const client = oauthClients.get(client_id);
        if (!client) {
            res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
            return;
        }

        // Validate redirect_uri matches registered URIs (prevent open redirect)
        const finalRedirect = redirect_uri ?? client.redirectUris[0];
        if (finalRedirect && client.redirectUris.length > 0 && !client.redirectUris.includes(finalRedirect)) {
            res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
            return;
        }

        // Verify owner's JWT (the browser session token)
        let ownerPayload;
        try {
            const { verifyJWT } = await import('../auth/jwt.js');
            ownerPayload = await verifyJWT(owner_token);
        } catch {
            res.status(401).json({ error: 'access_denied', error_description: 'Invalid or expired session' });
            return;
        }
        if (!ownerPayload || !ownerPayload.owner) {
            res.status(401).json({ error: 'access_denied', error_description: 'Invalid session token' });
            return;
        }

        // Verify the agent belongs to this owner
        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(400).json({ error: 'invalid_request', error_description: 'Agent not found' });
            return;
        }
        if (agent.owner !== ownerPayload.owner) {
            res.status(403).json({ error: 'access_denied', error_description: 'Agent does not belong to you' });
            return;
        }

        // Issue authorization code
        const parsed = parseGAII(gaii);
        const code = randomBytes(32).toString('hex');
        authCodes.set(code, {
            code,
            clientId: client_id,
            gaii,
            owner: parsed?.owner || agent.owner,
            roles: ['agent'],
            redirectUri: finalRedirect ?? '',
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge ? 'S256' : undefined,
            expiresAt: Date.now() + 600_000,
        });

        // Build redirect URL with authorization code
        if (finalRedirect) {
            const url = new URL(finalRedirect);
            url.searchParams.set('code', code);
            if (state) url.searchParams.set('state', state);

            // If caller wants JSON (fetch from consent page), return redirect_url
            // If caller is a form POST or non-JSON, do a 302 redirect
            const acceptsJson = req.headers.accept?.includes('application/json')
                || req.headers['content-type']?.includes('application/json');
            if (acceptsJson) {
                res.json({ redirect_url: url.toString() });
            } else {
                res.redirect(302, url.toString());
            }
        } else {
            res.json({ code, state });
        }
    });

    // POST /v1/mcp/token — Token exchange endpoint
    router.post('/v1/mcp/token', async (req: Request, res: Response) => {
        const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token, code_verifier } = req.body ?? {};

        if (grant_type === 'authorization_code') {
            if (!code || !client_id) {
                res.status(400).json({ error: 'invalid_request', error_description: 'code and client_id are required' });
                return;
            }

            const client = oauthClients.get(client_id);
            if (!client || client.clientSecret !== client_secret) {
                res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials' });
                return;
            }

            const authCode = authCodes.get(code);
            if (!authCode) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
                return;
            }

            // Code is single-use
            authCodes.delete(code);

            if (authCode.expiresAt < Date.now()) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
                return;
            }

            if (authCode.clientId !== client_id) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Code was issued to a different client' });
                return;
            }

            // PKCE validation (OAuth 2.1 §4.4.3)
            if (authCode.codeChallenge) {
                if (!code_verifier) {
                    res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier is required (PKCE)' });
                    return;
                }
                const computed = createHash('sha256').update(code_verifier).digest('base64url');
                if (computed !== authCode.codeChallenge) {
                    res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE code_verifier does not match code_challenge' });
                    return;
                }
            }

            // redirect_uri must match if it was provided during authorization (OAuth 2.1 §4.1.3)
            if (authCode.redirectUri && redirect_uri && authCode.redirectUri !== redirect_uri) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri does not match the authorization request' });
                return;
            }

            // Issue access + refresh tokens (JWT-based access token)
            const accessToken = await issueJWT({
                sub: authCode.gaii,
                owner: authCode.owner,
                node: config.nodeId,
                roles: authCode.roles,
            }, config.jwtTtlSeconds);

            const refreshTok = randomBytes(32).toString('hex');

            const tokenRecord: OAuthToken = {
                accessToken,
                refreshToken: refreshTok,
                clientId: client_id,
                gaii: authCode.gaii,
                owner: authCode.owner,
                roles: authCode.roles,
                expiresAt: Date.now() + config.jwtTtlSeconds * 1000,
            };
            oauthTokens.set(accessToken, tokenRecord);
            refreshTokenIndex.set(refreshTok, tokenRecord);

            res.json({
                access_token: accessToken,
                token_type: 'Bearer',
                expires_in: config.jwtTtlSeconds,
                refresh_token: refreshTok,
                scope: 'aimeat:full',
            });

        } else if (grant_type === 'refresh_token') {
            if (!refresh_token || !client_id) {
                res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token and client_id required' });
                return;
            }

            const client = oauthClients.get(client_id);
            if (!client || client.clientSecret !== client_secret) {
                res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials' });
                return;
            }

            const existing = refreshTokenIndex.get(refresh_token);
            if (!existing || existing.clientId !== client_id) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
                return;
            }

            // Rotate: revoke old, issue new
            oauthTokens.delete(existing.accessToken);
            refreshTokenIndex.delete(refresh_token);

            const newAccessToken = await issueJWT({
                sub: existing.gaii,
                owner: existing.owner,
                node: config.nodeId,
                roles: existing.roles,
            }, config.jwtTtlSeconds);

            const newRefreshTok = randomBytes(32).toString('hex');

            const newRecord: OAuthToken = {
                accessToken: newAccessToken,
                refreshToken: newRefreshTok,
                clientId: client_id,
                gaii: existing.gaii,
                owner: existing.owner,
                roles: existing.roles,
                expiresAt: Date.now() + config.jwtTtlSeconds * 1000,
            };
            oauthTokens.set(newAccessToken, newRecord);
            refreshTokenIndex.set(newRefreshTok, newRecord);

            res.json({
                access_token: newAccessToken,
                token_type: 'Bearer',
                expires_in: config.jwtTtlSeconds,
                refresh_token: newRefreshTok,
                scope: 'aimeat:full',
            });

        } else {
            res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Supported: authorization_code, refresh_token' });
        }
    });

    // POST /v1/mcp/token/revoke — Token revocation (RFC 7009)
    router.post('/v1/mcp/token/revoke', (req: Request, res: Response) => {
        const { token, token_type_hint } = req.body ?? {};

        if (!token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
            return;
        }

        // Try as access token first
        if (token_type_hint !== 'refresh_token') {
            const record = oauthTokens.get(token);
            if (record) {
                oauthTokens.delete(token);
                refreshTokenIndex.delete(record.refreshToken);
                res.status(200).json({ revoked: true });
                return;
            }
        }

        // Try as refresh token
        const record = refreshTokenIndex.get(token);
        if (record) {
            refreshTokenIndex.delete(token);
            oauthTokens.delete(record.accessToken);
            res.status(200).json({ revoked: true });
            return;
        }

        // RFC 7009: always return 200, even if token not found
        res.status(200).json({ revoked: true });
    });

    // GET /.well-known/oauth-authorization-server — OAuth metadata (RFC 8414)
    router.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
        const baseUrl = config.baseUrl;
        res.json({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/v1/mcp/authorize`,
            token_endpoint: `${baseUrl}/v1/mcp/token`,
            registration_endpoint: `${baseUrl}/v1/mcp/register`,
            revocation_endpoint: `${baseUrl}/v1/mcp/token/revoke`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['client_secret_post'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['aimeat:full'],
        });
    });

    return router;
}
