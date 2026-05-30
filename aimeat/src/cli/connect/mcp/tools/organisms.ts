/**
 * @file organisms.ts
 * @description MCP tool registrations for organism (collective) management --
 *   listing, viewing, joining, leaving, and member listing.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerOrganismsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_organism_list', descriptionFor('aimeat_organism_list'), {}, annotationsFor('aimeat_organism_list'), async () => {
    const resp = await client.get('/v1/organisms');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_get', descriptionFor('aimeat_organism_get'), {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_get'), async ({ id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_join', descriptionFor('aimeat_organism_join'), {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_join'), async ({ id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(id)}/join`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_leave', descriptionFor('aimeat_organism_leave'), {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_leave'), async ({ id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(id)}/leave`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_members', descriptionFor('aimeat_organism_members'), {
    id: z.string().describe('Organism identifier'),
  }, annotationsFor('aimeat_organism_members'), async ({ id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(id)}/members`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
