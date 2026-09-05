/**
 * @file src/cli/connect/mcp/tools/access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector-side aimeat_access_list: the same read the public MCP surface answers,
 *   through the node's own GET /v1/access/overview, so a Claude Desktop or Cursor session asks "who
 *   holds a key to my account" and gets the Access page's answer. No agent_name: the keys belong to
 *   the OWNER, whom every agent of theirs shares.
 * @structure registerAccessTools(mcp, registry)
 * @usage Called by `aimeat connect serve` via the MCP tool registry (tools/index.ts).
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial, mirroring mcp/access.ts.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAccessTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_access_list', descriptionFor('aimeat_access_list'), {}, annotationsFor('aimeat_access_list'), async () => {
    const resp = await client.get('/v1/access/overview');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
