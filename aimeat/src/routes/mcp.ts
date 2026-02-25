import { Router, type Request, type Response } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

export function mcpRouter(config: MeatConfig, storage: Storage): Router {
  const router = Router();

  // Per-session transports
  const transports = new Map<string, StreamableHTTPServerTransport>();

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

  return router;
}
