/**
 * @file index.ts
 * @description MCP module entry point. Contains the Express router factory (mcpRouter), OAuth 2.1
 *   endpoints, transport management, session lifecycle, and the resource change event bus.
 *   Tool/resource registrations live in ./core.ts.
 * @structure
 *   - resourceEvents, emitResourceUpdated, emitResourceListChanged — event bus for MCP resource changes
 *   - mcpRouter() — Express router factory with MCP transport + OAuth endpoints
 * @usage
 *   import { mcpRouter, emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
 * @version-history
 *   v1.0.0 — 2026-03-20 — Extracted from src/routes/mcp.ts (pure refactor, no logic changes)
 *   v1.1.0 — 2026-03-21 — Added registerOrganismsTools registration (5 tools + 1 resource)
 *   v1.2.0 — 2026-03-21 — Added registerKnowledgeTools registration (4 tools + 1 resource)
 *   v1.3.0 — 2026-03-21 — Added registerExtensionsTools registration (2 tools + 1 resource)
 *   v1.4.0 — 2026-03-21 — Added registerCatalogueTools (3), registerMemoryExtendedTools (2), registerWalletExtendedTools (1)
 *   v1.5.0 — 2026-03-21 — Added registerConsentTools (3), registerChatInstancesTools (3), registerFlagsTools (1), registerPromptsTools (1)
 *   v1.6.0 — 2026-05-28 — Added public MCP Hello Integration onboarding and telemetry tools
 *   v1.7.0 — 2026-05-30 — MCP audit Phase 3 (F1): per-agent scope enforcement — createMcpServer
 *     filters the tool surface by the agent's defaultScopes (scopeAllowsTool), mirroring REST
 *     requireScope gates. Honours config.mcpEnforceScopes (false = warn-only logging).
 *   v1.8.0 — 2026-05-30 — v2 S2: createMcpServer accepts a surface role; the gate hard-skips tools
 *     outside that surface (toolsForSurface). role='all' (v1) applies no surface filter.
 */

import { Router, type Request, type Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { issueJWT } from '../auth/jwt.js';
import { verify } from '../auth/keypair.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { registerCoreTools } from './core.js';
import { registerBoardsTools } from './boards.js';
import { registerOrganismsTools } from './organisms.js';
import { registerKnowledgeTools } from './knowledge.js';
import { registerExtensionsTools } from './extensions.js';
import { registerCatalogueTools } from './catalogue.js';
import { registerMemoryExtendedTools } from './memory-extended.js';
import { registerWalletExtendedTools } from './wallet-extended.js';
import { registerConsentTools } from './consent.js';
import { registerChatInstancesTools } from './chat-instances.js';
import { registerFlagsTools } from './flags.js';
import { registerPromptsTools } from './prompts.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerCortexTools } from './cortex.js';
import { registerAppsTools } from './apps.js';
import { registerSharingGroupTools } from './sharing-groups.js';
import { registerAgentTaskTools } from './agent-tasks.js';
import { registerAgentScheduleTools } from './agent-schedules.js';
import { registerAgentCapabilityTools } from './agent-capabilities.js';
import { registerAgentMessageTools } from './agent-messages.js';
import { registerAgentOnboardingTools } from './agent-onboarding.js';
import { registerAgentTelemetryTools } from './agent-telemetry.js';
import { registerAgentManagementTools } from './agent-management.js';
import { scopeAllowsTool } from './catalog/scopes.js';
import { toolsForSurface, isV2Role, V2_ROLES, type SurfaceRole } from './catalog/surfaces.js';

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

// OAuth 2.1 — authorization codes stay in-memory (short-lived, single-use).
// Clients, refresh tokens, and approvals are persisted to storage.
interface AuthorizationCode {
    code: string;
    clientId: string;
    clientName?: string;
    gaii: string;
    owner: string;
    roles: string[];
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    expiresAt: number;
}

/** SHA-256 hash a raw token for storage lookup */
function hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
}

export function mcpRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // Per-session transports
    const transports = new Map<string, StreamableHTTPServerTransport>();
    // Map MCP session IDs to ChatInstance IDs for heartbeat tracking
    const sessionChatInstances = new Map<string, string>();

    // OAuth 2.1 — only auth codes are in-memory (short-lived, single-use)
    const authCodes = new Map<string, AuthorizationCode>();

    function createMcpServer(agentGaii: string, scopes: string[], role: SurfaceRole | 'all' = 'all'): McpServer {
        const mcp = new McpServer(
            { name: `AIMEAT Node ${config.nodeId}`, version: '1.2.0' },
            { capabilities: { tools: {}, resources: { subscribe: true, listChanged: true } } },
        );

        // F1: enforce per-agent scopes on the tool surface. We monkeypatch BOTH mcp.tool and
        // mcp.registerTool (tools may use either) for the duration of registration so each
        // registerXxxTools() call only registers tools this agent's scopes allow (mirrors REST
        // requireScope gates). Owner-attached agents with a '*' scope get everything. Warn-only
        // mode (config.mcpEnforceScopes=false) registers all tools but logs what WOULD be filtered.
        const enforce = config.mcpEnforceScopes;
        const surfaceTools = role === 'all' ? null : toolsForSurface(role);
        const filteredTools: string[] = [];
        type ToolFn = (...args: unknown[]) => unknown;
        const patchable = mcp as unknown as { tool: ToolFn; registerTool: ToolFn };
        const gate = (name: string): boolean => {
            // v2 surface filter: a tool not in this surface's purpose is simply not part of it
            // (hard skip, silent — not a scope denial). role='all' (v1) applies no surface filter.
            if (surfaceTools && !surfaceTools.has(name)) return false;
            if (scopeAllowsTool(scopes, name)) return true;
            filteredTools.push(name);
            return !enforce; // warn-only: still register (true); enforce: skip (false)
        };
        const originalTool = patchable.tool.bind(mcp) as ToolFn;
        const originalRegisterTool = patchable.registerTool.bind(mcp) as ToolFn;
        patchable.tool = (...args: unknown[]) => gate(args[0] as string) ? originalTool(...args) : undefined;
        patchable.registerTool = (...args: unknown[]) => gate(args[0] as string) ? originalRegisterTool(...args) : undefined;

        registerCoreTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerBoardsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerOrganismsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerKnowledgeTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerExtensionsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerCatalogueTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerMemoryExtendedTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerWalletExtendedTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerConsentTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerChatInstancesTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerFlagsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerPromptsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerCapabilitiesTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerCortexTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAppsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerSharingGroupTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentTaskTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentScheduleTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentCapabilityTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentMessageTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentTelemetryTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentOnboardingTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentManagementTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);

        // Restore the original methods and report what scope enforcement did this session.
        patchable.tool = originalTool;
        patchable.registerTool = originalRegisterTool;
        if (filteredTools.length > 0) {
            logger.info(
                `[mcp-scope] ${enforce ? 'filtered' : 'would filter (warn-only)'} ${filteredTools.length} tool(s) for ${agentGaii}`,
                { scopes, filtered: [...new Set(filteredTools)] },
            );
        }

        return mcp;
    }

    // MCP Streamable HTTP POST handler — shared by /v1/mcp (role 'all') and /v2/mcp/:role.
    const handleMcpPost = (serverRole: SurfaceRole | 'all') => async (req: Request, res: Response) => {
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
                storage.updateChatInstance(ciId, { lastSeen: new Date().toISOString() }).catch(() => { });
            }
            const transport = transports.get(sessionId)!;
            await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
            return;
        }

        // Session ID was provided but session doesn't exist (server restart, expired, etc.)
        // MCP spec: MUST return 404 so client knows to re-initialize
        if (sessionId) {
            const body = req.body;
            const method = Array.isArray(body) ? body[0]?.method : body?.method;
            if (method !== 'initialize') {
                res.status(404).json({
                    jsonrpc: '2.0',
                    error: { code: -32600, message: 'Session not found. Please re-initialize.' },
                    id: (Array.isArray(body) ? body[0]?.id : body?.id) ?? null,
                });
                return;
            }
            // If method IS 'initialize', allow fall-through to create a new session
        }

        // New session: authenticate the agent via OAuth token
        // MCP ALWAYS requires GHII authentication — no anonymous access allowed
        let agentGaii: string | undefined;
        let sessionOwner: string | undefined;
        let mcpClientName: string | undefined;

        if (token) {
            try {
                const { verifyJWT } = await import('../auth/jwt.js');
                const payload = await verifyJWT(token);
                if (payload) {
                    agentGaii = payload.sub as string;
                    sessionOwner = payload.owner as string;
                    mcpClientName = payload.mcp_client;
                }
            } catch {
                // Token was provided but is invalid/expired — return 401
                res.status(401).json({
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Token expired or invalid. Please refresh your access token via /v1/mcp/token.' },
                    id: (Array.isArray(req.body) ? req.body[0]?.id : req.body?.id) ?? null,
                });
                return;
            }
        }

        if (!agentGaii) {
            // No token — challenge client to authenticate via OAuth (MCP spec §5.3)
            const resourceMetadataUrl = `${config.baseUrl}/.well-known/oauth-protected-resource`;
            res.status(401)
                .setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`)
                .json({
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Authentication required. MCP requires a GHII account. Use OAuth 2.1 to obtain an access token.' },
                    id: (Array.isArray(req.body) ? req.body[0]?.id : req.body?.id) ?? null,
                });
            return;
        }

        // agentGaii is guaranteed to be a string here (401 returned above if not)
        const authenticatedGaii: string = agentGaii;

        // Validate agent exists and has a real owner
        let chatInstanceId: string | undefined;
        let sessionScopes: string[]; // assigned from agent.defaultScopes in the validation block below

        {
            const agent = await storage.getAgent(authenticatedGaii);
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
            sessionScopes = agent.defaultScopes ?? [];

            // Upsert ChatInstanceRecord for session tracking
            // Prefer mcp_client from JWT (set during OAuth consent) over User-Agent sniffing
            let platform = 'unknown';
            if (mcpClientName) {
                const cn = mcpClientName.toLowerCase();
                if (cn.includes('claude code') || cn.includes('claude-code')) platform = 'claude-code';
                else if (cn.includes('claude desktop') || cn.includes('claude-desktop')) platform = 'claude-desktop';
                else if (cn.includes('claude')) platform = 'claude';
                else if (cn.includes('chatgpt') || cn.includes('openai')) platform = 'chatgpt';
                else if (cn.includes('copilot')) platform = 'copilot';
                else if (cn.includes('cursor')) platform = 'cursor';
                else if (cn.includes('gemini')) platform = 'gemini';
                else platform = mcpClientName.slice(0, 32);
            } else {
                const ua = (req.headers['user-agent'] || '').toLowerCase();
                if (ua.includes('claude')) platform = 'claude';
                else if (ua.includes('chatgpt') || ua.includes('openai')) platform = 'chatgpt';
                else if (ua.includes('copilot')) platform = 'copilot';
                else if (ua.includes('cursor')) platform = 'cursor';
                else if (ua.includes('gemini')) platform = 'gemini';
            }

            chatInstanceId = `mcp-${platform}#${sessionOwner}@${config.nodeId}`;
            try {
                const existing = await storage.getChatInstance(chatInstanceId);
                if (existing) {
                    await storage.updateChatInstance(chatInstanceId, { lastSeen: new Date().toISOString() });
                } else {
                    await storage.createChatInstance({
                        id: chatInstanceId,
                        platform,
                        appName: `mcp-${platform}`,
                        ownerName: sessionOwner,
                        ghii: `${sessionOwner}@${config.nodeId}`,
                        nodeId: config.nodeId,
                        isAnonymous: false,
                        agentGaii: authenticatedGaii,
                        createdAt: new Date().toISOString(),
                        lastSeen: new Date().toISOString(),
                    });
                }
            } catch (err) {
                logger.warn('Failed to upsert ChatInstance for MCP session', { error: (err as Error).message });
                chatInstanceId = undefined;
            }
        }

        // Create transport and MCP server for this session
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => `mcp-${randomBytes(16).toString('hex')}`,
        });

        const mcpServer = createMcpServer(authenticatedGaii, sessionScopes, serverRole);

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
    };

    // GET handler (SSE server→client notifications) — role-agnostic; the session is already bound
    // to its (role-scoped) server from the POST that created it.
    const handleMcpGet = async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
            res.status(400).json({ error: 'Missing or invalid mcp-session-id header' });
            return;
        }
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    };

    // DELETE handler — close session (role-agnostic)
    const handleMcpDelete = async (req: Request, res: Response) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        const transport = transports.get(sessionId)!;
        await transport.close();
        transports.delete(sessionId);
        res.status(200).json({ closed: true });
    };

    // Validate the :role path param for v2 surfaces; replies 400 (JSON-RPC) on unknown role.
    const v2Role = (req: Request, res: Response): SurfaceRole | null => {
        const raw = req.params.role;
        const role = (Array.isArray(raw) ? raw[0] : raw) as string;
        if (!isV2Role(role)) {
            res.status(400).json({ jsonrpc: '2.0', error: { code: -32602, message: `Unknown MCP surface role "${role}". Use one of: ${V2_ROLES.join(', ')}.` }, id: req.body?.id ?? null });
            return null;
        }
        return role;
    };

    // ── v1/mcp — full surface (frozen, role 'all') ──
    router.post('/v1/mcp', handleMcpPost('all'));
    router.get('/v1/mcp', handleMcpGet);
    router.delete('/v1/mcp', handleMcpDelete);

    // ── v2/mcp/:role — purpose-scoped surfaces (appdev | agent | service | admin) ──
    router.post('/v2/mcp/:role', async (req: Request, res: Response) => {
        const role = v2Role(req, res);
        if (role) await handleMcpPost(role)(req, res);
    });
    router.get('/v2/mcp/:role', async (req: Request, res: Response) => {
        if (v2Role(req, res)) await handleMcpGet(req, res);
    });
    router.delete('/v2/mcp/:role', async (req: Request, res: Response) => {
        if (v2Role(req, res)) await handleMcpDelete(req, res);
    });

    // ── OAuth 2.1 Endpoints ──

    // POST /v1/mcp/register — Dynamic Client Registration (RFC 7591)
    router.post('/v1/mcp/register', async (req: Request, res: Response) => {
        const { client_name, redirect_uris } = req.body ?? {};

        if (!client_name) {
            res.status(400).json({ error: 'invalid_request', error_description: 'client_name is required' });
            return;
        }

        const redirectUris = Array.isArray(redirect_uris) ? redirect_uris : [];
        const clientId = `mcp-client-${randomBytes(16).toString('hex')}`;
        const clientSecret = randomBytes(32).toString('hex');

        await storage.createOAuthClient({
            clientId,
            clientSecret: hashToken(clientSecret),
            clientName: client_name,
            redirectUris,
            createdAt: new Date().toISOString(),
        });

        res.status(201).json({
            client_id: clientId,
            client_secret: clientSecret,
            client_name,
            redirect_uris: redirectUris,
            token_endpoint_auth_method: 'client_secret_post',
            grant_types: ['authorization_code', 'refresh_token'],
        });
    });

    // GET /v1/mcp/authorize — Authorization endpoint (dual-path: signature or browser consent)
    router.get('/v1/mcp/authorize', async (req: Request, res: Response) => {
        const q = (key: string) => { const v = req.query[key]; return Array.isArray(v) ? v[0] as string : v as string | undefined; };
        const clientId = q('client_id')!;
        const redirectUri = q('redirect_uri')!;
        const responseType = q('response_type')!;
        const state = q('state');
        const scope = q('scope');
        const codeChallenge = q('code_challenge');
        const codeChallengeMethod = q('code_challenge_method');
        const gaii = q('gaii');
        const signature = q('signature');
        const timestamp = q('timestamp');

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

        const client = await storage.getOAuthClient(clientId);
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
                clientName: client.clientName,
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
        const { client_id, client_name: clientNameBody, redirect_uri, state, gaii, owner_token, code_challenge } = req.body ?? {};

        if (!client_id || !gaii || !owner_token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'Missing required fields (client_id, gaii, owner_token)' });
            return;
        }

        const client = await storage.getOAuthClient(client_id);

        // If client not found (e.g. server restarted since registration), allow consent
        // to proceed — we still verify owner JWT + agent ownership below.
        // Validate redirect_uri against registered URIs when available.
        const finalRedirect = redirect_uri ?? client?.redirectUris[0];
        if (client && finalRedirect && client.redirectUris.length > 0 && !client.redirectUris.includes(finalRedirect)) {
            res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
            return;
        }
        // Fail fast (clear 400, not a 500) if a redirect_uri was supplied but is not a
        // parseable absolute URL — otherwise `new URL(finalRedirect)` below throws an
        // unhandled TypeError, surfacing as INTERNAL_ERROR / "[object Object]" to the client.
        if (finalRedirect) {
            try { new URL(finalRedirect); }
            catch {
                res.status(400).json({ error: 'invalid_request', error_description: `Invalid redirect_uri: ${String(finalRedirect)}` });
                return;
            }
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
        const resolvedClientName = clientNameBody || client?.clientName || client_id;
        authCodes.set(code, {
            code,
            clientId: client_id,
            clientName: resolvedClientName,
            gaii,
            owner: parsed?.owner || agent.owner,
            roles: ['agent'],
            redirectUri: finalRedirect ?? '',
            codeChallenge: code_challenge,
            codeChallengeMethod: code_challenge ? 'S256' : undefined,
            expiresAt: Date.now() + 600_000,
        });

        // Remember this approval so future authorizations skip the consent screen
        await storage.createOAuthApproval({
            clientId: client_id,
            gaii,
            owner: parsed?.owner || agent.owner,
            scope: 'aimeat:full',
            approvedAt: new Date().toISOString(),
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

    // GET /v1/mcp/approval-check — Check if a client+agent pair has a remembered approval
    // Used by the consent page to auto-submit when the user has previously approved this client
    router.get('/v1/mcp/approval-check', async (req: Request, res: Response) => {
        const rawClientId = req.query.client_id; const clientId = (Array.isArray(rawClientId) ? rawClientId[0] : rawClientId) as string;
        const rawGaii = req.query.gaii; const gaii = (Array.isArray(rawGaii) ? rawGaii[0] : rawGaii) as string;
        if (!clientId || !gaii) {
            res.json({ approved: false });
            return;
        }
        const approval = await storage.getOAuthApproval(clientId, gaii);
        res.json({ approved: !!approval });
    });

    // POST /v1/mcp/token — Token exchange endpoint
    router.post('/v1/mcp/token', async (req: Request, res: Response) => {
        const { grant_type, code, client_id, client_secret, redirect_uri, refresh_token, code_verifier } = req.body ?? {};

        if (grant_type === 'authorization_code') {
            if (!code || !client_id) {
                res.status(400).json({ error: 'invalid_request', error_description: 'code and client_id are required' });
                return;
            }

            const client = await storage.getOAuthClient(client_id);
            if (client && client_secret && client.clientSecret !== hashToken(client_secret)) {
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
                mcp_client: authCode.clientName || client_id,
            }, config.jwtTtlSeconds);

            const refreshTok = randomBytes(32).toString('hex');

            // Persist refresh token (hashed) to storage
            await storage.createOAuthRefreshToken({
                tokenHash: hashToken(refreshTok),
                clientId: client_id,
                gaii: authCode.gaii,
                owner: authCode.owner,
                roles: authCode.roles,
                createdAt: new Date().toISOString(),
            });

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

            const client = await storage.getOAuthClient(client_id);
            if (client && client_secret && client.clientSecret !== hashToken(client_secret)) {
                res.status(401).json({ error: 'invalid_client', error_description: 'Invalid client credentials' });
                return;
            }

            const existing = await storage.getOAuthRefreshToken(hashToken(refresh_token));
            if (!existing || existing.clientId !== client_id) {
                res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
                return;
            }

            // Rotate: revoke old, issue new
            await storage.deleteOAuthRefreshToken(hashToken(refresh_token));

            const newAccessToken = await issueJWT({
                sub: existing.gaii,
                owner: existing.owner,
                node: config.nodeId,
                roles: existing.roles,
            }, config.jwtTtlSeconds);

            const newRefreshTok = randomBytes(32).toString('hex');

            await storage.createOAuthRefreshToken({
                tokenHash: hashToken(newRefreshTok),
                clientId: client_id,
                gaii: existing.gaii,
                owner: existing.owner,
                roles: existing.roles,
                createdAt: new Date().toISOString(),
            });

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
    router.post('/v1/mcp/token/revoke', async (req: Request, res: Response) => {
        const { token, token_type_hint } = req.body ?? {};

        if (!token) {
            res.status(400).json({ error: 'invalid_request', error_description: 'token is required' });
            return;
        }

        // Try as access token (JWT) — add to JWT revocation list
        if (token_type_hint !== 'refresh_token') {
            try {
                const { verifyJWT, revokeToken } = await import('../auth/jwt.js');
                const payload = await verifyJWT(token);
                if (payload && payload.exp) {
                    await revokeToken(token, payload.exp);
                    res.status(200).json({ revoked: true });
                    return;
                }
            } catch { /* not a valid JWT, try as refresh token */ }
        }

        // Try as refresh token (hash and look up in storage)
        const deleted = await storage.deleteOAuthRefreshToken(hashToken(token));
        if (deleted) {
            res.status(200).json({ revoked: true });
            return;
        }

        // RFC 7009: always return 200, even if token not found
        res.status(200).json({ revoked: true });
    });

    // GET /.well-known/oauth-protected-resource — Resource metadata (RFC 9728)
    // MCP clients discover this URL from the WWW-Authenticate header on 401 responses.
    // It tells them WHERE the authorization server is and WHAT scopes are needed.
    router.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
        const baseUrl = config.baseUrl;
        res.json({
            resource: `${baseUrl}/v1/mcp`,
            authorization_servers: [baseUrl],
            scopes_supported: ['aimeat:full'],
            bearer_methods_supported: ['header'],
        });
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
