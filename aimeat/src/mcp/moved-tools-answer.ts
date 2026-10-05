/**
 * @file src/mcp/moved-tools-answer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Answer a call to a tool that moved (catalog/moved-tools.ts) with TOOL_MOVED and the
 *   call that replaces it, on an MCP server, while the old name stays out of tools/list.
 *
 *   HOW. The MCP SDK answers a name it has no registration for with "Tool X not found", from its own
 *   tools/call request handler. Registering the old names would put them back in tools/list. So this
 *   wraps that one handler after the tools are registered: a moved name is answered here, and every
 *   other call goes to the SDK's handler unchanged. Used by the node MCP server (mcp/index.ts) and
 *   the connector (cli/connect/mcp/server.ts).
 * @structure answerMovedTools
 * @usage answerMovedTools(mcp); // after the last tool is registered
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { movedToolMessage } from '../tool-catalog/moved-tools.js';
import { logger } from '../utils/logger.js';

type RequestHandler = (request: { method: string; params?: { name?: unknown } }, extra: unknown) => Promise<unknown>;

export function answerMovedTools(mcp: McpServer): void {
    // The SDK keeps its handlers in a map on the protocol object; setRequestHandler() would re-parse
    // and cannot hand back the handler it replaces, so the map is read directly.
    const handlers = (mcp.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })._requestHandlers;
    const original = handlers?.get('tools/call');
    if (!handlers || !original) {
        logger.warn('moved-tools: the MCP server has no tools/call handler to wrap; old tool names answer "not found"');
        return;
    }
    handlers.set('tools/call', async (request, extra) => {
        const name = typeof request.params?.name === 'string' ? request.params.name : '';
        const moved = movedToolMessage(name);
        if (moved) return { content: [{ type: 'text', text: `TOOL_MOVED: ${moved}` }], isError: true };
        return original(request, extra);
    });
}
