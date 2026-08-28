/**
 * @file designbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for the Design Book tools (TARGET-074 phase 5) —
 *   parity with the server MCP (src/mcp/designbook.ts), so an agent served locally browses,
 *   proposes and adopts from the same Book with the same words.
 *
 *   A THIN PROXY, ON PURPOSE. The bench, ownership and versioning live behind the HTTP routes;
 *   this door forwards and returns.
 * @structure registerDesignbookTools(mcp, registry)
 * @usage import { registerDesignbookTools } from './designbook.js';
 * @version-history
 *   v1.1.0 — 2026-08-28 — The kind wording grows with the Book: look, motion and illustration
 *     join layout and fill in the search filter and the propose contract (parity with the server
 *     MCP, same slice).
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerDesignbookTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_designbook_search', descriptionFor('aimeat_designbook_search'), {
    kind: z.string().optional().describe('Only this part kind: "layout", "fill", "look", "motion" or "illustration".'),
    status: z.string().optional().describe('Only this lifecycle state: proposed, published, aging or retired.'),
    q: z.string().optional().describe('A word matched against id, title, summary and tags.'),
    limit: z.number().optional().describe('Rows to return, 1-200. Default 50.'),
  }, annotationsFor('aimeat_designbook_search'), async ({ kind, status, q, limit }) => {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (limit != null) params.set('limit', String(limit));
    const qs = params.toString();
    return out(await client.get(`/v1/designbook${qs ? `?${qs}` : ''}`));
  });

  mcp.tool('aimeat_designbook_get', descriptionFor('aimeat_designbook_get'), {
    id: z.string().describe('The part id, from the search.'),
  }, annotationsFor('aimeat_designbook_get'), async ({ id }) => {
    return out(await client.get(`/v1/designbook/${encodeURIComponent(id)}`));
  });

  mcp.tool('aimeat_designbook_propose', descriptionFor('aimeat_designbook_propose'), {
    part: z.record(z.string(), z.unknown()).describe('The part: { id, kind: "layout"|"fill"|"look"|"motion"|"illustration", title, summary, body, tags? }. The kind decides the body: a whole mosaic layout (layout/fill), { tokens, look? } (look), { tokens } of motion tokens only (motion), or { style, palette_words? } (illustration).'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_designbook_propose'), async ({ part, ai_provenance, ai_provenance_id }) => {
    return out(await client.post('/v1/designbook', {
      part,
      ...(ai_provenance ? { ai_provenance } : {}),
      ...(ai_provenance_id ? { ai_provenance_id } : {}),
    }));
  });

  mcp.tool('aimeat_designbook_adopt', descriptionFor('aimeat_designbook_adopt'), {
    id: z.string().describe('The part to adopt.'),
    filename: z.string().describe('Your published app file the layout lands in.'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_designbook_adopt'), async ({ id, filename, ai_provenance, ai_provenance_id }) => {
    return out(await client.post(`/v1/designbook/${encodeURIComponent(id)}/adopt`, {
      filename,
      ...(ai_provenance ? { ai_provenance } : {}),
      ...(ai_provenance_id ? { ai_provenance_id } : {}),
    }));
  });
}
