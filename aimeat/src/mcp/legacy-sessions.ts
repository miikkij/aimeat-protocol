/**
 * @file src/mcp/legacy-sessions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP 2025-era session code of /v1/mcp and /v2/mcp/:role: one Streamable HTTP
 *   transport and one McpServer per session, the session maps, the idle sweep, the session-principal
 *   check, and the GET (notification stream) and DELETE (close) handlers.
 *
 *   PURE EXTRACTION from mcp/index.ts (2026-10-20), so the 2026-07-28 code path can sit beside it
 *   without index.ts passing 800 lines (MCP SDK v2 migration plan doc-mvguy322f9se, step 5). The
 *   code is unchanged; what it reached from the router's closure (the config, the storage, the
 *   request authority, authenticate() and createMcpServer()) is handed in as LegacySessionDeps.
 *   Every 2025-era client keeps this code path byte for byte (decision 2026-10-20, item 2).
 * @structure LegacySessionDeps · legacySessions(deps) → { servePost, handleGet, handleDelete }
 * @usage
 *   const legacy = legacySessions({ config, storage, authority, authenticate, createMcpServer });
 *   await legacy.servePost(req, res, verified, token, serverRole);
 * @version-history
 *   v1.0.0 — 2026-10-20 — Extracted from mcp/index.ts. No behaviour change.
 */
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer } from '@modelcontextprotocol/server';
import { MCP_RESOURCE_METADATA_PATH } from '../services/protected-resource.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { SurfaceRole } from '../tool-catalog/surfaces.js';
import { registerChatInstance, touchChatInstance } from '../services/chat-instance-write.js';
import { markAgentMcpUse } from '../services/agent-mcp-touch.js';
import type { VerifiedToken } from '../auth/jwt.js';
import { sameMcpPrincipal, type mcpRequestAuthority } from './request-authority.js';
import { mcpSessionPlatform } from './session-platform.js';
import { noteMcpSession, forgetMcpSession } from './session-registry.js';

/** What the session code reached from the router's closure before it moved here. */
export interface LegacySessionDeps {
    config: AimeatConfig;
    storage: Storage;
    authority: ReturnType<typeof mcpRequestAuthority>;
    authenticate: (req: Request, res: Response) => Promise<VerifiedToken | null>;
    createMcpServer: (agentGaii: string, scopes: string[], role: SurfaceRole | 'all', getToken: () => string | undefined, owner?: string) => Promise<McpServer>;
}

export function legacySessions(deps: LegacySessionDeps) {
    const { config, storage, authority, authenticate, createMcpServer } = deps;

    // Per-session transports
    const transports = new Map<string, NodeStreamableHTTPServerTransport>();
    // Map MCP session IDs to ChatInstance IDs for heartbeat tracking
    const sessionChatInstances = new Map<string, string>();
    const sessionPrincipals = new Map<string, VerifiedToken>();

    function sessionAllowed(req: Request, res: Response, id: string, auth: VerifiedToken | null): auth is VerifiedToken {
        if (!auth) {
            if (!res.headersSent) res.status(401).json({ jsonrpc: '2.0', error: {
                code: -32001, message: 'Authentication required for this MCP session.' }, id: req.body?.id ?? null });
            return false;
        }
        const initial = sessionPrincipals.get(id);
        if (!initial || !sameMcpPrincipal(initial, auth)) {
            res.status(403).json({ jsonrpc: '2.0', error: {
                code: -32003, message: 'This MCP session belongs to a different principal.' }, id: req.body?.id ?? null });
            return false;
        }
        return true;
    }
    // IDLE EXPIRY (memory trace 2026-08-19). Every session carries a full McpServer — hundreds of
    // registered tools, each with its Zod schema graph — and until now a session died ONLY when the
    // client sent DELETE. Most clients never do: a closed desktop app, a dropped connection or a
    // restarted daemon just stops talking, so its server object stayed in `transports` forever.
    // Production heap snapshot: 17,815 live Zod check-closures and ~1 GB of retained schema graphs
    // after four hours. The sweep below closes any session with no request for
    // config.mcpSessionIdleMinutes; a returning client gets the spec's 404 and re-initializes.
    const sessionLastSeen = new Map<string, number>();
    // Which agent a session belongs to and which tool it came from, so the requests that follow the
    // initialize can keep the agent's MCP use current (services/agent-mcp-touch.ts) without a
    // second token parse. Cleaned wherever the other session maps are.
    const sessionAgents = new Map<string, { gaii: string; platform: string }>();
    // Every config.mcpSessionSweepMs (10 s shipped): the scan is a Map walk over a handful of
    // sessions, and a short interval is what lets the idle floor go sub-minute. The E2E runner pins
    // 1 s so e2e-mcp-session-expiry proves a 6-second idle in 8 s rather than 18.
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
                sessionPrincipals.delete(id);
                sessionLastSeen.delete(id);
                sessionAgents.delete(id);
                forgetMcpSession(id);
            }
        }
        if (reaped > 0) logger.info(`MCP idle sweep: closed ${reaped} session(s) idle over ${config.mcpSessionIdleMinutes} min (${transports.size} remain)`);
    }, config.mcpSessionSweepMs);
    sweeper.unref();

    // The session half of the POST handler: everything after the loop brake, the origin check and
    // authenticate(), which mcp/index.ts runs for both eras.
    async function servePost(req: Request, res: Response, verified: VerifiedToken | null, token: string | undefined, serverRole: SurfaceRole | 'all'): Promise<void> {
        // Determine session ID from header
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
            if (!sessionAllowed(req, res, sessionId, verified)) return;
            // Existing session — update lastSeen for session tracking
            sessionLastSeen.set(sessionId, Date.now());
            const ciId = sessionChatInstances.get(sessionId);
            if (ciId) {
                // notify:false — this heartbeat fires on every tool call, and a `chat` change event
                // per call would have every open browser re-fetching the list dozens of times a minute.
                touchChatInstance({ storage }, ciId, { notify: false }).catch(err => { logger.warn('handleMcpPost: continuing after a suppressed failure', { error: String(err) }); });
            }
            // The agent's own MCP-use mark, throttled inside: the MCP page reads "viimeksi" from it.
            const who = sessionAgents.get(sessionId);
            if (who) void markAgentMcpUse(storage, who.gaii, who.platform);
            const transport = transports.get(sessionId)!;
            await authority.run(token!, verified, () =>
                transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body));
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
        const agentGaii = verified?.sub;
        let sessionOwner = verified?.owner;
        const mcpClientName = verified?.mcp_client;

        if (!agentGaii) {
            // ONE QUESTION A STRANGER MAY ASK WITHOUT AN ACCOUNT: what can you do?
            //
            // A foreign agent arriving with nothing but the hostname could not learn a single
            // capability without first getting a credential, which is the wrong way round — you
            // decide whether to ask for an account by knowing what the account is for. `tools/list`
            // answers with names, descriptions and input shapes: the contract, which openapi.json
            // already publishes. No data, no session, no identity, and `tools/call` still 401s.
            //
            // `initialize` is DELIBERATELY NOT ANSWERED HERE, and the temptation is real because an
            // agent-readiness scanner probes exactly that. Every real MCP client initializes first
            // and relies on this 401 plus its WWW-Authenticate header to find the OAuth flow (MCP
            // spec §5.3); answering 200 with no session would send Claude, Cursor and the rest past
            // the only signpost they have and fail them one call later, on a route where the
            // failure would read as ours. A single unauthenticated `tools/list` is not a step any
            // real client takes before initializing, so this branch cannot be reached by one.
            const probe = Array.isArray(req.body) ? undefined : req.body as { method?: string; id?: unknown } | undefined;
            if (probe?.method === 'tools/list') {
                const { publicToolCatalogue } = await import('./public-catalogue.js');
                res.json({ jsonrpc: '2.0', id: probe.id ?? null, result: { tools: publicToolCatalogue() } });
                return;
            }
            // No token — challenge client to authenticate via OAuth (MCP spec §5.3)
            // THE MCP RESOURCE'S OWN METADATA, not the origin's. RFC 9728 §3.3 has a client reject
            // metadata whose `resource` is not the resource it is talking to, and the bare
            // well-known URL describes the origin — so pointing a client that is protecting
            // `/v1/mcp` at it handed them a document they are entitled to throw away.
            const resourceMetadataUrl = `${config.baseUrl.replace(/\/+$/, '')}${MCP_RESOURCE_METADATA_PATH}`;
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
        let sessionAgentInfo: { gaii: string; platform: string } | undefined;

        {
            const agent = await storage.getAgent(authenticatedGaii);
            if (!agent) {
                res.status(401).json({
                    jsonrpc: '2.0',
                    error: { code: -32001, message: 'Agent not found. Connect it first through device authorization (POST /v1/agents/device-authorize), which your owner approves.' },
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

            // Upsert ChatInstanceRecord for session tracking
            // Prefer mcp_client from JWT (set during OAuth consent) over User-Agent sniffing
            const platform = mcpSessionPlatform(mcpClientName, req.headers['user-agent']);

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

            // The agent itself learns it was used over MCP, from which tool, and when. The session
            // row above is per TOOL and keeps the first agent that ever opened it; this is the
            // per-agent truth the MCP page lists. Forced: the session's first request is the one
            // that carries a client name worth recording, whatever the throttle says.
            sessionAgentInfo = { gaii: authenticatedGaii, platform };
            void markAgentMcpUse(storage, authenticatedGaii, platform, { force: true });
        }

        // Create transport and MCP server for this session
        const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: () => `mcp-${randomBytes(16).toString('hex')}`,
        });

        const mcpServer = await authority.run(token!, verified!, () =>
            createMcpServer(authenticatedGaii, authority.scopes, serverRole, authority.token, sessionOwner));

        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId);
                sessionChatInstances.delete(transport.sessionId);
                sessionPrincipals.delete(transport.sessionId);
                sessionLastSeen.delete(transport.sessionId);
                sessionAgents.delete(transport.sessionId);
                forgetMcpSession(transport.sessionId);
            }
        };

        await mcpServer.connect(transport);

        await authority.run(token!, verified!, () =>
            transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body));

        // Store transport for session reuse (sessionId is generated during handleRequest)
        if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
            sessionLastSeen.set(transport.sessionId, Date.now());
            sessionPrincipals.set(transport.sessionId, verified!);
            if (chatInstanceId) {
                sessionChatInstances.set(transport.sessionId, chatInstanceId);
            }
            if (sessionAgentInfo) sessionAgents.set(transport.sessionId, sessionAgentInfo);
            // So DELETE /v1/agents/:name and POST /v1/agents/:gaii/rekey can take this socket down
            // with the agent's other credentials (mcp/session-registry.ts).
            noteMcpSession(transport.sessionId, authenticatedGaii, () => transport.close());
        }
    }

    // GET handler (SSE server→client notifications) — role-agnostic; the session is already bound
    // to its (role-scoped) server from the POST that created it.
    const handleMcpGet = async (req: Request, res: Response) => {
        const auth = await authenticate(req, res);
        if (res.headersSent) return;
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
            res.status(400).json({ error: 'Missing or invalid mcp-session-id header' });
            return;
        }
        if (!sessionAllowed(req, res, sessionId, auth)) return;
        sessionLastSeen.set(sessionId, Date.now());
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse);
    };

    // DELETE handler — close session (role-agnostic)
    const handleMcpDelete = async (req: Request, res: Response) => {
        const auth = await authenticate(req, res);
        if (res.headersSent) return;
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !transports.has(sessionId)) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        if (!sessionAllowed(req, res, sessionId, auth)) return;
        const transport = transports.get(sessionId)!;
        await transport.close();
        transports.delete(sessionId);
        res.status(200).json({ closed: true });
    };

    return { servePost, handleGet: handleMcpGet, handleDelete: handleMcpDelete };
}
