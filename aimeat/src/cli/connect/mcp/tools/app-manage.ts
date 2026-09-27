/**
 * @file src/cli/connect/mcp/tools/app-manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_manage on the connector MCP server: the same input shape as the node
 *   (src/mcp/app-manage-shape.ts), sent to the node's REST endpoints by appManageCall(), which the
 *   CLI dispatch calls too. Replaces the connector's ten app tools (seo, marks, legal, screenshot,
 *   visitors, visitors_measure, versions, audit, ui_get, ui_set).
 * @structure registerAppManageTool
 * @usage import { registerAppManageTool } from './app-manage.js';
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import type { ApiResponse } from '../../api-client.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';
import { appManageShape } from '../../../../mcp/app-manage-shape.js';
import { appManageCall } from '../../app-manage-call.js';

export function registerAppManageTool(mcp: McpServer, registry: AgentRegistry): void {
  const { client, owner } = registry.resolve();
  const out = (resp: ApiResponse) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.ok === false ? (resp.error ?? resp) : (resp.data ?? resp), null, 2) }], ...(resp.ok === false ? { isError: true as const } : {}) });

  mcp.tool('aimeat_app_manage', descriptionFor('aimeat_app_manage'), {
    ...appManageShape,
    // legal and ui_set send the declaration in their request body; the node route records it.
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_app_manage'), async (args) => {
    return out(await appManageCall(client, owner, args as Record<string, unknown>, ['agent_name']));
  });
}
