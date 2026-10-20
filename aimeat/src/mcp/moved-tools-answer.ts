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
 *   v1.0.1 — 2026-10-20 — The tools/call handler is wrapped through mcp/sdk-seams.ts.
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { movedToolMessage } from '../tool-catalog/moved-tools.js';
import { logger } from '../utils/logger.js';
import { wrapToolsCall } from './sdk-seams.js';

export function answerMovedTools(mcp: McpServer): void {
    // The SDK has no public way to wrap tools/call; mcp/sdk-seams.ts reaches its handler map.
    const wrapped = wrapToolsCall(mcp, (original) => async (request, extra) => {
        const name = typeof request.params?.name === 'string' ? request.params.name : '';
        const moved = movedToolMessage(name);
        if (moved) return { content: [{ type: 'text', text: `TOOL_MOVED: ${moved}` }], isError: true };
        return original(request, extra);
    });
    if (!wrapped) logger.warn('moved-tools: the MCP server has no tools/call handler to wrap; old tool names answer "not found"');
}
