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
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
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
 *   v1.8.1 — 2026-06-30 — resourceEvents.setMaxListeners(256): per-session fan-out (2 listeners/session,
 *     cleaned up on close) is intentional, not a leak — silences MaxListenersExceededWarning while
 *     keeping headroom for 128 concurrent agents and still flagging a genuine cleanup leak.
 *   v1.8.2 — 2026-07-13 — Extracted the OAuth 2.1 endpoints to ./oauth.ts (max-file-lines); no behavior change.
 *   v1.9.0 — 2026-07-25 — Per-session bearer token is now LIVE (sessionTokens box refreshed from every
 *     request) instead of frozen at initialize. An MCP session outlives its access token (jwtTtlSeconds,
 *     1 h default, rotated by the client via refresh_token), so capability invocation — the only path
 *     that re-presents the caller's token to the node's own HTTP surface — was answering AUTH_REQUIRED
 *     for the whole remainder of every session older than an hour. createMcpServer now takes a getter.
 */

import { Router, type Request, type Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { PeerInfo } from '../services/federation.js';
import { registerCoreTools } from './core.js';
import { registerBoardsTools } from './boards.js';
import { registerOrganismsTools } from './organisms.js';
import { registerWorkspaceTools } from './workspaces.js';
import { registerKnowledgeTools } from './knowledge.js';
import { registerAppdevPitfallTools } from './appdev-pitfalls.js';
import { registerAppdevResearchTools } from './appdev-research.js';
import { registerAppTemplateProposalTools } from './app-template-proposals.js';
import { registerAppdevProofTools } from './appdev-proofs.js';
import { registerSkillsTools } from './skills.js';
import { registerOperatorConfigTools } from './operator-config.js';
import { registerExtensionsTools } from './extensions.js';
import { registerCatalogueTools } from './catalogue.js';
import { registerMemoryExtendedTools } from './memory-extended.js';
import { registerWalletExtendedTools } from './wallet-extended.js';
import { registerConsentTools } from './consent.js';
import { registerCommerceTools } from './commerce.js';
import { registerExchangeTools } from './exchange.js';
import { registerExchangeRunTools } from './exchange-run.js';
import { registerChatInstancesTools } from './chat-instances.js';
import { registerFlagsTools } from './flags.js';
import { registerFeedbackTools } from './feedback.js';
import { registerPromptsTools } from './prompts.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerCortexTools } from './cortex.js';
import { registerAppsTools } from './apps.js';
import { registerSharingGroupTools } from './sharing-groups.js';
import { registerAgentTaskTools } from './agent-tasks.js';
import { registerAgentScheduleTools } from './agent-schedules.js';
import { registerWorkflowTools } from './workflows.js';
import { registerAgentCapabilityTools } from './agent-capabilities.js';
import { registerAgentMessageTools } from './agent-messages.js';
import { registerDmMessageTools } from './dm-messages.js';
import { registerContactTools } from './contacts.js';
import { registerAgentOnboardingTools } from './agent-onboarding.js';
import { registerAgentTelemetryTools } from './agent-telemetry.js';
import { registerAgentManagementTools } from './agent-management.js';
import { scopeAllowsTool } from './catalog/scopes.js';
import { toolsForSurface, isV2Role, V2_ROLES, type SurfaceRole } from './catalog/surfaces.js';
import { registerOAuthRoutes } from './oauth.js';

// ── Resource change event bus ──
// Allows REST routes and MCP tools to emit resource change events
// that get forwarded to subscribed MCP sessions via SSE.
export const resourceEvents = new EventEmitter();
// Each concurrent MCP session adds 2 listeners here (resource:updated +
// resource:listChanged) and removes them on session close (see core.ts onclose).
// This is intentional per-session fan-out, not a leak, so the number of listeners
// scales with concurrent agents — Node's default cap of 10 trips a spurious
// MaxListenersExceededWarning once ~6 agents connect at once. 256 = headroom for
// 128 concurrent agents (2 listeners each), while still flagging a genuine leak
// (e.g. broken onclose cleanup) instead of disabling the detector entirely (0).
resourceEvents.setMaxListeners(256);

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

export function mcpRouter(config: AimeatConfig, storage: Storage, peers: Map<string, PeerInfo>): Router {
    const router = Router();

    // Per-session transports
    const transports = new Map<string, StreamableHTTPServerTransport>();
    // Map MCP session IDs to ChatInstance IDs for heartbeat tracking
    const sessionChatInstances = new Map<string, string>();
    // Per-session BEARER TOKEN, kept live. A session outlives its access token: the OAuth token
    // has jwtTtlSeconds (1 h default) and the client silently rotates it via refresh_token, sending
    // the new one on every subsequent request. The few tools that re-present the caller's token to
    // the node's own HTTP surface (capability invocation) must use the CURRENT one, not the one
    // captured at initialize — otherwise they start answering AUTH_REQUIRED an hour into a session.
    const sessionTokens = new Map<string, { current: string | undefined }>();

    function createMcpServer(
        agentGaii: string,
        scopes: string[],
        role: SurfaceRole | 'all' = 'all',
        getToken: () => string | undefined = () => undefined,
    ): McpServer {
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
        registerWorkspaceTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerKnowledgeTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAppdevPitfallTools(mcp, storage, config, () => agentGaii, emitResourceUpdated);
        registerAppdevResearchTools(mcp, storage, config, () => agentGaii);
        registerAppTemplateProposalTools(mcp, storage, config, () => agentGaii);
        registerAppdevProofTools(mcp, storage, config, () => agentGaii);
        registerSkillsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerOperatorConfigTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerExtensionsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerCatalogueTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerMemoryExtendedTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerWalletExtendedTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerConsentTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerCommerceTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerExchangeTools(mcp, storage, config, () => agentGaii);
        registerExchangeRunTools(mcp, storage, config, () => agentGaii, getToken);
        registerChatInstancesTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerFlagsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerFeedbackTools(mcp, storage, config, () => agentGaii);
        registerPromptsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerCapabilitiesTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, getToken);
        registerCortexTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAppsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerSharingGroupTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentTaskTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentScheduleTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerWorkflowTools(mcp, storage, config, () => agentGaii);
        registerAgentCapabilityTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentMessageTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerDmMessageTools(mcp, storage, config, () => agentGaii, peers);
        registerContactTools(mcp, storage, config, () => agentGaii);
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
                storage.updateChatInstance(ciId, { lastSeen: new Date().toISOString() }).catch(err => { logger.warn('handleMcpPost: continuing after a suppressed failure', { error: String(err) }); });
            }
            // Refresh the session's bearer token from THIS request before dispatching: the client
            // rotates its access token mid-session, and capability invocation re-presents it.
            const box = sessionTokens.get(sessionId);
            if (box && token) box.current = token;
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

        const tokenBox: { current: string | undefined } = { current: token };
        const mcpServer = createMcpServer(authenticatedGaii, sessionScopes, serverRole, () => tokenBox.current);

        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
                sessionChatInstances.delete(transport.sessionId);
                sessionTokens.delete(transport.sessionId);
            }
        };

        await mcpServer.connect(transport);

        await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);

        // Store transport for session reuse (sessionId is generated during handleRequest)
        if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
            sessionTokens.set(transport.sessionId, tokenBox);
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

    // ── OAuth 2.1 Endpoints ── (extracted to ./oauth.ts)
    registerOAuthRoutes(router, config, storage);

    return router;
}
