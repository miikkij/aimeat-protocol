/**
 * @file src/cli/connect/mcp/local-call.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `POST /local/call/:tool` of the serve daemon: deterministic shell-callable tool
 *   dispatch over the tunnel. Same handler registry as `aimeat connect call`, but routed through the
 *   agent's tunnel-backed client — one loopback POST, no per-call subprocess and no fresh TLS per
 *   call. Body = the tool's JSON input (as `connect call --json`); response = the AIMEAT envelope
 *   (callers check `ok`). Agent picked by `X-Aimeat-Agent` / `?agent=` (defaults to the registry
 *   primary). A pure extraction from local-server.ts when that file passed 800 lines.
 * @structure registerLocalCallRoute(app, resolveAgent)
 * @usage registerLocalCallRoute(app, resolveAgent);
 * @version-history
 *   v1.0.0 — 2026-09-27 — Extracted from local-server.ts. A tool that became an action of another
 *     answers 410 TOOL_MOVED with the call that replaces it (mcp/catalog/moved-tools.ts).
 */
import type { Express, Request, Response } from 'express';
import type { RegisteredAgent } from '../agent-registry.js';
import { CONNECT_CLI_TOOLS } from '../tool-call.js';
import { movedToolMessage } from '../../../mcp/catalog/moved-tools.js';

export function registerLocalCallRoute(app: Express, resolveAgent: (req: Request) => RegisteredAgent): void {
  app.post('/local/call/:tool', async (req: Request, res: Response) => {
    let entry: RegisteredAgent;
    try { entry = resolveAgent(req); }
    catch (err) {
      res.status(400).json({ ok: false, error: { code: 'UNKNOWN_AGENT', message: (err as Error).message } });
      return;
    }
    const toolName = req.params.tool as string;
    const tool = CONNECT_CLI_TOOLS.find(t => t.name === toolName);
    if (!tool) {
      // A tool that became an action of another names the call that replaces it (mcp/catalog/moved-tools.ts).
      const moved = movedToolMessage(toolName);
      if (moved) { res.status(410).json({ ok: false, error: { code: 'TOOL_MOVED', message: moved } }); return; }
      res.status(404).json({ ok: false, error: { code: 'UNKNOWN_TOOL', message: `Unknown shell-callable tool: ${toolName}` } });
      return;
    }
    const input = (req.body && typeof req.body === 'object' && !Array.isArray(req.body))
      ? req.body as Record<string, unknown>
      : {};
    try {
      const response = await tool.handler({
        client: entry.client, // tunnel-backed in tunnel mode, direct fetch when degraded
        config: { node_url: entry.config.node_url, agent: entry.agent, owner: entry.owner },
        agentPath: encodeURIComponent(entry.agent),
      }, input);
      res.status(response.ok ? 200 : 400).json(response);
    } catch (err) {
      res.status(400).json({ ok: false, error: { code: 'TOOL_CALL_ERROR', message: (err as Error).message } });
    }
  });
}
