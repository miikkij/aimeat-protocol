/**
 * @file ui-library.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for the component catalogue of the node's own interface
 *   — parity with the server MCP (src/mcp/ui-library.ts). A thin proxy to GET /v1/ui/components,
 *   which is public and read-only.
 * @structure registerUiLibraryTools(mcp, registry)
 * @usage import { registerUiLibraryTools } from './ui-library.js';
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerUiLibraryTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_ui_component_list', descriptionFor('aimeat_ui_component_list'), zodShapeFor('aimeat_ui_component_list'), annotationsFor('aimeat_ui_component_list'), async ({ kind, status, q }) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    const qs = params.toString();
    return out(await client.get(`/v1/ui/components${qs ? `?${qs}` : ''}`));
  });

  mcp.tool('aimeat_ui_component_get', descriptionFor('aimeat_ui_component_get'), zodShapeFor('aimeat_ui_component_get'), annotationsFor('aimeat_ui_component_get'), async ({ id }) => {
    return out(await client.get(`/v1/ui/components/${encodeURIComponent(id)}`));
  });
}
