import { Router, type Request, type Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { issueJWT } from '../auth/jwt.js';
import { verify } from '../auth/keypair.js';
import { parseGAII } from '../utils/gaii.js';
import { generateTrackingCode } from '../utils/tracking-code.js';
import { calculateWorkCost, holdEscrow, settlePayment } from '../services/morsel.js';

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

export function mcpRouter(config: MeatConfig, storage: Storage): Router {
    const router = Router();

    // Per-session transports
    const transports = new Map<string, StreamableHTTPServerTransport>();

    // OAuth 2.1 stores
    const oauthClients = new Map<string, OAuthClient>();
    const authCodes = new Map<string, AuthorizationCode>();
    const oauthTokens = new Map<string, OAuthToken>();       // keyed by access token
    const refreshTokenIndex = new Map<string, OAuthToken>();  // keyed by refresh token

    function createMcpServer(agentGaii: string): McpServer {
        const mcp = new McpServer(
            { name: `AIMEAT Node ${config.nodeId}`, version: '1.2.0' },
            { capabilities: { tools: {} } },
        );

        // ── Tool 1: meat_catalogue_search ──
        mcp.tool(
            'meat_catalogue_search',
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

        // ── Tool 2: meat_agent_profile ──
        mcp.tool(
            'meat_agent_profile',
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

        // ── Tool 3: meat_memory_read ──
        mcp.tool(
            'meat_memory_read',
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

        // ── Tool 4: meat_memory_write ──
        mcp.tool(
            'meat_memory_write',
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
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({ key: record.key, version: record.version, written: true }, null, 2),
                    }],
                };
            },
        );

        // ── Tool 5: meat_memory_list ──
        mcp.tool(
            'meat_memory_list',
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

        // ── Tool 6: meat_action_execute ──
        mcp.tool(
            'meat_action_execute',
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

        // ── Tool 7: meat_work_inbox ──
        mcp.tool(
            'meat_work_inbox',
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

        // ── Tool 8: meat_work_accept ──
        mcp.tool(
            'meat_work_accept',
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

        // ── Tool 9: meat_work_deliver ──
        mcp.tool(
            'meat_work_deliver',
            'Deliver the result of a work item',
            { tracking_code: z.string(), output: z.record(z.string(), z.any()) },
            async ({ tracking_code, output }) => {
                const work = await storage.getWork(tracking_code);
                if (!work) return { content: [{ type: 'text' as const, text: 'Work not found' }], isError: true };
                if (work.providerGaii !== agentGaii) return { content: [{ type: 'text' as const, text: 'Not your work item' }], isError: true };
                if (!['accepted', 'in_progress'].includes(work.status)) return { content: [{ type: 'text' as const, text: `Cannot deliver: status is ${work.status}` }], isError: true };
                await settlePayment(storage, config, work);
                await storage.updateWork(tracking_code, { status: 'delivered', output, updatedAt: new Date().toISOString() });
                return { content: [{ type: 'text' as const, text: JSON.stringify({ tracking_code, status: 'delivered' }, null, 2) }] };
            },
        );

        // ── Tool 10: meat_wallet_balance ──
        mcp.tool(
            'meat_wallet_balance',
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

        // ── Tool 11: meat_board_read ──
        mcp.tool(
            'meat_board_read',
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

        // ── Tool 12: meat_board_post ──
        mcp.tool(
            'meat_board_post',
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

        // ── Tool 13: meat_storage_upload ──
        mcp.tool(
            'meat_storage_upload',
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
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({ key: file.key, size: file.size, uploaded: true }, null, 2) }],
                };
            },
        );

        // ── Tool 14: meat_storage_download ──
        mcp.tool(
            'meat_storage_download',
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

        return mcp;
    }

    // POST /v1/mcp — MCP Streamable HTTP endpoint (handles JSON-RPC requests)
    router.post('/v1/mcp', async (req: Request, res: Response) => {
        // Extract auth: support Bearer token or query param
        const authHeader = req.headers.authorization;
        const tokenParam = req.query._token as string | undefined;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : tokenParam;

        // Determine session ID from header
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
            // Existing session
            const transport = transports.get(sessionId)!;
            await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
            return;
        }

        // New session: authenticate the agent
        let agentGaii = 'anonymous';
        if (token) {
            try {
                const { verifyJWT } = await import('../auth/jwt.js');
                const payload = await verifyJWT(token);
                if (payload) agentGaii = payload.sub as string;
            } catch {
                // Allow anonymous for initialization
            }
        }

        // If there's a gaii/owner/sig in the body for inline auth
        if (req.body && !Array.isArray(req.body) && req.body.method === 'initialize') {
            // Authentication via MCP initialize params
            const params = req.body.params;
            if (params?.clientInfo?.gaii) {
                agentGaii = params.clientInfo.gaii;
            }
        }

        // Create transport and MCP server for this session
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        });

        const mcpServer = createMcpServer(agentGaii);

        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
            }
        };

        await mcpServer.connect(transport);

        // Store transport for session reuse
        if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
        }

        await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
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

    // GET /v1/mcp/authorize — Authorization endpoint (returns auth code)
    router.get('/v1/mcp/authorize', async (req: Request, res: Response) => {
        const clientId = req.query.client_id as string;
        const redirectUri = req.query.redirect_uri as string;
        const responseType = req.query.response_type as string;
        const state = req.query.state as string | undefined;
        const gaii = req.query.gaii as string | undefined;
        const signature = req.query.signature as string | undefined;
        const timestamp = req.query.timestamp as string | undefined;

        if (responseType !== 'code') {
            res.status(400).json({ error: 'unsupported_response_type', error_description: 'Only "code" is supported' });
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

        // Authenticate the agent via GAII + signature (MEAT's auth model)
        if (!gaii || !signature || !timestamp) {
            res.status(400).json({
                error: 'invalid_request',
                error_description: 'gaii, signature, and timestamp are required for authentication',
                auth_hint: 'Sign: base64(Ed25519_sign(private_key, gaii + node_id + timestamp))',
            });
            return;
        }

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
        const isValid = await verify(message, signature, agent.publicKey);
        if (!isValid) {
            res.status(401).json({ error: 'access_denied', error_description: 'Invalid signature' });
            return;
        }

        // Issue authorization code
        const code = randomBytes(32).toString('hex');
        const authCode: AuthorizationCode = {
            code,
            clientId,
            gaii,
            owner: parsed.owner,
            roles: ['agent'],
            redirectUri: redirectUri ?? client.redirectUris[0] ?? '',
            expiresAt: Date.now() + 600_000, // 10 minutes
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
    });

    // POST /v1/mcp/token — Token exchange endpoint
    router.post('/v1/mcp/token', async (req: Request, res: Response) => {
        const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token } = req.body ?? {};

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
                scope: 'meat:full',
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
                scope: 'meat:full',
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
        const baseUrl = `http://localhost:${config.port}`;
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
            scopes_supported: ['meat:full'],
        });
    });

    return router;
}
