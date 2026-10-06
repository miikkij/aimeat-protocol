/**
 * @file src/cli/connect/mcp/tools/dispatch-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The connector MCP tools that have no handler of their own: each one runs its CLI
 *   dispatch definition (CONNECT_CLI_TOOLS, src/tool-dispatch/), the same handler `aimeat connect
 *   call` and `POST /local/call/<tool>` run (secaudit 2026-10, M3). Before this the connector MCP
 *   mapped every tool name to its REST call a second time, beside the dispatch table, and the two
 *   drifted: a parameter one forwarded the other dropped.
 *
 *   A tool registers here when the dispatch table carries it (every shell-callable catalog tool is on
 *   the connector MCP too) and no connector module registered a handler of its own first. Its
 *   schema is the catalog's plus the connector's `agent_name`, and its answer is the connector's
 *   standard result: the envelope's data (or the refusal), shaped by `response_format` where the
 *   catalog defines a concise view.
 *
 *   The tools moved here on 2026-10-05 were each proved the same, before the move, by calling the old
 *   connector handler and this path with the same inputs against a recorded node that answered and
 *   one that refused: the same HTTP requests and the same result text in both.
 * @structure registerDispatchTools(mcp, registry, registered)
 * @usage registerDispatchTools(mcp, registry, namesTheModulesRegistered)
 * @version-history
 *   v1.1.0 — 2026-10-06 — `response_format` is taken as the view only on a tool whose catalog entry
 *     supports one; on any other it is the tool's own input and reaches its handler. aimeat_voice_speak
 *     names its audio format so, and would have lost an mp3 request when it moved here (secaudit
 *     2026-10 follow-up, Part B).
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, M3).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { CONNECT_CLI_TOOLS } from '../../tool-call.js';
import { getAimeatToolDefinition } from '../../../../tool-catalog/definitions.js';
import { descriptionFor, shapeResponse, type ResponseFormat } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { agentNameSchema, pickAgent, payloadResult } from './_registry.js';

/** Register every connector tool no module registered, over its dispatch definition. Returns their names. */
export function registerDispatchTools(mcp: McpServer, registry: AgentRegistry, registered: ReadonlySet<string>): string[] {
    const added: string[] = [];
    for (const tool of CONNECT_CLI_TOOLS) {
        if (registered.has(tool.name)) continue;
        // Every shell-callable tool is on the connector MCP too (audit-mcp-tools, cliFallbackWithoutConnectorMcp).
        if (!getAimeatToolDefinition(tool.name)) continue;
        const shape = { agent_name: agentNameSchema, ...zodShapeFor(tool.name) };
        // `response_format` is the concise/detailed view only on a tool that supports one; on any other
        // it is the tool's own input (aimeat_voice_speak's audio format) and goes to the handler.
        const viewParam = getAimeatToolDefinition(tool.name)?.supportsResponseFormat === true;
        mcp.tool(tool.name, descriptionFor(tool.name), shape, annotationsFor(tool.name), async (args: Record<string, unknown>) => {
            const { agent_name, ...rest } = args;
            const { response_format, ...viewless } = rest;
            const input = viewParam ? viewless : rest;
            const picked = pickAgent(registry, agent_name as string | undefined);
            const resp = await tool.handler({
                client: picked.client,
                config: { node_url: picked.config.node_url, agent: picked.agent, owner: picked.owner },
                agentPath: encodeURIComponent(picked.agent),
            }, input);
            const view = viewParam ? response_format as ResponseFormat | undefined : undefined;
            return payloadResult(shapeResponse(tool.name, view, resp.data ?? resp), resp);
        });
        added.push(tool.name);
    }
    return added;
}
