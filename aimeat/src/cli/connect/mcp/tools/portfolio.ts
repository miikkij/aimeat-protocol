/**
 * @file portfolio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registration for the person's OWN welcome page — parity with the
 *   server MCP (src/mcp/portfolio.ts) so `aimeat connect serve --surface agent` exposes it the same
 *   way /v2/mcp/agent does. A thin proxy over PUT /v1/portfolio/upload, so the size cap and the
 *   "which identity does a portfolio live under" arbitration stay in one place.
 *
 *   The tool shipped onto the agent surface with no connector half, so an agent served locally
 *   could not touch its owner's welcome page while the same agent could over /v2/mcp — the same
 *   shape the company tools were in, and caught the same way, by test/unit/connector-surfaces.ts.
 * @structure registerPortfolioTools(mcp, registry) — portfolio_publish
 * @usage import { registerPortfolioTools } from './portfolio.js';
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial: connector-surface coverage for the personal welcome page.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerPortfolioTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_portfolio_publish', descriptionFor('aimeat_portfolio_publish'), {
    html: z.string().describe('The complete HTML document to serve as this person\'s welcome page. It replaces the current one.'),
  }, annotationsFor('aimeat_portfolio_publish'), async ({ html }) => {
    return out(await client.put('/v1/portfolio/upload', { html }));
  });
}
