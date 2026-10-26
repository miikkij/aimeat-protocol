/**
 * @file src/mcp/modern-endpoint.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP 2026-07-28 code path of /v1/mcp and /v2/mcp/:role: stateless, one server per
 *   request, served by the SDK v2 handler (createMcpHandler) beside the 2025-era session code.
 *
 *   ROUTED BY ERA, NOT REPLACED (decision 2026-10-20, item 2). A request that carries the per-request
 *   `_meta` envelope of 2026-07-28 is modern; anything else is a 2025-era request and keeps the
 *   session code byte for byte (mcp/legacy-sessions.ts). isModernRequest asks the SDK's own
 *   classifier (isLegacyRequest), so this branch never disagrees with createMcpHandler. The handlers
 *   are strict (`legacy: 'reject'`): they serve a modern request and nothing else.
 *
 *   EVERYTHING IN FRONT STAYS IN FRONT. The loop brake, the origin check and authenticate() (verify,
 *   the four revocation checks, the RFC 8707 audience, a stale grant, current scopes) run in
 *   mcp/index.ts for both eras before this file is reached. A modern request without a token gets
 *   the 401 challenge an `initialize` gets (mcp/unauthenticated-answer.ts; decision 2026-10-20,
 *   item 3), so an SDK v2 client runs OAuth before it decides the era.
 *
 *   THE FACTORY IS createMcpServer, run inside the request authority (mcp/request-authority.ts), so
 *   every tool closure reads THIS request's token and scopes, as a 2025 session's do. The agent is
 *   admitted on every request (services/mcp-agent-admission.ts), because a modern request has no
 *   session that admitted it earlier, and the first-contact records are throttled there.
 *
 *   CHANGE NOTIFICATIONS. The handler serves `subscriptions/listen` itself; mcp/resource-events.ts
 *   events are published on every role's handler (handler.notify), so an open listen stream hears
 *   `tools/list_changed` after a permission change and `resources/updated` for a URI it subscribed
 *   to. The SDK's in-process bus sends tools/list_changed to every listen stream, not per agent
 *   (decision 2026-10-20, item 7): each client then re-lists its own principal-scoped list. Every open
 *   listen stream is registered in mcp/session-registry.ts under its agent, so deleting the agent or
 *   rotating its key closes it, as it closes a 2025 session.
 *
 *   TASKS. Each server the factory builds gets the MCP Tasks extension (mcp/tasks-extension.ts): a
 *   slow tools/call of a client that declares it answers with a task handle, and the client polls
 *   tasks/get. The 2025-era session code never gets it.
 * @structure isModernRequest(req) · modernAuthInfo(verified, token) · modernEndpoint(deps) → { serve, notify, close }
 * @usage
 *   const modern = modernEndpoint({ config, storage, run, build });
 *   if (await isModernRequest(req)) return modern.serve(req, res, verified, token, role);
 * @version-history
 *   v1.1.0 — 2026-10-26 — The MCP Tasks extension on every modern server (wish-mcp-tasks-laajennus-pitkille-ty-kalukutsuille).
 *   v1.0.0 — 2026-10-20 — Initial (MCP SDK v2 migration steps 5 and 6, plan doc-mvguy322f9se).
 */
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { createMcpHandler, isLegacyRequest, type AuthInfo, type McpHttpHandler, type McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler, toWebRequest, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { VerifiedToken } from '../auth/jwt.js';
import type { SurfaceRole } from '../tool-catalog/surfaces.js';
import { logger } from '../utils/logger.js';
import { admitMcpAgent, recordMcpContactThrottled } from '../services/mcp-agent-admission.js';
import { answerWithoutToken } from './unauthenticated-answer.js';
import { mcpSessionPlatform } from './session-platform.js';
import { noteMcpSession, forgetMcpSession } from './session-registry.js';
import { installTasksExtension } from './tasks-extension.js';
import { resolveIdentity } from '../utils/gaii.js';

/** Whether a POST speaks MCP 2026-07-28: the SDK's own classifier, so the two can never disagree. */
export async function isModernRequest(req: Request): Promise<boolean> {
    if (req.method !== 'POST') return false;
    // Express's req.auth is the node's own type, not the SDK's AuthInfo; nothing here reads it.
    const probe = await toWebRequest(req as unknown as NodeIncomingMessageLike, req.body);
    return !(await isLegacyRequest(probe, req.body));
}

/** The pass-through AuthInfo the handler hands the factory and the tools, from the verified token. */
export function modernAuthInfo(verified: VerifiedToken, token: string): AuthInfo {
    return { token, clientId: verified.sub, scopes: [...verified.scopes], expiresAt: verified.exp, extra: { verified } };
}

export interface ModernEndpointDeps {
    config: AimeatConfig;
    storage: Storage;
    /** The request authority's run (mcp/request-authority.ts): the token and scopes every tool reads. */
    run: <T>(token: string, verified: VerifiedToken, operation: () => T) => T;
    /** createMcpServer from mcp/index.ts, called inside run(). */
    build: (agentGaii: string, role: SurfaceRole | 'all', owner: string) => Promise<McpServer>;
}

export function modernEndpoint(deps: ModernEndpointDeps) {
    const { config, storage } = deps;
    const handlers = new Map<string, McpHttpHandler>();

    /** One strict handler per surface role, made on first use. */
    function handlerFor(role: SurfaceRole | 'all'): McpHttpHandler {
        let h = handlers.get(role);
        if (!h) {
            h = createMcpHandler(async (ctx) => {
                const verified = (ctx.authInfo?.extra as { verified?: VerifiedToken } | undefined)?.verified;
                if (!verified) throw new Error('modern MCP request reached the factory without a verified token');
                const server = await deps.build(verified.sub, role, verified.owner);
                // The Tasks extension exists only on this code path: a 2025-era session strips resultType.
                installTasksExtension(server, { storage, config, principal: resolveIdentity(verified, config.nodeId) });
                return server;
            }, {
                legacy: 'reject',
                // A keep-alive comment on open listen streams, so a proxy does not close an idle one.
                keepAliveMs: 25_000,
                onerror: (err: Error) => logger.warn('mcp-modern: the handler reported an error', { error: err.message }),
            });
            handlers.set(role, h);
        }
        return h;
    }

    /** Serve one modern request. The token, when there is one, is verified already. */
    async function serve(req: Request, res: Response, verified: VerifiedToken | null, token: string | undefined, role: SurfaceRole | 'all'): Promise<void> {
        if (!verified || !token) {
            await answerWithoutToken(req, res, config, 'modern');
            return;
        }
        const admitted = await admitMcpAgent(storage, verified.sub);
        if (!admitted.ok) {
            res.status(admitted.status).json({ jsonrpc: '2.0', error: { code: admitted.code, message: admitted.message }, id: req.body?.id ?? null });
            return;
        }
        const platform = mcpSessionPlatform(verified.mcp_client, req.headers['user-agent']);
        void recordMcpContactThrottled({ storage, config }, { gaii: verified.sub, owner: admitted.owner, platform })
            .catch(err => logger.warn('mcp-modern: the contact records were not written', { error: String(err) }));

        // A listen stream is the one modern request that stays open: register it under its agent, so
        // deleting the agent or rotating its key closes it (mcp/session-registry.ts).
        const method = Array.isArray(req.body) ? undefined : (req.body as { method?: string } | undefined)?.method;
        let listenId: string | undefined;
        if (method === 'subscriptions/listen') {
            listenId = `mcp-listen-${randomBytes(12).toString('hex')}`;
            const id = listenId;
            noteMcpSession(id, verified.sub, () => { if (!res.writableEnded) res.end(); });
            res.on('close', () => forgetMcpSession(id));
        }
        // An SSE answer must not be buffered by a proxy in front of the node (spec SHOULD).
        res.setHeader('X-Accel-Buffering', 'no');

        const handler = handlerFor(role);
        const authInfo = modernAuthInfo(verified, token);
        const node = toNodeHandler({
            fetch: (request, options) => deps.run(token, verified, () => handler.fetch(request, { ...options, authInfo })),
        }, { onerror: (err) => logger.warn('mcp-modern: the request could not be served', { error: err.message }) });
        // The AuthInfo above is the one the handler sees; Express's own req.auth is not the SDK's.
        await node(req as unknown as NodeIncomingMessageLike, res, req.body);
    }

    /** Publish a change to every role's open listen streams (handler.notify). */
    const notify = {
        toolsChanged: () => { for (const h of handlers.values()) h.notify.toolsChanged(); },
        resourcesChanged: () => { for (const h of handlers.values()) h.notify.resourcesChanged(); },
        resourceUpdated: (uri: string) => { for (const h of handlers.values()) h.notify.resourceUpdated(uri); },
    };

    async function close(): Promise<void> {
        await Promise.all([...handlers.values()].map(h => h.close()));
    }

    return { serve, notify, close };
}
