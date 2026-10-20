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
 *   v1.1.0 — 2026-10-20 — The agent admission and the first-contact records come from
 *     services/mcp-agent-admission.ts, and the answer to a request without a token from
 *     mcp/unauthenticated-answer.ts, both shared with the 2026-07-28 path. Same answers, same writes.
 *   v1.0.0 — 2026-10-20 — Extracted from mcp/index.ts. No behaviour change.
 */
import type { Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import type { SurfaceRole } from '../tool-catalog/surfaces.js';
import { touchChatInstance } from '../services/chat-instance-write.js';
import { markAgentMcpUse } from '../services/agent-mcp-touch.js';
import { admitMcpAgent, recordMcpContact } from '../services/mcp-agent-admission.js';
import { answerWithoutToken } from './unauthenticated-answer.js';
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
            // The public catalogue for tools/list, else the OAuth challenge (mcp/unauthenticated-answer.ts).
            await answerWithoutToken(req, res, config, 'legacy');
            return;
        }

        // agentGaii is guaranteed to be a string here (401 returned above if not)
        const authenticatedGaii: string = agentGaii;

        // Validate agent exists and has a real owner
        let chatInstanceId: string | undefined;
        let sessionAgentInfo: { gaii: string; platform: string } | undefined;

        {
            // A known agent, a real owner, a GHII account (services/mcp-agent-admission.ts, shared
            // with the 2026-07-28 path).
            const admitted = await admitMcpAgent(storage, authenticatedGaii);
            if (!admitted.ok) {
                res.status(admitted.status).json({
                    jsonrpc: '2.0',
                    error: { code: admitted.code, message: admitted.message },
                    id: req.body?.id ?? null,
                });
                return;
            }
            sessionOwner = admitted.owner;

            // Upsert ChatInstanceRecord for session tracking
            // Prefer mcp_client from JWT (set during OAuth consent) over User-Agent sniffing
            const platform = mcpSessionPlatform(mcpClientName, req.headers['user-agent']);
            // The chat-instance row, the onboarding signal and the agent's MCP-use mark, once per session.
            chatInstanceId = await recordMcpContact({ storage, config }, { gaii: authenticatedGaii, owner: sessionOwner, platform });
            sessionAgentInfo = { gaii: authenticatedGaii, platform };
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
