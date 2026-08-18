/**
 * @file catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for catalogue browsing -- agent directory,
 *   public boards, and people directory searches.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: replace flattened query with real REST filters
 *     (agents: search/category; directory: city/interest) to match server MCP + REST routes.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerCatalogueTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_catalogue_agents', descriptionFor('aimeat_catalogue_agents'), {
    search: z.string().optional().describe('Free-text search (name/description/GAII)'),
    category: z.string().optional().describe('Filter by capability category'),
  }, annotationsFor('aimeat_catalogue_agents'), async ({ search, category }) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/catalogue/agents${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_catalogue_boards', descriptionFor('aimeat_catalogue_boards'), {}, annotationsFor('aimeat_catalogue_boards'), async () => {
    const resp = await client.get('/v1/catalogue/boards');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_catalogue_directory', descriptionFor('aimeat_catalogue_directory'), {
    city: z.string().optional().describe('Filter by city'),
    interest: z.string().optional().describe('Filter by interest keyword'),
  }, annotationsFor('aimeat_catalogue_directory'), async ({ city, interest }) => {
    const params = new URLSearchParams();
    if (city) params.set('city', city);
    if (interest) params.set('interest', interest);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/catalogue/directory${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
