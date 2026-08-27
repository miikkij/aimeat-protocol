/**
 * @file app-ui.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for the Atelier mosaic pair (TARGET-074) — parity with
 *   the server MCP (src/mcp/app-ui.ts), so an agent served locally can arrange its owner's app
 *   screens exactly as the same agent can over /v2/mcp.
 *
 *   A THIN PROXY, ON PURPOSE. Validation, ownership and versioning live behind the HTTP routes;
 *   this door forwards and returns. The get makes two reads — the layout and nothing else,
 *   because the route already answers with the catalogue in the same payload.
 * @structure registerAppUiTools(mcp, registry)
 * @usage import { registerAppUiTools } from './app-ui.js';
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerAppUiTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client, owner } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_app_ui_get', descriptionFor('aimeat_app_ui_get'), {
    filename: z.string().describe('The published app file, e.g. "errands.html".'),
  }, annotationsFor('aimeat_app_ui_get'), async ({ filename }) => {
    // One read: the route answers with the layout AND the catalogue — the vocabulary rides along.
    return out(await client.get(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/ui`));
  });

  mcp.tool('aimeat_app_ui_set', descriptionFor('aimeat_app_ui_set'), {
    filename: z.string().describe('The published app file the layout belongs to.'),
    layout: z.record(z.string(), z.unknown()).describe('The whole layout: { v: 1, look?, nav?, blocks: [...] }.'),
    note: z.string().optional().describe('One line on what this change was for.'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_app_ui_set'), async ({ filename, layout, note, ai_provenance, ai_provenance_id }) => {
    return out(await client.put(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/ui`, {
      layout: note ? { ...layout, meta: { ...(layout.meta as object ?? {}), note } } : layout,
      ...(ai_provenance ? { ai_provenance } : {}),
      ...(ai_provenance_id ? { ai_provenance_id } : {}),
    }));
  });
}
