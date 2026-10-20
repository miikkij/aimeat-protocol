/**
 * @file src/cli/connect/mcp/local-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The serve daemon's local MCP endpoint (`/v1/mcp` on the loopback port): POST, GET and
 *   DELETE, behind the loopback admission local-server.ts installs first.
 *
 *   TWO ERAS ON ONE PATH, AS ON THE NODE. A POST that carries the MCP 2026-07-28 `_meta` envelope is
 *   served statelessly by the SDK v2 handler (createMcpHandler, legacy 'reject'): the agent is
 *   resolved from the request's own X-Aimeat-Agent header and a server is built for that one
 *   identity, per request. Anything else is a 2025-era request and keeps the session code: one
 *   Streamable HTTP transport per session, the agent decided at `initialize` and held for the
 *   session. Which era a POST is comes from the SDK's own classifier (isLegacyRequest), so the
 *   branch never disagrees with the handler (MCP SDK v2 migration step 10).
 *
 *   ONE IDENTITY PER SERVER. Both paths hand buildMcp an AgentRegistry holding exactly the resolved
 *   agent, so `resolve()` inside every tool module has one answer and cannot refuse; a request that
 *   names no agent while several are loaded is refused here, naming the candidates.
 * @structure registerLocalMcp(app, deps) → { sessions() }
 * @usage const localMcp = registerLocalMcp(app, { resolveAgent, buildMcp });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Moved out of local-server.ts unchanged (the session code), plus the
 *     2026-07-28 stateless path (MCP SDK v2 migration step 10).
 */
import type { Express, Request, Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { createMcpHandler, isLegacyRequest, type McpServer } from '@modelcontextprotocol/server';
import { AgentRegistry, type RegisteredAgent } from '../agent-registry.js';

export interface LocalMcpDeps {
  /** Which loaded agent a loopback request is for (X-Aimeat-Agent or ?agent=); throws when it cannot say. */
  resolveAgent: (req: Request) => RegisteredAgent;
  /** The MCP server for a registry holding one identity (mcp/server.ts buildMcpServer). */
  buildMcp: (sessionRegistry: AgentRegistry) => McpServer;
}

/** The JSON-RPC id of a request body, for an error answer. */
function idOf(body: unknown): unknown {
  return (Array.isArray(body) ? (body[0] as { id?: unknown } | undefined)?.id : (body as { id?: unknown } | undefined)?.id) ?? null;
}

export function registerLocalMcp(app: Express, deps: LocalMcpDeps): { sessions: () => number } {
  const { resolveAgent, buildMcp } = deps;
  const transports = new Map<string, NodeStreamableHTTPServerTransport>();

  /** A registry holding exactly one identity: the scoping every tool module reads. */
  const registryFor = (agent: RegisteredAgent): AgentRegistry => {
    const sessionRegistry = new AgentRegistry();
    sessionRegistry.add(agent);
    return sessionRegistry;
  };

  // The 2026-07-28 path: the factory reads the agent this request resolved, handed in as AuthInfo.
  const modern = createMcpHandler(async (ctx) => {
    const agent = (ctx.authInfo?.extra as { agent?: RegisteredAgent } | undefined)?.agent;
    if (!agent) throw new Error('a 2026-07-28 request reached the local MCP factory without an agent');
    return buildMcp(registryFor(agent));
  }, { legacy: 'reject', onerror: (err: Error) => console.error(`local MCP: ${err.message}`) });

  app.post('/v1/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId && !(await isLegacyRequest(await toWebRequest(req as unknown as NodeIncomingMessageLike, req.body), req.body))) {
      let agent: RegisteredAgent;
      try { agent = resolveAgent(req); }
      catch (err) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32001, message: `${(err as Error).message} Send it as X-Aimeat-Agent on every request.` }, id: idOf(req.body) });
        return;
      }
      const authInfo = { token: '', clientId: agent.gaii, scopes: [], extra: { agent } };
      const node = toNodeHandler({ fetch: (request, options) => modern.fetch(request, { ...options, authInfo }) });
      await node(req as unknown as NodeIncomingMessageLike, res, req.body);
      return;
    }
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
      return;
    }
    if (sessionId) {
      const body = req.body;
      const method = Array.isArray(body) ? body[0]?.method : body?.method;
      if (method !== 'initialize') {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Session not found. Please re-initialize.' },
          id: idOf(body),
        });
        return;
      }
    }
    // WHO this session speaks as, decided here and refused here. The identifier comes from the
    // same header every other loopback route reads, so a client that already names its agent needs
    // no change; one that names none while several agents are loaded is told so at connect time,
    // in the registry's own words, naming the candidates. Before this the same refusal arrived as
    // an exception thrown inside a tool module's constructor and took the daemon with it.
    let sessionAgent: RegisteredAgent;
    try { sessionAgent = resolveAgent(req); }
    catch (err) {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: `${(err as Error).message} Send it as X-Aimeat-Agent on this MCP session.` },
        id: idOf(req.body),
      });
      return;
    }
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => `local-${randomBytes(16).toString('hex')}`,
    });
    // One identity, so `resolve()` inside every tool module has exactly one answer and cannot
    // refuse. The scoping IS an AgentRegistry, which is why no tool module changes.
    const mcp = buildMcp(registryFor(sessionAgent));
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    await mcp.connect(transport);
    await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, req.body);
    if (transport.sessionId) transports.set(transport.sessionId, transport);
  });

  app.get('/v1/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Missing or invalid mcp-session-id header' });
      return;
    }
    await transports.get(sessionId)!.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse);
  });

  app.delete('/v1/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transports.get(sessionId)!.close();
    transports.delete(sessionId);
    res.status(200).json({ closed: true });
  });

  return { sessions: () => transports.size };
}
