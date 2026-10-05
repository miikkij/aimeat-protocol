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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.6.8 — 2026-09-26 — The propose contract says that beside a <ul> or <ol> of the markup every
 *     counter-reset also names list-item, and "all" takes only revert or revert-layer (parity with the
 *     server MCP).
 *   v1.6.7 — 2026-09-26 — The propose contract says a list item stays inside a list of the component:
 *     an <li> inside a <ul> or <ol>, no display: list-item, and list-item 0 beside a <summary> (parity
 *     with the server MCP).
 *   v1.6.6 — 2026-09-26 — The propose contract says the blocks of @font-feature-values pass inside it
 *     and a @function names its parameters without types (parity with the server MCP).
 *   v1.6.5 — 2026-09-26 — The propose contract says a counter, an anchor, a view transition or a
 *     timeline a declaration names starts with the component's prefix, written as the word itself
 *     (parity with the server MCP).
 *   v1.6.4 — 2026-09-26 — The propose contract says a component's stylesheet closes every block,
 *     bracket, comment and string it opens (parity with the server MCP).
 *   v1.6.3 — 2026-09-26 — The propose contract states the list of at-rules a component's stylesheet may
 *     carry (parity with the server MCP).
 *   v1.6.2 — 2026-09-26 — The propose contract says a component's stylesheet carries no @layer, @page or
 *     @view-transition, and that a name it defines with @keyframes, @property or @counter-style starts
 *     with its prefix (parity with the server MCP).
 *   v1.6.1 — 2026-09-26 — The propose contract says a component's stylesheet carries no @scope (parity
 *     with the server MCP).
 *   v1.6.0 — 2026-09-26 — The propose contract says the markup closes every element it opens and a
 *     nested rule starts with "&" (parity with the server MCP). get carries a component's `bench`, and
 *     the proposer alone gets the markup of one that no longer passes, because the route does.
 *   v1.5.0 — 2026-09-20 — aimeat_designbook_keep and the search's view "reasons" (parity with the
 *     server MCP); get carries the reasons because the route does.
 *   v1.4.0 — 2026-09-19 — A search with no word and no kind asks the route for its map view and
 *     answers the whole published shelf as one page of text (parity with the server MCP).
 *   v1.3.0 — 2026-09-05 — effect joins the kind wording, with its body and its targets (parity
 *     with the server MCP, wish-atelier-post-process-effects, stage 5).
 *   v1.2.0 — 2026-09-05 — genre and ambient join the kind wording (parity with the server MCP,
 *     wish-atelier-ambient-visuals).
 *   v1.1.0 — 2026-08-28 — The kind wording grows with the Book: look, motion and illustration
 *     join layout and fill in the search filter and the propose contract (parity with the server
 *     MCP, same slice).
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerDesignbookTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_designbook_propose', descriptionFor('aimeat_designbook_propose'), zodShapeFor('aimeat_designbook_propose'), annotationsFor('aimeat_designbook_propose'), async ({ part, ai_provenance, ai_provenance_id }) => {
    return out(await client.post('/v1/designbook', {
      part,
      ...(ai_provenance ? { ai_provenance } : {}),
      ...(ai_provenance_id ? { ai_provenance_id } : {}),
    }));
  });

  mcp.tool('aimeat_designbook_adopt', descriptionFor('aimeat_designbook_adopt'), zodShapeFor('aimeat_designbook_adopt'), annotationsFor('aimeat_designbook_adopt'), async ({ id, filename, ai_provenance, ai_provenance_id }) => {
    return out(await client.post(`/v1/designbook/${encodeURIComponent(id)}/adopt`, {
      filename,
      ...(ai_provenance ? { ai_provenance } : {}),
      ...(ai_provenance_id ? { ai_provenance_id } : {}),
    }));
  });
}
