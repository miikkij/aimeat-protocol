/**
 * @file surface-layout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for arranging this node's pages — parity with the server
 *   MCP (src/mcp/surface-layout.ts), so an agent served locally can do what the same agent can do
 *   over /v2/mcp.
 *
 *   A THIN PROXY, ON PURPOSE. Every refusal, the block validation and the passage rules live behind
 *   the HTTP routes; this door forwards and returns. The alternative is a second implementation of
 *   the same decisions, which is how one tool name came to mean two different backends here for
 *   months.
 * @structure registerSurfaceLayoutTools(mcp, registry)
 * @usage import { registerSurfaceLayoutTools } from './surface-layout.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerSurfaceLayoutTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_surface_layout_get', descriptionFor('aimeat_surface_layout_get'), {
    surface: z.string().describe("Which page: 'portal', 'home' or 'home-onboarding'."),
  }, annotationsFor('aimeat_surface_layout_get'), async ({ surface }) => {
    // Two reads rather than one: the layout, and the catalogue of blocks this node can serve. The
    // second is the vocabulary, and without it the first write an AI attempts is always a refusal.
    const layout = await client.get(`/v1/site/layout/${encodeURIComponent(surface)}`);
    if (layout.ok === false) return out(layout);
    const blocks = await client.get(`/v1/site/blocks?surface=${encodeURIComponent(surface)}`);
    return out({ ok: true, data: { ...(layout.data as object), available_blocks: (blocks.data as { blocks?: unknown })?.blocks ?? [] } });
  });

  mcp.tool('aimeat_surface_layout_set', descriptionFor('aimeat_surface_layout_set'), {
    surface: z.string().describe("Which page: 'portal', 'home' or 'home-onboarding'."),
    blocks: z.array(z.record(z.string(), z.unknown()))
      .describe('The blocks in the order they should appear. Each is { id, key } with optional props, titles, hidden, children and — on a free-form block — body.'),
    note: z.string().optional().describe('One line on what this change was for. It shows in the node change log.'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_surface_layout_set'), async ({ surface, blocks, note, ai_provenance, ai_provenance_id }) => {
    return out(await client.put(`/v1/site/layout/${encodeURIComponent(surface)}`, {
      v: 1, blocks,
      ...(note ? { meta: { note } } : {}),
      ...(ai_provenance ? { ai_provenance } : {}),
      ...(ai_provenance_id ? { ai_provenance_id } : {}),
    }));
  });
}
