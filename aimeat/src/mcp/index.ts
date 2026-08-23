/**
 * @file index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP module entry point. Contains the Express router factory (mcpRouter), OAuth 2.1
 *   endpoints, transport management, session lifecycle, and the resource change event bus.
 *   Tool/resource registrations live in ./core.ts.
 * @structure
 *   - resourceEvents, emitResourceUpdated, emitResourceListChanged — event bus for MCP resource changes
 *   - mcpRouter() — Express router factory with MCP transport + OAuth endpoints
 * @usage
 *   import { mcpRouter, emitResourceUpdated, emitResourceListChanged } from '../mcp/index.js';
 * @version-history
 *   v1.17.0 -- 2026-08-22 -- The handshake carries the proactive guidance when the owner keeps
 *     that setting on (services/proactive-mode.ts). createMcpServer takes the owner name and
 *     reads it here, because a connection is the one moment every client passes through; a
 *     failed read costs the guidance and never the session.
 *   v1.16.0 -- 2026-08-19 -- MCP sessions expire after config.mcpSessionIdleMinutes without a
 *     request. Each session holds a full McpServer (hundreds of tools, each with its Zod schema
 *     graph) and died only on an explicit client DELETE, which most clients never send -- the
 *     production heap held 17,815 live Zod check-closures and ~1 GB of schema graphs after four
 *     hours. A reaped client gets the spec's 404 and re-initializes.
 *   v1.15.0 -- 2026-08-16 -- SECURITY: a revoked access token is refused at this door. POST
 *     /v1/mcp/token/revoke writes the JWT into the revocation list and answers {revoked:true}, and
 *     nothing here ever read that list, so a credential that was dead on every REST route stayed
 *     alive on the MCP one until it expired. auth/middleware.ts checks isRevoked on all three of its
 *     paths; this was the fourth. The check sits above the session-resume branch, so a live session
 *     does not outlive the credential that opened it. Found by the E2E test-quality audit finding
 *     e2e-mcp:448, which noted the suite was asserting the endpoint echo rather than the effect.
 *   v1.14.0 -- 2026-08-16 -- registerAppDraftEditTools: the four incremental app-draft tools (write/replace/read/seed). They live in their own module
 *     because apps.ts is already near the 800-line ceiling.
 *   v1.13.0 -- 2026-08-11 -- August audit step 8: registerAppdevProofTools receives the session
 *     scopes, the way the pitfall, knowledge and commerce registrations already do. The proof
 *     attach now writes through services/memory-write.ts, whose scope gate needs them.
 *   v1.12.0 — 2026-08-10 — August audit step 8: the session's chat-instance upsert and its per-request
 *     heartbeat call services/chat-instance-write.ts instead of storage directly. A new MCP session
 *     now emits the `chat` change event the two other doors already emitted, so the browser's chat
 *     list shows it without waiting for something else to trigger a refresh.
 *   v1.11.0 — 2026-08-09 — The server declares PROMPTS (./prompts-managed.ts): the node's managed
 *     prompt packages become the primitive a person picks, which is what MCP's prompts primitive is
 *     for. mcp.prompt had been called nowhere in src/mcp/, so a surface built around prompt-driven
 *     work offered them only through a tool the model had to think of. createMcpServer is async now,
 *     since the prompt list comes from storage.
 *   v1.10.0 — 2026-08-09 — The initialize result carries `instructions` (./instructions.ts), per
 *     surface role. The handshake had never passed one, so an agent connecting to /v1/mcp met a few
 *     hundred tool descriptions with nothing telling it that aimeat_handbook_get is the way in — the
 *     operating guide was reachable only by an agent that already guessed it existed.
 *   v1.x — 2026-08-08 — registerCompanyTools: the company registry on the MCP surface.
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
import { resolveSupportRoute } from '../services/message-alias.js';
import { registerCoreTools } from './core.js';
import { registerComplianceTools } from './compliance.js';
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
import { registerPromptsTools } from './prompts.js';
import { registerCapabilitiesTools } from './capabilities.js';
import { registerCortexTools } from './cortex.js';
import { registerAppsTools } from './apps.js';
import { registerAppDraftEditTools } from './apps-draft-edit.js';
import { registerAppScreenshotTool } from './apps-screenshot.js';
import { registerAiImageTool } from './ai-image.js';
import { registerSharingGroupTools } from './sharing-groups.js';
import { registerAgentTaskTools } from './agent-tasks.js';
import { registerAgentScheduleTools } from './agent-schedules.js';
import { registerWorkflowTools } from './workflows.js';
import { registerAgentCapabilityTools } from './agent-capabilities.js';
import { registerAgentMessageTools } from './agent-messages.js';
import { registerDmMessageTools } from './dm-messages.js';
import { registerContactTools } from './contacts.js';
import { registerCompanyTools } from './companies.js';
import { registerPortfolioTools } from './portfolio.js';
import { registerAgentOnboardingTools } from './agent-onboarding.js';
import { registerAgentTelemetryTools } from './agent-telemetry.js';
import { registerAgentManagementTools } from './agent-management.js';
import { scopeAllowsTool } from './catalog/scopes.js';
import { wrapToolHandler } from './tool-usage-wrap.js';
import { toolsForSurface, isV2Role, V2_ROLES, type SurfaceRole } from './catalog/surfaces.js';
import { instructionsFor } from './instructions.js';
import { proactiveGuidance } from '../services/proactive-mode.js';
import { registerManagedPrompts } from './prompts-managed.js';
import { registerOAuthRoutes } from './oauth.js';
import { registerChatInstance, touchChatInstance } from '../services/chat-instance-write.js';

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
    // IDLE EXPIRY (memory trace 2026-08-19). Every session carries a full McpServer — hundreds of
    // registered tools, each with its Zod schema graph — and until now a session died ONLY when the
    // client sent DELETE. Most clients never do: a closed desktop app, a dropped connection or a
    // restarted daemon just stops talking, so its server object stayed in `transports` forever.
    // Production heap snapshot: 17,815 live Zod check-closures and ~1 GB of retained schema graphs
    // after four hours. The sweep below closes any session with no request for
    // config.mcpSessionIdleMinutes; a returning client gets the spec's 404 and re-initializes.
    const sessionLastSeen = new Map<string, number>();
    // Every 10 s: the scan is a Map walk over a handful of sessions, and a short interval is what
    // lets the idle floor go sub-minute (the E2E proves expiry with a 6-second idle).
    const SWEEP_EVERY_MS = 10_000;
    const sweeper = setInterval(() => {
        const cutoff = Date.now() - config.mcpSessionIdleMinutes * 60_000;
        let reaped = 0;
        for (const [id, t] of transports) {
            const seen = sessionLastSeen.get(id) ?? 0;
            if (seen < cutoff) {
                reaped++;
                // close() fires transport.onclose, which removes the session from every map.
                void Promise.resolve(t.close()).catch(err =>
                    logger.warn('MCP idle sweep: transport close failed; maps are cleaned regardless', { error: String(err) }));
                transports.delete(id);
                sessionChatInstances.delete(id);
                sessionTokens.delete(id);
                sessionLastSeen.delete(id);
            }
        }
        if (reaped > 0) logger.info(`MCP idle sweep: closed ${reaped} session(s) idle over ${config.mcpSessionIdleMinutes} min (${transports.size} remain)`);
    }, SWEEP_EVERY_MS);
    sweeper.unref();

    async function createMcpServer(
        agentGaii: string,
        scopes: string[],
        role: SurfaceRole | 'all' = 'all',
        getToken: () => string | undefined = () => undefined,
        owner?: string,
    ): Promise<McpServer> {
        // What this account chose about being offered things it did not ask for. Read here because
        // the handshake is the one moment every client passes through, and never allowed to fail a
        // connection: proactiveGuidance() answers null on any trouble.
        const guidance = await proactiveGuidance(storage, config, owner);
        // Who answers support here. Read from the stored peer rows because this layer has no peer
        // map, and through the SAME resolver the send path uses, so the sentence an agent is told
        // and the address its message actually takes cannot disagree. Never fails a connection: an
        // unreadable peer list means the instructions say what they always said.
        const supportAnsweredBy = await storage.listFederationPeers()
            .then(rows => {
                const route = resolveSupportRoute(rows);
                return route.kind === 'upstream' ? route.nodeId : null;
            })
            .catch(err => { logger.warn('mcp: support routing unread, instructions unchanged', { error: String(err) }); return null; });
        const mcp = new McpServer(
            { name: `AIMEAT Node ${config.nodeId}`, version: '1.2.0' },
            {
                capabilities: { tools: {}, resources: { subscribe: true, listChanged: true } },
                // The orientation an agent reads before it has called anything. Without it a client
                // meets a few hundred tool descriptions and no indication of where to start, so the
                // handbook this text points at was reachable only by guessing it existed.
                instructions: instructionsFor(role, { proactiveGuidance: guidance, supportAnsweredBy }),
            },
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
        // Measured INSIDE the gate: a tool this agent's scopes filtered out is never wrapped, so a
        // tool that was never offered is never counted as one that was not called. The wrap sits at
        // registration for the same reason the gate does — one place, every tool, nothing for a new
        // tool's author to remember. See mcp/tool-usage-wrap.ts.
        const measuredTool = wrapToolHandler(originalTool, () => agentGaii);
        const measuredRegisterTool = wrapToolHandler(originalRegisterTool, () => agentGaii);
        patchable.tool = (...args: unknown[]) => gate(args[0] as string) ? measuredTool(...args) : undefined;
        patchable.registerTool = (...args: unknown[]) => gate(args[0] as string) ? measuredRegisterTool(...args) : undefined;

        registerCoreTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes, peers);
        registerBoardsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerOrganismsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerWorkspaceTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerKnowledgeTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerAppdevPitfallTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, scopes);
        registerAppdevResearchTools(mcp, storage, config, () => agentGaii);
        registerAppTemplateProposalTools(mcp, storage, config, () => agentGaii);
        registerAppdevProofTools(mcp, storage, config, () => agentGaii, scopes);
        registerSkillsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerOperatorConfigTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerComplianceTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerExtensionsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerCatalogueTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerMemoryExtendedTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerWalletExtendedTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerConsentTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerCommerceTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerExchangeTools(mcp, storage, config, () => agentGaii);
        registerExchangeRunTools(mcp, storage, config, () => agentGaii, getToken);
        registerChatInstancesTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerFlagsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerPromptsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerCapabilitiesTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, getToken);
        registerCortexTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAppsTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAppDraftEditTools(mcp, storage, config, () => agentGaii);
        registerAppScreenshotTool(mcp, storage, config, () => agentGaii);
        registerAiImageTool(mcp, storage, config, () => agentGaii);
        registerSharingGroupTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerAgentTaskTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentScheduleTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
        registerWorkflowTools(mcp, storage, config, () => agentGaii);
        registerAgentCapabilityTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentMessageTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerDmMessageTools(mcp, storage, config, () => agentGaii, peers);
        registerContactTools(mcp, storage, config, () => agentGaii);
        registerCompanyTools(mcp, storage, config, () => agentGaii);
        registerPortfolioTools(mcp, storage, config, () => agentGaii);
        registerAgentTelemetryTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentOnboardingTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);
        registerAgentManagementTools(mcp, storage, config, () => agentGaii, emitResourceUpdated, emitResourceListChanged);

        // Restore the original methods and report what scope enforcement did this session.
        patchable.tool = originalTool;
        patchable.registerTool = originalRegisterTool;

        // The node's managed prompts, as the primitive the PERSON picks from (a slash command in
        // Claude Code) rather than one the model has to think of calling. Registered after the
        // tool-gate window closes: the gate patches mcp.tool/registerTool, and a prompt is neither.
        // Awaited here rather than inside that window, so no storage round-trip happens while the
        // two methods are monkeypatched.
        const promptCount = await registerManagedPrompts(mcp, storage, config, () => agentGaii);
        if (promptCount > 0) {
            logger.info(`[mcp-prompts] ${promptCount} managed prompt(s) offered to ${agentGaii}`);
        }

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

        // A REVOKED token is refused here, before anything else looks at it. POST /v1/mcp/token/revoke
        // writes the JWT into the revocation list and answers `{revoked:true}`, and this door was the
        // one place that never read the list: auth/middleware.ts checks isRevoked on all three of its
        // paths, so the same credential was dead on the REST surface and alive on the MCP one. The
        // check sits ABOVE the session-resume branch on purpose — a live session must not outlive the
        // credential it was opened with, and that branch even refreshes the session's stored bearer
        // from the request. E2E test-quality audit, e2e-mcp:448: the suite asserted the endpoint's
        // `revoked: true` echo, which RFC 7009 answers unconditionally for any string.
        if (token) {
            const { isRevoked } = await import('../auth/jwt.js');
            if (await isRevoked(token)) {
                res.status(401).json({
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Token has been revoked. Obtain a new access token via /v1/mcp/token.' },
                    id: (Array.isArray(req.body) ? req.body[0]?.id : req.body?.id) ?? null,
                });
                return;
            }
        }

        // Determine session ID from header
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
            // Existing session — update lastSeen for session tracking
            sessionLastSeen.set(sessionId, Date.now());
            const ciId = sessionChatInstances.get(sessionId);
            if (ciId) {
                // notify:false — this heartbeat fires on every tool call, and a `chat` change event
                // per call would have every open browser re-fetching the list dozens of times a minute.
                touchChatInstance({ storage }, ciId, { notify: false }).catch(err => { logger.warn('handleMcpPost: continuing after a suppressed failure', { error: String(err) }); });
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

            // The id predates buildChatInstanceId and every session row in production is addressed
            // by it, so it is passed explicitly rather than derived.
            chatInstanceId = `mcp-${platform}#${sessionOwner}@${config.nodeId}`;
            try {
                const out = await registerChatInstance(
                    { storage, config },
                    { ownerName: sessionOwner, agentGaii: authenticatedGaii },
                    { platform, appName: `mcp-${platform}`, id: chatInstanceId },
                );
                if (!out.ok) {
                    logger.warn('Failed to upsert ChatInstance for MCP session', { error: `${out.code}: ${out.message}` });
                    chatInstanceId = undefined;
                }
            } catch (err) {
                logger.warn('Failed to upsert ChatInstance for MCP session', { error: (err as Error).message });
                chatInstanceId = undefined;
            }

            // Onboarding funnel: the owner's FIRST MCP session is the activation signal the
            // rescue email keys off. Fire-and-forget; must never delay or break the session.
            const { recordFirstMcpCall } = await import('../services/onboarding-funnel.js');
            void recordFirstMcpCall(storage, config, sessionOwner, platform);
        }

        // Create transport and MCP server for this session
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => `mcp-${randomBytes(16).toString('hex')}`,
        });

        const tokenBox: { current: string | undefined } = { current: token };
        const mcpServer = await createMcpServer(authenticatedGaii, sessionScopes, serverRole, () => tokenBox.current, sessionOwner);

        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
                sessionChatInstances.delete(transport.sessionId);
                sessionTokens.delete(transport.sessionId);
                sessionLastSeen.delete(transport.sessionId);
            }
        };

        await mcpServer.connect(transport);

        await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);

        // Store transport for session reuse (sessionId is generated during handleRequest)
        if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
            sessionLastSeen.set(transport.sessionId, Date.now());
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
        sessionLastSeen.set(sessionId, Date.now());
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
    // `/mcp` alongside `/v1/mcp`. The versioned path stays canonical and is what the Server Card
    // declares, but `/mcp` at the origin root is the de facto convention: a client that does not
    // read the card tries it first, and every one that did got a 404 from a node whose MCP server
    // was one path away. An alias, not a second server — same handlers, same sessions.
    router.post(['/v1/mcp', '/mcp'], handleMcpPost('all'));
    router.get(['/v1/mcp', '/mcp'], handleMcpGet);
    router.delete(['/v1/mcp', '/mcp'], handleMcpDelete);

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
